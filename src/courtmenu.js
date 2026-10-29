// The "what we playing?" menu at a court (or a field): who's run it is, your cash, the games
// to choose from, the house rules (the wager, how long), START, or watch from the side.
//
//   SMOKE'S RUN                         Cash $700
//   Ledger Ave Courts
//   CHOOSE YOUR GAME
//   [ 1 ON 1 vs. SMOKE · 88 OVR · First to 11 ]   (the chosen one is boxed)
//     33 · 3 players · Every player for themselves
//   HOUSE RULES
//   Wager      ‹ $100 ›
//   Play to    ‹  11  ›
//   [ START GAME · $100 ]
//   Watch courtside
//   ✕ Select   ◀ ▶ Change   ○ Back
//
// Controller: D-pad ↑↓ to move, ◀ ▶ to change a rule, ✕ to pick, ○ to back out. Keyboard:
// arrows / W S A D, Enter / E, Esc. Mouse and touch: tap a game, tap the arrows, tap START.
// The game waits while it's open (main.js).

export class CourtMenu {
  constructor(game) {
    this.game = game;
    this.open = false;
    const el = document.createElement('div');
    el.id = 'court-menu';
    el.className = 'hidden';
    document.body.appendChild(el);
    this.el = el;
    el.addEventListener('click', (e) => this.click(e));
  }

  // opts: { title, place, games: [{ id, title, sub() }], rules: [{ id, label, values, i, fmt,
  // only }], start(state) -> label, onStart(state), onWatch(), watch }
  show(opts) {
    const game = this.game;
    this.opts = opts;
    this.gi = 0; // (the chosen game)
    this.rows = null;
    this.focus = 0;
    this.html = null;
    this.open = true;
    if (game.input.locked) game.input.unlock();
    this.el.classList.remove('hidden');
    this.render();
  }

  close(watch = true) {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
    const cb = this.opts?.onClose;
    if (cb) cb(watch);
  }

  state() {
    const o = this.opts;
    const s = { game: o.games[this.gi].id };
    for (const r of o.rules) s[r.id] = r.values[r.i];
    return s;
  }

  // The rows you can move between: each game, the rules that apply to the chosen game, START,
  // watch.
  rowList() {
    const o = this.opts;
    const rows = o.games.map((g, i) => ({ kind: 'game', i }));
    const gid = o.games[this.gi].id;
    o.rules.forEach((r, i) => {
      if (!r.only || r.only === gid || (Array.isArray(r.only) && r.only.includes(gid))) rows.push({ kind: 'rule', i });
    });
    rows.push({ kind: 'start' });
    rows.push({ kind: 'watch' });
    return rows;
  }

  update(a) {
    const inp = this.game.input;
    const rows = this.rowList();
    const n = rows.length;
    const left = a.phoneLeft || inp.hit?.('KeyA');
    const right = a.phoneRight || inp.hit?.('KeyD');
    if (a.menuUp) this.focus = (this.focus - 1 + n) % n;
    if (a.menuDown) this.focus = (this.focus + 1) % n;
    this.focus = Math.min(this.focus, n - 1);
    const r = rows[this.focus];
    if ((left || right) && r) {
      if (r.kind === 'rule') this.change(r.i, right ? 1 : -1);
      else if (r.kind === 'game') {
        // (◀ ▶ on the games flips between them too)
        this.gi = (this.gi + (right ? 1 : -1) + this.opts.games.length) % this.opts.games.length;
        this.focus = this.gi;
      }
    }
    if (a.menuOk && r) this.pick(r);
    else if (a.menuBack) this.close(true);
    if (this.open) this.render();
  }

  change(ri, d) {
    const R = this.opts.rules[ri];
    R.i = (R.i + d + R.values.length) % R.values.length;
    this.opts.onChange?.(R);
  }

  pick(r) {
    if (r.kind === 'game') {
      // (choosing a game takes you down to START)
      this.gi = r.i;
      this.focus = this.rowList().findIndex((x) => x.kind === 'start');
    } else if (r.kind === 'rule') this.change(r.i, 1);
    else if (r.kind === 'start') {
      const s = this.state();
      this.open = false;
      this.el.classList.add('hidden');
      this.opts.onStart(s);
    } else if (r.kind === 'watch') this.close(true);
  }

  click(e) {
    const t = e.target.closest('[data-row]');
    if (e.target === this.el) return this.close(true);
    if (!t) return;
    const rows = this.rowList();
    const k = +t.dataset.row;
    this.focus = k;
    const arrow = e.target.closest('[data-step]');
    if (arrow && rows[k]?.kind === 'rule') this.change(rows[k].i, +arrow.dataset.step);
    else this.pick(rows[k]);
    if (this.open) this.render();
  }

  render() {
    const game = this.game;
    const o = this.opts;
    const rows = this.rowList();
    const inp = game.input;
    const pad = inp.mode === 'pad' && !inp.touchMode;
    const money = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
    const s = this.state();
    let k = 0;
    const games = o.games
      .map((g, i) => {
        const row = k++;
        const on = i === this.gi;
        return `<div class="cm-game${on ? ' on' : ''}${this.focus === row ? ' focus' : ''}" data-row="${row}"><div class="cm-gt">${g.title}</div><div class="cm-gs">${g.sub(s)}</div></div>`;
      })
      .join('');
    const gid = o.games[this.gi].id;
    const rules = o.rules
      .filter((r) => !r.only || r.only === gid || (Array.isArray(r.only) && r.only.includes(gid)))
      .map((r) => {
        const row = k++;
        return `<div class="cm-rule${this.focus === row ? ' focus' : ''}" data-row="${row}"><span>${r.label}</span><span class="cm-val"><b data-step="-1">‹</b><i>${r.fmt(r.values[r.i])}</i><b data-step="1">›</b></span></div>`;
      })
      .join('');
    const startRow = k++;
    const watchRow = k++;
    const help = inp.touchMode ? 'Tap to choose · tap ‹ › to change' : pad ? '✕ Select &nbsp;&nbsp; ◀ ▶ Change &nbsp;&nbsp; ○ Back' : 'Enter Select &nbsp;&nbsp; ← → Change &nbsp;&nbsp; Esc Back';
    const html = `<div class="cm-box">
      <div class="cm-head"><div><div class="cm-title">${o.title}</div><div class="cm-place">${o.place}</div></div><div class="cm-cash">Cash ${money(game.cash)}</div></div>
      <div class="cm-h">CHOOSE YOUR GAME</div>
      <div class="cm-games">${games}</div>
      <div class="cm-h">HOUSE RULES</div>
      <div class="cm-rules">${rules}</div>
      <div class="cm-start${this.focus === startRow ? ' focus' : ''}" data-row="${startRow}">${o.start(s)}</div>
      <div class="cm-watch${this.focus === watchRow ? ' focus' : ''}" data-row="${watchRow}">${o.watch || 'Watch courtside'}</div>
      <div class="cm-help">${help}</div>
    </div>`;
    void rows;
    if (html !== this.html) {
      // (only when something's changed: a click mid-redraw would miss)
      this.html = html;
      this.el.innerHTML = html;
      this.el.querySelector('.focus')?.scrollIntoView?.({ block: 'nearest' }); // (a short screen: keep the chosen row in view)
    }
  }
}
