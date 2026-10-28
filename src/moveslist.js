// The moves list: how to play the pickup game you're in, for whatever you're holding (a phone,
// a controller, a keyboard). It pauses the game while it's open.
//   open: the phone's ? button (right of QUIT), Create on the controller, Tab on the keyboard
//   close: the same, ○ / Esc, or a tap outside it

// Each row: [what it does, phone, controller, keyboard].
const BALL = {
  title: 'BASKETBALL',
  sections: [
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
      ['Alley-oop (off the glass)', 'PASS twice', '△ (3-9.5 m out)', 'F'],
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
  notes: 'Every make, miss and turnover resets the play: make it, take it; a miss is the other one\'s ball.',
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

export class MovesList {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.el = null;
  }

  // Which list (the game you're in), or null.
  which() {
    const g = this.game;
    if (g.sport?.active) return BALL;
    if (g.gridiron?.active) return FOOTBALL;
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
      });
      document.body.appendChild(this.el);
    }
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    const rows = L.sections
      .map(([h, list]) => `<div class="mv-h">${esc(h)}</div>${list.filter((r) => r[col] !== '—').map((r) => `<div class="mv-r"><span>${esc(r[0])}</span><b>${esc(r[col])}</b></div>`).join('')}`)
      .join('');
    const close = col === 1 ? 'tap ? or outside to close' : col === 2 ? 'Create or ○ to close' : 'Tab or Esc to close';
    this.el.innerHTML = `<div class="mv-card"><div class="mv-top"><span>${L.title} · MOVES</span><em>${how}</em><button class="mv-x" aria-label="close">✕</button></div><div class="mv-list">${rows}</div>${L.notes ? `<div class="mv-note">${esc(L.notes)}</div>` : ''}<div class="mv-foot">${close} · the game's paused</div></div>`;
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
