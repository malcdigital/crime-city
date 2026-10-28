// The 3-point contest leaderboard. In the published game it's shared: everyone who plays it
// reads the same board (the artifact's database, collection "threept": one document per player,
// keyed by their id, holding their best). Each player writes only their own row. Anywhere it
// can't reach that (a local copy, signed out), it falls back to this device's own best runs.
//
// Rows hold ids and numbers only; names are looked up when the board's shown.

const LOCAL = 'crimecity.threept.v1';

export class Leaderboard {
  constructor() {
    this.ready = this.init();
  }

  async init() {
    const c = typeof window !== 'undefined' ? window.claude : null;
    if (!c?.use) return;
    try {
      const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
      this.db = db;
      this.user = user;
      this.me = user ? await user.id() : null;
    } catch {
      this.db = null;
    }
  }

  get online() {
    return !!(this.db && this.me);
  }

  local() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL)) || { best: 0, runs: [] };
    } catch {
      return { best: 0, runs: [] };
    }
  }

  saveLocal(score) {
    const L = this.local();
    L.best = Math.max(L.best || 0, score);
    L.runs = [...(L.runs || []), { score, at: Date.now() }].sort((a, b) => b.score - a.score).slice(0, 10);
    try {
      localStorage.setItem(LOCAL, JSON.stringify(L));
    } catch {
      // (private window: nothing kept)
    }
    return L;
  }

  // Your best so far (online if it can, else this device's).
  async best() {
    await this.ready;
    const L = this.local();
    if (!this.online) return L.best || 0;
    try {
      const s = await this.db.doc(`threept/${this.me}`).get();
      return Math.max(L.best || 0, s.exists ? s.data().best || 0 : 0);
    } catch {
      return L.best || 0;
    }
  }

  // A finished run. Returns { best, newBest } (best before this run).
  async submit(score) {
    await this.ready;
    const was = await this.best();
    this.saveLocal(score);
    if (this.online && score > 0) {
      try {
        const ref = this.db.doc(`threept/${this.me}`);
        const s = await ref.get();
        const d = s.exists ? s.data() : null;
        if (!d || score > (d.best || 0)) await ref.set({ best: score, at: new Date().toISOString(), runs: (d?.runs || 0) + 1 });
        else await ref.update({ runs: (d.runs || 0) + 1 });
      } catch {
        // (couldn't write: a view-only viewer, or offline; the local best still counts)
      }
    }
    return { best: was, newBest: score > was };
  }

  // The top n: [{ name, best, you }], plus your rank. shared tells which board it is.
  async top(n = 10) {
    await this.ready;
    if (this.online) {
      try {
        const q = await this.db.collection('threept').orderBy('best', 'desc').limit(n).get();
        const ids = q.docs.map((d) => d.id);
        const ps = ids.length ? await this.user.profiles(ids) : {};
        const rows = q.docs.map((d) => ({ name: (ps[d.id] && ps[d.id].name) || 'Someone', best: d.data().best || 0, you: d.id === this.me }));
        const mine = await this.best();
        let rank = rows.findIndex((r) => r.you) + 1;
        if (!rank && mine > 0) {
          const above = await this.db.collection('threept').where('best', '>', mine).get();
          rank = above.size + 1;
        }
        return { shared: true, rows, rank, mine };
      } catch {
        // (fall through to this device's)
      }
    }
    const L = this.local();
    return { shared: false, rows: (L.runs || []).map((r) => ({ name: 'You', best: r.score, you: true, at: r.at })), rank: 0, mine: L.best || 0 };
  }
}
