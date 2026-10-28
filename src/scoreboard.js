// The one-on-one scoreboard, top and center:
//
//            DOWNTOWN COURT
//   ╭──────────────────────────╮
//   │   YOU              TANK   │
//   │   02       —        00    │
//   │   ● POSSESSION            │
//   ├──────────────────────────┤
//   │        FIRST TO 11        │
//   ╰──────────────────────────╯
//
// When somebody scores, their number flips over to the new one, their side lights up, a "+2"
// floats off it and the board gives a pulse. Smaller on a phone (style.css).

const pad2 = (n) => String(n).padStart(2, '0');

export class Scoreboard {
  constructor() {
    this.el = null;
    this.last = null;
  }

  build() {
    const el = document.createElement('div');
    el.id = 'scoreboard';
    el.innerHTML = `<div class="sc-place"></div>
      <div class="sc-box">
        <div class="sc-row">
          <div class="sc-side you"><div class="sc-name">YOU</div><div class="sc-num"><span></span></div><div class="sc-poss">● POSSESSION</div></div>
          <div class="sc-dash">—</div>
          <div class="sc-side opp"><div class="sc-name"></div><div class="sc-num"><span></span></div><div class="sc-poss">● POSSESSION</div></div>
        </div>
        <div class="sc-foot"></div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
  }

  // s: { place, opp (his name), you, them (the scores), poss ('you' / 'opp' / null), to, bet }
  show(s) {
    if (!this.el) this.build();
    const el = this.el;
    el.classList.remove('hidden');
    document.body.classList.add('scoreboard-on');
    const L = this.last;
    if (!L || L.place !== s.place) el.querySelector('.sc-place').textContent = s.place.toUpperCase();
    if (!L || L.opp !== s.opp) el.querySelector('.opp .sc-name').textContent = s.opp.toUpperCase();
    for (const [k, v] of [['you', s.you], ['opp', s.them]]) {
      const was = L && L.game === s.game ? (k === 'you' ? L.you : L.them) : null;
      const num = el.querySelector(`.${k} .sc-num`);
      if (was == null) num.innerHTML = `<span>${pad2(v)}</span>`;
      else if (v !== was) this.scored(k, num, was, v);
    }
    el.querySelector('.you .sc-poss').classList.toggle('on', s.poss === 'you');
    el.querySelector('.opp .sc-poss').classList.toggle('on', s.poss === 'opp');
    const gp = Math.max(s.you, s.them) === s.to - 1;
    const foot = `${gp ? '<b>GAME POINT</b> · ' : ''}FIRST TO ${s.to}${s.bet ? ` · $${s.bet}` : ''}`;
    if (!L || L.foot !== foot) el.querySelector('.sc-foot').innerHTML = foot;
    this.last = { ...s, foot };
  }

  // The scoring animation on one side.
  scored(k, num, was, v) {
    const el = this.el;
    // (the old number flips up and out, the new one drops in)
    num.innerHTML = `<span class="out">${pad2(was)}</span><span class="in">${pad2(v)}</span>`;
    setTimeout(() => {
      if (num.querySelector('.in')) num.innerHTML = `<span>${pad2(v)}</span>`;
    }, 520);
    const side = el.querySelector(`.${k}`);
    const pop = document.createElement('div');
    pop.className = 'sc-pop';
    pop.textContent = `+${v - was}`;
    side.appendChild(pop);
    setTimeout(() => pop.remove(), 1100);
    // (restart the glow and the pulse even if they're still going)
    for (const [node, cls] of [[side, 'hit'], [el.querySelector('.sc-box'), 'pulse']]) {
      node.classList.remove(cls);
      void node.offsetWidth;
      node.classList.add(cls);
    }
  }

  hide() {
    if (this.el) this.el.classList.add('hidden');
    document.body.classList.remove('scoreboard-on');
    this.last = null;
  }
}
