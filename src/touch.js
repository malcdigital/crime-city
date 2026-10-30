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
// look), 'weapon' (tap = swap; hold = reload; swipe up opens the inventory strip until the next tap),
// 'quit' (tap twice to quit the pickup game).
const BUTTONS = [
  ['fire', 'FIRE', B.R2, ['foot'], 'fire', 'big red'],
  ['aim', 'AIM', B.L2, ['foot'], 'toggle', 'mid'],
  ['reload', '□', B.SQUARE, ['strip', 'qb'], 'hold', 'sm'], // (on foot: hold the GUN button to reload)
  ['cross', '✕', B.CROSS, ['foot', 'car', 'phone', 'menu', 'strip', 'map', 'stop', 'qb'], 'hold', 'sm'],
  ['circle', '○', B.CIRCLE, ['foot', 'car', 'phone', 'menu', 'map', 'stop', 'qb'], 'hold', 'sm'],
  ['fight', '□', B.SQUARE, ['stop'], 'hold', 'sm'], // (a police stop: fight back)
  // Pickup basketball (streetball.js): NBA 2K style.
  // Street dice (dice.js): roll, walk away, and craps' with / fade.
  ['droll', 'ROLL', B.CROSS, ['dice'], 'hold', 'big red txt'],
  ['dleave', 'LEAVE', B.CIRCLE, ['dice'], 'hold', 'mid txt'],
  ['dleft', '◀', B.LEFT, ['dice'], 'hold', 'sm'],
  ['dright', '▶', B.RIGHT, ['dice'], 'hold', 'sm'],
  ['bshoot', 'SHOOT', B.SQUARE, ['ball'], 'hold', 'big red txt'],
  ['bblock', '△', B.TRIANGLE, ['ball'], 'hold', 'sm'],
  ['bpass', 'PASS', B.CROSS, ['ball'], 'hold', 'mid txt'],
  ['boop', 'OOP', B.TRIANGLE, ['ball'], 'hold', 'mid txt'], // (shooting around: off the glass to yourself)
  ['bd', 'GUARD', B.L2, ['ball'], 'hold', 'mid txt'], // (hold: stay in front of him)
  ['bcross', 'CROSS', 18, ['ball'], 'hold', 'sm txt'],
  ['bhesi', 'HESI', 19, ['ball'], 'hold', 'sm txt'],
  ['bstep', 'STEP', 20, ['ball'], 'hold', 'sm txt'],
  ['bspin', 'SPIN', 21, ['ball'], 'hold', 'sm txt'],
  // Football (gridiron.js): ✕ hikes; then □ ✕ ○ △ throw to the receiver with that button
  // over his head (tap: bullet, hold: lob).
  ['qfire', 'FIRE', B.R2, [], 'hold', 'big red'],
  // (PLAY at the line picks the play; after the snap it's R1: the back. Running with it: moves.)
  ['qr1', 'PLAY', B.R1, ['qb'], 'hold', 'mid txt'],
  // (playing catch: □ ✕ △ are bullet, touch, lob; LONG / CLOSER call him out or in)
  ['clong', 'LONG', B.UP, ['qb'], 'hold', 'sm txt'],
  ['cclose', 'CLOSER', B.DOWN, ['qb'], 'hold', 'sm txt'],
  // (the QB Challenge: ◀ ▶ pick the ring)
  ['tprev', '◀', B.LEFT, ['qb'], 'hold', 'sm'],
  ['tnext', '▶', B.RIGHT, ['qb'], 'hold', 'sm'],
  ['rjuke', 'JUKE', 18, ['qb'], 'hold', 'sm txt'],
  ['rspin', 'SPIN', 21, ['qb'], 'hold', 'sm txt'],
  ['rstiff', 'STIFF', 20, ['qb'], 'hold', 'sm txt'],
  ['tri', '△', B.TRIANGLE, ['map', 'qb'], 'hold', 'sm'], // (on foot and in the car, USE gets you in and out)
  ['crouch', 'DUCK', B.L3, ['foot'], 'hold', 'sm txt'],
  ['weapon', 'GUN', B.L1, ['foot', 'strip'], 'weapon', 'sm txt'],
  ['use', 'USE', B.UP, ['foot', 'car'], 'hold', 'pill'], // (not in a pickup game: QUIT leaves it)
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
  ['pause', '❚❚', B.OPTIONS, ['foot', 'car', 'phone', 'map', 'strip', 'stop', 'ball', 'qb'], 'hold', 'top'],
  ['phone', '📱', B.CREATE, ['foot', 'car', 'phone'], 'hold', 'top'],
  ['map', 'MAP', B.TOUCHPAD, ['foot', 'car', 'map'], 'hold', 'top txt'],
  ['spawn', 'CAR', B.R3, ['foot'], 'hold', 'top txt test'],
  // Quit the pickup game (tap, then tap SURE? to confirm: a stray tap won't forfeit the bet).
  ['quit', 'QUIT', -1, ['ball', 'qb'], 'quit', 'top txt'],
  // The moves list for the game you're in (pauses it), right of QUIT.
  ['moves', '?', -1, ['ball', 'qb', 'moves'], 'moves', 'top'],
];
// What the face buttons mean here, shown small under the symbol.
const HINTS = {
  foot: { cross: 'yes', circle: 'no' },
  car: { cross: 'yes', circle: 'no' },
  phone: { cross: 'ok', circle: 'back' },
  menu: { cross: 'buy', circle: 'leave' },
  strip: { cross: 'give', reload: 'drop', weapon: 'close' },
  map: { cross: 'pin', circle: 'close', tri: 'legend', heat: 'heat' },
  stop: { cross: 'quietly', circle: 'bribe', fight: 'fight' },
  ball: { bblock: 'block', bd: 'hold' },
  qb: { cross: 'hike' },
};

// What the USE button does right now, in a word, read off the prompt the game is showing
// ("Press USE to pick up from Dre" → PICK UP). Unknown wording falls back to its first verb.
const VERBS = [
  [/^pick ?up|^grab/i, 'PICK UP'], [/^drop off/i, 'DROP OFF'], [/^put it down/i, 'DROP'], [/^pay/i, 'PAY'],
  [/^swap/i, 'SWAP'], [/^sell/i, 'SELL'], [/^rob/i, 'ROB'], [/^buy|^look at buying/i, 'BUY'], [/^bank/i, 'BANK'],
  [/^use the atm/i, 'ATM'], [/^tag/i, 'TAG'], [/^recruit/i, 'RECRUIT'], [/^send/i, 'SEND'], [/^mod/i, 'MOD'],
  [/^take the bus/i, 'BUS'], [/^hail/i, 'TAXI'], [/^get in the .*game/i, 'JOIN'], [/^get in\b/i, 'ENTER'], [/^carjack/i, 'JACK'], [/^get out/i, 'EXIT'], [/^start/i, 'START'], [/^shop|^browse/i, 'SHOP'],
  [/^enter|^go in|^go inside/i, 'ENTER'], [/^talk/i, 'TALK'],
];
// Simple icons (white, drawn at 24×24) for the buttons that are things rather than actions.
const svg = (body, fill = false) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICONS = {
  map: svg('<path d="M3 6.5l5.5-2 7 2 5.5-2v13l-5.5 2-7-2-5.5 2z"/><path d="M8.5 4.5v13M15.5 6.5v13"/>'),
  phone: svg('<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>'),
  spawn: svg('<path d="M2.5 15.5v-3l2.5-1 2.5-4h8l3 4 3 1v3h-2"/><path d="M7.5 15.5h8"/><circle cx="6" cy="16" r="2"/><circle cx="17.5" cy="16" r="2"/>'),
};
// The GUN button shows what's in your hands.
const WEAPON_ICONS = {
  fists: svg('<rect x="4.6" y="5.2" width="3.9" height="6.6" rx="1.95"/><rect x="8.6" y="3.8" width="3.9" height="8" rx="1.95"/><rect x="12.6" y="4.2" width="3.9" height="7.6" rx="1.95"/><rect x="16.5" y="5.8" width="3.4" height="6" rx="1.7"/><path d="M4.6 10.2h15.3v4.3a6.6 6.6 0 0 1-6.6 6.6h-2A6.7 6.7 0 0 1 4.6 14.4z"/><path d="M5.2 13.6h6.4a1.7 1.7 0 0 0 0-3.4H9.4" fill="none" stroke="rgba(15,18,26,.85)" stroke-width="1.5" stroke-linecap="round"/>', true),
  pistol: svg('<path d="M3 7h16.5l1 1.6v2.2h-6.6l-1 1.2h-2.2l-1.4 5.5H5.1l1.6-6.1H3z"/>', true),
  smg: svg('<path d="M2 8h17.5l1.5 1.5V11h-5.5l-.8 1H12l-1 6H8.6l.8-6H7.5l-.4 3.5H5L5.4 11H2z"/>', true),
  rifle: svg('<path d="M1 9.5h4l1-1.5h12l1.5-1h3v2.5h-3.5l-1 1H14l-.6 1H11l-1.3 4.5H7.5l1-4.5H6.5L4.5 14H1.5l1.5-3.5H1z"/>', true),
  shotgun: svg('<path d="M1 10.5l3.5-1.5H23v1.8h-8v1.4H8.5l-1.2.8H5.5l-2.5 3H1z"/>', true),
};

export function useVerb(prompt) {
  if (!prompt || !/\bUSE\b/.test(prompt)) return null;
  if (/USE:\s*"/.test(prompt)) return 'TALK'; // (asking a court to play)
  let m = prompt.match(/(?:Press|Hold|Tap)\s+USE\s+(?:to|for)\s+(.+)/i) || prompt.match(/USE:?\s+(.+)/);
  let phrase = m ? m[1] : '';
  if (!phrase) {
    // ("Pick up the ball and shoot around: USE")
    m = prompt.match(/^(.+?):\s*USE\s*$/);
    phrase = m ? m[1] : '';
  }
  if (/^for\b/i.test(phrase) || (m && /\bfor\s/.test(m[0]) && !/\sto\s/.test(m[0]))) return /safehouse|home|house|apartment|condo|loft|penthouse/i.test(phrase) ? 'ENTER' : 'OPEN'; // (yours: go in / open it up)
  for (const [re, w] of VERBS) if (re.test(phrase.trim())) return w;
  const w = (phrase.trim().split(/\s+/)[0] || '').replace(/[^a-z]/gi, '').toUpperCase();
  return w && w.length <= 8 ? w : 'USE';
}

export class TouchControls {
  constructor(input, opts = {}) {
    this.input = input;
    this.enabled = false;
    this.lastT = -1;
    this.ctx = ''; // (set on the first update)
    this.btn = new Array(22).fill(0);
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
      el.innerHTML = `<span class="tl">${ICONS[id] || label.replace('\n', '<br>')}</span><span class="th"></span>`;
      if (ICONS[id]) el.classList.add('icon');
      el.setAttribute('aria-label', id === 'spawn' ? 'car' : id);
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

  // The ? button was tapped (input.js asks once a frame).
  takeMoves() {
    const t = this.movesNow;
    this.movesNow = false;
    return t;
  }

  // One quick press, seen by the game for a frame.
  tap(b) {
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
    let pressed = null;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.enable();
      capture(el, e.pointerId);
      pid = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
      downT = e.timeStamp; // (when the finger landed, even if the page was busy)
      if (kind === 'moves') {
        this.movesNow = true;
        this.lastT = performance.now();
        pid = null;
        return;
      }
      if (kind === 'quit') {
        if (this.quitArm > e.timeStamp) this.quitNow = true;
        else this.quitArm = e.timeStamp + 2500;
        pid = null;
        return;
      }
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
      if (id === 'bpass' && this.passOop) {
        // (a one-on-one: nobody to pass to, so it's the OOP button: off the glass to yourself)
        this.tap(B.TRIANGLE);
        pressed = null;
        return;
      }
      if (kind === 'weapon') {
        // (the GUN button: tap swaps, hold reloads, swipe up opens the inventory strip; decided
        // as it goes, in update and pointermove)
        this.wHold = { t0: performance.now(), y0: e.clientY, done: false };
        return;
      }
      // (USE presses whatever it's showing: the interact button, or △ to get in / out of a car)
      pressed = id === 'use' ? this.useB ?? b : b;
      this.press(pressed);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId === pid && kind === 'weapon' && this.wHold && !this.wHold.done && e.clientY - this.wHold.y0 < -28) {
        // (swiped up: the inventory strip, open until the next tap)
        this.wHold.done = true;
        this.latched = true;
        el.classList.add('on');
        return;
      }
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
      if (kind === 'weapon') {
        const W = this.wHold;
        this.wHold = null;
        if (this.latched) {
          el.classList.add('on');
          return;
        }
        if (W && !W.done) this.tap(b); // (a tap: swap weapons)
        return;
      }
      this.release(pressed ?? b);
      pressed = null;
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

  // The right side of the screen: drag to look. With the ball in a pickup game it's the dribble
  // moves instead: a tap is a hesitation, a quick swipe left / right a crossover that way, up a
  // spin, down a step-back (each fires the moment the swipe is long enough).
  bindLook(zone) {
    const last = new Map();
    const gest = new Map();
    const SWIPE = 32;
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.enable();
      capture(zone, e.pointerId);
      last.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.dribbleGest) gest.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp, done: false });
    });
    zone.addEventListener('pointermove', (e) => {
      const p = last.get(e.pointerId);
      if (!p) return;
      this.lastT = performance.now();
      const G = gest.get(e.pointerId);
      if (G) {
        // (a dribble gesture: no looking around with it)
        last.set(e.pointerId, [e.clientX, e.clientY]);
        if (G.done) return;
        const dx = e.clientX - G.x;
        const dy = e.clientY - G.y;
        if (Math.hypot(dx, dy) < SWIPE) return;
        G.done = true;
        if (Math.abs(dx) >= Math.abs(dy)) this.dribble('cross', dx < 0 ? -1 : 1);
        else if (dy < 0) this.dribble('spin', Math.abs(dx) > 8 ? Math.sign(dx) : 0);
        else this.dribble('step', 0);
        return;
      }
      this.lookDX += (e.clientX - p[0]) * LOOK;
      this.lookDY += (e.clientY - p[1]) * LOOK;
      last.set(e.pointerId, [e.clientX, e.clientY]);
    });
    const up = (e) => {
      last.delete(e.pointerId);
      const G = gest.get(e.pointerId);
      gest.delete(e.pointerId);
      // (a tap: lifted quickly without swiping)
      if (G && !G.done && e.type === 'pointerup' && e.timeStamp - G.t < 350) this.dribble('hesi', 0);
    };
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
  }

  // A dribble move from a gesture, for input.js to pick up this frame.
  dribble(kind, side) {
    this.gesture = { kind, side };
    this.lastT = performance.now();
    if (navigator.vibrate) {
      try {
        navigator.vibrate(8);
      } catch {
        // (no haptics)
      }
    }
  }

  // Which set of buttons to show (called every frame before the input is read).
  update(game) {
    if (!this.enabled) return;
    let ctx = 'foot';
    if (!game.started || game.paused || game.wastedT > 0 || game.bustedT > 0 || game.clipPlayer?.open || game.travel?.active) ctx = 'none';
    else if (game.matchup?.open) ctx = 'none'; // (the matchup cinematic: tap anywhere to skip)
    else if (game.moves?.open) ctx = 'moves'; // (the moves list: just its ? to close it)
    else if (game.courtMenu?.open || game.card?.open) ctx = 'none'; // (the court menu, the contest card: tap them directly)
    else if (game.shops.menu) ctx = 'menu';
    else if (game.mapView.open) ctx = 'map';
    else if (game.hud.phoneOpen) ctx = 'phone';
    else if (this.latched || game.inventory?.open) ctx = 'strip';
    else if (game.stop) ctx = 'stop'; // (pulled over: go quietly, bribe, or fight)
    else if (game.player.vehicle) ctx = 'car';
    else if (game.dice?.playing) ctx = 'dice'; // (street dice: roll, leave, with / fade)
    else if (game.sport?.active) ctx = 'ball'; // (one-on-one: shoot, moves, steal, block)
    else if (game.gridiron?.active) ctx = 'qb'; // (quarterback: throw, hike)
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
    // On foot and in the car, ✕ (and the car's ○) are only for answering: a buyer's offer, a
    // corner tax, a ticket. They show while a question's up, and hide the rest of the time.
    if (ctx === 'foot' || ctx === 'car') {
      const ask = game.time - (game.askedAt ?? -99) < 0.3;
      const bx = this.el.buttons;
      bx.cross.el.classList.toggle('hidden', !ask);
      bx.circle.el.classList.toggle('hidden', !ask); // (on foot, punching is on USE)
    }
    if (ctx === 'stop') this.el.buttons.fight.hint.textContent = game.player.vehicle ? 'floor it' : 'fight';
    if (ctx === 'qb') {
      const M = game.gridiron;
      const b = this.el.buttons;
      const line = M?.state === 'line';
      const running = M?.state === 'play' && M.scramble && game.football?.ball?.holder === 'you';
      b.cross.hint.textContent = line ? 'hike' : '';
      for (const id of ['reload', 'cross', 'circle', 'tri']) b[id].el.classList.toggle('hidden', running);
      for (const id of ['rjuke', 'rspin', 'rstiff']) b[id].el.classList.toggle('hidden', !running);
      b.qr1.el.classList.toggle('hidden', running);
      b.qr1.el.querySelector('.tl').textContent = line ? 'PLAY' : 'R1';
      // Playing catch: □ bullet, ✕ touch, △ lob, LONG / CLOSER (no ○, no R1).
      // (the QB Challenge too: the same three throws; ◀ ▶ pick the ring)
      const cat = M?.mode === 'catch';
      const qbc = M?.mode === 'qbc';
      const meter = cat || qbc;
      this.el.root.dataset.mode = cat ? 'catch' : qbc ? 'qbc' : '';
      b.reload.hint.textContent = meter ? 'bullet' : '';
      b.tri.hint.textContent = meter ? 'lob' : '';
      // (a ball coming to you: CATCH is the only button)
      const incoming = cat && ((game.football?.ball?.mode === 'flight' && game.football.ball.to === 'you') || !!M?.cat?.late);
      this.el.root.classList.toggle('catching', incoming); // (CATCH alone, and big: style.css)
      if (meter) b.cross.hint.textContent = incoming ? 'catch' : 'touch';
      b.circle.el.classList.toggle('hidden', running || meter);
      b.qr1.el.classList.toggle('hidden', running || meter);
      b.clong.el.classList.toggle('hidden', !cat || incoming);
      b.cclose.el.classList.toggle('hidden', !cat || incoming);
      b.reload.el.classList.toggle('hidden', running || incoming);
      b.tri.el.classList.toggle('hidden', running || incoming);
      // (the QB Challenge's last stage: ◀ ▶ are the juke)
      const juke = qbc && !!M.qbcJukeOn?.();
      b.tprev.el.classList.toggle('hidden', !juke);
      b.tnext.el.classList.toggle('hidden', !juke);
      b.tprev.hint.textContent = b.tnext.hint.textContent = juke ? 'juke' : '';
      if (juke) for (const id of ['reload', 'cross', 'tri']) b[id].el.classList.add('hidden'); // (no throwing till you've beaten him: just the juke)
    }
    if (ctx !== 'qb') this.el.root.classList.remove('catching');
    this.dribbleGest = false;
    if (ctx === 'ball') {
      // (on defense: SHOOT is steal, the moves are hidden)
      const off = game.sport.has === 'you' && !game.sport.t3; // (the contest: just SHOOT)
      const dead = !!(game.sport.check || game.sport.reset || game.sport.dead); // (checking it up / resetting the play: just the one button)
      const b = this.el.buttons;
      const st = game.sport.reset ? 'SKIP' : game.sport.check ? 'CHECK' : off || game.sport.has !== 'opp' ? 'SHOOT' : 'STEAL';
      const stl = b.bshoot.el.querySelector('.tl');
      if (stl.textContent !== st) stl.textContent = st;
      b.bblock.hint.textContent = game.sport.has === 'opp' ? 'block' : 'rebound';
      // (with the ball the dribble moves are gestures on the right side of the screen, so no
      // move buttons; △ is for D and rebounds, the oop is a double tap on PASS)
      for (const id of ['bcross', 'bstep', 'bspin']) b[id].el.classList.add('hidden');
      b.bhesi.el.classList.toggle('hidden', game.sport.has !== 'opp' || dead); // (on defense: HANDS, hold to contest)
      b.bhesi.el.querySelector('.tl').textContent = 'HANDS';
      b.bblock.el.classList.toggle('hidden', !!game.sport.t3 || off || dead);
      b.bpass.el.classList.toggle('hidden', dead || !!game.sport.t33 || !(off || (game.sport.solo && game.sport.g?.ball?.mode === 'loose'))); // (passing / the oop; a fetch shooting around)
      // (a one-on-one: no one to pass to, so PASS is OOP; shooting around, OOP gets its own button)
      this.passOop = off && !game.sport.solo;
      const pl = b.bpass.el.querySelector('.tl');
      const pt = this.passOop ? 'OOP' : 'PASS';
      if (pl.textContent !== pt) pl.textContent = pt;
      b.bpass.hint.textContent = '';
      b.boop.el.classList.toggle('hidden', !(off && game.sport.solo && !game.sport.t33));
      this.dribbleGest = off; // (the right side: tap hesi, swipe cross / spin / step back)
      b.bd.el.classList.toggle('hidden', !!game.sport.solo || off || dead); // (GUARD: on defense only; with the ball the back-pedal is automatic)
    }
    // QUIT: armed by the first tap (SURE?), quits on the second.
    const qb = this.el.buttons.quit;
    if (qb) {
      const armed = this.quitArm > performance.now();
      qb.el.querySelector('.tl').textContent = armed ? 'SURE?' : 'QUIT';
      qb.el.classList.toggle('hot', armed);
      if (this.quitNow) {
        this.quitNow = false;
        this.quitArm = 0;
        qb.el.querySelector('.tl').textContent = 'QUIT';
        qb.el.classList.remove('hot');
        if (armed) game.quitPickup?.();
      }
    }
    // FIRE is dimmed until you aim (a gun only fires while aiming); with your fists (or a melee
    // weapon) out it's your punch / swing, and says so.
    const fire = this.el.buttons.fire;
    if (fire) {
      const mw = game.arsenal?.current();
      fire.el.classList.toggle('dim', ctx === 'foot' && !game.aimingNow && !mw?.melee);
      const ft = ctx === 'foot' && mw?.melee ? (/fist/i.test(mw.name || '') ? 'PUNCH' : 'SWING') : 'FIRE';
      const fl = fire.el.querySelector('.tl');
      if (fl.textContent !== ft) fl.textContent = ft;
    }
    // USE is the one contextual button: it says what it'll do and lights up when there's
    // something to do — the prompt's action (PICK UP, BUY, ROB, PAY, TALK...), or with nothing
    // else around, ENTER the car you're next to / EXIT the one you're in.
    const use = this.el.buttons.use;
    if (use) {
      let verb = useVerb(game.prompt);
      this.useB = B.UP;
      if (verb && /USE to (get in|carjack|get out)\b/.test(game.prompt || '')) this.useB = B.TRIANGLE; // (cars: the enter button)
      if (!verb && ctx === 'foot' && game.nearestVehicle?.(3.8)) {
        verb = 'ENTER';
        this.useB = B.TRIANGLE;
      } else if (!verb && ctx === 'car') {
        verb = 'EXIT';
        this.useB = B.TRIANGLE;
      }
      const text = verb || 'USE';
      const tl = use.el.querySelector('.tl');
      if (tl.textContent !== text) tl.textContent = text;
      use.el.classList.toggle('hot', !!verb && verb !== 'EXIT');
      use.el.classList.toggle('ready', verb === 'EXIT'); // (always there: not dimmed)
      use.el.classList.toggle('long', text.length > 6);
    }
    const w = this.el.buttons.weapon;
    // (held a moment: reload; the label says so while it's reloading)
    if (this.wHold && !this.wHold.done && performance.now() - this.wHold.t0 > 350) {
      this.wHold.done = true;
      if (ctx === 'foot') this.tap(B.SQUARE);
    }
    if (w && ctx === 'foot') {
      const wpn = game.arsenal?.current();
      const id = WEAPON_ICONS[wpn?.id] ? wpn.id : 'pistol';
      if (this.wIcon !== id) {
        this.wIcon = id;
        w.el.querySelector('.tl').innerHTML = WEAPON_ICONS[id];
        w.el.classList.add('icon');
        w.el.setAttribute('aria-label', wpn?.name || 'weapon');
      }
      w.el.classList.toggle('reloading', game.arsenal?.reloadT > 0); // (an amber ring runs round it while you reload)
    }
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
