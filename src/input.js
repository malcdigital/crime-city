import { clamp } from './util.js';

// PS5 / standard gamepad button indices.
export const PAD = {
  CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3, L1: 4, R1: 5, L2: 6, R2: 7,
  CREATE: 8, OPTIONS: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, TOUCHPAD: 17,
};

const DEAD = 0.18;
const deadzone = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

// Button names shown in prompts, for keyboard and controller.
// (Third: the touch buttons on a phone.)
const LABELS = {
  enter: ['F', '△', '△'],
  interact: ['E', 'D-pad ↑', 'USE'],
  fire: ['Left-click', 'R2', 'FIRE'],
  aim: ['Right-click', 'L2', 'AIM'],
  melee: ['J', '○', '○'],
  reload: ['R', '□', '□'],
  sprint: ['Shift', '✕', 'push the stick all the way'],
  play: ['Click PLAY', 'Press ✕', 'Tap PLAY'],
  phone: ['T', 'D-pad →', '📱'],
  crouch: ['C', 'L3', 'DUCK'],
  map: ['M', 'Touchpad', 'MAP'],
  contacts: ['R', '□', '□'],
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
    this.realPad = pad;
    if (pad && (pad.buttons.some((b) => b.pressed) || pad.axes.some((a) => Math.abs(a) > 0.35))) this.padActiveT = performance.now();
    // Touch controls act as a controller (touch.js): used when touched more recently than a
    // real controller.
    this.touchMode = false;
    const t = this.touch;
    if (t && t.enabled && (!pad || t.lastT > (this.padActiveT || 0))) {
      pad = t.pad();
      this.touchMode = t.recent;
      const [dx, dy] = t.takeLook();
      this.mdx += dx;
      this.mdy += dy;
      if (t.recent) this.mode = 'pad';
    }
    this.pad = pad;
    this.padNow = pad ? pad.buttons.map((b) => b.pressed || b.value > 0.5) : [];
    if (pad && !this.touchMode) {
      const active = this.padNow.some((b) => b) || pad.axes.some((a) => Math.abs(a) > 0.35);
      if (active) this.mode = 'pad';
    }
  }

  // A real controller (not the touch controls).
  get padConnected() {
    return !!this.realPad;
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
    return LABELS[action][this.touchMode ? 2 : this.mode === 'pad' ? 1 : 0];
  }

  actions(dt) {
    const k = (c) => this.keys.has(c);
    const a = {};
    a.moveX = clamp((k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0) + this.axis(0), -1, 1);
    a.moveY = clamp((k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0) - this.axis(1), -1, 1);
    a.sprint = k('ShiftLeft') || k('ShiftRight') || this.btn(PAD.CROSS) || !!(this.touchMode && this.touch.sprint);
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
    a.nextWeapon = this.wheel > 0; // mouse wheel swaps weapons too
    a.wheelDelta = this.wheel;
    a.dpadDown = this.btnHit(PAD.DOWN);
    a.dpadUp = this.btnHit(PAD.UP);
    // Weapons: tap L1 / Tab to swap your two weapons, hold it to see your inventory strip.
    a.stripHeld = k('Tab') || this.btn(PAD.L1);
    // While the strip is open: give (✕ / E) and drop (□ / G), held for "all".
    a.giveHeld = this.btn(PAD.CROSS) || k('KeyE');
    a.dropHeld = this.btn(PAD.SQUARE) || k('KeyG');
    a.rsX = this.axis(2);
    a.rsY = this.axis(3);
    a.mouseDX = this.mdx;
    a.mouseDY = this.mdy;
    a.prevWeapon = this.wheel < 0;
    a.slot = -1;
    for (let n = 1; n <= 2; n++) if (this.hit(`Digit${n}`)) a.slot = n - 1;
    a.throttle = clamp((k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0) + this.btnVal(PAD.R2) - this.btnVal(PAD.L2), -1, 1);
    a.steer = clamp((k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0) + this.axis(0), -1, 1);
    a.handbrake = k('Space') || this.btn(PAD.R1);
    // Gas and brake held at the same time (for burnouts).
    a.gas = k('KeyW') || k('ArrowUp') || this.btnVal(PAD.R2) > 0.5;
    a.brakeHeld = k('KeyS') || k('ArrowDown') || this.btnVal(PAD.L2) > 0.5;
    a.pause = this.hit('KeyP') || this.btnHit(PAD.OPTIONS);
    a.phoneToggle = this.hit('KeyT') || this.btnHit(PAD.CREATE);
    a.phone = a.phoneToggle || this.btnHit(PAD.RIGHT);
    // Working the phone (and the inventory strip): D-pad / arrows, ✕ / Enter, ○ / Backspace.
    a.arrowY = (k('ArrowUp') ? 1 : 0) - (k('ArrowDown') ? 1 : 0);
    a.phoneUp = this.btnHit(PAD.UP) || this.hit('ArrowUp');
    a.phoneDown = this.btnHit(PAD.DOWN) || this.hit('ArrowDown');
    a.phoneLeft = this.btnHit(PAD.LEFT) || this.hit('ArrowLeft');
    a.phoneRight = this.btnHit(PAD.RIGHT) || this.hit('ArrowRight');
    a.phoneOk = this.btnHit(PAD.CROSS) || this.hit('Enter');
    a.phoneBack = this.btnHit(PAD.CIRCLE) || this.hit('Backspace') || this.hit('Escape');
    a.start = this.btnHit(PAD.CROSS) || this.btnHit(PAD.OPTIONS);
    a.menuUp = this.hit('ArrowUp') || this.hit('KeyW') || this.btnHit(PAD.UP);
    a.menuDown = this.hit('ArrowDown') || this.hit('KeyS') || this.btnHit(PAD.DOWN);
    a.menuOk = this.hit('Enter') || this.hit('Space') || this.hit('KeyE') || this.btnHit(PAD.CROSS);
    a.menuBack = this.hit('Escape') || this.hit('Backspace') || this.btnHit(PAD.CIRCLE) || this.btnHit(PAD.OPTIONS);
    a.dealYes = this.hit('KeyE') || this.btnHit(PAD.CROSS);
    a.dealNo = this.hit('KeyQ') || this.btnHit(PAD.CIRCLE);
    a.dealFight = this.hit('KeyR') || this.btnHit(PAD.SQUARE); // (a police stop: fight back)
    a.mapHeat = this.hit('KeyH') || this.btnHit(PAD.SQUARE);
    a.mapLegend = this.hit('KeyL') || this.btnHit(PAD.TRIANGLE);
    a.map = this.hit('KeyM') || this.btnHit(PAD.TOUCHPAD);
    a.mapHeld = k('KeyM') || this.btn(PAD.TOUCHPAD); // (held: quits a pickup game)
    a.mapWaypoint = this.hit('Enter') || this.hit('Space') || this.btnHit(PAD.CROSS);
    a.playClip = this.hit('Enter') || this.btnHit(PAD.CROSS);
    a.closeClip = this.hit('Escape') || this.btnHit(PAD.CIRCLE);
    a.spawnCar = this.hit('KeyV') || this.btnHit(PAD.R3);
    // Pickup basketball (streetball.js), NBA 2K's layout on the controller:
    //   □ hold and let go = shoot (tap = pump fake) / steal on D, R2 (or ✕) sprint, L2 intense D /
    //   box out, △ block / rebound, right stick = Pro Stick dribble moves (the camera follows).
    // Keyboard: hold left-click or Space to shoot / left-click or R to steal, Shift sprint,
    //   right-click intense D, F block / rebound, moves: J / L crossover, I hesitation (hold:
    //   size-up), K step-back, U / O spin, B / N behind the back, H between the legs (or right-click
//   with J / L). Controller: L2 held with a sideways flick = between the legs.
    // Touch: SHOOT (□), BLOCK (△), D (L2) and the CROSS / HESI / STEP / SPIN buttons.
    a.bShoot = this.lmb || k('Space') || this.btn(PAD.SQUARE);
    a.bSteal = this.clicked || this.hit('KeyR') || this.btnHit(PAD.SQUARE);
    a.bSprint = a.sprint || this.btnVal(PAD.R2) > 0.3;
    a.bIntense = this.rmb || this.btnVal(PAD.L2) > 0.3;
    a.bBlock = this.hit('KeyF') || this.btnHit(PAD.TRIANGLE);
    // Shooting around: ✕ / Q / PASS passes (tap: whoever you face; hold: lock on, let go to pass).
    a.bPass = this.btn(PAD.CROSS) || k('KeyQ');
    a.bSprintNoX = k('ShiftLeft') || k('ShiftRight') || this.btnVal(PAD.R2) > 0.3 || !!(this.touchMode && this.touch.sprint);
    a.bStickX = this.touchMode ? 0 : this.axis(2);
    a.bStickY = this.touchMode ? 0 : this.axis(3);
    const mv = [['KeyJ', 'cross', -1], ['KeyL', 'cross', 1], ['KeyI', 'hesi', 0], ['KeyK', 'step', 0], ['KeyU', 'spin', -1], ['KeyO', 'spin', 1], ['KeyB', 'behind', -1], ['KeyN', 'behind', 1], ['KeyH', 'legs', 0]];
    a.bMove = null;
    for (const [code, kind, side] of mv) if (this.hit(code)) a.bMove = { kind, side };
    a.bSizeUp = k('KeyI');
    // (on defense: hold the right stick / I / HANDS to keep your hands up and contest, no jump)
    a.bHands = (!this.touchMode && Math.hypot(this.axis(2), this.axis(3)) > 0.55) || k('KeyI') || this.btn(19);
    // (the touch buttons: 18 cross, 19 hesi, 20 step, 21 spin; their side comes from the stick)
    const tside = a.moveX < -0.2 ? -1 : a.moveX > 0.2 ? 1 : 0;
    if (this.btnHit(18)) a.bMove = { kind: 'cross', side: tside };
    if (this.btnHit(19)) a.bMove = { kind: 'hesi', side: 0 };
    if (this.btnHit(20)) a.bMove = { kind: 'step', side: 0 };
    if (this.btnHit(21)) a.bMove = { kind: 'spin', side: tside };
    // Pickup football (gridiron.js), Madden's layout: after the snap each receiver has a button
    // (□ ✕ ○ △, R1 for the back; keyboard 1-5): tap it for a bullet, hold it for a lob.
    a.qbR = [
      this.btn(PAD.SQUARE) || k('Digit1'),
      this.btn(PAD.CROSS) || k('Digit2'),
      this.btn(PAD.CIRCLE) || k('Digit3'),
      this.btn(PAD.TRIANGLE) || k('Digit4'),
      this.btn(PAD.R1) || k('Digit5'),
    ];
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
