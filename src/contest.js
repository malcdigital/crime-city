import * as THREE from 'three';
import { ballMesh } from './court.js';
import { dist, lerpAngle } from './util.js';
import { handsAt } from './passpose.js';
import { crouchPose, makeCharacter } from './character.js';

// The 3-point contest (solo, against the clock and the leaderboard), the way the league runs it:
// five racks round the arc (the corners, the wings, the top), five balls each: four worth 1 and
// the last, the money ball, worth 2; one rack of your choosing is all money balls. Between the
// wing racks and the top, two deep balls a couple of meters behind the arc, worth 3 each. 70
// seconds; 40 is perfect. You grab each ball off the rack and shoot it (the same shot meter);
// between stations you run on your own. A ball let go before the horn counts if it goes in.
//
// streetball.js runs it (startContest): the shot itself is the usual one; this keeps the racks,
// hands you each ball, flies the ones you've let go of, keeps score and runs the clock.

const TIME = 70;
const GRAB_T = 0.45; // (turn to the rack, hands on it, back to the basket with it)
const RACK_TURN = 1.15; // (how far round to the left he turns for the rack: ~66°)
const SLOT = 0.26; // (ball to ball on the rack)
const ease = (k) => k * k * (3 - 2 * k);
const _h = new THREE.Vector3();
const _ax = new THREE.Vector3();
const RACK_NAMES = ['Left corner', 'Left wing', 'Top of the key', 'Right wing', 'Right corner'];
export { RACK_NAMES };

// The money ball: red, white and blue panels, the way the league's look; the deep ball gold.
let MONEY_TEX = null;
function moneyTexture() {
  if (MONEY_TEX) return MONEY_TEX;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const cols = ['#d32f2f', '#f5f5f5', '#1e4fd6', '#f5f5f5', '#d32f2f', '#f5f5f5', '#1e4fd6', '#f5f5f5'];
  cols.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect((i / cols.length) * 256, 0, 256 / cols.length + 1, 128);
  });
  g.strokeStyle = '#111';
  g.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo((i / 4) * 256, 0);
    g.lineTo((i / 4) * 256, 128);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(0, 64);
  g.lineTo(256, 64);
  g.stroke();
  MONEY_TEX = new THREE.CanvasTexture(c);
  MONEY_TEX.colorSpace = THREE.SRGBColorSpace;
  return MONEY_TEX;
}
function moneyBall() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 22, 14), new THREE.MeshLambertMaterial({ map: moneyTexture() }));
  m.castShadow = true;
  return m;
}
function deepBall() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 22, 14), new THREE.MeshLambertMaterial({ color: 0xffc928, emissive: 0x6b4a00 }));
  m.castShadow = true;
  return m;
}

// Reaching for the rack, out = 0 (holding at the chest) .. 1 (hands on the ball): arms out and
// down, a dip and a lean. (The turn to the left is the caller's.) Returns the crouch's height.
function reachPose(c, out) {
  c.group.rotation.x = 0.36 * out;
  for (const [a, e, w, side] of [[c.armL, c.elbowL, c.wristL, 1], [c.armR, c.elbowR, c.wristR, -1]]) {
    a.rotation.x = -0.55 - 0.4 * out;
    a.rotation.z = side * (0.3 - 0.08 * out);
    e.rotation.x = -1.05 + 0.95 * out;
    w.rotation.x = -0.5 + 0.2 * out;
  }
  return crouchPose(c, 0.5 * out);
}

// Where his hands are at full reach, turned to the rack: [left, up, forward] from where he stands
// facing the basket. The rack's front slot goes right there, so his hands land on the ball.
let REACH = null;
function reachPoint() {
  if (REACH) return REACH;
  try {
    const c = makeCharacter();
    c.group.position.set(0, 0, 0);
    c.group.rotation.y = RACK_TURN;
    c.group.position.y = reachPose(c, 1);
    c.group.updateMatrixWorld(true);
    const v = handsAt(c, new THREE.Vector3());
    // (facing +z, his left is +x)
    REACH = [v.x, v.y, v.z];
    if (!(v.y > 0.35 && v.y < 1.4 && Math.hypot(v.x, v.z) > 0.25 && Math.hypot(v.x, v.z) < 1.2)) REACH = [0.62, 0.9, 0.3];
  } catch {
    REACH = [0.62, 0.9, 0.3];
  }
  return REACH;
}

const tint = (m, color) => {
  m.traverse((o) => {
    if (o.isMesh && o.material) {
      o.material = o.material.clone();
      o.material.color = new THREE.Color(color);
    }
  });
  return m;
};

export class Contest {
  // sb: the Streetball running it; spots: the five rack spots (left corner to right corner),
  // deep: the two deep spots; money: which rack is all money balls.
  constructor(sb, spots, deep, money) {
    this.sb = sb;
    const game = sb.game;
    this.game = game;
    const rim = sb.rim;
    this.money = money;
    this.objs = []; // (meshes to take away at the end)
    // The stations, in order: rack 1, rack 2, deep 1, rack 3, deep 2, rack 4, rack 5.
    const mkRack = (i) => ({ kind: 'rack', i, spot: spots[i], balls: [] });
    const mkDeep = (i) => ({ kind: 'deep', i, spot: deep[i], balls: [] });
    this.stations = [mkRack(0), mkRack(1), mkDeep(0), mkRack(2), mkDeep(1), mkRack(3), mkRack(4)];
    for (const S of this.stations) {
      const [sx, sz] = S.spot;
      const fx = rim.x - sx;
      const fz = rim.z - sz;
      const fl = Math.hypot(fx, fz) || 1;
      const f = [fx / fl, fz / fl];
      const left = [f[1], -f[0]];
      S.f = f;
      S.left = left;
      const gy = game.city.groundY?.(sx, sz) || 0;
      // The front slot: where his hands land. The rack runs out from there, away from him.
      const [rl, ry, rf] = reachPoint();
      const P = [sx + left[0] * rl + f[0] * rf, gy + ry, sz + left[1] * rl + f[1] * rf];
      const dl = Math.hypot(left[0] * rl + f[0] * rf, left[1] * rl + f[1] * rf) || 1;
      const d = [-f[0], -f[1]]; // (the rack runs back from the front ball, alongside him on his left, pointing at the basket)
      S.P = P;
      S.d = d;
      const metal = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
      const topY = P[1] - 0.12 - 0.03; // (the ball sits on top)
      if (S.kind === 'rack') {
        const len = SLOT * 4 + 0.36;
        const frame = new THREE.Group();
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, len), metal);
        top.position.y = topY;
        frame.add(top);
        // (a lip at the front end: the balls roll down to it)
        const lip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.04), metal);
        lip.position.set(0, topY + 0.05, -len / 2);
        frame.add(lip);
        for (const [ax, az] of [[-0.13, -len / 2 + 0.06], [0.13, -len / 2 + 0.06], [-0.13, len / 2 - 0.06], [0.13, len / 2 - 0.06]]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, topY - gy, 0.045), metal);
          leg.position.set(ax, (topY - gy) / 2, az);
          frame.add(leg);
        }
        const mid = SLOT * 2;
        frame.position.set(P[0] + d[0] * mid, gy, P[2] + d[1] * mid);
        frame.rotation.y = Math.atan2(d[0], d[1]);
        game.scene.add(frame);
        this.objs.push(frame);
        S.rackSeg = [[P[0] - d[0] * 0.18, P[2] - d[1] * 0.18], [P[0] + d[0] * (SLOT * 4 + 0.18), P[2] + d[1] * (SLOT * 4 + 0.18)]];
        for (let k = 0; k < 5; k++) {
          const isMoney = k === 4 || S.i === money;
          const mesh = isMoney ? moneyBall() : ballMesh(); // (money balls: red, white and blue)
          const b = { mesh, x: P[0] + d[0] * SLOT * k, y: P[1], z: P[2] + d[1] * SLOT * k, vx: 0, vy: 0, vz: 0, mode: 'rack', holder: null, t: 0, pts: isMoney ? 2 : 1, ck: isMoney ? 'money' : 'reg', res: null, slot: k, slotTo: k }; // (ck: the contest's kind; the shot code uses kind)
          mesh.position.set(b.x, b.y, b.z);
          game.scene.add(mesh);
          this.objs.push(mesh);
          S.balls.push(b);
        }
      } else {
        // A deep ball on its stand, worth 3, right where his hands go.
        const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, topY - gy, 10), metal);
        stand.position.set(P[0], gy + (topY - gy) / 2, P[2]);
        game.scene.add(stand);
        this.objs.push(stand);
        S.rackSeg = [[P[0], P[2]], [P[0], P[2]]];
        const mesh = deepBall();
        const b = { mesh, x: P[0], y: P[1], z: P[2], vx: 0, vy: 0, vz: 0, mode: 'rack', holder: null, t: 0, pts: 3, ck: 'deep', res: null, slot: 0, slotTo: 0 };
        mesh.position.set(b.x, b.y, b.z);
        game.scene.add(mesh);
        this.objs.push(mesh);
        S.balls.push(b);
      }
    }
    this.si = 0; // (station)
    this.bi = 0; // (ball there)
    this.clock = TIME;
    this.phase = 'count'; // count -> shoot / move -> horn -> done
    this.t = 0;
    this.score = 0;
    this.flying = []; // (let go of, on their way)
    this.loose = []; // (shot, rolling about)
    this.grab = null;
    this.best = 0;
    game.leaderboard?.best().then((v) => (this.best = v));
  }

  station() {
    return this.stations[this.si];
  }

  ballsLeft() {
    const S = this.station();
    return S ? S.balls.length - this.bi : 0;
  }

  // (main.js asks for the nets: every contest ball near the rim)
  allBalls() {
    return [...this.flying.map((F) => F.b), ...this.loose];
  }

  // Can you shoot right now: on your spot, a ball in your hands, the clock running.
  canShoot() {
    return this.phase === 'shoot' && this.sb.has === 'you' && !this.grab;
  }

  // Your buttons (streetball input): you stay on your spot; between stations you run yourself.
  input(dt, a) {
    const sb = this.sb;
    const game = this.game;
    const p = game.player;
    const [px, pz] = p.pos();
    a.bMove = null;
    a.bStickX = a.bStickY = 0;
    a.bPass = false;
    a.bBlock = false;
    a.bSteal = false;
    a.bIntense = false;
    a.interactHeld = false;
    if (!this.canShoot() && !sb.shot) a.bShoot = false;
    a.moveX = a.moveY = 0;
    // (the camera behind you at the basket)
    const want = Math.atan2(sb.rim.x - px, sb.rim.z - pz);
    game.camYaw = lerpAngle(game.camYaw, want, Math.min(1, dt * 4));
    if (this.phase === 'move' && this.path?.length) {
      // (on round the front of the next rack, then easing onto the spot)
      let [tx, tz] = this.path[0];
      let dl = Math.hypot(tx - px, tz - pz);
      while (this.path.length > 1 && dl < 0.45) {
        this.path.shift();
        [tx, tz] = this.path[0];
        dl = Math.hypot(tx - px, tz - pz);
      }
      const last = this.path.length === 1;
      const k = last ? Math.max(0.22, Math.min(1, dl / 1.1)) : 1; // (slowing down into it)
      const yaw = game.camYaw;
      const dx = (tx - px) / (dl || 1);
      const dz = (tz - pz) / (dl || 1);
      a.moveY = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) * k;
      a.moveX = (dx * -Math.cos(yaw) + dz * Math.sin(yaw)) * k;
      a.bSprintNoX = a.sprint = !last && this.pathLen() > 3.5;
    }
  }

  // Every frame (streetball step).
  step(dt) {
    const sb = this.sb;
    const game = this.game;
    const p = game.player;
    const [px, pz] = p.pos();
    this.t += dt;
    if (this.phase === 'count') {
      // (3, 2, 1, go)
      if (this.t > 2.2) {
        this.phase = 'shoot';
        this.t = 0;
        game.hud.toast('GO!', '#5ef2b0');
      }
      this.face(p, dt);
    } else if (this.phase === 'shoot' || this.phase === 'move' || this.phase === 'settle') {
      this.clock = Math.max(0, this.clock - dt);
      if (this.clock <= 0) this.horn();
    }
    if (this.phase === 'shoot') {
      if (!sb.shot && !sb.you.fall && !this.grab) this.face(p, dt);
      // Out of balls here (and your last one's away): on to the next station.
      if (this.ballsLeft() <= 0 && !sb.shot && !sb.you.fall && sb.has !== 'you') {
        this.si += 1;
        this.bi = 0;
        if (this.si >= this.stations.length) this.horn(true);
        else {
          this.phase = 'move';
          this.path = this.route(this.station());
        }
      } else if (sb.has !== 'you' && !sb.shot && !sb.you.fall && !this.grab && this.ballsLeft() > 0) {
        // Grab the next ball off the rack (on your left): turn to it, both hands on it, in.
        const b = this.station().balls[this.bi];
        this.grab = { t: 0, T: GRAB_T, b, from: [b.x, b.y, b.z] };
      }
      if (this.grab) {
        const G = this.grab;
        G.t += dt;
        const b = G.b;
        // (it stays in the rack's front slot till the hands are on it (that's where his hands
        // land), then rides in them to the chest; the rest roll down a slot behind it)
        if (G.t > G.T * 0.27) {
          handsAt(p.char, _h);
          const k = ease(Math.min(1, (G.t - G.T * 0.27) / (G.T * 0.22))); // (the hands get there a beat after the pose does: eased joints)
          b.x = G.from[0] + (_h.x - G.from[0]) * k;
          b.y = G.from[1] + (_h.y - G.from[1]) * k;
          b.z = G.from[2] + (_h.z - G.from[2]) * k;
          b.mesh.position.set(b.x, b.y, b.z);
          if (!G.rolled && G.t > G.T * 0.45) {
            G.rolled = true;
            for (const o of this.station().balls) if (o !== b && o.mode === 'rack') o.slotTo = Math.max(0, o.slot - 1);
          }
        }
        if (G.t >= G.T) {
          b.mode = 'held';
          b.holder = 'you';
          sb.g.ball = b;
          sb.has = 'you';
          this.grab = null;
        }
      }
    } else if (this.phase === 'move') {
      const [tx, tz] = this.station().spot;
      if (this.path?.length === 1 && dist(px, pz, tx, tz) < 0.08) {
        p.x = tx;
        p.z = tz;
        p.speed = 0;
        this.path = null;
        this.phase = 'settle';
      }
    } else if (this.phase === 'settle') {
      // (on the spot: turning to the basket before reaching for the first ball)
      if (this.face(p, dt) < 0.08) this.phase = 'shoot';
    }
    // The balls left on the rack rolling down to the front.
    for (const S of this.stations) {
      if (!S.P) continue;
      for (const b of S.balls) {
        if (b.mode !== 'rack' || b.slot <= b.slotTo) continue;
        const was = b.slot;
        b.slot = Math.max(b.slotTo, b.slot - dt / 0.3);
        b.x = S.P[0] + S.d[0] * SLOT * b.slot;
        b.z = S.P[2] + S.d[1] * SLOT * b.slot;
        b.mesh.position.set(b.x, b.y, b.z);
        _ax.set(-S.d[1], 0, S.d[0]);
        b.mesh.rotateOnWorldAxis(_ax, ((was - b.slot) * SLOT) / 0.12); // (rolling, not sliding)
      }
    }
    // The ones you've let go of: up, and in (or off the rim); then rolling about.
    const rim = sb.rim;
    const G = 9.8;
    for (const F of [...this.flying]) {
      const b = F.b;
      b.t += dt;
      const k = Math.min(1, b.t / b.T);
      b.x = b.p0[0] + (b.p1[0] - b.p0[0]) * k;
      b.z = b.p0[2] + (b.p1[2] - b.p0[2]) * k;
      const t = Math.min(b.t, b.T);
      b.y = b.p0[1] + b.vy0 * t - 0.5 * G * t * t;
      b.mesh.rotation.x += dt * 9;
      if (b.t >= b.T) {
        this.flying.splice(this.flying.indexOf(F), 1);
        b.mode = 'loose';
        if (F.make) {
          b.x = rim.x;
          b.z = rim.z;
          b.vx = b.vz = 0;
          b.vy = -1.5;
          this.score += b.pts;
          b.res = 'make';
          game.sfx?.swish?.();
          if (b.ck !== 'reg') game.hud.toast(b.ck === 'deep' ? 'DEEP BALL! +3' : 'Money ball! +2', '#5ef2b0');
        } else {
          const side = Math.random() * 2 - 1;
          const sp = 1.5 + Math.random() * 1.7;
          const L = Math.hypot(side, 1);
          b.vx = ((rim.dx - rim.dz * side) / L) * sp;
          b.vz = ((rim.dz + rim.dx * side) / L) * sp;
          b.vy = 0.8 + Math.random() * 1.8;
          b.res = 'miss';
        }
        this.loose.push(b);
      }
    }
    for (const b of this.loose) {
      sb.H.roll(b, dt);
      b.mesh.position.set(b.x, b.y, b.z);
    }
    for (const F of this.flying) F.b.mesh.position.set(F.b.x, F.b.y, F.b.z);
    // After the horn: once nothing's in the air, the result.
    if (this.phase === 'horn' && (!this.flying.length || this.t > 3)) this.finish();
  }

  // Your body while grabbing a ball (streetball late): turned to the rack on your left, a little
  // dip, both hands out to the ball, then back square to the basket with it at the chest.
  pose(p) {
    const G = this.grab;
    if (!G) return 0;
    const c = p.char;
    const k = Math.min(1, G.t / G.T);
    const out = ease(Math.min(1, k / 0.3)) * (1 - ease(Math.max(0, (k - 0.42) / 0.58))); // (out to it, a beat on it, back)
    c.group.rotation.y = p.heading + RACK_TURN * out; // (round to the left, where the rack is)
    return reachPose(c, out);
  }

  // Turning to the basket (eased, never a snap). Returns how far off it still is.
  face(p, dt) {
    const rim = this.sb.rim;
    const [px, pz] = p.pos();
    const want = Math.atan2(rim.x - px, rim.z - pz);
    p.heading = lerpAngle(p.heading, want, Math.min(1, dt * 7));
    p.char.group.rotation.y = p.heading;
    let d = want - p.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
  }

  // The way to the next station: round the front (basket) end of its rack (it runs back along
  // that spot's left, the side you're coming from), then in onto the spot.
  route(S) {
    const [sx, sz] = S.spot;
    const { f, left, P } = S;
    return [
      [P[0] + f[0] * 1.15 + left[0] * 0.45, P[2] + f[1] * 1.15 + left[1] * 0.45], // (round the front end of its rack, the basket end)
      [sx + f[0] * 1.2, sz + f[1] * 1.2], // (in front of the spot)
      [sx, sz],
    ];
  }

  pathLen() {
    const [px, pz] = this.game.player.pos();
    let d = 0;
    let [x, z] = [px, pz];
    for (const [tx, tz] of this.path || []) {
      d += Math.hypot(tx - x, tz - z);
      [x, z] = [tx, tz];
    }
    return d;
  }

  // Your shot's away (streetball launch): it flies on its own; the next ball's yours to grab.
  release(b, make) {
    this.flying.push({ b, make });
    const sb = this.sb;
    sb.has = null;
    sb.flight = null;
    this.bi += 1;
    // (a stand-in so nothing reaches for a ball that's gone: the next one, still on the rack)
    const S = this.station();
    // (never the ball that's flying: the court would keep putting its mesh back where it was)
    sb.g.ball = S && S.balls[this.bi] ? S.balls[this.bi] : { mesh: new THREE.Object3D(), x: b.x, y: b.y, z: b.z, vx: 0, vy: 0, vz: 0, mode: 'rack', holder: null, t: 0 };
  }

  // Time (or the last ball): no more shots; whatever's in the air still counts.
  horn(allDone = false) {
    if (this.phase === 'horn' || this.phase === 'done') return;
    const sb = this.sb;
    if (sb.shot) sb.shot = null; // (not away before the horn: doesn't count)
    if (sb.has === 'you') {
      sb.has = null;
      sb.g.ball.mode = 'rack';
    }
    this.grab = null;
    this.phase = 'horn';
    this.t = 0;
    this.game.hud.toast(allDone ? 'All 27 up!' : 'BZZZT! Time!', '#ffd23f');
  }

  async finish() {
    if (this.phase === 'done') return;
    this.phase = 'done';
    const game = this.game;
    const score = this.score;
    const lb = game.leaderboard;
    const res = lb ? await lb.submit(score) : { best: 0, newBest: false };
    const board = lb ? await lb.top(10) : { shared: false, rows: [], rank: 0, mine: score };
    this.sb.endContest();
    game.card?.show({ score, ...res, board, again: () => this.sb.again3 && this.sb.again3() });
  }

  // The board: the clock, the score, each station's balls.
  view() {
    return {
      clock: this.clock,
      phase: this.phase,
      count: this.phase === 'count' ? Math.max(1, Math.ceil(2.2 - this.t - 0.4)) : 0,
      moneyName: RACK_NAMES[this.money],
      score: this.score,
      best: this.best,
      cur: this.phase === 'shoot' ? [this.si, this.bi] : null,
      stations: this.stations.map((S) => ({ kind: S.kind, balls: S.balls.map((b) => ({ kind: b.ck, res: b.res })) })),
    };
  }

  clear() {
    for (const o of this.objs) this.game.scene.remove(o);
    this.objs = [];
  }
}

// The results card after a run: your score, a new best, the leaderboard.
export class ResultsCard {
  constructor(game) {
    this.game = game;
    this.open = false;
    const el = document.createElement('div');
    el.id = 'contest-card';
    el.className = 'hidden';
    document.body.appendChild(el);
    this.el = el;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) this.act(b.dataset.act);
    });
  }

  show({ score, best, newBest, board, again }) {
    this.again = again;
    this.open = true;
    if (this.game.input.locked) this.game.input.unlock();
    const inp = this.game.input;
    const pad = inp.mode === 'pad' && !inp.touchMode;
    const rows = board.rows.length
      ? board.rows.map((r, i) => `<div class="cc-row${r.you ? ' you' : ''}"><span class="cc-rk">${i + 1}</span><span class="cc-nm"></span><span class="cc-sc">${r.best}</span></div>`).join('')
      : '<div class="cc-empty">No scores yet. You could be first.</div>';
    this.el.innerHTML = `<div class="cc-box">
      <div class="cc-h">3-POINT CONTEST</div>
      <div class="cc-score">${score}</div>
      <div class="cc-sub">${newBest ? '<b>NEW PERSONAL BEST!</b>' : `Your best: ${Math.max(best, score)}`}${board.shared && board.rank ? ` · #${board.rank} overall` : ''}</div>
      <div class="cc-lh">${board.shared ? 'LEADERBOARD' : 'YOUR BEST RUNS (THIS DEVICE)'}</div>
      <div class="cc-rows">${rows}</div>
      <div class="cc-btns"><div class="cc-btn go" data-act="again">${pad ? '✕ ' : ''}Run it back</div><div class="cc-btn" data-act="done">${pad ? '○ ' : ''}Done</div></div>
    </div>`;
    // (names are other people's: set as text)
    const nm = this.el.querySelectorAll('.cc-nm');
    board.rows.forEach((r, i) => {
      if (nm[i]) nm[i].textContent = r.you && !board.shared ? new Date(r.at || Date.now()).toLocaleDateString() : r.you ? `${r.name} (you)` : r.name;
    });
    this.el.classList.remove('hidden');
  }

  update(a) {
    const inp = this.game.input;
    if (a.menuOk || a.dealYes || inp.hit?.('Enter') || inp.hit?.('KeyE')) this.act('again');
    else if (a.menuBack || a.phoneBack) this.act('done');
  }

  act(what) {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
    if (what === 'again') this.again?.();
  }
}
