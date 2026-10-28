import * as THREE from 'three';
import { markPass, markCatch, passPose, passFrom, steerPass } from './passpose.js';
import { lam } from './character.js';
import { rand, dist, lerpAngle } from './util.js';
import { safetyAt, turnout, quietNote } from './safety.js';
import { ballMesh } from './court.js';

// People shooting hoops at the basketball courts (court.js): one of these per court.
// When you come near, a few people turn up at each basket (more in the day and evening, a
// couple late at night under the lights, nobody in the small hours). At each basket one has
// the ball: dribbles to a spot, sets, jumps and shoots. It goes in (drops through the net) or
// clanks off the rim; whoever's closest chases the rebound, and sometimes passes it out to
// someone else for the next shot. They're ordinary pedestrians underneath (peds.js state
// 'play'): shooting or crashing near them scatters them like anyone else, and the ball rolls
// to a stop where it's dropped.
const NEAR = 150; // they turn up when you're this close
const FAR = 200; // and go when you're this far
const G = 9.8;
const _axis = new THREE.Vector3();
const BALL_R = 0.12;
const FLOOR = 0.06 + BALL_R; // the court's surface
const ARRIVE = 0.4;

export class Hoops {
  constructor(game, site) {
    this.game = game;
    this.site = site;
    this.groups = [];
    this.spoiled = false; // everyone ran off: nobody comes back until you've been away
  }

  get active() {
    return this.groups.length > 0;
  }

  // How many at each basket right now.
  crowd() {
    const h = this.game.rhythm ? this.game.rhythm.hour() : 15;
    if (h >= 1 && h < 7) return [0, 0];
    if (h >= 23 || h < 1) return [2, 0];
    if (h < 10) return [2, 1];
    return [3, 2];
  }

  update(dt) {
    const S = this.site;
    if (!S) return;
    const game = this.game;
    const [px, pz] = game.player.pos();
    const d = dist(px, pz, S.cx, S.cz);
    if (d > FAR) {
      if (this.active) this.clear();
      this.spoiled = false;
      return;
    }
    if (!this.active && !this.spoiled && d < NEAR && game.time >= (this.nextTry || 0)) this.start();
    for (const g of this.groups) this.step(g, dt);
    // The nets: every ball in play at this court pushes them about.
    if (S.nets) {
      const balls = this.groups.map((g) => g.ball);
      const sb = game.sport;
      if (sb?.active && sb.H === this) {
        if (sb.g?.ball && !balls.includes(sb.g.ball)) balls.push(sb.g.ball);
        for (const P of sb.t33?.players || []) if (P.ball) balls.push(P.ball);
        if (sb.t3) balls.push(...sb.t3.allBalls());
      }
      for (const n of S.nets) n.step(dt, balls);
    }
    // Everyone gone (ran off, hurt): the game's over.
    if (this.active && this.groups.every((g) => !g.players.length)) {
      for (const g of this.groups) this.dropBall(g);
      this.spoiled = true;
      this.groups = this.groups.filter((g) => g.ball.mode !== 'held');
    }
  }

  start() {
    const S = this.site;
    // Fewer come out when it's not safe (safety.js).
    const safe = safetyAt(this.game, S.cx, S.cz);
    const counts = this.crowd().map((n) => turnout(n, safe.k, 0.25));
    if (counts[0] === 1 && counts[1]) [counts[0], counts[1]] = [counts[0] + counts[1], 0]; // (nobody shoots alone if there's company)
    quietNote(this.game, S.name, safe);
    this.nextTry = this.game.time + 30; // (if nobody came: look again in a while)
    if (!counts[0] && !counts[1]) return;
    S.ball.visible = false;
    S.hoops.forEach((rim, i) => {
      const n = counts[i];
      if (!n) return;
      if (this.game.sport?.solo && this.game.sport.rim === rim) return; // (you're shooting around there)
      const mesh = ballMesh(BALL_R);
      this.game.scene.add(mesh);
      const g = { rim, players: [], ball: { mesh, x: 0, y: FLOOR, z: 0, vx: 0, vy: 0, vz: 0, mode: 'held', holder: null, t: 0 }, last: null };
      for (let k = 0; k < n; k++) {
        const [x, z] = this.spot(g, 3, 7);
        const p = this.game.peds.addAt(x, z);
        p.state = 'play';
        p.act = this;
        p.keep = true;
        p.sidewalk = false;
        p.heading = Math.atan2(rim.x - x, rim.z - z);
        p.hp = { g, role: 'wait', spot: [x, z], t: rand(0, 2), dribble: Math.random() * 6 };
        g.players.push(p);
      }
      this.giveBall(g, g.players[0]);
      this.groups.push(g);
    });
  }

  clear() {
    for (const g of this.groups) {
      if (g.match) g.match.end('off');
      for (const p of g.players) if (!p.removed) p.dispose();
      this.game.scene.remove(g.ball.mesh);
    }
    this.groups = [];
    if (this.site) this.site.ball.visible = true;
  }

  // A spot on this basket's half, `a` to `b` meters out from the rim, on the court.
  spot(g, a, b) {
    const { rim } = g;
    const C = this.site.court; // (world bounds of the lines)
    const ang = rand(-1.25, 1.25);
    const r = rand(a, b);
    const out = Math.max(0.8, Math.cos(ang) * r); // out into the court
    const side = Math.sin(ang) * r; // across it
    const x = rim.x + rim.dx * out - rim.dz * side;
    const z = rim.z + rim.dz * out + rim.dx * side;
    return [Math.max(C.x0 + 0.6, Math.min(C.x1 - 0.6, x)), Math.max(C.z0 + 0.6, Math.min(C.z1 - 0.6, z))];
  }

  giveBall(g, p) {
    const b = g.ball;
    b.mode = 'held';
    b.holder = p;
    b.t = 0;
    for (const q of g.players) if (q !== p && q.hp.role !== 'wait') this.toWait(q);
    p.hp.role = 'hold';
    p.hp.phase = 'walk';
    p.hp.t = 0;
    p.hp.spot = this.openSpot(p, 1.5, 7);
  }

  toWait(p) {
    p.hp.role = 'wait';
    p.hp.spot = this.openSpot(p, 3, 7.5);
    p.hp.t = rand(2, 5);
  }

  // A spot that isn't on top of anyone else at this basket.
  openSpot(p, a, b) {
    const g = p.hp.g;
    let best = null;
    let room = -1;
    for (let k = 0; k < 6; k++) {
      const s = this.spot(g, a, b);
      let near = Infinity;
      for (const q of g.players) {
        if (q === p || !q.hp) continue;
        near = Math.min(near, dist(s[0], s[1], q.x, q.z), q.hp.spot ? dist(s[0], s[1], ...q.hp.spot) : Infinity);
      }
      if (near > 2.2) return s;
      if (near > room) {
        room = near;
        best = s;
      }
    }
    return best;
  }

  // The ball flies from where it is to (tx, ty, tz) in T seconds.
  launch(b, tx, ty, tz, T) {
    b.mode = 'flight';
    b.holder = null;
    b.p0 = [b.x, b.y, b.z];
    b.p1 = [tx, ty, tz];
    b.catcher = null; // (a pass sets these after: passpose.js)
    b.yAdj = 0;
    b.T = T;
    b.t = 0;
    b.vy0 = (ty - b.y + 0.5 * G * T * T) / T;
  }

  dropBall(g) {
    const b = g.ball;
    if (b.mode !== 'held') return;
    b.mode = 'loose';
    b.holder = null;
    b.vx = rand(-1, 1);
    b.vz = rand(-1, 1);
    b.vy = 0;
  }

  // ---- One basket's game ----
  step(g, dt) {
    const b = g.ball;
    if (g.match) return g.match.step(dt); // (you're playing him one-on-one: streetball.js)
    // Anyone who got scared off, hurt or killed is out (and drops the ball).
    for (const p of [...g.players]) {
      if (p.state === 'play' && !p.removed) continue;
      g.players.splice(g.players.indexOf(p), 1);
      p.keep = false;
      p.sidewalk = true;
      p.act = null;
      if (b.holder === p) this.dropBall(g);
      if (b.target === p) b.target = null;
    }
    if (b.mode === 'flight') {
      steerPass(b); // (a pass ends up in his hands)
      b.t += dt;
      const k = Math.min(1, b.t / b.T);
      b.x = b.p0[0] + (b.p1[0] - b.p0[0]) * k;
      b.z = b.p0[2] + (b.p1[2] - b.p0[2]) * k;
      const t = Math.min(b.t, b.T);
      b.y = b.p0[1] + b.vy0 * t - 0.5 * G * t * t + (b.yAdj || 0) * k;
      if (b.t >= b.T) this.landed(g);
    } else if (b.mode === 'loose') {
      this.roll(b, dt);
    }
    // Loose ball: the nearest (not the one who just shot, if anyone else is there) goes for it.
    if (b.mode === 'loose' || (b.mode === 'flight' && b.kind === 'shot' && b.t > b.T - 0.3)) {
      const pool = g.players.filter((p) => p !== g.last || g.players.length === 1);
      let best = null;
      for (const p of pool) if (!best || dist(p.x, p.z, b.x, b.z) < dist(best.x, best.z, b.x, b.z)) best = p;
      for (const p of g.players) {
        if (p === best) p.hp.role = 'chase';
        else if (p.hp.role === 'chase') this.toWait(p);
      }
      if (best && b.mode === 'loose' && dist(best.x, best.z, b.x, b.z) < 0.75 && b.y < 1.4) this.picked(g, best);
    }
    // Moving the ball with whoever has it.
    if (b.mode === 'held' && b.holder) {
      const p = b.holder;
      const fx = Math.sin(p.heading);
      const fz = Math.cos(p.heading);
      const jump = p.hp.jump || 0;
      if (p.hp.phase === 'walk') {
        p.hp.dribble += dt * (p.speed > 0 ? 9 : 7);
        b.x = p.x + fx * 0.4 - fz * 0.3;
        b.z = p.z + fz * 0.4 + fx * 0.3;
        b.y = FLOOR + Math.abs(Math.sin(p.hp.dribble)) * 0.8;
      } else {
        const up = p.hp.phase === 'shoot' ? Math.min(1, p.hp.t / 0.25) : 0;
        b.x = p.x + fx * 0.3;
        b.z = p.z + fz * 0.3;
        b.y = 1.2 + up * 1.0 + jump;
      }
    }
    b.mesh.position.set(b.x, b.y, b.z);
    if (b.mode === 'flight') b.mesh.rotation.x += dt * 9; // (backspin in the air)
    else if (b.mode === 'loose') {
      // Rolling: turns with how fast it's going along the ground, and stops when it stops.
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 0.05) {
        _axis.set(b.vz / sp, 0, -b.vx / sp);
        b.mesh.rotateOnWorldAxis(_axis, (sp / 0.12) * dt);
      }
    }
  }

  // The ball got where it was going.
  landed(g) {
    const b = g.ball;
    const { rim } = g;
    if (b.kind === 'pass') {
      const r = b.target;
      b.target = null;
      if (r && !r.removed && r.state === 'play' && dist(r.x, r.z, b.x, b.z) < 1.5) {
        this.giveBall(g, r);
        r.hp.phase = 'set'; // catch and shoot from there
        r.hp.t = rand(0.3, 0.7);
        return;
      }
      b.mode = 'loose';
      b.vx = b.vz = 0;
      b.vy = -1;
      return;
    }
    b.mode = 'loose';
    if (b.make) {
      // Through the net.
      b.x = rim.x;
      b.z = rim.z;
      b.vx = b.vz = 0;
      b.vy = -1.5;
      for (const p of g.players) if (p !== g.last) p.hp.cheerT = 0.9;
      this.game.sfx?.swish?.();
    } else {
      // Off the rim, back out into the court.
      const side = rand(-1, 1);
      const sp = rand(1.5, 3.2);
      const L = Math.hypot(side, 1);
      b.vx = ((rim.dx - rim.dz * side) / L) * sp;
      b.vz = ((rim.dz + rim.dx * side) / L) * sp;
      b.vy = rand(0.8, 2.6);
    }
  }

  // Bouncing and rolling, inside the fence.
  roll(b, dt) {
    const P = this.site.pad;
    b.vy -= G * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    if (b.y < FLOOR) {
      b.y = FLOOR;
      b.vy = Math.abs(b.vy) > 1 ? -b.vy * 0.65 : 0;
      const f = Math.max(0, 1 - dt * 1.2);
      b.vx *= f;
      b.vz *= f;
    }
    if (b.x < P.x0 + BALL_R || b.x > P.x1 - BALL_R) {
      b.x = Math.max(P.x0 + BALL_R, Math.min(P.x1 - BALL_R, b.x));
      b.vx = -b.vx * 0.5;
    }
    if (b.z < P.z0 + BALL_R || b.z > P.z1 - BALL_R) {
      b.z = Math.max(P.z0 + BALL_R, Math.min(P.z1 - BALL_R, b.z));
      b.vz = -b.vz * 0.5;
    }
  }

  picked(g, p) {
    const b = g.ball;
    this.giveBall(g, p);
    // Sometimes kick it out to someone else for the shot.
    const others = g.players.filter((q) => q !== p && q.hp.role === 'wait');
    if (others.length && Math.random() < 0.45) {
      p.hp.phase = 'pass';
      p.hp.t = 0;
      p.hp.to = others[Math.floor(Math.random() * others.length)];
    }
    b.y = Math.max(b.y, 1.0);
  }

  // ---- Each player: where to go (peds.js calls this every frame) ----
  drive(p, dt) {
    const h = p.hp;
    const g = h.g;
    if (g.match) return g.match.drive(p, dt);
    const { rim } = g;
    const b = g.ball;
    const face = (x, z) => {
      p.heading = lerpAngle(p.heading, Math.atan2(x - p.x, z - p.z), Math.min(1, dt * 7));
    };
    h.cheerT = Math.max(0, (h.cheerT || 0) - dt);
    h.jump = 0;
    if (h.role === 'chase') {
      // (to where the ball's heading)
      const tx = b.x + b.vx * 0.4;
      const tz = b.z + b.vz * 0.4;
      if (dist(p.x, p.z, tx, tz) < 0.5) {
        face(b.x, b.z);
        return { speed: 0 };
      }
      return { tx, tz, speed: 3.4 };
    }
    if (h.role === 'hold') {
      if (b.holder !== p && h.phase !== 'shoot') {
        this.toWait(p);
        return { speed: 0 };
      }
      h.t += dt;
      if (h.phase === 'walk') {
        if (dist(p.x, p.z, ...h.spot) > ARRIVE && h.t < 8) return { tx: h.spot[0], tz: h.spot[1], speed: 1.9 };
        h.phase = 'set';
        h.t = 0;
        h.setT = rand(0.4, 1.0);
        return { speed: 0 };
      }
      if (h.phase === 'pass') {
        const r = h.to;
        if (!r || r.removed || r.state !== 'play') {
          h.phase = 'walk';
          return { speed: 0 };
        }
        face(r.x, r.z);
        if (h.t > 0.35) {
          const d = dist(p.x, p.z, r.x, r.z);
          b.kind = 'pass';
          b.target = r;
          r.hp.role = 'catch';
          this.launch(b, r.x, 1.2, r.z, Math.max(0.35, d / 11));
          passFrom(b, p.char, r.char); // (from his hands, into the other's)
          markPass(p.char, this.game.time);
          markCatch(r.char, this.game.time + Math.max(0.35, d / 11));
          g.last = p;
          this.toWait(p);
        }
        return { speed: 0 };
      }
      if (h.phase === 'set') {
        face(rim.x, rim.z);
        if (h.t > (h.setT ?? 0.5)) {
          h.phase = 'shoot';
          h.t = 0;
        }
        return { speed: 0 };
      }
      if (h.phase === 'shoot') {
        face(rim.x, rim.z);
        h.jump = h.t < 0.5 ? Math.sin((Math.PI * h.t) / 0.5) * 0.45 : 0;
        if (h.t >= 0.25 && b.mode === 'held') {
          const d = dist(p.x, p.z, rim.x, rim.z);
          b.kind = 'shot';
          b.make = Math.random() < Math.max(0.3, 0.75 - d * 0.06);
          const miss = b.make ? 0 : rand(0.22, 0.38);
          const a = rand(0, Math.PI * 2);
          this.launch(b, rim.x + Math.cos(a) * miss, rim.y + 0.08, rim.z + Math.sin(a) * miss * 0.6, 0.75 + d * 0.06);
          g.last = p;
          h.release = true;
        }
        if (h.t > 0.65) this.toWait(p);
        return { speed: 0 };
      }
    }
    if (h.role === 'catch') {
      face(b.x, b.z);
      if (b.mode !== 'flight' || b.target !== p) this.toWait(p);
      return { speed: 0 };
    }
    // Waiting: drift to a spot, watch the ball, now and then move somewhere else.
    h.t -= dt;
    if (h.t <= 0) {
      h.spot = this.openSpot(p, 2.5, 7.5);
      h.t = rand(3, 7);
    }
    if (dist(p.x, p.z, ...h.spot) > ARRIVE) return { tx: h.spot[0], tz: h.spot[1], speed: 1.3 };
    face(b.x, b.z);
    return { speed: 0 };
  }

  // Arms and the jump (peds.js calls this after the walk animation; returns the height offset).
  pose(p) {
    const h = p.hp;
    if (h.g.match) return h.g.match.pose(p);
    const c = p.char;
    const b = h.g.ball;
    if (h.role === 'hold' && b.holder === p) {
      if (h.phase === 'walk') {
        c.armR.rotation.x = -0.5 - Math.abs(Math.cos(h.dribble)) * 0.35; // dribbling
      } else if (h.phase === 'shoot') {
        const k = Math.min(1, h.t / 0.25);
        c.armL.rotation.x = c.armR.rotation.x = -1.4 - k * 1.5;
      } else {
        c.armL.rotation.x = c.armR.rotation.x = -1.3; // ball at the chest
      }
    } else if (h.role === 'hold' && h.phase === 'shoot') {
      c.armR.rotation.x = -2.8; // (the follow-through)
      c.armL.rotation.x = -2.2;
    } else if (h.role === 'catch') {
      c.armL.rotation.x = c.armR.rotation.x = -1.2;
    } else if (h.cheerT > 0) {
      c.armR.rotation.x = -2.9;
    }
    passPose(c, this.game.time); // (a pass or a catch going on)
    return 0.06 + (h.jump || 0);
  }
}
