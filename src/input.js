// Keyboard and mouse input. Uses pointer lock when available, and falls back to
// click-and-drag mouse look when the browser blocks it (e.g. inside an iframe).
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mdx = 0;
    this.mdy = 0;
    this.clicked = false;
    this.locked = false;
    this.dragging = false;

    addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (this.locked) this.clicked = true;
      else this.dragging = true;
    });
    addEventListener('mouseup', () => (this.dragging = false));
    document.addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging) {
        this.mdx += e.movementX;
        this.mdy += e.movementY;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
  }

  lock() {
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {});
    } catch {
      // Pointer lock unavailable; drag-to-look still works.
    }
  }

  down(code) {
    return this.keys.has(code);
  }

  hit(code) {
    return this.pressed.has(code);
  }

  endFrame() {
    this.pressed.clear();
    this.mdx = 0;
    this.mdy = 0;
    this.clicked = false;
  }
}
