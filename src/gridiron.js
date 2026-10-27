import * as THREE from 'three';
import { dist, rand, pick } from './util.js';
import { setShirt } from './character.js';

// Quarterback a drive at Harbor Field (football.js runs the passing drill there).
// - Join: walk onto the field while they're lining up; their quarterback offers you the ball.
//   E / D-pad ↑ / USE plays; Q / ○ changes the bet ($0-$500: score on the drive and you take
//   his money too). He steps off to the sideline and watches.
// - The drive: from the 40, four downs to make 10 yards, until you score or lose it.
//   Get behind the line and ✕ / E hikes it. The receivers run their routes with the backs on
//   them. The one you're looking toward is your target (the arrow over his head). Hold FIRE and
//   let go in the green: a good release leads him; a bad one sails or dies short.
//   Caught: he runs till he's brought down. Dropped or batted away: incomplete. Thrown into
//   coverage: it can be picked off (the drive's over).
//   Hold it too long and you're sacked (5 seconds); run past the line and you're a runner
//   (no throwing from there) till a back brings you down.
// - Walk off the field, get in a car or have the police after you and you forfeit. If they
//   scatter (trouble nearby), it's called off and the bet comes back.
const YD = 0.9144;
const BETS = [0, 50, 100, 250, 500];
const NAMES = ['Coach', 'Big Lou', 'Tre', 'Marcus', 'Deebo', 'Junior', 'Bam'];
const SACK = 4.5;
const DOWNS = ['1st', '2nd', '3rd', '4th'];

export class Gridiron {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.betI = 2;
    this.meter = null;
  }

  get fb() {
    return this.game.football;
  }

  onField(x, z, pad = 0) {
    const F = this.fb.site.field;
    return x > F.x0 - 3 - pad && x < F.x1 + 3 + pad && z > F.z0 - 3 - pad && z < F.z1 + 3 + pad;
  }

  // ---- Joining (main.js handleInteractions, on foot) ----
  offer(a) {
    const game = this.game;
    const fb = this.fb;
    if (this.active || game.player.vehicle || game.stars > 0 || game.stop || !fb?.ball || fb.match) return;
    const qb = fb.qb;
    if (!qb || !qb.fb || !fb.wrs.length || !['reset', 'set'].includes(fb.phase)) return;
    const [px, pz] = game.player.pos();
    if (!this.onField(px, pz) || dist(px, pz, qb.x, qb.z) > 9) return;
    if (a.dealNo) {
      this.betI = (this.betI + 1) % BETS.length;
      a.melee = false;
    }
    let bet = BETS[this.betI];
    while (bet > game.cash && bet > 0) bet = BETS[BETS.indexOf(bet) - 1];
    if (!qb.ballName) qb.ballName = pick(NAMES);
    const betKey = game.input.mode === 'kb' ? 'Q' : '○';
    game.prompt = `${qb.ballName}: "You got an arm? From the 40, four downs. Put it in the end zone." ${game.input.label('interact')} to play · ${betKey} bet: ${bet ? `$${bet}` : 'nothing'}`;
    if (a.interactHeld && !game.interactWasHeld) this.start(qb, bet);
  }

  start(qb, bet) {
    const game = this.game;
    const fb = this.fb;
    const S = fb.site;
    this.active = true;
    this.bet = bet;
    game.cash -= bet; // (held until it's over)
    this.bench = qb;
    qb.fb.role = 'bench';
    // You under center (football.js reads x, z and fb.home off this).
    const p = game.player;
    this.you = { fb: { role: 'qb', home: [0, 0] }, get x() { return p.pos()[0]; }, get z() { return p.pos()[1]; }, get heading() { return p.heading; } };
    fb.qb = this.you;
    fb.match = this;
    this.goal = S.goal0;
    this.los = this.goal + 40 * YD;
    this.first = this.los - 10 * YD;
    this.down = 0;
    this.meter = null;
    this.state = 'line';
    this.t = 0;
    // Somebody comes off the sideline so every receiver's covered.
    this.extra = [];
    for (const w of fb.wrs) {
      if (fb.dbs.some((d) => d.fb.mark === w)) continue;
      const d = game.peds.addAt(w.x, w.z - 6);
      d.state = 'play';
      d.act = fb;
      d.keep = true;
      d.sidewalk = false;
      setShirt(d.char, 0x22416e);
      d.fb = { role: 'db', home: [w.x, w.z - 6], t: 0, mark: w };
      d.heading = 0;
      fb.players.push(d);
      fb.dbs.push(d);
      this.extra.push(d);
    }
    fb.los = this.los;
    fb.setHomes();
    // The ball's yours.
    fb.ball.mode = 'held';
    fb.ball.holder = 'you';
    fb.phase = 'reset';
    fb.t = 0;
    for (const f of fb.fans) f.fb.cheerT = 1;
    // The arrow over your target.
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 4), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    m.rotation.x = Math.PI;
    m.visible = false;
    game.scene.add(m);
    this.arrow = m;
    game.hud.toast(`${qb.ballName}'s squad · ${bet ? `$${bet} says you score` : 'just for fun'}. Get behind the line`, '#ffd23f');
  }

  yardLine(z) {
    const y = Math.round((z - this.goal) / YD);
    return y > 50 ? 100 - y : y;
  }

  board() {
    const toGo = this.first <= this.goal + 0.01 ? 'Goal' : Math.max(1, Math.round((this.los - this.first) / YD));
    return `${DOWNS[this.down] || '4th'} & ${toGo} · ball on the ${this.yardLine(this.los)}${this.bet ? ` · $${this.bet} on it` : ''}`;
  }

  // ---- Your buttons (main.js, before the weapons) ----
  input(dt, a) {
    const game = this.game;
    const fb = this.fb;
    const fire = a.fire;
    const hike = a.dealYes;
    a.fire = a.firePressed = a.aim = a.aimPressed = a.melee = a.reload = a.dealYes = false;
    const b = fb.ball;
    const [px, pz] = game.player.pos();
    if (this.state === 'line') {
      // Behind the line, near the middle, everyone set: ✕ hikes it.
      const ready = fb.phase === 'set' || (fb.phase === 'reset' && fb.players.every((q) => q.fb.role === 'bench' || q.fb.role === 'fan' || dist(q.x, q.z, ...q.fb.home) < 1.5));
      const spot = pz > this.los + 1 && pz < this.los + 8 && Math.abs(px - fb.site.field.cx) < 6;
      this.ready = ready && spot;
      if (hike && this.ready) this.snap();
      return;
    }
    if (this.state === 'play' && b.holder === 'you') {
      if (fire) {
        this.meter = this.meter || { t: 0 };
        this.meter.t += dt;
      } else if (this.meter) {
        const v = this.meterValue();
        this.meter = null;
        if (pz < this.los) game.hud.toast("Past the line: you can't throw now", '#ff8080');
        else this.throwIt(v);
      }
    } else this.meter = null;
  }

  meterValue() {
    if (!this.meter) return 0;
    const t = this.meter.t % 1.4;
    return t < 0.7 ? t / 0.7 : 1 - (t - 0.7) / 0.7;
  }

  snap() {
    const fb = this.fb;
    this.state = 'play';
    this.t = 0;
    this.sacked = false;
    fb.phase = 'play';
    fb.t = 0;
    for (const w of fb.wrs) {
      w.fb.route = fb.route(w);
      w.fb.leg = 0;
    }
    fb.target = null;
    this.game.hud.toast('Hike!', '#ffd23f');
  }

  // Who you're looking toward.
  pickTarget() {
    const game = this.game;
    const [px, pz] = game.player.pos();
    const yaw = game.camYaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    let best = null;
    let bs = -2;
    for (const w of this.fb.wrs) {
      const d = dist(px, pz, w.x, w.z) || 1;
      const s = ((w.x - px) * fx + (w.z - pz) * fz) / d;
      if (s > bs) {
        bs = s;
        best = w;
      }
    }
    return best;
  }

  throwIt(v) {
    const game = this.game;
    const fb = this.fb;
    const w = this.target;
    if (!w) return;
    const [px, pz] = game.player.pos();
    const p = game.player;
    const b = fb.ball;
    // Lead him: where he'll be when it gets there.
    const d0 = dist(px, pz, w.x, w.z);
    const T = 0.55 + d0 / 17;
    const sp = w.speed || 0;
    let tx = w.x + Math.sin(w.heading) * sp * T;
    let tz = w.z + Math.cos(w.heading) * sp * T;
    // A route's end: he stops there.
    const end = w.fb.route?.[w.fb.route.length - 1];
    if (end && dist(w.x, w.z, end[0], end[1]) < sp * T) [tx, tz] = end;
    const err = v >= 0.82 ? 0.8 : v >= 0.55 ? 2.2 : 4;
    const a = rand(0, Math.PI * 2);
    tx += Math.cos(a) * err * rand(0.5, 1);
    tz += Math.sin(a) * err * rand(0.5, 1);
    const F = fb.site.field;
    tx = Math.max(F.x0 - 1, Math.min(F.x1 + 1, tx));
    b.x = px + Math.sin(p.heading) * 0.2;
    b.z = pz + Math.cos(p.heading) * 0.2;
    b.y = 2.0;
    fb.launch(tx, 1.3, tz, T, 'pass', w);
    this.state = 'air';
    this.throwT = 0.4;
    game.hud.toast(v >= 0.82 ? 'Dime!' : v >= 0.55 ? 'Decent ball' : 'Wobbler...', v >= 0.82 ? '#7ee081' : v >= 0.55 ? '#ffd23f' : '#ff8080');
  }

  // The pass gets there (football.js arrived() hands it over).
  arrived() {
    const game = this.game;
    const fb = this.fb;
    const b = fb.ball;
    const w = b.to;
    const dW = w && fb.players.includes(w) ? dist(w.x, w.z, b.x, b.z) : 99;
    let db = null;
    for (const q of fb.dbs) if (!db || dist(q.x, q.z, b.x, b.z) < dist(db.x, db.z, b.x, b.z)) db = q;
    const dD = db ? dist(db.x, db.z, b.x, b.z) : 99;
    // Picked off: a back closer to it than your man.
    if (db && dD < 1.6 && dD < dW && Math.random() < 0.55) {
      fb.hold(db);
      game.hud.toast('INTERCEPTED', '#ff8080');
      return this.end('pick');
    }
    let pr = dW < 0.8 ? 0.9 : dW < 1.6 ? 0.65 : dW < 2.5 ? 0.3 : 0;
    const cover = db && w ? dist(db.x, db.z, w.x, w.z) : 99;
    if (cover < 1.5) pr -= 0.3;
    else if (cover < 2.5) pr -= 0.15;
    if (Math.random() < pr) {
      fb.hold(w);
      fb.phase = 'run';
      fb.t = 0;
      fb.runFor = 99;
      w.fb.runTo = [w.x, this.goal - 3];
      this.state = 'run';
      this.t = 0;
      for (const f of fb.fans) f.fb.cheerT = rand(1, 1.8);
      game.hud.toast('Caught!', '#7ee081');
      return;
    }
    // Incomplete: it bounces away.
    b.mode = 'loose';
    b.vx = rand(-1.5, 1.5);
    b.vz = rand(-1.5, 1.5);
    b.vy = -2;
    game.hud.toast(dD < 2 ? 'Batted away. Incomplete' : 'Incomplete', '#ff8080');
    this.over(null);
  }

  // ---- Every frame (football.js step) ----
  phase(dt) {
    const game = this.game;
    const fb = this.fb;
    const b = fb.ball;
    const [px, pz] = game.player.pos();
    this.t += dt;
    // Forfeits / called off.
    if (!this.onField(px, pz, 2)) this.outT = (this.outT || 0) + dt;
    else this.outT = 0;
    if (this.outT > 2.5 || game.player.vehicle || game.stars > 0 || game.wastedT > 0 || game.bustedT > 0) return this.end('forfeit');
    if (!fb.wrs.length) return this.end('off');
    if (this.state === 'line') {
      // Lining up (football.js 'reset': everyone walks to their spot).
      if (fb.phase === 'reset' && fb.players.every((q) => q.fb.role === 'bench' || dist(q.x, q.z, ...q.fb.home) < 0.7)) fb.phase = 'set';
    } else if (this.state === 'play') {
      if (b.holder === 'you') {
        // Scrambling past the line.
        if (pz < this.los) this.scramble = true;
        if (pz <= this.goal) return this.touchdown('you');
        const tackler = fb.dbs.find((q) => dist(q.x, q.z, px, pz) < 0.9);
        if (this.scramble && tackler) {
          game.hud.toast(`Brought down at the ${this.yardLine(pz)}`, '#ffd23f');
          return this.over(pz);
        }
        if (!this.scramble && this.t > SACK) {
          game.hud.toast('SACKED', '#ff8080');
          return this.over(Math.min(this.los + 4 * YD, fb.site.field.z1 - 1));
        }
      }
    } else if (this.state === 'run') {
      const h = b.holder;
      if (!h || h === 'you') return this.over(this.los);
      if (h.z <= this.goal) return this.touchdown(h);
      const tackler = fb.dbs.find((q) => dist(q.x, q.z, h.x, h.z) < 0.9);
      if (tackler || this.t > 7 || (h.fb.runTo && dist(h.x, h.z, ...h.fb.runTo) < 0.6)) {
        game.hud.toast(`Brought down at the ${this.yardLine(h.z)}`, '#ffd23f');
        return this.over(h.z);
      }
    } else if (this.state === 'dead') {
      // The ball comes back to you; everyone lines up again.
      if (this.t > 1.6) {
        b.mode = 'held';
        b.holder = 'you';
        fb.los = this.los;
        fb.setHomes();
        for (const w of fb.wrs) w.fb.route = null;
        fb.phase = 'reset';
        fb.t = 0;
        this.state = 'line';
        this.t = 0;
      }
    }
    if (this.throwT > 0) this.throwT -= dt;
    // The arrow over who you'd throw to.
    this.target = this.state === 'play' && b.holder === 'you' && !this.scramble ? this.pickTarget() : null;
    this.arrow.visible = !!this.target;
    if (this.target) this.arrow.position.set(this.target.x, 2.6 + Math.sin(game.time * 6) * 0.08, this.target.z);
    const kb = game.input.mode === 'kb';
    let hint = '';
    if (this.state === 'line') hint = this.ready ? `${kb ? 'E' : '✕'} hike` : 'Get behind the line, in the middle';
    else if (this.state === 'play' && b.holder === 'you') hint = this.scramble ? 'Run it in!' : this.t > SACK - 1.5 ? 'Pocket collapsing: throw it!' : `Look at your man · hold ${game.input.label('fire')}, let go in the green`;
    game.hud.sport?.(this.board(), this.meter ? this.meterValue() : null, hint);
  }

  // The ball in your hands (football.js step).
  carry(b) {
    const p = this.game.player;
    const [px, pz] = p.pos();
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    if (this.meter) {
      b.x = px - fx * 0.2 - fz * 0.35;
      b.z = pz - fz * 0.2 + fx * 0.35;
      b.y = 2.0;
    } else {
      b.x = px + fx * 0.15 - fz * 0.3;
      b.z = pz + fz * 0.15 + fx * 0.3;
      b.y = 1.15;
    }
    b.mesh.rotation.set(0, p.heading, 0);
  }

  // The play's over: spot it (null: incomplete, back where it was) and count the down.
  over(z) {
    const game = this.game;
    const fb = this.fb;
    this.state = 'dead';
    this.t = 0;
    this.scramble = false;
    this.meter = null;
    fb.phase = 'dead';
    fb.t = 0;
    if (z != null) this.los = Math.max(this.goal + YD, Math.min(fb.site.field.z1 - 1, z));
    if (this.los <= this.first + 0.01) {
      this.down = 0;
      this.first = Math.max(this.goal, this.los - 10 * YD);
      game.hud.toast('First down!', '#7ee081');
      return;
    }
    this.down += 1;
    if (this.down > 3) {
      game.hud.toast('Turnover on downs', '#ff8080');
      this.end('downs');
    }
  }

  touchdown(who) {
    const game = this.game;
    for (const f of this.fb.fans) f.fb.cheerT = 2.5;
    for (const q of this.fb.wrs) q.fb.cheerT = 2;
    game.hud.toast(who === 'you' ? 'TOUCHDOWN! You took it in yourself' : 'TOUCHDOWN!', '#7ee081');
    this.end('td');
  }

  // Your arms (main.js, after you move).
  late() {
    const game = this.game;
    const p = game.player;
    const c = p.char;
    p.showWeapon('fists');
    const b = this.fb.ball;
    if (b.holder === 'you') {
      if (this.meter) {
        c.armR.rotation.x = -2.9;
        c.armL.rotation.x = -1.2;
      } else c.armR.rotation.x = -0.7;
    } else if (this.throwT > 0) c.armR.rotation.x = -2.2; // (follow-through)
  }

  // ---- Over ----
  end(how) {
    const game = this.game;
    const fb = this.fb;
    const bet = this.bet;
    const name = this.bench?.ballName || 'They';
    if (how === 'td') {
      game.cash += bet * 2;
      game.cred += 10;
      game.hud.toast(`You scored on ${name}'s squad${bet ? ` · +$${bet}` : ''} · +10 cred`, '#7ee081');
    } else if (how === 'pick' || how === 'downs') {
      game.hud.toast(`${name}: "Nah, you ain't got it."${bet ? ` · -$${bet}` : ''}`, '#ff8080');
    } else if (how === 'forfeit') {
      game.hud.toast(`You walked off${bet ? ` · -$${bet}` : ''}`, '#ff8080');
    } else {
      game.cash += bet;
      game.hud.toast('Game called off', '#9fc3ff');
    }
    this.active = false;
    this.meter = null;
    fb.match = null;
    game.scene.remove(this.arrow);
    // (the extra back goes home)
    for (const d of this.extra || []) {
      fb.players.splice(fb.players.indexOf(d), 1);
      if (fb.dbs.includes(d)) fb.dbs.splice(fb.dbs.indexOf(d), 1);
      if (fb.ball?.holder === d) fb.loose();
      d.keep = false;
      d.sidewalk = true;
      d.act = null;
      if (d.state === 'play' && !d.removed) d.resumeWalking();
    }
    this.extra = [];
    // Their quarterback takes it back (or someone else does if he's gone: football.js).
    const q = this.bench;
    if (q && fb.players.includes(q)) {
      q.fb.role = 'qb';
      fb.qb = q;
    } else fb.qb = null;
    if (fb.qb) {
      fb.setHomes();
      fb.phase = 'back';
      fb.t = 0;
    }
    const b = fb.ball;
    if (b && (b.holder === 'you' || !fb.qb)) {
      if (fb.qb) fb.hold(fb.qb);
      else fb.loose();
    }
    game.hud.sport?.(null);
    game.save();
  }
}
