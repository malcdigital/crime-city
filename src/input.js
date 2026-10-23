import { clamp } from './util.js';

// PS5 / standard gamepad button indices.
export const PAD = {
  CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3, L1: 4, R1: 5, L2: 6, R2: 7,
  CREATE: 8, OPTIONS: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, TOUCHPAD: 17,
};

const DEAD = 0.18;
const deadzone = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

// Button names shown in prompts, for keyboard and controller.
const LABELS = {
  enter: ['F', '△'],
  interact: ['E', 'D-pad ↑'],
  fire: ['Left-click', 'R2'],
  aim: ['Right-click', 'L2'],
  melee: ['J', '○'],
  reload: ['R', '□'],
  sprint: ['Shift', '✕'],
  play: ['Click PLAY', 'Press ✕'],
  phone: ['T', 'D-pad →'],
  crouch: ['C', 'L3'],
  map: ['M', 'Touchpad'],
  contacts: ['R', '□'],
};

// Keyboard, mouse and gamepad input, merged into one set of actions per frame.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mdx = 0;
    this.mdy = 0;
    this.clicked = false;
    this.lmb = false;
    this.rmb = false;
    this.wheel = 0;
    this.locked = false;
    this.dragging = false;
    this.mode = 'kb';
    this.pad = null;
    this.padPrev = [];
    this.padNow = [];

    addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.mode = 'kb';
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.lmb = this.rmb = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      this.mode = 'kb';
      if (e.button === 2) this.rmb = true;
      if (e.button !== 0) return;
      if (this.locked) {
        this.clicked = true;
        this.lmb = true;
      } else this.dragging = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.lmb = false;
        this.dragging = false;
      }
      if (e.button === 2) this.rmb = false;
    });
    canvas.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging) {
        this.mdx += e.movementX;
        this.mdy += e.movementY;
        this.mode = 'kb';
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.lmb = false;
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

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  // Read the controller. Call once at the start of each frame.
  poll() {
    let pad = null;
    let pads = [];
    try {
      pads = navigator.getGamepads ? navigator.getGamepads() || [] : [];
    } catch {
      // Some embedded pages block controller access.
      this.padBlocked = true;
    }
    for (const g of pads) {
      if (g && g.connected) {
        if (!pad || g.mapping === 'standard') pad = g;
      }
    }
    this.pad = pad;
    this.padNow = pad ? pad.buttons.map((b) => b.pressed || b.value > 0.5) : [];
    if (pad) {
      const active = this.padNow.some((b) => b) || pad.axes.some((a) => Math.abs(a) > 0.35);
      if (active) this.mode = 'pad';
    }
  }

  get padConnected() {
    return !!this.pad;
  }

  down(code) {
    return this.keys.has(code);
  }

  hit(code) {
    return this.pressed.has(code);
  }

  btn(i) {
    return !!this.padNow[i];
  }

  btnVal(i) {
    return this.pad?.buttons[i]?.value || 0;
  }

  btnHit(i) {
    return !!this.padNow[i] && !this.padPrev[i];
  }

  axis(i) {
    return deadzone(this.pad?.axes[i] || 0);
  }

  label(action) {
    return LABELS[action][this.mode === 'pad' ? 1 : 0];
  }

  actions(dt) {
    const k = (c) => this.keys.has(c);
    const a = {};
    a.moveX = clamp((k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0) + this.axis(0), -1, 1);
    a.moveY = clamp((k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0) - this.axis(1), -1, 1);
    a.sprint = k('ShiftLeft') || k('ShiftRight') || this.btn(PAD.CROSS);
    a.crouch = this.hit('KeyC') || this.btnHit(PAD.L3);
    a.lookX = -this.mdx * 0.0025 + (k('ArrowLeft') ? dt * 2.2 : 0) - (k('ArrowRight') ? dt * 2.2 : 0) - this.axis(2) * dt * 3.2;
    a.lookY = this.mdy * 0.0025 + this.axis(3) * dt * 2.0;
    a.aim = this.rmb || this.btnVal(PAD.L2) > 0.3;
    a.aimPressed = this.btnHit(PAD.L2);
    a.fire = this.lmb || this.btnVal(PAD.R2) > 0.3;
    a.firePressed = this.clicked || this.btnHit(PAD.R2);
    a.melee = this.hit('KeyJ') || this.btnHit(PAD.CIRCLE);
    a.enter = this.hit('KeyF') || this.btnHit(PAD.TRIANGLE);
    a.interactHeld = k('KeyE') || this.btn(PAD.UP);
    a.interactKey = k('KeyE');
    a.reload = this.hit('KeyR') || this.btnHit(PAD.SQUARE);
    a.nextWeapon = this.wheel > 0 || this.btnHit(PAD.DOWN);
    a.wheelDelta = this.wheel;
    a.dpadDown = this.btnHit(PAD.DOWN);
    a.dpadUp = this.btnHit(PAD.UP);
    // Weapon wheel: hold L1 / Tab (tap to swap back to your last weapon).
    a.wheelHeld = k('Tab') || this.btn(PAD.L1);
    a.rsX = this.axis(2);
    a.rsY = this.axis(3);
    a.mouseDX = this.mdx;
    a.mouseDY = this.mdy;
    a.prevWeapon = this.wheel < 0 || this.btnHit(PAD.LEFT);
    a.slot = -1;
    for (let n = 1; n <= 8; n++) if (this.hit(`Digit${n}`)) a.slot = n - 1;
    a.throttle = clamp((k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0) + this.btnVal(PAD.R2) - this.btnVal(PAD.L2), -1, 1);
    a.steer = clamp((k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0) + this.axis(0), -1, 1);
    a.handbrake = k('Space') || this.btn(PAD.R1);
    // Gas and brake held at the same time (for burnouts).
    a.gas = k('KeyW') || k('ArrowUp') || this.btnVal(PAD.R2) > 0.5;
    a.brakeHeld = k('KeyS') || k('ArrowDown') || this.btnVal(PAD.L2) > 0.5;
    a.pause = this.hit('KeyP') || this.btnHit(PAD.OPTIONS);
    a.phone = this.hit('KeyT') || this.btnHit(PAD.RIGHT) || this.btnHit(PAD.CREATE);
    a.start = this.btnHit(PAD.CROSS) || this.btnHit(PAD.OPTIONS);
    a.menuUp = this.hit('ArrowUp') || this.hit('KeyW') || this.btnHit(PAD.UP);
    a.menuDown = this.hit('ArrowDown') || this.hit('KeyS') || this.btnHit(PAD.DOWN);
    a.menuOk = this.hit('Enter') || this.hit('Space') || this.hit('KeyE') || this.btnHit(PAD.CROSS);
    a.menuBack = this.hit('Escape') || this.hit('Backspace') || this.btnHit(PAD.CIRCLE) || this.btnHit(PAD.OPTIONS);
    a.dealYes = this.hit('KeyE') || this.btnHit(PAD.CROSS);
    a.dealNo = this.hit('KeyQ') || this.btnHit(PAD.CIRCLE);
    a.map = this.hit('KeyM') || this.btnHit(PAD.TOUCHPAD);
    a.mapWaypoint = this.hit('Enter') || this.hit('Space') || this.btnHit(PAD.CROSS);
    a.playClip = this.hit('Enter') || this.btnHit(PAD.CROSS);
    a.closeClip = this.hit('Escape') || this.btnHit(PAD.CIRCLE);
    a.spawnCar = this.hit('KeyV') || this.btnHit(PAD.R3);
    a.looking = a.lookX !== 0 || a.lookY !== 0;
    return a;
  }

  endFrame() {
    this.pressed.clear();
    this.mdx = 0;
    this.mdy = 0;
    this.clicked = false;
    this.wheel = 0;
    this.padPrev = this.padNow;
  }
}
