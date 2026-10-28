import { dist, rand, pick, lerpAngle } from './util.js';

// After a pickup game (streetball.js: a one-on-one or 33), he walks up to you. Most of the time
// it's love: a handshake, a fist bump, or a dap that pulls into a hug with a pat on the back.
// Sometimes he's heated (more likely when he lost, the bigger the bet, the worse the blowout):
// he shoves you back or swings on you. Then it's yours: walk away (○ / Q), or fight (□ / R:
// fighting comes later). Walk off and it's over.
//
// While it plays out it runs his group at the court (hoops.js asks g.match for their moves),
// and main.js calls late() after your walk animation so your arms can do their part.

const GOOD_WIN = ['You nice, man. Good game.', 'Respect. You was cooking today.', "GG. I want that back next time.", 'Good run, bro. You got that.'];
const GOOD_LOSS = ['Good game. Run it back sometime.', 'GG. You got next time.', 'Good run, bro.', 'Appreciate the run. Come back through.'];
const HEATED = ['Man, get off my court!', "That's a foul and you know it!", "You lucky. Don't come back around here.", 'Watch yourself, man.', 'You think you hard?'];

export class PostGame {
  constructor(game) {
    this.game = game;
    this.active = false;
  }

  // who: the one who comes over; youWon; bet; margin (points: a blowout gets under his skin).
  start({ H, g, who, youWon, bet = 0, margin = 0, force = null }) {
    if (!who || who.removed || who.state !== 'play') return this.release(H, g);
    let angry = youWon ? 0.1 + (bet >= 250 ? 0.2 : bet >= 100 ? 0.08 : 0) + (bet >= 500 ? 0.1 : 0) + (margin >= 7 ? 0.15 : 0) : 0.04;
    angry = force ? force === 'push' || force === 'punch' : Math.random() < angry;
    const kind = force || (angry ? (Math.random() < 0.35 ? 'punch' : 'push') : pick(['shake', 'bump', 'bump', 'hug']));
    this.active = true;
    this.H = H;
    this.g = g;
    this.who = who;
    this.kind = kind;
    this.angry = angry;
    this.youWon = youWon;
    this.phase = 'approach';
    this.t = 0;
    this.hitDone = false;
    this.knock = null;
    this.line = angry ? pick(HEATED) : pick(youWon ? GOOD_WIN : GOOD_LOSS);
    g.match = this; // (his group's moves are ours a moment)
  }

  release(H, g) {
    if (g && g.match === this) g.match = null;
    if (H && g) for (const q of g.players) if (!q.removed) H.toWait(q);
  }

  finish() {
    this.active = false;
    this.release(this.H, this.g);
    this.game.prompt = '';
  }

  // (hoops.js, for his group: the ball comes down out of the net and rolls on its own; nothing
  // else to run)
  step(dt) {
    if (!this.active) return;
    const b = this.g?.ball;
    if (b && b.mode !== 'held') {
      if (b.mode !== 'loose') {
        // (still in the air when it ended: it just drops from there)
        b.mode = 'loose';
        b.vx = b.vz = b.vy = 0;
      }
      this.H.roll(b, dt);
      b.mesh?.position.set(b.x, b.y, b.z);
    }
    const w = this.who;
    if (!w || w.removed || w.state !== 'play') this.finish();
  }

  // How long the moment itself lasts.
  get T() {
    return { shake: 1.4, bump: 1.1, hug: 1.9, push: 0.9, punch: 0.9 }[this.kind];
  }

  // How close he stands for it.
  get gap() {
    if (this.kind === 'hug') return this.phase === 'act' && this.t > 0.35 ? 0.55 : 0.95;
    return this.kind === 'bump' ? 0.9 : this.kind === 'push' || this.kind === 'punch' ? 0.85 : 1.0;
  }

  drive(p, dt) {
    const [px, pz] = this.game.player.pos();
    if (p !== this.who) {
      // (the rest of them: hanging back, watching)
      p.heading = lerpAngle(p.heading, Math.atan2(px - p.x, pz - p.z), Math.min(1, dt * 4));
      return { speed: 0 };
    }
    const d = dist(p.x, p.z, px, pz) || 1;
    p.heading = lerpAngle(p.heading, Math.atan2(px - p.x, pz - p.z), Math.min(1, dt * 8));
    if (this.phase === 'leave') {
      const away = [p.x - ((px - p.x) / d) * 4, p.z - ((pz - p.z) / d) * 4];
      p.heading = Math.atan2(away[0] - p.x, away[1] - p.z);
      return { tx: away[0], tz: away[1], speed: 1.6 };
    }
    const tx = px - ((px - p.x) / d) * this.gap;
    const tz = pz - ((pz - p.z) / d) * this.gap;
    if (dist(p.x, p.z, tx, tz) > 0.12) return { tx, tz, speed: this.phase === 'approach' ? 2.4 : 1.2 };
    return { speed: 0 };
  }

  // His arms (and the others standing by).
  pose(p) {
    if (p !== this.who || this.phase !== 'act') return 0.04;
    greet(p.char, this.kind, this.t, 'him');
    return 0.04;
  }

  // Your buttons, before anything else sees them (main.js): squared up, ○ / Q walks away and
  // □ / R would fight, not punch or reload.
  input(a) {
    if (!this.active || this.phase !== 'square') return;
    this.walk = this.walk || a.dealNo;
    this.fight = this.fight || a.dealFight;
    a.melee = a.reload = a.dealNo = a.dealFight = false;
  }

  // Every frame after your walk animation (main.js): the moment, your arms, getting shoved,
  // then walk away or fight.
  late(dt, a) {
    if (!this.active) return;
    const game = this.game;
    const p = game.player;
    const w = this.who;
    const [px, pz] = p.pos();
    const d = dist(px, pz, w.x, w.z);
    this.t += dt;
    // (walk off and it's over)
    if (d > 6 && this.phase !== 'approach') return this.finish();
    if (this.phase === 'approach') {
      if (d < this.gap + 0.25 || this.t > 6) {
        this.phase = 'act';
        this.t = 0;
        game.hud.toast(`${w.ballName || 'He'}: "${this.line}"`, this.angry ? '#ff8080' : '#ffd23f');
      }
      return;
    }
    if (this.phase === 'act') {
      // (you face him and do your part)
      p.heading = Math.atan2(w.x - px, w.z - pz);
      p.char.group.rotation.y = p.heading;
      greet(p.char, this.kind, this.t, 'you');
      // Shoved or hit: knocked back a step or two, stumbling.
      if (this.angry && !this.hitDone && this.t > 0.24) {
        this.hitDone = true;
        const ux = (px - w.x) / (d || 1);
        const uz = (pz - w.z) / (d || 1);
        this.knock = { ux, uz, left: this.kind === 'push' ? 1.4 : 0.8, t: 0 };
        game.shakeCamera?.(this.kind === 'punch' ? 0.1 : 0.05, 0.25);
        if (this.kind === 'punch') game.hurtPlayer?.(8);
      }
      if (this.knock && this.knock.left > 0) {
        const step = Math.min(this.knock.left, dt * 4.5);
        this.knock.left -= step;
        p.x += this.knock.ux * step;
        p.z += this.knock.uz * step;
        p.char.group.rotation.x = -0.28; // (rocked back)
      }
      if (this.t >= this.T) {
        this.phase = this.angry ? 'square' : 'leave';
        this.t = 0;
      }
      return;
    }
    if (this.phase === 'square') {
      // Squared up: walk away, or fight (not yet).
      const kb = game.input.mode === 'kb' && !game.input.touchMode;
      game.prompt = `${kb ? 'Q' : '○'} walk away · ${kb ? 'R' : '□'} fight back (coming soon)`;
      void a;
      if (this.walk) {
        game.hud.toast('You walk away. Not worth it.', '#9fc3ff');
        this.phase = 'leave';
        this.t = 0;
        game.prompt = '';
      } else if (this.fight) game.hud.toast("Fighting's coming soon. Walk away for now", '#9fc3ff');
      this.walk = this.fight = false;
      if (this.t > 10) {
        this.phase = 'leave';
        this.t = 0;
      }
      return;
    }
    if (this.phase === 'leave' && this.t > 1.6) this.finish();
  }
}

const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));

// The arms for each kind of moment, at t seconds in. who: 'you' or 'him' (the push and the punch
// are his; you're the one rocked back).
function greet(c, kind, t, who) {
  const R = [c.armR, c.elbowR, c.wristR];
  const L = [c.armL, c.elbowL, c.wristL];
  const set = (A, x, e, w = 0, z = 0) => {
    A[0].rotation.x = x;
    A[1].rotation.x = e;
    A[2].rotation.x = w;
    A[0].rotation.z = z;
  };
  if (kind === 'shake') {
    // (reach, clasp, a couple of pumps, let go)
    const up = ease(clamp01(t / 0.3)) * (1 - ease(clamp01((t - 1.1) / 0.3)));
    set(R, -1.15 * up + Math.sin(t * 16) * 0.1 * (t > 0.35 && t < 1.0 ? 1 : 0), -0.35 * up);
    return;
  }
  if (kind === 'bump') {
    // (fists out, bump, and blow it up)
    const reach = ease(clamp01(t / 0.3));
    const bump = t > 0.3 && t < 0.55;
    const after = ease(clamp01((t - 0.55) / 0.4));
    set(R, -1.25 * reach + (-0.9 * after), (bump ? -0.35 : -1.1) * (1 - after * 0.5), after * 0.6);
    return;
  }
  if (kind === 'hug') {
    // (dap first, then pulled in: arms round, a pat or two on the back)
    if (t < 0.35) {
      set(R, -1.15 * ease(clamp01(t / 0.25)), -0.4);
      return;
    }
    const k = ease(clamp01((t - 0.35) / 0.3)) * (1 - ease(clamp01((t - 1.6) / 0.3)));
    const pat = t > 0.8 && t < 1.5 ? Math.sin(t * 18) * 0.25 : 0;
    set(R, -1.3 * k, (-1.5 + pat) * k, 0, 0.45 * k);
    set(L, -1.2 * k, -1.4 * k, 0, -0.45 * k);
    return;
  }
  if (who === 'him') {
    if (kind === 'push') {
      // (both hands up, then shoved out)
      const shove = ease(clamp01((t - 0.12) / 0.12));
      const back = ease(clamp01((t - 0.55) / 0.3));
      set(R, -1.45 * (1 - back), (-1.4 + 1.3 * shove) * (1 - back));
      set(L, -1.45 * (1 - back), (-1.4 + 1.3 * shove) * (1 - back));
      return;
    }
    // (the punch: cocked, then a straight right)
    const cock = t < 0.16;
    const back = ease(clamp01((t - 0.5) / 0.3));
    set(R, (cock ? -1.0 : -1.55) * (1 - back), (cock ? -1.9 : -0.05) * (1 - back));
    set(L, -1.2 * (1 - back), -1.5 * (1 - back)); // (the guard)
    return;
  }
  // You, rocked back: arms flung out to catch your balance.
  const k = ease(clamp01((t - 0.22) / 0.15)) * (1 - ease(clamp01((t - 0.6) / 0.3)));
  set(R, -0.9 * k, -0.4 * k, 0, -0.5 * k);
  set(L, -0.9 * k, -0.4 * k, 0, 0.5 * k);
}
