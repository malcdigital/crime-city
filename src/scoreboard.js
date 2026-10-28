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
    for (const k of ['you', 'opp']) {
      // (heating up: HEAT CHECK, then ON FIRE, by the name)
      const side = el.querySelector(`.${k}`);
      const st = s.heat?.[k] || null;
      side.classList.toggle('check', st === 'check');
      side.classList.toggle('fire', st === 'fire');
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

  // 33:
  //   ╭────────────────────────────────╮
  //   │ 33                     3 ALIVE │
  //   │              POT               │
  //   │               9                │
  //   │      MAKE +3 · MISS TAKE 9     │
  //   ├────────────────────────────────┤
  //   │   YOU        TANK      SMOKE   │
  //   │  12 / 33    27 / 33    6 / 33  │
  //   │  ━━━━░░░░   ━━━━━━━░   ━━░░░░  │
  //   │  ▲ SHOOTING                    │
  //   ╰────────────────────────────────╯
  //          MISS → YOUR SCORE: 21
  // A make bumps the pot; a miss drops it onto the shooter (his side flashes, "+9" floats off).
  // s: { game, pot, turn (index), players: [{ name, score, out, color, you }] }
  show33(s) {
    if (!this.el33) {
      const el = document.createElement('div');
      el.id = 'board33';
      el.innerHTML = `<div class="b3-box"><div class="b3-head"><span class="b3-title">33</span><span class="b3-alive"></span></div>
        <div class="b3-pot"><div class="b3-pl">POT</div><div class="b3-pv"></div><div class="b3-rule"></div></div>
        <div class="b3-players"></div></div><div class="b3-stake"></div>`;
      document.body.appendChild(el);
      this.el33 = el;
    }
    const el = this.el33;
    el.classList.remove('hidden');
    document.body.classList.add('scoreboard-on', 'board33-on');
    const L = this.last33 && this.last33.game === s.game ? this.last33 : null;
    const alive = s.players.filter((P) => !P.out).length;
    el.querySelector('.b3-alive').textContent = `${alive} ALIVE`;
    el.querySelector('.b3-pv').textContent = s.pot;
    el.querySelector('.b3-rule').textContent = `MAKE +3 · MISS TAKE ${s.pot}`;
    const box = el.querySelector('.b3-players');
    const key = s.players.map((P) => P.name).join('|');
    if (!L || L.key !== key) {
      box.innerHTML = s.players
        .map((P) => `<div class="b3-p" style="--pc:#${P.color.toString(16).padStart(6, '0')}"><div class="b3-n"></div><div class="b3-s"></div><div class="b3-bar"><i></i></div><div class="b3-up">▲ SHOOTING</div></div>`)
        .join('');
    }
    const cols = box.children;
    s.players.forEach((P, i) => {
      const c = cols[i];
      c.querySelector('.b3-n').textContent = P.you ? 'YOU' : P.name.toUpperCase();
      c.querySelector('.b3-s').innerHTML = P.out ? `<b>OUT</b> · ${P.score}` : `${P.score} <span>/ 33</span>`;
      const f = c.querySelector('.b3-bar i');
      f.style.width = `${Math.min(100, (P.score / 33) * 100).toFixed(1)}%`;
      c.classList.toggle('hot', !P.out && P.score >= 24);
      c.classList.toggle('out', !!P.out);
      c.classList.toggle('turn', i === s.turn && !P.out);
      // (a miss: the pot lands on him)
      const was = L && L.key === key ? L.players[i]?.score : null;
      if (was != null && P.score > was) this.flash(c, `+${P.score - was}`, 'hit');
    });
    if (L && s.pot > L.pot) this.restart(el.querySelector('.b3-pot'), 'bump');
    if (L && s.pot < L.pot && L.pot > 0) this.restart(el.querySelector('.b3-pot'), 'drain');
    const Y = s.players.find((P) => P.you);
    const st = el.querySelector('.b3-stake');
    if (Y && !Y.out) {
      const v = Y.score + s.pot;
      st.innerHTML = `MISS → YOUR SCORE: <b class="${v >= 33 ? 'dead' : ''}">${v}${v >= 33 ? ' (OUT)' : ''}</b>`;
      st.classList.toggle('mine', s.players[s.turn] === Y);
    } else st.innerHTML = Y ? 'YOU\'RE OUT · WATCHING' : '';
    this.last33 = { game: s.game, pot: s.pot, key, players: s.players.map((P) => ({ score: P.score })) };
  }

  flash(node, text, cls) {
    const pop = document.createElement('div');
    pop.className = 'sc-pop';
    pop.textContent = text;
    node.appendChild(pop);
    setTimeout(() => pop.remove(), 1100);
    this.restart(node, cls);
  }

  restart(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  hide33() {
    if (this.el33) this.el33.classList.add('hidden');
    document.body.classList.remove('scoreboard-on', 'board33-on');
    this.last33 = null;
  }

  hide() {
    this.hide33();
    if (this.el) this.el.classList.add('hidden');
    document.body.classList.remove('scoreboard-on');
    this.last = null;
  }
}
