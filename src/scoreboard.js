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
// The flames that go up behind a side when that player's on fire: tongues of fire of different
// sizes, flickering out of step, and a few embers rising.
const flames = () => {
  let h = '';
  for (let i = 0; i < 9; i++) {
    const w = 16 + ((i * 7) % 4) * 6;
    h += `<i style="left:${(i / 8) * 100 - 8}%;width:${w}px;height:${38 + ((i * 5) % 3) * 14}px;animation-delay:-${(i * 0.13) % 0.6}s;animation-duration:${0.45 + ((i * 3) % 4) * 0.08}s"></i>`;
  }
  for (let i = 0; i < 5; i++) h += `<b style="left:${12 + i * 19}%;animation-delay:-${i * 0.31}s"></b>`;
  return `<div class="sc-flames">${h}</div>`;
};

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
          <div class="sc-side you">${flames()}<div class="sc-name">YOU</div><div class="sc-num"><span></span></div><div class="sc-poss">● POSSESSION</div></div>
          <div class="sc-dash">—</div>
          <div class="sc-side opp">${flames()}<div class="sc-name"></div><div class="sc-num"><span></span></div><div class="sc-poss">● POSSESSION</div></div>
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
    this.fitBoard(el, '--fs', 0.2, 0.25);
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
    this.fitBoard(el, '--fs', 0.3, 0.32);
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

  // The 3-point contest: the clock, the score, a row of dots per station (green made, red
  // missed, the money balls blue-ringed, the deep balls gold), the ball you're on outlined.
  showContest(v) {
    this.contestEl();
    const el = this.elC;
    el.classList.remove('qbc');
    el.querySelector('.c3-t').textContent = '3-POINT CONTEST';
    this.contestBody(v);
  }

  // (the board and its 3-2-1, made once; shared by the 3-point contest and the QB Challenge)
  contestEl() {
    if (!this.elC) {
      const el = document.createElement('div');
      el.id = 'board3pt';
      el.innerHTML = `<div class="c3-box"><div class="c3-head"><span class="c3-t">3-POINT CONTEST</span><span class="c3-clock"></span></div><div class="c3-racks"></div><div class="c3-foot"><span>SCORE <b class="c3-sc"></b></span><span>BEST <b class="c3-best"></b></span></div></div>`;
      // (the 3-2-1 is its own element, centered on the screen, not inside the scaled board)
      const cn = document.createElement('div');
      cn.id = 'c3-count';
      document.body.append(el, cn);
      this.elC = el;
      this.elCount = cn;
    }
  }

  contestBody(v) {
    const el = this.elC;
    el.classList.remove('hidden');
    this.elCount.classList.remove('hidden');
    document.body.classList.add('scoreboard-on', 'board3pt-on');
    this.fitContest();
    const sec = Math.ceil(v.clock);
    const ck = el.querySelector('.c3-clock');
    ck.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    ck.classList.toggle('low', v.clock <= 10 && v.phase !== 'count');
    const sc = el.querySelector('.c3-sc');
    if (sc.textContent !== String(v.score)) {
      sc.textContent = String(v.score);
      this.restart(sc, 'bump');
    }
    el.querySelector('.c3-best').textContent = String(Math.max(v.best || 0, 0));
    const html = v.stations
      .map((S, si) => `<div class="c3-st ${S.kind}">${S.balls.map((b, bi) => `<i class="${b.kind}${b.res ? ` ${b.res}` : ''}${v.cur && v.cur[0] === si && v.cur[1] === bi ? ' cur' : ''}"></i>`).join('')}</div>`)
      .join('');
    const racks = el.querySelector('.c3-racks');
    if (racks.innerHTML !== html) racks.innerHTML = html;
    const cn = this.elCount;
    const ctext = v.phase === 'count' ? String(v.count) : '';
    document.body.classList.toggle('counting', !!ctext); // (no toasts over the 3-2-1: style.css)
    if (cn.dataset.n !== ctext) {
      cn.dataset.n = ctext;
      cn.innerHTML = ctext ? `${ctext}<small></small>` : '';
      if (ctext) {
        cn.querySelector('small').textContent = `MONEY RACK: ${String(v.moneyName || '').toUpperCase()}`;
        this.restart(cn, 'pop');
      }
    }
  }

  // The QB Challenge on the same board: the clock, the three stages (each one's score, the one
  // you're on lit, the ones done ticked), the multiplier when you're on a streak, the score and
  // the record; the 3-2-1 before each stage with its name under it.
  showQbc(v) {
    this.contestEl();
    const el = this.elC;
    el.classList.remove('hidden');
    el.classList.add('qbc');
    this.elCount.classList.remove('hidden');
    document.body.classList.add('scoreboard-on', 'board3pt-on');
    const t = el.querySelector('.c3-t');
    if (t.textContent !== 'QB CHALLENGE') t.textContent = 'QB CHALLENGE';
    this.fitContest();
    const sec = Math.ceil(v.left);
    const ck = el.querySelector('.c3-clock');
    ck.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    ck.classList.toggle('low', v.left <= (v.lowAt ?? 10) && v.phase !== 'count');
    const sc = el.querySelector('.c3-sc');
    if (sc.textContent !== String(v.score)) {
      sc.textContent = String(v.score);
      this.restart(sc, 'bump');
    }
    el.querySelector('.c3-best').textContent = String(Math.max(v.best || 0, 0));
    const html =
      v.stages.map((S, i) => `<div class="c3-st qs${i === v.stage ? ' cur' : ''}${S.done ? ' done' : ''}"><span>${S.name}</span><b>${S.score}</b></div>`).join('') +
      `<div class="c3-st qm${v.mult > 1 ? ` on m${v.mult}` : ''}${v.heat ? ` ${v.heat}` : ''}"><span>${v.heat === 'fire' ? 'ON FIRE' : v.heat === 'rhythm' ? 'IN RHYTHM' : `STREAK ${v.streak}`}</span><b>x${v.mult}</b></div>`;
    const racks = el.querySelector('.c3-racks');
    if (racks.innerHTML !== html) {
      const bumped = racks.querySelector('.qm b')?.textContent !== `x${v.mult}` && v.mult > 1;
      racks.innerHTML = html;
      if (bumped) this.restart(racks.querySelector('.qm'), 'bump');
    }
    const cn = this.elCount;
    const ctext = v.phase === 'count' && v.count > 0 ? String(v.count) : '';
    document.body.classList.toggle('counting', !!ctext); // (no toasts over the 3-2-1: style.css)
    const key = `${ctext}:${v.stage}`;
    if (cn.dataset.n !== key) {
      cn.dataset.n = key;
      cn.innerHTML = ctext ? `${ctext}<small></small>` : '';
      if (ctext) {
        cn.querySelector('small').textContent = `STAGE ${v.stage + 1} · ${v.stages[v.stage].name}: ${String(v.sub || '').toUpperCase()}`;
        this.restart(cn, 'pop');
      }
    }
  }

  // Sizing the contest board to the screen. On a phone it sits in the top-right corner, in the
  // space between the pause / QUIT buttons and the edge (the cash and clock hide under it while
  // the contest's on), scaled to fit whatever the width; anywhere else it's centered at the
  // top, scaled down only if the window's too narrow for it. Rechecked when the window or the
  // touch layout changes.
  fitContest() {
    this.fitBoard(this.elC, '--c3s', 0.12, 0.2);
  }

  // Sizing a board to the screen. On a phone it sits in the top-right corner, in the space
  // between the pause / QUIT buttons and the edge (the cash and clock hide under it while it's
  // up), scaled to fit that width and no taller than phoneH of the screen; anywhere else it's
  // centered at the top, scaled down only if the window's too small for it. Rechecked when
  // the window, the buttons or the board's own size change.
  fitBoard(el, prop, phoneH, deskH) {
    if (!el) return;
    // (a phone, or a narrow window: the corner layout)
    const touch = document.body.classList.contains('touch') || innerWidth < 760;
    let left = 0; // (the right edge of the pause / QUIT buttons up top, or of the info top left)
    if (touch) {
      for (const b of document.querySelectorAll('.tb-quit, .tb-pause, .tb-moves')) {
        const r = b.getBoundingClientRect();
        if (r.width && r.top < 80) left = Math.max(left, r.right);
      }
      if (!document.body.classList.contains('touch')) {
        const tl = document.getElementById('top-left')?.getBoundingClientRect();
        if (tl) left = Math.max(left, tl.right + 6);
      }
      if (!left) left = innerWidth * 0.5;
    }
    const w = el.offsetWidth; // (unscaled: transforms don't change it)
    const h = el.offsetHeight;
    const key = `${innerWidth}x${innerHeight}:${touch}:${Math.round(left)}:${w}x${h}`;
    if (el.dataset.fit === key) return;
    el.dataset.fit = key;
    const s = touch ? Math.max(0.45, Math.min(1, (innerWidth - left - 10 - Math.max(8, innerWidth * 0.01)) / w, (innerHeight * phoneH) / h)) : Math.min(1, (innerWidth - 16) / w, (innerHeight * deskH) / h);
    el.style.setProperty(prop, s.toFixed(3));
  }

  hideContest() {
    if (this.elC) this.elC.classList.add('hidden');
    if (this.elCount) this.elCount.classList.add('hidden');
    document.body.classList.remove('board3pt-on', 'counting');
  }

  hide33() {
    if (this.el33) this.el33.classList.add('hidden');
    document.body.classList.remove('scoreboard-on', 'board33-on');
    this.last33 = null;
  }

  hide() {
    this.hide33();
    this.hideContest();
    if (this.el) this.el.classList.add('hidden');
    document.body.classList.remove('scoreboard-on');
    this.last = null;
  }
}
