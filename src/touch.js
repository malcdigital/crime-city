// Touch controls for phones and tablets. They work like a virtual PS5 controller: every button
// here presses the same controller button the game already understands (input.js), so all the
// prompts, menus and the phone work the same as with a real controller.
// - Left thumb: a joystick that appears wherever you touch the left side (moves you; steers,
//   gas and brake in a car). Push it all the way out to sprint.
// - Right thumb: drag anywhere on the right side to look around (dragging off FIRE aims too).
// - Buttons change with what you're doing: on foot, driving, phone, map, shop menus and the
//   inventory strip. USE lights up when there's something to do.
// They switch on by themselves the first time you touch the screen.
const B = { CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3, L1: 4, R1: 5, L2: 6, R2: 7, CREATE: 8, OPTIONS: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, TOUCHPAD: 17 };
function capture(el, id) {
  try {
    el.setPointerCapture(id);
  } catch {
    // (some browsers refuse; the touch still works without it)
  }
}
const LOOK = 1.5; // look speed (mouse pixels per screen pixel)
const STICK_R = 56; // joystick radius in pixels
// Driving with the stick (thumbs are less precise than a real stick):
const STEER_R = 76; // a wider sideways throw for steering
const STEER_DEAD = 0.07; // a little slack in the middle so the car tracks straight
const STEER_CURVE = 1.7; // gentle near the center, full lock at the edge
const STEER_RATE = 3.2; // how fast the wheel turns toward the stick (full lock per ~0.3 s)
const STEER_RETURN = 7; // and how fast it comes back to center when you let go
const PAD_DEAD = 0.18; // input.js's stick deadzone (the shaped steering skips past it)

// [id, label, button, contexts, kind, class]
// kind: 'hold' (pressed while touched), 'toggle' (tap on / tap off), 'fire' (hold + drag to
// look), 'weapon' (tap = swap; long-press opens the inventory strip until the next tap).
const BUTTONS = [
  ['fire', 'FIRE', B.R2, ['foot', 'ball'], 'fire', 'big red'],
  ['aim', 'AIM', B.L2, ['foot'], 'toggle', 'mid'],
  ['reload', '□', B.SQUARE, ['foot', 'strip', 'ball'], 'hold', 'sm'],
  ['cross', '✕', B.CROSS, ['foot', 'car', 'phone', 'menu', 'strip', 'map', 'stop', 'ball'], 'hold', 'sm'],
  ['circle', '○', B.CIRCLE, ['foot', 'car', 'phone', 'menu', 'map', 'stop'], 'hold', 'sm'],
  ['fight', '□', B.SQUARE, ['stop'], 'hold', 'sm'], // (a police stop: fight back)
  ['tri', '△', B.TRIANGLE, ['foot', 'car', 'map'], 'hold', 'sm'],
  ['crouch', 'DUCK', B.L3, ['foot'], 'hold', 'sm txt'],
  ['weapon', 'GUN', B.L1, ['foot', 'strip'], 'weapon', 'sm txt'],
  ['use', 'USE', B.UP, ['foot', 'car'], 'hold', 'pill'],
  ['gas', 'GAS', B.R2, ['car'], 'hold', 'pedal green'],
  ['brake', 'BRAKE', B.L2, ['car'], 'hold', 'pedal'],
  ['hand', 'HAND\nBRAKE', B.R1, ['car'], 'hold', 'mid txt'],
  ['zin', 'ZOOM +', B.R2, ['map'], 'hold', 'mid txt'],
  ['zout', 'ZOOM −', B.L2, ['map'], 'hold', 'mid txt'],
  ['heat', '□', B.SQUARE, ['map'], 'hold', 'sm'],
  ['up', '▲', B.UP, ['phone', 'menu', 'map'], 'hold', 'dp'],
  ['down', '▼', B.DOWN, ['phone', 'menu', 'map'], 'hold', 'dp'],
  ['left', '◀', B.LEFT, ['phone', 'menu', 'strip'], 'hold', 'dp'],
  ['right', '▶', B.RIGHT, ['phone', 'menu', 'strip'], 'hold', 'dp'],
  ['pause', '❚❚', B.OPTIONS, ['foot', 'car', 'phone', 'map', 'strip', 'stop', 'ball'], 'hold', 'top'],
  ['phone', '📱', B.CREATE, ['foot', 'car', 'phone'], 'hold', 'top'],
  ['map', 'MAP', B.TOUCHPAD, ['foot', 'car', 'map'], 'hold', 'top txt'],
  ['spawn', 'CAR', B.R3, ['foot'], 'hold', 'top txt test'],
];
// What the face buttons mean here, shown small under the symbol.
const HINTS = {
  foot: { cross: 'yes', circle: 'punch', tri: 'car', reload: 'reload' },
  car: { cross: 'yes', circle: 'no', tri: 'exit' },
  phone: { cross: 'ok', circle: 'back' },
  menu: { cross: 'buy', circle: 'leave' },
  strip: { cross: 'give', reload: 'drop', weapon: 'close' },
  map: { cross: 'pin', circle: 'close', tri: 'legend', heat: 'heat' },
  stop: { cross: 'quietly', circle: 'bribe', fight: 'fight' },
  ball: { fire: 'shoot', reload: 'steal', cross: 'block' },
};

export class TouchControls {
  constructor(input, opts = {}) {
    this.input = input;
    this.enabled = false;
    this.lastT = -1;
    this.ctx = ''; // (set on the first update)
    this.btn = new Array(18).fill(0);
    this.held = new Map(); // button index -> number of touches holding it
    this.toggled = new Set();
    this.fresh = new Set(); // pressed and released before the game saw it: report once
    this.axes = [0, 0, 0, 0];
    this.raw = [0, 0]; // stick offset in pixels
    this.steer = 0; // smoothed steering (driving)
    this.pedal = 0; // stick gas (1) / brake (-1), latched (driving)
    this.carSpeed = 0;
    this.padT = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    this.sprint = false;
    this.latched = false; // inventory strip held open
    this.showSpawn = !!opts.spawnButton;
    this.build();
    // Turn on at the first touch anywhere.
    addEventListener('touchstart', () => this.enable(), { passive: true, capture: true });
    if (opts.force) this.enable();
  }

  enable() {
    this.lastT = performance.now();
    if (this.enabled) return;
    this.enabled = true;
    document.body.classList.add('touch');
    this.root.classList.remove('hidden');
  }

  build() {
    const root = document.createElement('div');
    root.id = 'touch';
    root.className = 'hidden';
    root.dataset.ctx = 'none';
    // Zones: left = joystick, right = look.
    const left = document.createElement('div');
    left.className = 'tz tz-left';
    const right = document.createElement('div');
    right.className = 'tz tz-right';
    const stick = document.createElement('div');
    stick.className = 'stick hidden';
    stick.innerHTML = '<div class="knob"></div>';
    root.append(left, right, stick);
    this.el = { root, left, right, stick, knob: stick.firstChild, buttons: {} };
    for (const [id, label, b, ctx, kind, cls] of BUTTONS) {
      if (id === 'spawn' && !this.showSpawn) continue;
      const el = document.createElement('div');
      el.className = `tb tb-${id} ${cls} hidden`;
      el.innerHTML = `<span class="tl">${label.replace('\n', '<br>')}</span><span class="th"></span>`;
      el.dataset.ctx = ctx.join(' ');
      root.appendChild(el);
      this.el.buttons[id] = { el, b, kind, ctx, hint: el.querySelector('.th') };
      this.bindButton(id);
    }
    document.body.appendChild(root);
    this.root = root;
    this.bindStick(left);
    this.bindLook(right);
    // Keep the page from scrolling or zooming under your thumbs.
    root.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    root.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  press(b) {
    this.held.set(b, (this.held.get(b) || 0) + 1);
    this.fresh.add(b);
    this.lastT = performance.now();
  }

  release(b) {
    const n = (this.held.get(b) || 0) - 1;
    if (n <= 0) this.held.delete(b);
    else this.held.set(b, n);
  }

  bindButton(id) {
    const B0 = this.el.buttons[id];
    const { el, b, kind } = B0;
    let pid = null;
    let lx = 0;
    let ly = 0;
    let downT = 0;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.enable();
      capture(el, e.pointerId);
      pid = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
      downT = e.timeStamp; // (when the finger landed, even if the page was busy)
      el.classList.add('on');
      if (kind === 'toggle') {
        if (this.toggled.has(b)) this.toggled.delete(b);
        else this.toggled.add(b);
        this.fresh.add(b);
        return;
      }
      if (kind === 'weapon' && this.latched) {
        // Close the inventory strip.
        this.latched = false;
        this.release(b);
        pid = null;
        return;
      }
      this.press(b);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid || kind !== 'fire') return;
      // Drag off the fire button to aim while shooting.
      this.lookDX += (e.clientX - lx) * LOOK;
      this.lookDY += (e.clientY - ly) * LOOK;
      lx = e.clientX;
      ly = e.clientY;
    });
    const up = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      el.classList.toggle('on', kind === 'toggle' && this.toggled.has(b));
      if (kind === 'toggle') return;
      if (kind === 'weapon' && e.timeStamp - downT > 350) {
        // Long press: keep the strip open until the next tap.
        this.latched = true;
        el.classList.add('on');
        return;
      }
      this.release(b);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  bindStick(zone) {
    let pid = null;
    let ox = 0;
    let oy = 0;
    const { stick, knob } = this.el;
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.enable();
      if (pid !== null) return;
      pid = e.pointerId;
      capture(zone, e.pointerId);
      ox = e.clientX;
      oy = e.clientY;
      stick.style.left = `${ox}px`;
      stick.style.top = `${oy}px`;
      stick.classList.remove('hidden');
      knob.style.transform = 'translate(-50%, -50%)';
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      this.lastT = performance.now();
      let dx = e.clientX - ox;
      let dy = e.clientY - oy;
      const d = Math.hypot(dx, dy);
      // Pushed well past the edge: sprint (and the stick follows your thumb).
      this.sprint = d > STICK_R * 1.25;
      if (d > STICK_R * 1.6) {
        const k = (d - STICK_R * 1.6) / d;
        ox += dx * k;
        oy += dy * k;
        stick.style.left = `${ox}px`;
        stick.style.top = `${oy}px`;
        dx = e.clientX - ox;
        dy = e.clientY - oy;
      }
      this.raw[0] = dx;
      this.raw[1] = dy;
      const dd = Math.hypot(dx, dy);
      const s = dd > STICK_R ? STICK_R / dd : 1;
      this.axes[0] = (dx * s) / STICK_R;
      this.axes[1] = (dy * s) / STICK_R;
      knob.style.transform = `translate(calc(-50% + ${dx * s}px), calc(-50% + ${dy * s}px))`;
    });
    const up = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      this.axes[0] = this.axes[1] = 0;
      this.raw[0] = this.raw[1] = 0;
      this.pedal = 0;
      this.sprint = false;
      stick.classList.add('hidden');
    };
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
  }

  bindLook(zone) {
    const last = new Map();
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.enable();
      capture(zone, e.pointerId);
      last.set(e.pointerId, [e.clientX, e.clientY]);
    });
    zone.addEventListener('pointermove', (e) => {
      const p = last.get(e.pointerId);
      if (!p) return;
      this.lastT = performance.now();
      this.lookDX += (e.clientX - p[0]) * LOOK;
      this.lookDY += (e.clientY - p[1]) * LOOK;
      last.set(e.pointerId, [e.clientX, e.clientY]);
    });
    const up = (e) => last.delete(e.pointerId);
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
  }

  // Which set of buttons to show (called every frame before the input is read).
  update(game) {
    if (!this.enabled) return;
    let ctx = 'foot';
    if (!game.started || game.paused || game.wastedT > 0 || game.bustedT > 0 || game.clipPlayer?.open || game.travel?.active) ctx = 'none';
    else if (game.shops.menu) ctx = 'menu';
    else if (game.mapView.open) ctx = 'map';
    else if (game.hud.phoneOpen) ctx = 'phone';
    else if (this.latched || game.inventory?.open) ctx = 'strip';
    else if (game.stop) ctx = 'stop'; // (pulled over: go quietly, bribe, or fight)
    else if (game.player.vehicle) ctx = 'car';
    else if (game.sport?.active || game.gridiron?.active) ctx = 'ball'; // (a pickup game: shoot / throw, steal, block / hike)
    this.carSpeed = game.player.vehicle ? Math.abs(game.player.vehicle.speed) : 0;
    if (ctx !== this.ctx) {
      // New screen: let go of everything (a held AIM must not become a held BRAKE).
      if (!(this.ctx === 'foot' && ctx === 'strip') && !(this.ctx === 'strip' && ctx === 'foot')) {
        this.held.clear();
        this.toggled.clear();
        this.latched = false;
        for (const { el } of Object.values(this.el.buttons)) el.classList.remove('on');
      }
      this.ctx = ctx;
      this.root.dataset.ctx = ctx;
      for (const [id, B0] of Object.entries(this.el.buttons)) {
        const show = B0.ctx.includes(ctx);
        B0.el.classList.toggle('hidden', !show);
        B0.hint.textContent = (HINTS[ctx] && HINTS[ctx][id]) || '';
      }
    }
    if (ctx === 'stop') this.el.buttons.fight.hint.textContent = game.player.vehicle ? 'floor it' : 'fight';
    if (ctx === 'ball') {
      const qb = !!game.gridiron?.active; // (football: throw and hike; no steal)
      this.el.buttons.fire.hint.textContent = qb ? 'throw' : 'shoot';
      this.el.buttons.cross.hint.textContent = qb ? 'hike' : 'block';
      this.el.buttons.reload.el.classList.toggle('hidden', qb);
    }
    // FIRE is dimmed until you aim (a gun only fires while aiming).
    const fire = this.el.buttons.fire;
    if (fire) fire.el.classList.toggle('dim', ctx === 'foot' && !game.aimingNow && !game.arsenal?.current()?.melee);
    // USE lights up when there's something to do.
    const use = this.el.buttons.use;
    if (use) use.el.classList.toggle('hot', !!game.prompt && /\bUSE\b/.test(game.prompt));
    const w = this.el.buttons.weapon;
    if (w && ctx === 'foot') w.el.querySelector('.tl').textContent = (game.arsenal?.current()?.name || 'GUN').split(' ')[0].toUpperCase().slice(0, 6);
  }

  // The virtual controller for this frame (same shape as a Gamepad).
  pad() {
    for (let i = 0; i < this.btn.length; i++) this.btn[i] = this.held.has(i) || this.toggled.has(i) || this.fresh.has(i) ? 1 : 0;
    if (this.latched) this.btn[B.L1] = 1;
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this.padT || now)) / 1000);
    this.padT = now;
    const axes = [this.axes[0], this.axes[1], 0, 0];
    if (this.ctx === 'car') {
      axes[0] = this.driveSteer(dt);
      // The stick's up/down is gas/brake too. Push up past a third to get on the gas and it
      // stays on while you steer, even if your thumb drifts sideways or down a bit; pull back
      // below the middle to come off it. Same for the brake.
      const y = this.raw[1] / STICK_R;
      if (y < -0.35) this.pedal = 1;
      else if (y > 0.35) this.pedal = -1;
      else if ((this.pedal > 0 && y > 0.2) || (this.pedal < 0 && y < -0.2)) this.pedal = 0;
      if (this.pedal > 0) this.btn[B.R2] = Math.max(this.btn[B.R2], Math.min(1, 0.6 + Math.max(0, -y - 0.35)));
      if (this.pedal < 0) this.btn[B.L2] = Math.max(this.btn[B.L2], Math.min(1, 0.6 + Math.max(0, y - 0.35)));
      axes[1] = 0;
    } else {
      this.steer = 0;
      this.pedal = 0;
    }
    this.fresh.clear();
    return { connected: true, mapping: 'standard', axes, buttons: this.btn.map((v) => ({ pressed: v > 0.5, value: v })) };
  }

  // Steering from the stick: a wide sideways throw, gentle near the center, less lock the
  // faster you go, and the wheel turns smoothly instead of snapping.
  driveSteer(dt) {
    const x = Math.max(-1, Math.min(1, this.raw[0] / STEER_R));
    const m = Math.max(0, (Math.abs(x) - STEER_DEAD) / (1 - STEER_DEAD));
    const fast = Math.min(1, this.carSpeed / 35);
    const want = Math.sign(x) * Math.pow(m, STEER_CURVE) * (1 - 0.45 * fast);
    const rate = Math.abs(want) < Math.abs(this.steer) || want * this.steer < 0 ? STEER_RETURN : STEER_RATE;
    const d = want - this.steer;
    this.steer += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    // (input.js applies its stick deadzone; step past it so small steering still counts)
    if (Math.abs(this.steer) < 0.005) return 0;
    return Math.sign(this.steer) * (PAD_DEAD + (1 - PAD_DEAD) * Math.abs(this.steer));
  }

  takeLook() {
    const r = [this.lookDX, this.lookDY];
    this.lookDX = this.lookDY = 0;
    return r;
  }

  // Touched in the last few seconds (vs. a real controller or the keyboard).
  get recent() {
    return this.enabled && performance.now() - this.lastT < 30000;
  }
}
