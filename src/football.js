import * as THREE from 'three';
import { lam, setShirt, bendLeg, bendSpine } from './character.js';
import { qbStance, wrStance, dbStance, holdBall, tuckCarry, throwPose, catchPose, layoutPose, jukedPose, reachBall, fbBallAt } from './footballpose.js';
import { rand, dist, lerpAngle, pick } from './util.js';
import { safetyAt, turnout, quietNote } from './safety.js';

// Football practice at Harbor Field (field.js): a passing drill, and a few people watching
// from the bleachers.
// A quarterback and his receivers (green) against a couple of defensive backs (blue). They
// line up, the ball's snapped, the receivers run their routes with the backs on them, and the
// quarterback throws to one of them as he comes open. Caught (and the receiver runs on with
// it) or dropped (it bounces away and someone picks it up); then it comes back to the
// quarterback and they line up again. The crowd cheers a catch.
// Like the hoops (hoops.js) they're ordinary pedestrians underneath (peds.js state 'play'):
// trouble nearby scatters them.
const NEAR = 160;
const FAR = 210;
const G = 9.8;
const RUN = 5.6; // receivers on their routes
const COVER = 5.2; // the backs, a step slower
const JOG = 3.4; // (hustling back to the line)
const OFFENSE = 0x2e7d32;
const DEFENSE = 0x22416e;
const BALL_Y = 0.12;

export class Football {
  constructor(game) {
    this.game = game;
    this.site = game.city.footballField;
    this.players = [];
    this.fans = [];
    this.ball = null;
    this.spoiled = false;
  }

  get active() {
    return this.players.length + this.fans.length > 0 || !!this.ball;
  }

  // Receivers, backs and fans, by the time of day.
  crowd() {
    const h = this.game.rhythm ? this.game.rhythm.hour() : 15;
    if (h >= 22 || h < 7) return [0, 0, 0];
    if (h < 11) return [2, 1, 1];
    if (h >= 17) return [3, 2, 5];
    return [3, 2, 2];
  }

  update(dt) {
    const S = this.site;
    if (!S) return;
    const [px, pz] = this.game.player.pos();
    const d = dist(px, pz, S.field.cx, (S.field.z0 + S.field.z1) / 2);
    if (d > FAR) {
      if (this.active) this.clear();
      this.spoiled = false;
      return;
    }
    if (!this.active && !this.spoiled && d < NEAR && this.game.time >= (this.nextTry || 0)) this.start();
    if (!this.ball) return;
    this.step(dt);
    if (!this.players.length && !this.fans.length) this.spoiled = true;
  }

  // ---- Setting up ----
  start() {
    // Fewer come out when it's not safe (safety.js).
    const F0 = this.site.field;
    const safe = safetyAt(this.game, F0.cx, (F0.z0 + F0.z1) / 2);
    const base = this.crowd();
    const nWR = turnout(base[0], safe.k, 0.3);
    const nDB = Math.min(nWR, turnout(base[1], safe.k, 0.3));
    const nFans = turnout(base[2], safe.k * safe.k, 0.3); // (watchers are the first to stay home)
    quietNote(this.game, 'Harbor Field', safe);
    this.nextTry = this.game.time + 30;
    if (!nWR) return;
    const F = this.site.field;
    this.los = rand(992, 1006); // line of scrimmage; they're going north (toward smaller z)
    const add = (role, home, shirt) => {
      const p = this.game.peds.addAt(home[0], home[1], Math.random() < 0.2);
      p.state = 'play';
      p.act = this;
      p.keep = true;
      p.sidewalk = false;
      setShirt(p.char, shirt);
      p.fb = { role, home, t: 0 };
      p.heading = role === 'db' ? 0 : Math.PI;
      this.players.push(p);
      return p;
    };
    this.qb = add('qb', [F.cx, this.los + 5], OFFENSE);
    const wrHomes = [[F.x0 + 3, this.los], [F.x1 - 3, this.los], [F.cx + 5.5, this.los + 0.6]];
    this.wrs = [];
    for (let k = 0; k < nWR; k++) this.wrs.push(add('wr', wrHomes[k], OFFENSE));
    this.dbs = [];
    for (let k = 0; k < nDB; k++) {
      const db = add('db', [wrHomes[k][0] + (k ? -1 : 1), this.los - 6], DEFENSE);
      db.fb.mark = this.wrs[k];
      this.dbs.push(db);
    }
    // The fans, sitting in the bleachers.
    const B = this.site.bleachers;
    for (let k = 0; k < nFans; k++) {
      const row = Math.floor(rand(0, B.rows));
      const x = rand(B.x0 + 0.8, B.x1 - 0.8);
      const z = B.z0 + (row + 0.5) * B.depth + 0.05;
      const p = this.game.peds.addAt(x, z);
      p.state = 'play';
      p.act = this;
      p.keep = true;
      p.sidewalk = false;
      p.fb = { role: 'fan', seatY: 0.45 + row * B.rise + 0.03, t: rand(0, 3) };
      p.heading = Math.PI;
      this.fans.push(p);
    }
    // The ball (a stretched sphere: a football).
    const geo = new THREE.SphereGeometry(0.11, 10, 8);
    geo.scale(1, 1, 1.6);
    const mesh = new THREE.Mesh(geo, lam(0x6b3a1f));
    mesh.castShadow = true;
    this.game.scene.add(mesh);
    this.ball = { mesh, x: F.cx, y: 1.2, z: this.los + 5, vx: 0, vy: 0, vz: 0, mode: 'held', holder: this.qb };
    this.phase = 'reset';
    this.t = 0;
  }

  clear() {
    if (this.match) this.match.end('off');
    for (const p of [...this.players, ...this.fans]) if (!p.removed) p.dispose();
    this.players = [];
    this.fans = [];
    if (this.ball) this.game.scene.remove(this.ball.mesh);
    this.ball = null;
  }

  // ---- The drill ----
  step(dt) {
    const b = this.ball;
    const F = this.site.field;
    // Anyone scared off or hurt is out.
    for (const list of [this.players, this.fans]) {
      for (const p of [...list]) {
        if (p.state === 'play' && !p.removed) continue;
        list.splice(list.indexOf(p), 1);
        p.keep = false;
        p.sidewalk = true;
        p.act = null;
        if (p.fb?.role === 'fan') {
          // (off the bleachers onto the grass in front)
          p.z = this.site.bleachers.z0 - 0.8;
          setDownLegs(p);
        }
        if (b.holder === p) this.loose();
      }
    }
    this.wrs = this.wrs.filter((p) => this.players.includes(p));
    this.dbs = this.dbs.filter((p) => this.players.includes(p));
    if (!this.match && !this.players.includes(this.qb)) {
      // Somebody else plays quarterback.
      this.qb = this.wrs.shift() || null;
      if (this.qb) {
        this.qb.fb.role = 'qb';
        this.qb.fb.home = [F.cx, this.los + 5];
      }
      for (const db of this.dbs) if (!this.wrs.includes(db.fb.mark)) db.fb.mark = this.wrs[0] || null;
    }
    this.t += dt;
    if (this.match) this.match.phase(dt); // (you're the quarterback: gridiron.js)
    else if (this.qb) this.runPhase(dt);

    // The ball.
    if (b.mode === 'flight') {
      b.t += dt;
      const k = Math.min(1, b.t / b.T);
      const ox = b.x;
      const oy = b.y;
      const oz = b.z;
      b.x = b.p0[0] + (b.p1[0] - b.p0[0]) * k;
      b.z = b.p0[2] + (b.p1[2] - b.p0[2]) * k;
      const t = Math.min(b.t, b.T);
      b.y = b.p0[1] + b.vy0 * t - 0.5 * G * t * t;
      // (nose along the flight)
      b.mesh.lookAt(b.x + (b.x - ox) * 10, b.y + (b.y - oy) * 10, b.z + (b.z - oz) * 10);
      b.mesh.rotateZ(b.t * 25); // the spiral
      if (b.t >= b.T) this.arrived();
    } else if (b.mode === 'loose') {
      b.vy -= G * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.y < BALL_Y) {
        b.y = BALL_Y;
        // (a football bounces any old way)
        if (Math.abs(b.vy) > 1.2) {
          b.vy = -b.vy * 0.45;
          b.vx += rand(-1.5, 1.5);
          b.vz += rand(-1.5, 1.5);
        } else b.vy = 0;
        const f = Math.max(0, 1 - dt * 2);
        b.vx *= f;
        b.vz *= f;
      }
      b.x = Math.max(F.x0 - 2, Math.min(F.x1 + 2, b.x));
      b.z = Math.max(F.z0 - 2, Math.min(F.z1 + 2, b.z));
      b.mesh.rotation.x += dt * 6 * Math.hypot(b.vx, b.vz);
    } else if (b.holder === 'you') {
      if (this.match) this.match.carry(b);
    } else if (b.holder) {
      const p = b.holder;
      const fx = Math.sin(p.heading);
      const fz = Math.cos(p.heading);
      if (fbBallAt(p.char, _fv)) {
        // (in his hands, wherever this frame's pose put them: footballpose.js)
        b.x = _fv.x;
        b.y = _fv.y;
        b.z = _fv.z;
      } else if (p.fb.throwT > 0) {
        // Cocked back over the shoulder.
        b.x = p.x - fx * 0.2 - fz * 0.35;
        b.z = p.z - fz * 0.2 + fx * 0.35;
        b.y = 2.0;
      } else if (p.speed > 0.5) {
        // Tucked under the arm.
        b.x = p.x + fx * 0.15 - fz * 0.3;
        b.z = p.z + fz * 0.15 + fx * 0.3;
        b.y = 1.15;
      } else {
        b.x = p.x + fx * 0.3;
        b.z = p.z + fz * 0.3;
        b.y = 1.15;
      }
      b.mesh.rotation.set(0, p.heading, 0);
    }
    b.mesh.position.set(b.x, b.y, b.z);
  }

  runPhase() {
    const b = this.ball;
    const F = this.site.field;
    const qb = this.qb;
    if (this.phase === 'reset') {
      // Everyone back to where they line up.
      const ready = this.players.every((p) => dist(p.x, p.z, ...p.fb.home) < 0.7);
      if ((ready && b.holder === qb) || this.t > 14) {
        if (b.holder !== qb) this.hold(qb);
        this.phase = 'set';
        this.t = 0;
        this.throwing = false;
        this.snapAt = rand(1.5, 3);
      }
    } else if (this.phase === 'set') {
      if (this.t > this.snapAt) {
        // Hike: everybody gets a route, the quarterback picks who he's going to.
        this.phase = 'play';
        this.t = 0;
        for (const w of this.wrs) {
          w.fb.route = this.route(w);
          w.fb.leg = 0;
        }
        this.target = this.wrs.length ? pick(this.wrs) : null;
        this.throwAt = rand(1.3, 2.0);
      }
    } else if (this.phase === 'play') {
      const w = this.target;
      if (!w || !this.wrs.includes(w)) {
        this.phase = 'back';
        this.t = 0;
        return;
      }
      if (b.holder === qb && this.t > this.throwAt && !qb.fb.throwT) {
        // Throw when he's about to get where he's going (or he's been running a while).
        const end = w.fb.route[w.fb.route.length - 1];
        const d = dist(qb.x, qb.z, end[0], end[1]);
        const T = 0.55 + d / 17;
        const left = routeLeft(w) / RUN;
        if (left <= T + 0.1 || this.t > 4.5) {
          qb.fb.throwT = 0.35;
          this.throwTo = left <= T + 0.1 ? end : [w.x + Math.sin(w.heading) * 2, w.z + Math.cos(w.heading) * 2]; // (just ahead of him)
          this.throwT = T;
          this.throwing = true;
        }
      }
      if (this.throwing && b.holder === qb && qb.fb.throwT <= 0.12) {
        this.throwing = false;
        const [tx, tz] = this.throwTo;
        this.launch(tx, 1.3, tz, this.throwT, 'pass', w);
        qb.fb.relT = 0.4; // (the follow-through)
      }
      if (this.t > 9) {
        this.phase = 'back';
        this.t = 0;
      }
    } else if (this.phase === 'run') {
      // The catch: he runs on with it a few seconds.
      if (this.t > this.runFor) {
        this.phase = 'back';
        this.t = 0;
      }
    } else if (this.phase === 'dead' || this.phase === 'back') {
      // Getting the ball back to the quarterback.
      if (b.holder && b.holder !== qb && b.mode === 'held' && this.t > 0.6 && dist(b.holder.x, b.holder.z, qb.x, qb.z) < 22) {
        this.launch(qb.x, 1.2, qb.z, 0.45 + dist(b.holder.x, b.holder.z, qb.x, qb.z) / 22, 'toss', qb);
      }
      if (b.holder === qb && b.mode === 'held') {
        this.phase = 'reset';
        this.t = 0;
        this.los = Math.max(F.z0 + 30, Math.min(F.z1 - 20, this.los + rand(-4, 4)));
        this.setHomes();
      }
      if (this.t > 20) {
        // (taking too long: start over)
        this.hold(qb);
      }
    }
  }

  setHomes() {
    const F = this.site.field;
    const homes = [[F.x0 + 3, this.los], [F.x1 - 3, this.los], [F.cx + 5.5, this.los + 0.6]];
    if (this.qb) this.qb.fb.home = [F.cx, this.los + 5];
    this.wrs.forEach((w, k) => (w.fb.home = homes[k]));
    this.dbs.forEach((d, k) => (d.fb.home = [homes[k][0] + (k ? -1 : 1), this.los - 6]));
    // (in a game: a back behind the quarterback, a linebacker over the middle)
    if (this.rb) this.rb.fb.home = [F.cx - 1.6, this.los + 7];
    if (this.lb) this.lb.fb.home = [F.cx + 0.5, this.los - 4.5];
  }

  // A route from where he lines up: go, slant, out, curl or post (any, or the one the play
  // calls); the back runs a flat (out to the side, then up the sideline).
  route(w, want = null) {
    const F = this.site.field;
    const [hx, hz] = w.fb.home;
    const side = hx < F.cx ? -1 : 1; // toward his sideline
    const cx = (x) => Math.max(F.x0 + 1.2, Math.min(F.x1 - 1.2, x));
    const cz = (z) => Math.max(F.z0 + 2, z);
    const kind = want || pick(['go', 'slant', 'out', 'curl', 'post']);
    const pts = {
      flat: [[hx + side * 7, hz - 3], [hx + side * 8, hz - 12]],
      go: [[hx, hz - 26]],
      slant: [[hx, hz - 5], [hx - side * 9, hz - 15]],
      out: [[hx, hz - 11], [hx + side * 7, hz - 11]],
      curl: [[hx, hz - 14], [hx - side * 1.5, hz - 12]],
      post: [[hx, hz - 11], [hx - side * 7, hz - 26]],
    }[kind];
    return pts.map(([x, z]) => [cx(x), cz(z)]);
  }

  // Just out of reach (about 1-2.6 m): he lays out for it.
  diveFor(r, x, z) {
    const d = dist(r.x, r.z, x, z);
    if (d < 0.95 || d > 2.6) return false;
    r.fb.dive = true;
    r.fb.diveTo = [x, z];
    r.fb.downT = r.fb.downLen = 1.3;
    r.heading = Math.atan2(x - r.x, z - r.z);
    return true;
  }

  // Brought down: the runner and the tackler both hit the turf.
  tackle(runner, tackler) {
    for (const q of [runner, tackler]) {
      if (!q || !q.fb) continue;
      q.fb.dive = false;
      q.fb.downT = q.fb.downLen = 1.1;
    }
    if (tackler && runner && runner.x != null) tackler.heading = Math.atan2(runner.x - tackler.x, runner.z - tackler.z);
  }

  hold(p) {
    const b = this.ball;
    b.mode = 'held';
    b.holder = p;
  }

  loose() {
    const b = this.ball;
    b.mode = 'loose';
    b.holder = null;
    b.vx = rand(-1, 1);
    b.vz = rand(-1, 1);
    b.vy = 0;
  }

  launch(tx, ty, tz, T, kind, to) {
    const b = this.ball;
    b.mode = 'flight';
    b.holder = null;
    b.kind = kind;
    b.to = to;
    b.p0 = [b.x, b.y, b.z];
    b.p1 = [tx, ty, tz];
    b.T = T;
    b.t = 0;
    b.vy0 = (ty - b.y + 0.5 * G * T * T) / T;
  }

  arrived() {
    const b = this.ball;
    if (this.match && b.kind === 'pass') return this.match.arrived();
    const r = b.to;
    const near = r && this.players.includes(r) && dist(r.x, r.z, b.x, b.z) < 2.6;
    if (near && b.kind === 'pass') this.diveFor(r, b.x, b.z);
    const sure = b.kind === 'toss' ? 0.97 : 0.75;
    if (near && Math.random() < sure) {
      this.hold(r);
      if (b.kind === 'pass') {
        this.phase = 'run';
        this.t = 0;
        this.runFor = rand(1.5, 3);
        for (const f of this.fans) f.fb.cheerT = rand(1, 1.8);
      }
      return;
    }
    // Dropped (or nobody there): it bounces away.
    b.mode = 'loose';
    const sp = Math.hypot(b.p1[0] - b.p0[0], b.p1[2] - b.p0[2]) / b.T;
    const L = Math.hypot(b.p1[0] - b.p0[0], b.p1[2] - b.p0[2]) || 1;
    b.vx = ((b.p1[0] - b.p0[0]) / L) * sp * 0.4;
    b.vz = ((b.p1[2] - b.p0[2]) / L) * sp * 0.4;
    b.vy = -2;
    if (b.kind === 'pass') {
      this.phase = 'dead';
      this.t = 0;
    }
  }

  // ---- Each one: where to go (peds.js calls this every frame) ----
  drive(p, dt) {
    const f = p.fb;
    const b = this.ball;
    const face = (h) => {
      p.heading = lerpAngle(p.heading, h, Math.min(1, dt * 7));
    };
    const faceAt = (x, z) => face(Math.atan2(x - p.x, z - p.z));
    f.throwT = Math.max(0, (f.throwT || 0) - dt);
    f.relT = Math.max(0, (f.relT || 0) - dt);
    f.beatT = Math.max(0, (f.beatT || 0) - dt);
    f.cheerT = Math.max(0, (f.cheerT || 0) - dt);
    // Down on the turf (a dive or a tackle): lunging forward a moment, then getting up.
    if (f.downT > 0) {
      f.downT -= dt;
      const t = (f.downLen || 1.1) - f.downT;
      if (f.dive && t < 0.3 && f.diveTo) return { tx: f.diveTo[0], tz: f.diveTo[1], speed: 5.5 };
      if (f.downT <= 0) f.dive = false;
      return { speed: 0 };
    }
    if (f.role === 'fan') {
      // Watching the ball.
      if (b) faceAt(b.x, b.z);
      if (Math.abs(lerpAngle(0, p.heading - Math.PI, 1)) > 1.2) face(Math.PI); // (they don't turn round in their seats)
      return { speed: 0 };
    }
    if (!b) return { speed: 0 };
    // (the QB Challenge or playing catch with you: fieldmodes.js says where everyone goes)
    if (this.match?.drivePlayer && this.match.mode !== 'drive') return this.match.drivePlayer(p, f, b, faceAt);
    if (f.role === 'bench') {
      // (their quarterback, watching you from the sideline)
      const sx = this.site.field.x0 - 1.6;
      const sz = this.los + 2;
      if (dist(p.x, p.z, sx, sz) > 0.6) return { tx: sx, tz: sz, speed: JOG };
      faceAt(b.x, b.z);
      return { speed: 0 };
    }
    const goTo = (x, z, speed) => (dist(p.x, p.z, x, z) > 0.45 ? { tx: x, tz: z, speed } : null);
    const ph = this.phase;
    // The ball's loose: the nearest offensive player goes and gets it.
    if (b.mode === 'loose' && f.role !== 'db') {
      const off = this.players.filter((q) => q.fb.role !== 'db' && q.fb.role !== 'bench');
      let best = null;
      for (const q of off) if (!best || dist(q.x, q.z, b.x, b.z) < dist(best.x, best.z, b.x, b.z)) best = q;
      if (best === p) {
        if (dist(p.x, p.z, b.x, b.z) < 0.7 && b.y < 0.8) {
          this.hold(p);
          if (this.phase === 'play' || this.phase === 'run') this.phase = 'dead';
        }
        return { tx: b.x, tz: b.z, speed: 4.2 };
      }
    }
    // Ball coming to me: go get under it.
    if (b.mode === 'flight' && b.to === p) {
      const [tx, tz] = [b.p1[0], b.p1[2]];
      const g = goTo(tx, tz, b.kind === 'pass' ? RUN * 1.1 : JOG);
      if (g) return g;
      faceAt(b.x, b.z);
      return { speed: 0 };
    }
    if (f.role === 'qb') {
      if (ph === 'play' || ph === 'run') {
        // Drop back, then stand in the pocket looking downfield.
        const g = goTo(f.home[0], f.home[1] + 3, 2.6);
        if (g && b.holder === p && !f.throwT) return g;
        faceAt(this.target ? this.target.x : f.home[0], this.target ? this.target.z : f.home[1] - 20);
        return { speed: 0 };
      }
      const g = goTo(...f.home, JOG);
      if (g) return g;
      face(Math.PI);
      return { speed: 0 };
    }
    if (f.role === 'lb') return this.driveLB(p, f, b, goTo, faceAt, face);
    if (f.role === 'rb' && this.match) {
      const r = this.driveRB(p, f, b, goTo, faceAt, face);
      if (r) return r;
    }
    if (f.role === 'wr' || f.role === 'rb') {
      if (ph === 'play' && f.route && !(b.holder === p)) {
        const pt = f.route[f.leg];
        if (pt) {
          if (dist(p.x, p.z, pt[0], pt[1]) < 0.6) f.leg++;
          else return { tx: pt[0], tz: pt[1], speed: RUN };
        }
        faceAt(this.qb ? this.qb.x : p.x, this.qb ? this.qb.z : p.z + 5);
        return { speed: 0 };
      }
      if (b.holder === p && ph === 'run') {
        if (!f.runTo) f.runTo = [p.x, Math.max(this.site.field.z0 + 1, p.z - 18)];
        return goTo(...f.runTo, RUN * 0.9) || { speed: 0 };
      }
      f.runTo = null;
      if (b.holder === p && (ph === 'back' || ph === 'dead')) {
        const q = this.qb;
        return goTo(q.x, q.z + 2, JOG) || { speed: 0 };
      }
      const g = goTo(...f.home, JOG);
      if (g) return g;
      face(Math.PI);
      return { speed: 0 };
    }
    // Defensive back: stay with his man during the play, otherwise line up across from him.
    // (you scrambling with it: the nearest back comes for you)
    const M = this.match;
    if (M && M.scramble && b.holder === 'you') {
      const [px, pz] = this.game.player.pos();
      if (f.beatT > 0) return { speed: 0 }; // (juked: caught flat-footed)
      return { tx: px, tz: pz, speed: 6.4 };
    }
    if (M && M.biteT > 0) {
      // (play action: biting on the fake, a step up)
      faceAt(this.game.player.pos()[0], this.game.player.pos()[1]);
      return { speed: 0 };
    }
    // (after a catch every back goes for the ball carrier)
    const m = ph === 'run' && b.holder && b.holder !== 'you' && (b.holder.fb?.role === 'wr' || b.holder.fb?.role === 'rb') ? b.holder : f.mark;
    if ((ph === 'play' || ph === 'run') && m && this.players.includes(m)) {
      const lead = 0.6;
      const tx = m.x + Math.sin(m.heading) * lead * (m.speed > 0 ? 1 : 0);
      const tz = m.z + Math.cos(m.heading) * lead * (m.speed > 0 ? 1 : 0) - 0.8;
      const g = goTo(tx, tz, ph === 'run' && b.holder === m ? (this.match ? RUN * 1.05 : RUN * 0.95) : COVER);
      if (g) return g;
      faceAt(m.x, m.z);
      return { speed: 0 };
    }
    const g = goTo(...f.home, JOG);
    if (g) return g;
    face(0);
    return { speed: 0 };
  }

  // The back, in a game (gridiron.js): on a run play he comes for the handoff; on a pass he runs
  // his flat like a receiver (null: the receiver code takes it from there).
  driveRB(p, f, b, goTo, faceAt, face) {
    const M = this.match;
    if (this.phase !== 'play') return null;
    if (M.play?.run && !M.handed) {
      // (to the quarterback's side for the handoff, timed to meet him)
      const [qx, qz] = this.game.player.pos();
      const side = M.play.run === 'toss' ? 1 : 0.6;
      const g = goTo(qx + side, qz - 0.3, 5.2);
      if (g) return g;
      faceAt(qx, qz - 5);
      return { speed: 0 };
    }
    if (M.play?.run && M.handed) {
      // (after the handoff: carrying out the fake into the line, then back)
      if (M.t < 1.6) return goTo(p.x, this.los - 1, 3) || { speed: 0 };
      return goTo(...f.home, JOG) || { speed: 0 };
    }
    return null;
  }

  // The linebacker, in a game: over the middle; on a pass he drops into a zone and breaks on the
  // ball; on a run (or you scrambling) he comes downhill for the carrier.
  driveLB(p, f, b, goTo, faceAt, face) {
    const M = this.match;
    const [px, pz] = this.game.player.pos();
    if (!M || !(this.phase === 'play' || this.phase === 'run')) {
      const g = goTo(...f.home, JOG);
      if (g) return g;
      face(0);
      return { speed: 0 };
    }
    if (f.beatT > 0) return { speed: 0 };
    if (M.biteT > 0) return goTo(f.home[0], this.los - 2, 3) || { speed: 0 }; // (biting on the fake)
    const carrier = b.holder === 'you' ? (M.scramble ? [px, pz] : null) : b.holder && b.holder !== this.qb ? [b.holder.x, b.holder.z] : null;
    if (carrier) return { tx: carrier[0], tz: carrier[1], speed: 6.2 };
    if (b.mode === 'flight' && b.kind === 'pass' && dist(p.x, p.z, b.p1[0], b.p1[2]) < 7) return { tx: b.p1[0], tz: b.p1[2], speed: 5.6 };
    // (the zone: 8 m off the line, shading toward the ball)
    const zx = Math.max(this.site.field.x0 + 4, Math.min(this.site.field.x1 - 4, (f.home[0] + px) / 2));
    const g = goTo(zx, this.los - 8, 4.2);
    if (g) return g;
    faceAt(px, pz);
    return { speed: 0 };
  }

  // Arms, stance, sitting (peds.js calls this after the walk animation; returns the height).
  pose(p) {
    const f = p.fb;
    const c = p.char;
    const b = this.ball;
    if (f.role === 'fan') {
      bendLeg(c.legL, c.kneeL, 1.5, 1.5);
      bendLeg(c.legR, c.kneeR, 1.5, 1.5);
      // (sat forward, elbows on the knees; on their feet in spirit for a big play: leaning back,
      // arms up, waving one)
      c.armL.rotation.x = c.armR.rotation.x = -0.9;
      c.elbowL.rotation.x = c.elbowR.rotation.x = -1.2;
      bendSpine(c, 0.3, 0, 0);
      c.neck.rotation.set(-0.3, 0, 0);
      if (f.cheerT > 0) {
        c.armR.rotation.x = -2.9;
        c.armL.rotation.x = -2.6 + Math.sin(f.cheerT * 18) * 0.3;
        c.elbowL.rotation.x = c.elbowR.rotation.x = -0.2;
        bendSpine(c, -0.15, Math.sin(f.cheerT * 9) * 0.15, 0);
        c.neck.rotation.set(-0.25, 0, 0);
      }
      return f.seatY - 0.9;
    }
    let y = 0.04;
    c.group.rotation.x = 0;
    c.armL.rotation.z = c.armR.rotation.z = 0;
    c.group.userData.fbGrip = null;
    // Down: a diving catch (laid out, then getting up) or brought down in a tackle.
    if (f.downT > 0) {
      const T = f.downLen || 1.1;
      const t = T - f.downT;
      const k = t < 0.25 ? t / 0.25 : f.downT < 0.35 ? f.downT / 0.35 : 1;
      return y + layoutPose(c, k, f.dive);
    }
    const set = this.phase === 'set' && p.speed === 0;
    if (set) y = (f.role === 'qb' ? qbStance(c) : f.role === 'wr' || f.role === 'rb' ? wrStance(c) : f.role === 'db' || f.role === 'lb' ? dbStance(c) : 0) + 0.04; // (in their stance)
    if (f.beatT > 0) jukedPose(c, f.jukeSide || 1); // (juked: off balance, twisted, arms out)
    if (b) {
      if (b.holder === p) {
        if (f.throwT > 0) throwPose(c, 1 - Math.max(0, f.throwT - 0.12) / 0.23, 0); // (winding up)
        else if (p.speed > (f.role === 'qb' ? 4 : 0.5)) tuckCarry(c, p.speed); // (high and tight; a quarterback dropping back keeps two hands on it)
        else if (!set) y = holdBall(c, f.role === 'qb' ? Math.sin(this.t * 1.6) * 0.8 : 0, p.speed < 0.6, this.t) + 0.04; // (in the pocket, scanning, feet at shoulder width)
      } else if (f.relT > 0) {
        throwPose(c, 1, 1 - f.relT / 0.4); // (the throw and the follow-through)
      } else if (b.mode === 'flight' && b.to === p && b.T - b.t < 0.6) {
        if (b.kind === 'pass') catchPose(c, b.style === 'lob' || b.p1[1] > 1.5);
        else catchPose(c, false); // (a toss or a handoff: hands out at the chest)
      } else if ((f.role === 'db' || f.role === 'lb') && (this.phase === 'play' || this.match?.mode === 'drive') && b.mode === 'flight' && b.kind === 'pass') {
        reachBall(c); // (going up for it)
      }
    }
    return y;
  }
}

// How far he's still got to run on his route.
function routeLeft(w) {
  const r = w.fb.route;
  if (!r) return 0;
  let d = 0;
  let x = w.x;
  let z = w.z;
  for (let k = w.fb.leg; k < r.length; k++) {
    d += dist(x, z, r[k][0], r[k][1]);
    [x, z] = r[k];
  }
  return d;
}

// Stand back up (a fan getting off the bleachers).
function setDownLegs(p) {
  const c = p.char;
  bendLeg(c.legL, c.kneeL, 0, 0);
  bendLeg(c.legR, c.kneeR, 0, 0);
}

// (The shared football poses are in footballpose.js.)
const _fv = new THREE.Vector3();
