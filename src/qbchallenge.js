import * as THREE from 'three';
import { dist, rand, pick, lerpAngle } from './util.js';
import { CTYPES, GOLD, YD, G } from './fieldmodes.js';
import { Scoreboard } from './scoreboard.js';

// The QB Challenge at Harbor Field (mixed into Gridiron: gridiron.js), picked from the field's
// menu. Three stages from the spot, 40 seconds each, with the throw meter (throwmeter.js: □
// bullet, ✕ touch, △ lob; hold for power, let go in the green, tap again on the line), at five
// rings on posts downfield (10, 16, 22, 30 and 40 yards: 1, 2, 2, 3, 5 points). D-pad ◀ ▶
// (Z / X, ◀ ▶ on a phone) picks the ring.
//   ACCURACY  the rings standing still.
//   MOVING    the rings sliding side to side (the throw's aimed where the ring will be), and the
//             green on the power meter narrower (MOVE_WIN of its width).
//   POCKET    the rings still again, with two rushers coming at you from 7 yards off every
//             snap: hold it too long and you're sacked (the streak's gone). Step up or slide in
//             the pocket to buy time.
// Scoring: through the middle of a ring (within 25 cm) is a BULLSEYE, double points. Hits in a
// row build a multiplier: x2 from the third, x3 from the sixth (a miss or a sack resets it).
// Every so often one ring turns gold: the MONEY ring, double again for a few seconds.
// Presentation: an intro (the camera flying down the field over the rings; skippable), a 3-2-1
// before each stage, the contest board (the clock, the three stages' scores, the multiplier,
// the record), a hit cam that rides a deep ball in (time slowed; the clock waits for it), the
// record banner the moment you pass it, and a finish (the camera round you, the final score by
// stage, NEW RECORD). The best total is saved (a new record: +3 cred).

const RING_R = 0.8;
const RING_Y = 1.7;
const QBC_KEY = 'crimecity.qbc.v2';
const STAGE_T = 40;
export const QBC_STAGES = [
  { id: 'acc', name: 'ACCURACY', sub: 'Put it through the rings' },
  { id: 'move', name: 'MOVING', sub: 'Rings on the move, a smaller green' },
  { id: 'pocket', name: 'POCKET', sub: 'Beat the rush' },
];
// The rings: [yards downfield, meters across, points]
const TARGETS = [
  [10, -6, 1],
  [16, 6.5, 2],
  [22, 0, 2],
  [30, -7.5, 3],
  [40, 5, 5],
];
const COLORS = [0x6fa8ff, 0x3ddc97, 0xffd23f, 0xff9f43, 0xff4d6d];
const BULL = 0.25; // (through the middle of a ring: a bullseye)
const MOVE_WIN = 0.6; // (MOVING: the green window on the power meter, this much of its usual width)
const RUSH_START = 7; // (the rushers' marks, meters in front of the spot)
const RUSH_SPEED = 3.3;
const RUSH_DELAY = 0.5;
const SACK_R = 0.85;
const MONEY_T = 6;
const HITCAM_PTS = 5; // (the hit cam: the deep ring (or the money one) going through)
const HITCAM_GAP = 6; // (seconds, at least, between hit cams)

export const QBChallenge = {
  startChallenge(qb) {
    const game = this.game;
    const fb = this.fb;
    this.startMode(qb, 'qbc');
    const F = fb.site.field;
    const sz = Math.min(F.z1 - 12, Math.max(F.z0 + 47, fb.los + 5));
    const p = game.player;
    p.x = F.cx;
    p.z = sz;
    p.heading = Math.PI; // (facing downfield)
    game.camYaw = Math.PI;
    let best = 0;
    try {
      best = Number(localStorage.getItem(QBC_KEY)) || 0;
    } catch {
      // (storage unavailable)
    }
    const gy = game.city.groundY?.(F.cx, sz) || 0;
    const Q = (this.qbc = { spot: [F.cx, sz], gy, stage: -1, t: -99, left: STAGE_T, score: 0, stageScores: [0, 0, 0], throws: 0, hits: 0, best, passed: false, targets: [], flights: [], ready: false, rackAt: 0, over: false, stageOver: false, overT: 0, sel: 2, streak: 0, mult: 1, money: null, nextMoney: 0, cam: null, rush: [], rushOn: false, readyAt: 0 });
    TARGETS.forEach(([yd, across, pts], i) => {
      const z = sz - yd * YD;
      const x0 = F.cx + across;
      const grp = new THREE.Group();
      const col = COLORS[i];
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, RING_Y - RING_R + 0.05, 6), new THREE.MeshLambertMaterial({ color: 0x2a2f38 }));
      post.position.y = (RING_Y - RING_R) / 2;
      grp.add(post);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.08, 8, 28), new THREE.MeshLambertMaterial({ color: col, emissive: 0x000000 }));
      ring.position.y = RING_Y;
      grp.add(ring);
      // (a see-through face with its points and the bullseye on it)
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const g = cv.getContext('2d');
      const hex = `#${col.toString(16).padStart(6, '0')}`;
      g.fillStyle = hex;
      g.globalAlpha = 0.25;
      g.beginPath();
      g.arc(64, 64, 62, 0, Math.PI * 2);
      g.fill();
      const br = (BULL / (RING_R * 0.92)) * 62; // (the bullseye, to scale)
      g.globalAlpha = 0.5;
      g.fillStyle = '#ffd23f';
      g.beginPath();
      g.arc(64, 64, br, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 0.95;
      g.strokeStyle = '#fff3b0';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(64, 64, br, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#ffffff';
      g.font = 'bold 30px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`+${pts}`, 64, 24); // (its points: "+3", not to be mixed up with its button)
      g.font = 'bold 15px sans-serif';
      g.fillText(pts > 1 ? 'PTS' : 'PT', 64, 106);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(RING_R * 0.92, 28), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      disc.position.y = RING_Y;
      grp.add(disc);
      grp.position.set(x0, gy, z);
      grp.rotation.y = Math.atan2(F.cx - x0, sz - z); // (facing the spot)
      game.scene.add(grp);
      Q.targets.push({ grp, ring, col, x: x0, z, x0, gy, pts, ph: rand(0, Math.PI * 2), amp: 0, ampM: rand(2.5, 4), per: rand(2.6, 4.2), flash: 0 });
    });
    // (left to right as you look downfield: ◀ ▶ steps through them in that order)
    Q.targets.sort((a, b) => a.x0 - b.x0);
    // The players: two to rush in the pocket; the rest watch from the sideline.
    const pool = fb.players.slice().sort(() => Math.random() - 0.5);
    for (const q of pool) {
      q.fb.qbcSaveHome = q.fb.home;
      q.fb.qbcRole = null;
    }
    Q.rush = pool.slice(0, 2);
    this.toSideline(sz - 4);
    this.qbcPlace(); // (already off the field when the intro starts)
    fb.ball.mesh.visible = false; // (in your hands from stage one: not left hanging where it was under the intro)
    // The intro, then stage one (the game waits under the intro).
    game.qbcCine?.intro({ spot: Q.spot, gy, rings: Q.targets.map((T) => [T.x, T.z]), best }, () => this.qbcStage(0));
    if (!game.qbcCine) this.qbcStage(0);
  },

  // A stage: its players placed, its targets up, the 3-2-1.
  qbcStage(i) {
    const game = this.game;
    const fb = this.fb;
    const Q = this.qbc;
    if (!Q) return;
    const S = QBC_STAGES[i];
    Q.stage = i;
    Q.t = -3;
    Q.left = STAGE_T;
    Q.stageOver = false;
    Q.ready = true;
    Q.readyAt = 0;
    Q.streak = 0;
    Q.mult = 1;
    Q.money = null;
    Q.nextMoney = rand(6, 10);
    Q.rushOn = false;
    this.press = null;
    const MS = this.meterS();
    MS.acc = null;
    this.fb.ball.mesh.visible = true;
    const [sx, sz] = Q.spot;
    game.player.x = sx;
    game.player.z = sz;
    game.player.heading = Math.PI;
    // (everyone off the field first; then this stage's players to their marks)
    for (const q of fb.players) {
      q.fb.qbcRole = null;
      q.fb.route = null;
    }
    this.toSideline(sz - 4);
    Q.sel = 2;
    if (S.id === 'pocket') {
      Q.rush.forEach((q, k) => {
        q.fb.qbcRole = 'rush';
        q.fb.side = null;
        q.fb.mark = [sx + (k ? 2.6 : -2.6), sz - RUSH_START];
      });
    }
    for (const T of Q.targets) {
      T.amp = S.id === 'move' ? T.ampM : 0;
      T.x = T.x0;
      T.ring.material.color.setHex(T.col);
      T.ring.material.emissive.setHex(0);
    }
    this.qbcPlace();
  },

  // Everyone straight to their place, not walking there: the ones watching on the sideline,
  // the rushers on their marks.
  qbcPlace() {
    const Q = this.qbc;
    const [sx, sz] = Q.spot;
    for (const q of this.fb.players) {
      const f = q.fb;
      const at = f.qbcRole === 'rush' ? f.mark : f.side;
      if (!at) continue;
      q.x = at[0];
      q.z = at[1];
      q.speed = 0;
      f.downT = f.pickT = 0;
      f.dive = false;
      q.heading = f.qbcRole ? Math.atan2(sx - q.x, sz - q.z) : Math.atan2(sx - q.x, sz - 8 - q.z); // (facing you, or the field)
      // (the body too, right now: under the intro the game's not running to move it)
      q.char.group.position.x = q.x;
      q.char.group.position.z = q.z;
      q.char.group.rotation.y = q.heading;
    }
  },

  qbcCanThrow() {
    const Q = this.qbc;
    if (!Q || Q.stage < 0 || Q.t < 0 || Q.stageOver || !Q.ready || Q.cam || this.downT > 0) return false;
    return true;
  },

  // What the meter's measured against: the ring you've picked.
  qbcTarget() {
    const Q = this.qbc;
    if (!Q || Q.stage < 0) return null;
    return Q.targets[Q.sel] || null;
  },
  // (the green on the power meter: narrower when the rings move; fieldmodes.js winFor)
  qbcWinK() {
    const Q = this.qbc;
    return Q && QBC_STAGES[Q.stage]?.id === 'move' ? MOVE_WIN : 1;
  },

  // Your buttons: ◀ ▶ picks the ring; the meter throws.
  qbcInput(dt, a, fire) {
    const inp = this.game.input;
    const Q = this.qbc;
    const R = a.qbR || [];
    const MS = this.meterS();
    if (Q.stage >= 0 && !this.press && !MS.acc) {
      const n = Q.targets.length;
      const step = (inp.btnHit?.(14) || inp.hit?.('KeyZ') ? -1 : 0) + (inp.btnHit?.(15) || inp.hit?.('KeyX') ? 1 : 0);
      if (step && n) Q.sel = (Q.sel + step + n) % n;
    }
    this.meterInput(dt, a, fire);
    this.prevR = R.slice();
    this.prevFire = fire;
  },

  // Let go and tapped (fieldmodes.js meterRelease): at the ring (where it'll be, if it's moving).
  qbcThrow(T, kind, pw, acc, tapN) {
    const game = this.game;
    const p = game.player;
    const Q = this.qbc;
    const b = this.fb.ball;
    const [px, pz] = p.pos();
    const TY = CTYPES[kind];
    // (aimed at where the ring will be when it gets there)
    const ft = TY.T(dist(px, pz, T.x, T.z));
    const tx = T.amp ? T.x0 + T.amp * Math.sin(T.ph + ((Q.t + ft) * Math.PI * 2) / T.per) : T.x;
    const tz = T.z;
    const d = dist(px, pz, tx, tz) || 1;
    const ux = (tx - px) / d;
    const uz = (tz - pz) / d;
    // (the power sets how far it carries; the tap, how far off line: early left, late right)
    // (dead on the green carries right there; anywhere in the green, close; off it, as far as
    // the power you let go at)
    const off = pw - this.needFor(kind, d);
    const win = this.winFor(kind);
    const k = Math.abs(off) <= win * 0.5 ? 0.04 : Math.abs(off) <= win ? 0.5 : 1;
    const L = Math.max(2, d + off * TY.max * k);
    let wob = TY.err * 0.25 * (0.4 + d / 45);
    if ((p.speed || 0) > 2.5) wob += 0.5;
    const lat = acc * 10 * (0.5 + d / 45) + rand(-1, 1) * wob;
    const p1 = [px + ux * L - uz * lat, T.gy + RING_Y, pz + uz * L + ux * lat];
    const FT = TY.T(L);
    const perfect = this.meterResult(Q, kind, pw, this.needFor(kind, d), acc, tapN);
    const mesh = new THREE.Mesh(b.mesh.geometry, perfect ? GOLD : b.mesh.material);
    mesh.castShadow = true;
    game.scene.add(mesh);
    const p0 = [b.x, b.y, b.z];
    const f = { mesh, p0, p1, T: FT, t: 0, vy0: (p1[1] - p0[1] + 0.5 * G * FT * FT) / FT, tgt: T, ux, uz, ringD: d, crossed: false, done: false, mode: 'flight', x: p0[0], y: p0[1], z: p0[2], vx: 0, vy: 0, vz: 0, life: 0 };
    Q.flights.push(f);
    b.mesh.visible = false;
    Q.ready = false;
    Q.rushOn = false; // (it's out: the rush pulls up)
    Q.rackAt = Q.t + 0.7;
    Q.throws++;
    this.throwT = 0.26;
    // (a deep one that's going in: the hit cam rides it; not too often)
    // (it picks the ball up for the last second or so before it gets there)
    if (Q.t - (Q.lastCam ?? -99) > HITCAM_GAP && this.qbcGoingIn(f, T, L, lat, FT)) {
      const tIn = (f.ringD / L) * FT;
      Q.camNext = { f, at: Math.max(0, tIn - 1.0) };
      Q.lastCam = Q.t;
    }
  },

  // Will it go in? (for the hit cam: the +5 ring or the money ring, through it)
  qbcGoingIn(f, T, L, lat, FT) {
    const Q = this.qbc;
    if (!(T.pts >= HITCAM_PTS || Q.money?.T === T) || L < f.ringD) return false;
    const k = f.ringD / L;
    const t = k * FT;
    const y = f.p0[1] + f.vy0 * t - 0.5 * G * t * t;
    return Math.hypot(lat * k, y - (T.gy + RING_Y)) < RING_R - 0.15;
  },

  // A hit: the points (bullseye, money, the multiplier), the streak, the record.
  qbcScore(base, { bull = false, money = false, label = '' } = {}) {
    const game = this.game;
    const Q = this.qbc;
    Q.streak++;
    Q.hits++;
    Q.mult = Q.streak >= 6 ? 3 : Q.streak >= 3 ? 2 : 1;
    const pts = base * (bull ? 2 : 1) * (money ? 2 : 1) * Q.mult;
    Q.score += pts;
    Q.stageScores[Q.stage] += pts;
    const tags = [bull ? 'BULLSEYE' : '', money ? 'MONEY' : '', Q.mult > 1 ? `x${Q.mult}` : ''].filter(Boolean).join(' · ');
    game.hud.toast(`${label}${tags ? ` ${tags}` : ''} +${pts}`, bull || money ? '#ffd23f' : '#7ee081');
    if (pts >= 6) for (const q of this.fb.fans) q.fb.cheerT = rand(1, 1.6);
    if (!Q.passed && Q.best > 0 && Q.score > Q.best) {
      Q.passed = true;
      game.contestCine?.record(Q.score);
      for (const q of this.fb.fans) q.fb.cheerT = 2.2;
    }
  },
  qbcMiss(why) {
    const Q = this.qbc;
    if (Q.streak >= 3) this.game.hud.toast(`${why} · streak over`, '#ff8080');
    else this.game.hud.toast(why, '#ff8080');
    Q.streak = 0;
    Q.mult = 1;
  },

  qbcStep(dt) {
    const game = this.game;
    const Q = this.qbc;
    const p = game.player;
    if (!Q || Q.stage < 0) return;
    const stage = QBC_STAGES[Q.stage].id;
    Q.t += dt;
    if (Q.t >= 0 && !Q.cam && !Q.stageOver) Q.left -= dt; // (the clock waits for the hit cam)
    if (this.downT > 0) this.downT -= dt;
    // (the next ball: a beat after each throw; in the pocket, once the rush is back on its marks)
    if (!Q.ready && Q.t >= Q.rackAt && !Q.stageOver && !Q.cam && !Q.camNext && !(this.downT > 0)) {
      const set = stage !== 'pocket' || Q.rush.every((q) => dist(q.x, q.z, ...q.fb.mark) < 1);
      if (set) {
        Q.ready = true;
        Q.readyAt = Q.t;
        this.fb.ball.mesh.visible = true;
      }
    }
    // (you throw from the spot: a few steps of room)
    const [sx, sz] = Q.spot;
    p.x = Math.max(sx - 4, Math.min(sx + 4, p.x));
    p.z = Math.max(sz - 0.5, Math.min(sz + 4, p.z));
    // The camera on what you've picked, you squared up to it.
    const S = this.qbcTarget();
    if (S && !Q.cam) {
      const face = Math.atan2(S.x - p.x, S.z - p.z);
      game.camYaw = lerpAngle(game.camYaw, face, Math.min(1, dt * 6));
      if ((p.speed || 0) < 0.6 || this.press || this.meterS().acc) p.heading = lerpAngle(p.heading, face, Math.min(1, dt * 10));
    }
    // The money target: one ring gold for a few seconds every so often.
    if (Q.t >= 0) {
      if (Q.money && Q.t > Q.money.until) Q.money = null;
      if (!Q.money && Q.t >= Q.nextMoney && !Q.stageOver) {
        Q.money = { T: pick(Q.targets), until: Q.t + MONEY_T };
        Q.nextMoney = Q.t + MONEY_T + rand(5, 9);
        game.hud.toast(`MONEY RING: the +${Q.money.T.pts} pays double`, '#ffd23f');
      }
    }
    // The rings (sliding, when they move); the picked one pulsing, the money one gold.
    for (const T of Q.targets) {
      const on = Q.targets[Q.sel] === T;
      T.ring.scale.setScalar(on ? 1 + 0.06 * Math.sin(game.time * 8) : 1);
      if (T.amp) T.x = T.x0 + T.amp * Math.sin(T.ph + (Math.max(0, Q.t) * Math.PI * 2) / T.per);
      T.grp.position.x = T.x;
      T.grp.rotation.y = Math.atan2(p.x - T.x, p.z - T.z);
      const gold = Q.money?.T === T;
      if (T.flash > 0) {
        T.flash -= dt;
        T.ring.material.color.setHex(Math.floor(T.flash * 12) % 2 === 0 ? 0xffffff : gold ? 0xffc83a : T.col);
      } else T.ring.material.color.setHex(gold ? 0xffc83a : T.col);
      T.ring.material.emissive.setHex(gold ? (Math.sin(game.time * 9) > 0 ? 0x9a6a00 : 0x553800) : 0);
    }
    if (stage === 'pocket') this.qbcRush(dt);
    this.qbcFlights(dt);
    // The hit cam: on for the last second of the flight, done a beat after the ball's settled.
    if (Q.camNext && (Q.camNext.f.t >= Q.camNext.at || Q.camNext.f.done)) {
      if (!Q.camNext.f.done) Q.cam = { f: Q.camNext.f, endAt: null, pos: null };
      Q.camNext = null;
    }
    if (Q.cam) {
      const f = Q.cam.f;
      if (f.done && Q.cam.endAt == null) Q.cam.endAt = Q.t + 0.55;
      if ((Q.cam.endAt != null && Q.t >= Q.cam.endAt) || f.life > 2 || !Q.flights.includes(f)) Q.cam = null;
    }
    // Time: the balls in the air finish, then the next stage (or the finish).
    if (!Q.stageOver && Q.left <= 0) {
      Q.stageOver = true;
      Q.overT = Q.t;
      Q.rushOn = false;
      this.press = null;
      this.meterS().acc = null;
      game.hud.toast(`Time! ${QBC_STAGES[Q.stage].name}: ${Q.stageScores[Q.stage]} pts`, '#ffd23f');
    }
    if (Q.stageOver && !Q.cam && !Q.camNext && (!Q.flights.some((f) => !f.done) || Q.t > Q.overT + 4) && Q.t > Q.overT + 1.6) {
      if (Q.stage < QBC_STAGES.length - 1) this.qbcStage(Q.stage + 1);
      else this.qbcFinish();
    }
  },

  // POCKET: the rush comes a beat after each snap; reach you with the ball and you're sacked.
  qbcRush() {
    const game = this.game;
    const Q = this.qbc;
    if (Q.ready && !Q.stageOver && Q.t >= 0 && Q.t >= Q.readyAt + RUSH_DELAY) Q.rushOn = true;
    if (!Q.rushOn) return;
    const [px, pz] = game.player.pos();
    if (Q.rush.some((q) => dist(q.x, q.z, px, pz) < SACK_R)) {
      Q.rushOn = false;
      Q.ready = false;
      Q.rackAt = Q.t + 1.4;
      this.press = null;
      this.meterS().acc = null;
      this.downT = 1.1; // (you hit the turf: gridiron.js late())
      this.fb.ball.mesh.visible = false;
      this.qbcMiss('SACKED');
      game.shakeCamera?.(0.05, 0.25);
    }
  },

  // Where the challenge's players go (football.js drive → fieldmodes.js drivePlayer).
  driveQbc(p, f, b, goTo, faceAt) {
    const Q = this.qbc;
    const [px, pz] = this.game.player.pos();
    if (f.qbcRole === 'rush') {
      if (Q.rushOn) return { tx: px, tz: pz, speed: RUSH_SPEED };
      const g = goTo(f.mark[0], f.mark[1], 5);
      if (g) return g;
      faceAt(px, pz);
      return { speed: 0 };
    }
    void b;
    return { speed: 0 };
  },

  // The balls in the air: through a ring, off it, short, wide.
  qbcFlights(dt) {
    const game = this.game;
    const Q = this.qbc;
    for (const f of [...Q.flights]) {
      if (f.mode === 'flight') {
        f.t += dt;
        const k = Math.min(1, f.t / f.T);
        const ox = f.x;
        const oy = f.y;
        const oz = f.z;
        f.x = f.p0[0] + (f.p1[0] - f.p0[0]) * k;
        f.z = f.p0[2] + (f.p1[2] - f.p0[2]) * k;
        const t = Math.min(f.t, f.T);
        f.y = f.p0[1] + f.vy0 * t - 0.5 * G * t * t;
        f.mesh.position.set(f.x, f.y, f.z);
        f.mesh.lookAt(f.x + (f.x - ox) * 10, f.y + (f.y - oy) * 10, f.z + (f.z - oz) * 10);
        f.mesh.rotateZ(f.t * 25);
        // (through the ring's plane: through it, off it, or past it)
        if (!f.crossed && (f.x - f.p0[0]) * f.ux + (f.z - f.p0[2]) * f.uz >= f.ringD) {
          f.crossed = true;
          this.qbcCross(f, (f.y - oy) / dt);
        }
        if (f.mode === 'flight' && f.t >= f.T) this.qbcLand(f, (f.y - oy) / dt);
      } else {
        f.life += dt;
        f.vy -= G * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.z += f.vz * dt;
        if (f.y < 0.12) {
          f.y = 0.12;
          f.vy = Math.abs(f.vy) > 1.2 ? -f.vy * 0.4 : 0;
          f.vx *= 0.8;
          f.vz *= 0.8;
        }
        // (still on its way to the ring's plane: through it, or short if it hits the grass first)
        if (!f.crossed) {
          if ((f.x - f.p0[0]) * f.ux + (f.z - f.p0[2]) * f.uz >= f.ringD) {
            f.crossed = true;
            this.qbcCross(f, f.vy);
          } else if (f.y <= 0.13) {
            f.crossed = true;
            f.done = true;
            this.qbcMiss('Short');
          }
        }
        if (f.y <= 0.13) {
          f.vx *= 0.97;
          f.vz *= 0.97;
        }
        f.mesh.position.set(f.x, f.y, f.z);
        if (f.life > 2.5) {
          if (!f.done) f.done = true;
          game.scene.remove(f.mesh);
          Q.flights.splice(Q.flights.indexOf(f), 1);
        }
      }
    }
  },

  // A ball crossing a ring's plane: through it (it scores, and flies on), off it (knocked back),
  // or past it.
  qbcCross(f, vy) {
    const Q = this.qbc;
    const T = f.tgt;
    const lat = Math.abs((f.x - T.x) * -f.uz + (f.z - T.z) * f.ux);
    const off = Math.hypot(lat, f.y - (T.gy + RING_Y));
    f.done = true;
    if (off < RING_R - 0.11) {
      T.flash = 0.6;
      this.qbcScore(T.pts, { bull: off < BULL, money: Q.money?.T === T, label: off < BULL ? 'Dead center!' : 'Through!' });
    } else if (off < RING_R + 0.2) {
      const sp = Math.hypot(f.p1[0] - f.p0[0], f.p1[2] - f.p0[2]) / f.T;
      f.mode = 'loose';
      f.vx = -f.ux * sp * 0.25 + rand(-1, 1);
      f.vz = -f.uz * sp * 0.25;
      f.vy = Math.abs(vy) * 0.3 + 1;
      this.qbcMiss('Off the ring');
    } else this.qbcMiss(f.y > T.gy + RING_Y ? 'Over it' : 'Wide');
  },
  // The end of its flight (short of the ring, or past it): on as a loose ball.
  qbcLand(f, vy) {
    // (it carries on at the same pace, still falling: a touch short can still drop through)
    const sp = Math.hypot(f.p1[0] - f.p0[0], f.p1[2] - f.p0[2]) / f.T;
    f.mode = 'loose';
    f.vx = f.ux * sp;
    f.vz = f.uz * sp;
    f.vy = vy;
  },
  // The hit cam: riding behind the ball, looking on to the ring (main.js
  // updateCamera asks; null when it's not on).
  camOverride() {
    const Q = this.mode === 'qbc' ? this.qbc : null;
    if (!Q?.cam) return null;
    const C = Q.cam;
    const f = C.f;
    const ux = f.ux;
    const uz = f.uz;
    const ty = f.tgt.gy + RING_Y;
    const want = new THREE.Vector3(f.x - ux * 3.4 + uz * 0.9, Math.max(Q.gy + 1.2, f.y + 0.8), f.z - uz * 3.4 - ux * 0.9);
    if (!C.pos) C.pos = this.game.camera.position.clone();
    C.pos.lerp(want, 0.25);
    const look = new THREE.Vector3(f.x + ux * 5, f.y + (ty - f.y) * 0.5, f.z + uz * 5);
    return { pos: C.pos, look };
  },

  // The board, the arrow over your pick, the meter, the hint.
  qbcHud() {
    const game = this.game;
    const Q = this.qbc;
    if (!Q || Q.stage < 0) return;
    const stage = QBC_STAGES[Q.stage];
    const aim = this.qbcTarget();
    this.arrow.visible = !!aim && !Q.stageOver && !Q.cam;
    if (aim) {
      this.arrow.position.set(aim.x, aim.gy + RING_Y + RING_R + 0.7 + Math.sin(game.time * 6) * 0.08, aim.z);
      this.arrow.material.color.setHex(Q.money?.T === aim ? 0xffc83a : 0xffd23f);
    }
    this.updateIcons?.();
    const inp = game.input;
    const kb = inp.mode === 'kb' && !inp.touchMode;
    const keys = inp.touchMode ? 'BULLET · TOUCH · LOB' : kb ? 'J · K · L' : '□ · ✕ · △';
    const pickK = inp.touchMode ? '◀ ▶' : kb ? 'Z / X' : 'D-pad ◀ ▶';
    const hint = Q.t < 0 ? `${stage.name}: ${stage.sub}` : Q.stageOver ? 'Time!' : this.meterS().acc ? 'Tap it again on the line!' : `${pickK}: pick a ring · ${keys}: hold, let go in the green, tap on the line${stage.id === 'pocket' ? ' · get it out before the rush gets there' : ''}`;
    game.hud.sport?.(`QB CHALLENGE · STAGE ${Q.stage + 1} OF 3: ${stage.name}`, null, hint);
    // (the contest board: the 3-point contest's, shared)
    const sb = (game.sport.scoreboard ||= new Scoreboard());
    sb.showQbc?.({ left: Math.max(0, Q.left), count: Math.ceil(-Q.t), phase: Q.t < 0 ? 'count' : 'play', stage: Q.stage, stages: QBC_STAGES.map((s, i) => ({ name: s.name, score: Q.stageScores[i], done: i < Q.stage || (i === Q.stage && Q.stageOver) })), score: Q.score, best: Q.best, mult: Q.mult, streak: Q.streak, sub: stage.sub });
    this.meterHud();
  },

  qbcFinish() {
    const game = this.game;
    const Q = this.qbc;
    if (Q.finishing) return;
    Q.finishing = true;
    const rec = Q.score > Q.best && Q.score > 0;
    if (rec) {
      try {
        localStorage.setItem(QBC_KEY, String(Q.score));
      } catch {
        // (storage unavailable)
      }
      game.cred += 3;
    }
    for (const q of this.fb.fans) q.fb.cheerT = rec ? 3 : 1.5;
    const sb = game.sport.scoreboard;
    sb?.hideContest();
    game.hud.sport?.(null);
    this.arrow.visible = false;
    const done = () => {
      game.hud.toast(`QB Challenge: ${Q.score} points · ${Q.hits} of ${Q.throws} on target${rec ? ' · NEW RECORD! +3 cred' : Q.best ? ` · record ${Q.best}` : ''}`, rec ? '#7ee081' : '#ffd23f');
      this.end('qbc');
    };
    if (game.qbcCine) game.qbcCine.outro({ score: Q.score, best: Q.best, newBest: rec, stages: QBC_STAGES.map((s, i) => [s.name, Q.stageScores[i]]), hits: Q.hits, throws: Q.throws }, done);
    else done();
  },

  // Stopped or finished (fieldmodes.js endMode): everything put away.
  qbcEnd(how) {
    const game = this.game;
    const Q = this.qbc;
    for (const T of Q.targets) game.scene.remove(T.grp);
    for (const f of Q.flights) game.scene.remove(f.mesh);
    for (const q of this.fb.players) {
      if (q.fb.qbcSaveHome) q.fb.home = q.fb.qbcSaveHome;
      q.fb.qbcSaveHome = null;
      q.fb.qbcRole = null;
      q.fb.route = null;
    }
    game.sport.scoreboard?.hideContest();
    if (how !== 'qbc') game.hud.toast(how === 'forfeit' ? 'You walked off the QB Challenge' : 'QB Challenge stopped', '#9fc3ff');
    if (game.qbcCine?.open) {
      game.qbcCine.done = null; // (already ending: don't end it again)
      game.qbcCine.finish();
    }
    this.qbc = null;
  },
};

export { QBC_KEY };
