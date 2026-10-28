import * as THREE from 'three';
import { ballMesh } from './court.js';
import { dist, lerpAngle } from './util.js';
import { handsAt } from './passpose.js';
import { crouchPose } from './character.js';

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
const GRAB_T = 0.62; // (turn to the rack, hands on it, back to the basket with it)
const _h = new THREE.Vector3();
const RACK_NAMES = ['Left corner', 'Left wing', 'Top', 'Right wing', 'Right corner'];
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
      const gy = game.city.groundY?.(sx, sz) || 0;
      if (S.kind === 'rack') {
        // A rack beside you (on your left as you face the basket), the front ball first.
        const cx = sx + left[0] * 0.72 - f[0] * 0.1;
        const cz = sz + left[1] * 0.72 - f[1] * 0.1;
        const frame = new THREE.Group();
        const metal = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 1.4), metal);
        top.position.y = 0.72;
        frame.add(top);
        for (const [ax, az] of [[-0.14, -0.62], [0.14, -0.62], [-0.14, 0.62], [0.14, 0.62]]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.72, 0.05), metal);
          leg.position.set(ax, 0.36, az);
          frame.add(leg);
        }
        frame.position.set(cx, gy, cz);
        frame.rotation.y = Math.atan2(f[0], f[1]);
        game.scene.add(frame);
        this.objs.push(frame);
        for (let k = 0; k < 5; k++) {
          const isMoney = k === 4 || S.i === money;
          const mesh = isMoney ? moneyBall() : ballMesh(); // (money balls: red, white and blue)
          const along = 0.52 - k * 0.26;
          const b = { mesh, x: cx + f[0] * along, y: gy + 0.75 + 0.12, z: cz + f[1] * along, vx: 0, vy: 0, vz: 0, mode: 'rack', holder: null, t: 0, pts: isMoney ? 2 : 1, ck: isMoney ? 'money' : 'reg', res: null }; // (ck: the contest's kind; the shot code uses kind)
          mesh.position.set(b.x, b.y, b.z);
          game.scene.add(mesh);
          this.objs.push(mesh);
          S.balls.push(b);
        }
      } else {
        // A deep ball on its stand, worth 3.
        const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.75, 10), new THREE.MeshLambertMaterial({ color: 0x2b2f36 }));
        const cx = sx + left[0] * 0.6;
        const cz = sz + left[1] * 0.6;
        stand.position.set(cx, gy + 0.375, cz);
        game.scene.add(stand);
        this.objs.push(stand);
        const mesh = deepBall();
        const b = { mesh, x: cx, y: gy + 0.75 + 0.12, z: cz, vx: 0, vy: 0, vz: 0, mode: 'rack', holder: null, t: 0, pts: 3, ck: 'deep', res: null };
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
    if (this.phase === 'move') {
      const [tx, tz] = this.station().spot;
      const dx = tx - px;
      const dz = tz - pz;
      const dl = Math.hypot(dx, dz) || 1;
      const yaw = game.camYaw;
      a.moveY = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / dl;
      a.moveX = (dx * -Math.cos(yaw) + dz * Math.sin(yaw)) / dl;
      a.bSprintNoX = a.sprint = dl > 0.8;
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
      this.face(p);
    } else if (this.phase === 'shoot' || this.phase === 'move') {
      this.clock = Math.max(0, this.clock - dt);
      if (this.clock <= 0) this.horn();
    }
    if (this.phase === 'shoot') {
      if (!sb.shot && !sb.you.fall) this.face(p);
      // Out of balls here (and your last one's away): on to the next station.
      if (this.ballsLeft() <= 0 && !sb.shot && !sb.you.fall && sb.has !== 'you') {
        this.si += 1;
        this.bi = 0;
        if (this.si >= this.stations.length) this.horn(true);
        else this.phase = 'move';
      } else if (sb.has !== 'you' && !sb.shot && !sb.you.fall && !this.grab && this.ballsLeft() > 0) {
        // Grab the next ball off the rack (on your left): turn to it, both hands on it, in.
        const b = this.station().balls[this.bi];
        this.grab = { t: 0, T: GRAB_T, b, from: [b.x, b.y, b.z] };
      }
      if (this.grab) {
        const G = this.grab;
        G.t += dt;
        const b = G.b;
        // (it stays on the rack till the hands get there, then rides in them to the chest)
        if (G.t > G.T * 0.45) {
          handsAt(p.char, _h);
          const k = Math.min(1, (G.t - G.T * 0.45) / (G.T * 0.2));
          b.x = G.from[0] + (_h.x - G.from[0]) * k;
          b.y = G.from[1] + (_h.y - G.from[1]) * k;
          b.z = G.from[2] + (_h.z - G.from[2]) * k;
          b.mesh.position.set(b.x, b.y, b.z);
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
      if (dist(px, pz, tx, tz) < 0.35) {
        p.x = tx;
        p.z = tz;
        p.speed = 0;
        this.phase = 'shoot';
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
    const out = Math.sin(Math.min(1, k / 0.9) * Math.PI); // (out to it and back)
    const [px, pz] = p.pos();
    const want = Math.atan2(G.b.x - px, G.b.z - pz);
    let turn = want - p.heading;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    c.group.rotation.y = p.heading + turn * out * 0.85;
    c.group.rotation.x = 0.28 * out;
    const reach = k < 0.55 ? out : 1 - (k - 0.55) / 0.45; // (arms out to it, then in to the chest)
    for (const [a, e, w, side] of [[c.armL, c.elbowL, c.wristL, 1], [c.armR, c.elbowR, c.wristR, -1]]) {
      a.rotation.x = -0.55 - 0.55 * reach;
      a.rotation.z = side * 0.28;
      e.rotation.x = -1.05 + 0.85 * reach;
      w.rotation.x = -0.4;
    }
    return crouchPose(c, 0.35 * out);
  }

  face(p) {
    const rim = this.sb.rim;
    const [px, pz] = p.pos();
    p.heading = Math.atan2(rim.x - px, rim.z - pz);
    p.char.group.rotation.y = p.heading;
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
