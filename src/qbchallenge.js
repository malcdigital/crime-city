import * as THREE from 'three';
import { dist, rand, pick, lerpAngle } from './util.js';
import { CTYPES, GOLD, YD, G } from './fieldmodes.js';
import { Scoreboard } from './scoreboard.js';

// The QB Challenge at Harbor Field (mixed into Gridiron: gridiron.js), picked from the field's
// menu. Three stages from the spot, 40 seconds each, with the throw meter (throwmeter.js: □
// bullet, ✕ touch, △ lob; hold for power, let go in the green, tap again on the line):
//   ACCURACY  five rings on posts downfield (10, 16, 22, 30 and 40 yards: 1, 2, 2, 3, 5 points;
//             "Moving" in the menu slides them side to side). D-pad ◀ ▶ (Z / X, ◀ ▶ on a phone)
//             picks the ring.
//   TIMING    three receivers line up and run routes (go, post, out, slant, curl); ◀ ▶ picks
//             one, and the throw's led to where he'll be. In stride (within 0.7 m of him) it's a
//             bullseye; close enough he catches it (a bit further, he lays out for it). Points by
//             how deep he caught it: under 12 yards 1, 20 yards 2, 30 yards 3, deeper 5.
//   POCKET    the rings again (still), with two rushers coming at you from 7 yards off every
//             snap: hold it too long and you're sacked (the streak's gone). Step up or slide in
//             the pocket to buy time.
// Scoring: through the middle of a ring (within 25 cm) is a BULLSEYE, double points. Hits in a
// row build a multiplier: x2 from the third, x3 from the sixth (a miss, a sack or a drop resets
// it). Every so often one ring turns gold, or a receiver gets a gold arrow: the MONEY target,
// double again for a few seconds.
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
  { id: 'time', name: 'TIMING', sub: 'Hit them in stride' },
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
const WR_X = [-9, 0, 9]; // (the receivers' line, across from the spot)
const WR_LINE = 6; // (meters downfield of the spot)
const WR_SPEED = 5.6;
const RUSH_START = 7; // (the rushers' marks, meters in front of the spot)
const RUSH_SPEED = 3.3;
const RUSH_DELAY = 0.5;
const SACK_R = 0.85;
const MONEY_T = 6;
const HITCAM_PTS = 5; // (the hit cam: the deep ring (or the money one) going through, or a receiver 30 yards out)
const HITCAM_GAP = 6; // (seconds, at least, between hit cams)

export const QBChallenge = {
  startChallenge(qb, moving) {
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
    const Q = (this.qbc = { spot: [F.cx, sz], gy, moving, stage: -1, t: -99, left: STAGE_T, score: 0, stageScores: [0, 0, 0], throws: 0, hits: 0, best, passed: false, targets: [], flights: [], ready: false, rackAt: 0, over: false, stageOver: false, overT: 0, sel: 2, streak: 0, mult: 1, money: null, nextMoney: 0, cam: null, wrs: [], rush: [], rep: null, rushOn: false, readyAt: 0 });
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
      Q.targets.push({ grp, ring, col, x: x0, z, x0, gy, pts, ph: rand(0, Math.PI * 2), amp: 0, ampM: moving ? rand(2.5, 4) : 0, per: rand(2.6, 4.2), flash: 0 });
    });
    // (left to right as you look downfield: ◀ ▶ steps through them in that order)
    Q.targets.sort((a, b) => a.x0 - b.x0);
    // The players: three to run routes, two to rush; the rest watch from the sideline.
    const pool = fb.players.slice().sort(() => Math.random() - 0.5);
    for (const q of pool) {
      q.fb.qbcSaveHome = q.fb.home;
      q.fb.qbcRole = null;
    }
    Q.wrs = pool.slice(0, 3);
    Q.rush = pool.length >= 5 ? pool.slice(3, 5) : pool.slice(-2); // (not enough out there: two of the receivers rush too)
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
    Q.rep = null;
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
    const F = fb.site.field;
    if (S.id === 'time') {
      Q.wrs.forEach((w, k) => {
        w.fb.qbcRole = 'wr';
        w.fb.side = null;
        w.fb.line = [Math.max(F.x0 + 2, Math.min(F.x1 - 2, sx + WR_X[k])), sz - WR_LINE];
        w.fb.home = w.fb.line; // (fb.route() runs from here)
      });
      Q.wrs.sort((a, b) => a.fb.line[0] - b.fb.line[0]);
      Q.sel = 1;
      Q.rep = { phase: 'set', t: 0, money: null, thrown: false, doneAt: 0 };
    } else {
      Q.sel = 2;
      if (S.id === 'pocket') {
        Q.rush.forEach((q, k) => {
          q.fb.qbcRole = 'rush';
          q.fb.side = null;
          q.fb.mark = [sx + (k ? 2.6 : -2.6), sz - RUSH_START];
        });
      }
    }
    for (const T of Q.targets) {
      T.grp.visible = S.id !== 'time';
      T.amp = S.id === 'acc' ? T.ampM : 0;
      T.x = T.x0;
      T.ring.material.color.setHex(T.col);
      T.ring.material.emissive.setHex(0);
    }
    this.qbcPlace();
  },

  // Everyone straight to their place, not walking there: the ones watching on the sideline,
  // the receivers on their line, the rushers on their marks.
  qbcPlace() {
    const Q = this.qbc;
    const [sx, sz] = Q.spot;
    for (const q of this.fb.players) {
      const f = q.fb;
      const at = f.qbcRole === 'wr' ? f.line : f.qbcRole === 'rush' ? f.mark : f.side;
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
    if (QBC_STAGES[Q.stage].id === 'time') return Q.rep?.phase === 'run' && !Q.rep.thrown;
    return true;
  },

  // What the meter's measured against: the ring you've picked, or where the receiver you've
  // picked will be when a touch pass gets there.
  qbcTarget() {
    const Q = this.qbc;
    if (!Q || Q.stage < 0) return null;
    if (QBC_STAGES[Q.stage].id !== 'time') return Q.targets[Q.sel] || null;
    const w = Q.wrs[Q.sel];
    if (!w) return null;
    const [px, pz] = this.game.player.pos();
    const [lx, lz] = this.qbcLead(w, 'touch', px, pz);
    return { x: lx, z: lz, w };
  },

  // Where a receiver will be in t seconds, on along his route.
  qbcAhead(w, t) {
    let x = w.x;
    let z = w.z;
    let left = t * WR_SPEED;
    const R = w.fb.route;
    if (this.qbc?.rep?.phase === 'run' && R) {
      for (let i = w.fb.leg || 0; i < R.length && left > 0; i++) {
        const d = dist(x, z, R[i][0], R[i][1]);
        if (d <= left) {
          x = R[i][0];
          z = R[i][1];
          left -= d;
        } else {
          x += ((R[i][0] - x) / d) * left;
          z += ((R[i][1] - z) / d) * left;
          left = 0;
        }
      }
    }
    return [x, z];
  },
  // (a lead: where he'll be when this kind of throw gets to him, worked out twice over)
  qbcLead(w, kind, px, pz) {
    const TY = CTYPES[kind];
    let [x, z] = [w.x, w.z];
    for (let i = 0; i < 3; i++) [x, z] = this.qbcAhead(w, TY.T(dist(px, pz, x, z)));
    return [x, z];
  },

  // Your buttons: ◀ ▶ picks the ring or the receiver; the meter throws.
  qbcInput(dt, a, fire) {
    const inp = this.game.input;
    const Q = this.qbc;
    const R = a.qbR || [];
    const MS = this.meterS();
    if (Q.stage >= 0 && !this.press && !MS.acc) {
      const n = QBC_STAGES[Q.stage].id === 'time' ? Q.wrs.length : Q.targets.length;
      const step = (inp.btnHit?.(14) || inp.hit?.('KeyZ') ? -1 : 0) + (inp.btnHit?.(15) || inp.hit?.('KeyX') ? 1 : 0);
      if (step && n) Q.sel = (Q.sel + step + n) % n;
    }
    this.meterInput(dt, a, fire);
    this.prevR = R.slice();
    this.prevFire = fire;
  },

  // Let go and tapped (fieldmodes.js meterRelease): at the ring, or led to the receiver.
  qbcThrow(T, kind, pw, acc, tapN) {
    const game = this.game;
    const p = game.player;
    const Q = this.qbc;
    const b = this.fb.ball;
    const [px, pz] = p.pos();
    const TY = CTYPES[kind];
    const isWR = QBC_STAGES[Q.stage].id === 'time';
    const w = isWR ? Q.wrs[Q.sel] : null;
    let tx;
    let tz;
    if (w) [tx, tz] = this.qbcLead(w, kind, px, pz);
    else {
      // (aimed at where the ring will be when it gets there)
      const ft = TY.T(dist(px, pz, T.x, T.z));
      tx = T.amp ? T.x0 + T.amp * Math.sin(T.ph + ((Q.t + ft) * Math.PI * 2) / T.per) : T.x;
      tz = T.z;
    }
    const d = dist(px, pz, tx, tz) || 1;
    const ux = (tx - px) / d;
    const uz = (tz - pz) / d;
    // (the power sets how far it carries; the tap, how far off line: early left, late right)
    // (dead on the green carries right there; anywhere in the green, close; off it, as far as
    // the power you let go at)
    const off = pw - this.needFor(kind, d);
    const k = Math.abs(off) <= TY.win * 0.5 ? 0.04 : Math.abs(off) <= TY.win ? 0.5 : 1;
    const L = Math.max(2, d + off * TY.max * k);
    let wob = TY.err * 0.25 * (0.4 + d / 45);
    if ((p.speed || 0) > 2.5) wob += 0.5;
    const lat = acc * 10 * (0.5 + d / 45) + rand(-1, 1) * wob;
    const p1 = [px + ux * L - uz * lat, w ? Q.gy + 1.3 : T.gy + RING_Y, pz + uz * L + ux * lat];
    const FT = TY.T(L);
    const perfect = this.meterResult(Q, kind, pw, this.needFor(kind, d), acc, tapN);
    const mesh = new THREE.Mesh(b.mesh.geometry, perfect ? GOLD : b.mesh.material);
    mesh.castShadow = true;
    game.scene.add(mesh);
    const p0 = [b.x, b.y, b.z];
    const f = { mesh, p0, p1, T: FT, t: 0, vy0: (p1[1] - p0[1] + 0.5 * G * FT * FT) / FT, tgt: w ? null : T, wr: w, ux, uz, ringD: w ? Infinity : d, crossed: !!w, done: false, mode: 'flight', x: p0[0], y: p0[1], z: p0[2], vx: 0, vy: 0, vz: 0, life: 0 };
    Q.flights.push(f);
    b.mesh.visible = false;
    Q.ready = false;
    Q.rushOn = false; // (it's out: the rush pulls up)
    Q.rackAt = Q.t + 0.7;
    Q.throws++;
    if (Q.rep) Q.rep.thrown = true;
    this.throwT = 0.26;
    // (a deep one that's going in: the hit cam rides it; not too often)
    // (it picks the ball up for the last second or so before it gets there)
    if (Q.t - (Q.lastCam ?? -99) > HITCAM_GAP && this.qbcGoingIn(f, w, T, L, lat, FT)) {
      const tIn = w ? FT : (f.ringD / L) * FT;
      Q.camNext = { f, at: Math.max(0, tIn - 1.0) };
      Q.lastCam = Q.t;
    }
  },

  // Will it go in? (for the hit cam: the +5 ring or the money ring, through it; a receiver 30
  // yards or more out, near enough to catch)
  qbcGoingIn(f, w, T, L, lat, FT) {
    const Q = this.qbc;
    if (w) return L >= 27 && Math.abs(lat) < 1.2;
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
    if (stage !== 'time' && Q.t >= 0) {
      if (Q.money && Q.t > Q.money.until) Q.money = null;
      if (!Q.money && Q.t >= Q.nextMoney && !Q.stageOver) {
        Q.money = { T: pick(Q.targets), until: Q.t + MONEY_T };
        Q.nextMoney = Q.t + MONEY_T + rand(5, 9);
        game.hud.toast(`MONEY RING: the +${Q.money.T.pts} pays double`, '#ffd23f');
      }
    }
    // The rings (sliding, when they move); the picked one pulsing, the money one gold.
    for (const T of Q.targets) {
      const on = stage !== 'time' && Q.targets[Q.sel] === T;
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
    if (stage === 'time') this.qbcRep(dt);
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

  // TIMING: a rep is the receivers set on the line, then their routes; the throw, then back.
  qbcRep(dt) {
    const Q = this.qbc;
    const R = Q.rep;
    R.t += dt;
    if (R.phase === 'set') {
      const lined = Q.wrs.every((w) => dist(w.x, w.z, ...w.fb.line) < 0.8);
      if (!lined || Q.t < 0 || Q.stageOver) R.t = 0;
      else if (R.t > 0.5 && Q.ready) {
        // (the routes: three different ones; sometimes one of them's the money man)
        const kinds = ['go', 'post', 'out', 'slant', 'curl'].sort(() => Math.random() - 0.5);
        Q.wrs.forEach((w, k) => {
          w.fb.route = this.fb.route(w, kinds[k]);
          w.fb.leg = 0;
        });
        R.money = Math.random() < 0.35 ? pick(Q.wrs) : null;
        if (R.money) this.game.hud.toast(`MONEY MAN: hit ${R.money.ballName || 'him'} for double`, '#ffd23f');
        Object.assign(R, { phase: 'run', t: 0, thrown: false, doneAt: 0 });
      }
    } else if (R.phase === 'run') {
      const f = Q.flights.find((x) => x.wr && !x.done);
      if (R.thrown && !f && !R.doneAt) R.doneAt = Q.t;
      if (!R.thrown && R.t > 6.5) {
        this.qbcMiss('Held it too long: nobody open');
        R.doneAt = Q.t;
        this.press = null;
        this.meterS().acc = null;
      }
      if (R.doneAt && Q.t > R.doneAt + 0.9) {
        R.phase = 'back';
        for (const w of Q.wrs) w.fb.route = null;
      }
    } else if (R.phase === 'back' && Q.wrs.every((w) => dist(w.x, w.z, ...w.fb.line) < 0.8)) Object.assign(R, { phase: 'set', t: 0, money: null });
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
    if (f.qbcRole === 'wr') {
      // (holding a catch a moment)
      if (Q.rep?.phase === 'run' && f.route) {
        const pt = f.route[f.leg];
        if (pt) {
          if (dist(p.x, p.z, pt[0], pt[1]) < 0.6) f.leg++;
          else return { tx: pt[0], tz: pt[1], speed: WR_SPEED };
        }
        // (the route's run: he settles and looks back for it, coming back to a ball that's short)
        const fl = Q.flights.find((x) => x.wr === p && !x.done);
        if (fl) {
          const g = goTo(fl.p1[0], fl.p1[2], 4);
          if (g && dist(p.x, p.z, fl.p1[0], fl.p1[2]) < 3) return g;
        }
        faceAt(px, pz);
        return { speed: 0 };
      }
      const g = goTo(f.line[0], f.line[1], 4.2);
      if (g) return g;
      faceAt(px, pz);
      return { speed: 0 };
    }
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

  // The balls in the air: through a ring, off it, short, wide; to a receiver, caught or not.
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
        if (f.mode === 'flight' && f.t >= f.T) {
          if (f.wr) this.qbcCatch(f);
          else this.qbcLand(f, (f.y - oy) / dt);
        }
      } else if (f.mode === 'caught') {
        // (in his hands a moment, then he tosses it aside)
        f.life += dt;
        const w = f.wr;
        f.mesh.position.set(w.x + Math.sin(w.heading) * 0.3, Q.gy + 1.15, w.z + Math.cos(w.heading) * 0.3);
        if (f.life > 1.1) {
          game.scene.remove(f.mesh);
          Q.flights.splice(Q.flights.indexOf(f), 1);
        }
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
  // A ball getting to a receiver: in stride, caught, laid out for, or incomplete.
  qbcCatch(f) {
    const Q = this.qbc;
    const w = f.wr;
    const d = dist(w.x, w.z, f.x, f.z);
    f.done = true;
    const dove = d >= 1.5 && d < 2.6 && this.fb.diveFor(w, f.x, f.z);
    const caught = d < 1.5 || (dove && Math.random() < 0.45);
    if (!caught) {
      this.qbcLand(f, -3);
      return this.qbcMiss(d < 2.6 ? `${w.ballName || 'He'} couldn't hang on` : 'Incomplete');
    }
    f.mode = 'caught';
    f.life = 0;
    const yd = (Q.spot[1] - w.z) / YD;
    const base = yd < 12 ? 1 : yd < 20 ? 2 : yd < 30 ? 3 : 5;
    this.qbcScore(base, { bull: d < 0.7, money: Q.rep?.money === w, label: d < 0.7 ? `In stride, ${Math.round(yd)} yds!` : dove ? 'Diving catch!' : `Caught, ${Math.round(yd)} yds` });
  },

  // The hit cam: riding behind the ball, looking on to the ring or the receiver (main.js
  // updateCamera asks; null when it's not on).
  camOverride() {
    const Q = this.mode === 'qbc' ? this.qbc : null;
    if (!Q?.cam) return null;
    const C = Q.cam;
    const f = C.f;
    const ux = f.ux;
    const uz = f.uz;
    const ty = f.wr ? Q.gy + 1.3 : f.tgt.gy + RING_Y;
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
    const S = this.qbcTarget();
    const aim = stage.id === 'time' ? S?.w : S;
    this.arrow.visible = !!aim && !Q.stageOver && !Q.cam;
    if (aim) {
      const y = stage.id === 'time' ? Q.gy + 2.5 : aim.gy + RING_Y + RING_R + 0.7;
      this.arrow.position.set(aim.x, y + Math.sin(game.time * 6) * 0.08, aim.z);
      this.arrow.material.color.setHex((stage.id === 'time' ? Q.rep?.money === aim : Q.money?.T === aim) ? 0xffc83a : 0xffd23f);
    }
    this.updateIcons?.();
    const inp = game.input;
    const kb = inp.mode === 'kb' && !inp.touchMode;
    const keys = inp.touchMode ? 'BULLET · TOUCH · LOB' : kb ? 'J · K · L' : '□ · ✕ · △';
    const pickK = inp.touchMode ? '◀ ▶' : kb ? 'Z / X' : 'D-pad ◀ ▶';
    const what = stage.id === 'time' ? 'a receiver' : 'a ring';
    const hint = Q.t < 0 ? `${stage.name}: ${stage.sub}` : Q.stageOver ? 'Time!' : this.meterS().acc ? 'Tap it again on the line!' : stage.id === 'time' && Q.rep?.phase !== 'run' ? 'Receivers setting up...' : `${pickK}: pick ${what} · ${keys}: hold, let go in the green, tap on the line${stage.id === 'pocket' ? ' · get it out before the rush gets there' : ''}`;
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
