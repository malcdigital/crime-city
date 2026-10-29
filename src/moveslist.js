// The moves list: how to play the pickup game you're in, for whatever you're holding (a phone,
// a controller, a keyboard). It pauses the game while it's open.
//   open: the phone's ? button (right of QUIT), Create on the controller, Tab on the keyboard
//   close: the same, ○ / Esc, or a tap outside it

// Each row: [what it does, phone, controller, keyboard].
const BALL = {
  title: 'BASKETBALL',
  sections: [
    ['TRIPLE THREAT (WITH IT, BEFORE YOU DRIBBLE)', [
      ['Start the dribble', 'move the stick', 'left stick (or R2 + a dribble move)', 'WASD (or Shift + a move key)'],
      ['Jab step (forward, side, crossing over)', 'swipe on the right side', 'right stick: flick that way', 'J / L / I / K'],
      ['Pump fake (still no dribble)', 'SHOOT: quick tap', '□ quick tap', 'Space: quick tap'],
    ]],
    ['WITH THE BALL', [
      ['Shoot (let go in the green)', 'SHOOT: hold, let go', '□ hold, let go', 'Space / click hold'],
      ['Pump fake', 'SHOOT: quick tap', '□ quick tap', 'Space: quick tap'],
      ['Hesitation', 'tap the right side', 'right stick: flick toward the ball', 'I'],
      ['Crossover', 'swipe ← / → on the right side', 'right stick: flick left / right', 'J / L'],
      ['Spin', 'swipe ↑ on the right side', 'right stick: down-diagonal', 'U / O'],
      ['Step-back', 'swipe ↓ on the right side', 'right stick: flick down', 'K'],
      ['Behind the back', '—', 'right stick: up-diagonal', 'B / N'],
      ['Between the legs', '—', 'hold L2 + flick sideways', 'H'],
      ['Size up', '—', 'right stick: hold up', 'I hold'],
      ['Sprint', 'push the stick all the way', 'R2 / ✕', 'Shift'],
      ['Layup / dunk', 'drive at the rim + SHOOT', 'drive at the rim + □', 'drive at the rim + Space'],
      ['Alley-oop (off the glass, 3-9.5 m out; run at it, you go up within ~2 m)', 'OOP (PASS in a 1-on-1)', '△', 'F'],
      ['Pass (shooting around)', 'PASS (hold: pick who)', '✕ (hold: pick who)', 'Q'],
    ]],
    ['DEFENSE', [
      ['Guard: stay in front', 'GUARD hold', 'L2 hold', 'right-click hold'],
      ['Steal', 'STEAL', '□', 'click / R'],
      ['Block / rebound', '△', '△', 'F'],
      ['Hands up (contest)', 'HANDS hold', 'right stick hold', 'I hold'],
    ]],
    ['THE GAME', [
      ['Check it up / skip the reset', 'CHECK / SKIP', '✕', 'E'],
      ['Quit', 'QUIT, then SURE?', 'hold the touchpad', 'hold M'],
      ['This list', '?', 'Create', 'Tab'],
    ]],
  ],
  notes: 'You get the ball in triple threat: no dribble until you move. Every make, miss and turnover resets the play: make it, take it; a miss is the other one\'s ball.',
};

const FOOTBALL = {
  title: 'FOOTBALL',
  sections: [
    ['AT THE LINE', [
      ['Pick a play', 'PLAY', 'L1 / R1', 'Z / X'],
      ['Hike', '✕', '✕', 'E'],
    ]],
    ['THROWING', [
      ['Throw (tap: bullet, hold: lob)', 'the receiver\'s button', 'the button over his head (□ ✕ ○ △; R1 the back)', '1-5'],
      ['Lead the throw', 'the stick', 'left stick', 'WASD'],
    ]],
    ['RUNNING WITH IT', [
      ['Juke', 'JUKE', 'right stick ← / →', 'J / L'],
      ['Spin', 'SPIN', 'right stick ↓', 'U'],
      ['Stiff-arm', 'STIFF', '□', 'K'],
    ]],
    ['THE GAME', [
      ['Quit', 'QUIT, then SURE?', 'hold the touchpad', 'hold M'],
      ['This list', '?', 'Create', 'Tab'],
    ]],
  ],
  notes: '',
};

const QBC = {
  title: 'QB CHALLENGE',
  sections: [
    ['THROWING', [
      ['Throw at a target (tap: bullet, hold: lob)', "the target's button", 'the button over it (□ ✕ ○ △ R1)', '1-5 (or click the one you look at)'],
      ['Points', '1 · 2 · 2 · 3 · 5', 'deeper is worth more', 'deeper is worth more'],
    ]],
    ['THE GAME', [
      ['Quit', 'QUIT, then SURE?', 'hold the touchpad', 'hold M'],
      ['This list', '?', 'Create', 'Tab'],
    ]],
  ],
  notes: 'Bullets are quick but get wild deep; lobs hang up there but stay on line. 60 seconds; a new ball a beat after each throw.',
};
const CATCH = {
  title: 'PLAYING CATCH',
  sections: [
    ['THROWING (hold for power, let go in the green; tap the same button again on the line)', [
      ['Bullet (on a line, quick)', 'BULLET', '□', 'J'],
      ['Touch (over the top, dropped in)', 'TOUCH', '✕', 'K (or click)'],
      ['Lob (high, the deepest)', 'LOB', '△', 'L'],
      ['Lead him on a route', 'the stick', 'left stick', 'WASD'],
    ]],
    ['CALLING HIM', [
      ['Go long (10 yards out)', 'LONG', 'D-pad ↑', 'E'],
      ['Come closer', 'CLOSER', 'D-pad ↓', 'Q'],
      ['Run a route', '—', 'R1', 'X'],
    ]],
    ['CATCHING', [
      ['Catch it', 'be under it', 'be under it', 'be under it'],
    ]],
    ['THE GAME', [
      ['Stop', 'QUIT, then SURE?', 'hold the touchpad', 'hold M'],
      ['This list', '?', 'Create', 'Tab'],
    ]],
  ],
  notes: 'Go anywhere on the field: stay within 50 yards of each other (past that, backing off fights you and he comes in). Power: early on the meter falls short, late sails long. Accuracy: time slows to half while you throw; tap again as the needle crosses the notch (that\'s the release): early pulls it to your left, late pushes it right. Both dead on: a PERFECT PASS.',
  setting: 'meter',
};

import { ThrowMeter, METER_STYLES } from './throwmeter.js';

export class MovesList {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.el = null;
  }

  // Playing catch, the list has a setting at the top: the throw meter (◀ ▶ / H / a tap changes it).
  hasSetting() {
    return this.open && !!this.which()?.setting;
  }

  // Which list (the game you're in), or null.
  which() {
    const g = this.game;
    if (g.sport?.active) return BALL;
    if (g.gridiron?.active) return g.gridiron.mode === 'qbc' ? QBC : g.gridiron.mode === 'catch' ? CATCH : FOOTBALL;
    return null;
  }

  show() {
    const L = this.which();
    if (!L) return;
    const g = this.game;
    const col = g.input.touchMode ? 1 : g.input.mode === 'pad' ? 2 : 3;
    const how = col === 1 ? 'PHONE' : col === 2 ? 'CONTROLLER' : 'KEYBOARD';
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.id = 'moves';
      this.el.addEventListener('pointerdown', (e) => {
        if (e.target === this.el || e.target.closest('.mv-x')) this.hide();
        else if (e.target.closest('.mv-set')) {
          this.game.cycleStyle('meter');
          this.show();
        }
      });
      document.body.appendChild(this.el);
    }
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    const rows = L.sections
      .map(([h, list]) => `<div class="mv-h">${esc(h)}</div>${list.filter((r) => r[col] !== '—').map((r) => `<div class="mv-r"><span>${esc(r[0])}</span><b>${esc(r[col])}</b></div>`).join('')}`)
      .join('');
    const close = col === 1 ? 'tap ? or outside to close' : col === 2 ? 'Create or ○ to close' : 'Tab or Esc to close';
    let set = '';
    if (L.setting === 'meter') {
      const st = g.style?.meter || 'arc';
      const how2 = col === 1 ? 'tap to change' : col === 2 ? '◀ ▶ to change' : '← → or H to change';
      set = `<div class="mv-set">${`<div class="tm-preview">${ThrowMeter.preview(st)}</div>`}<span>Throw meter<small>${how2}</small></span><b>‹ ${METER_STYLES[st]} ›</b></div>`;
    }
    this.el.innerHTML = `<div class="mv-card"><div class="mv-top"><span>${L.title} · MOVES</span><em>${how}</em><button class="mv-x" aria-label="close">✕</button></div>${set}<div class="mv-list">${rows}</div>${L.notes ? `<div class="mv-note">${esc(L.notes)}</div>` : ''}<div class="mv-foot">${close} · the game's paused</div></div>`;
    this.el.classList.remove('hidden');
    this.open = true;
    document.body.classList.add('moves-open');
  }

  hide() {
    if (this.el) this.el.classList.add('hidden');
    this.open = false;
    document.body.classList.remove('moves-open');
  }

  toggle() {
    if (this.open) this.hide();
    else this.show();
  }
}
