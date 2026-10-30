import * as THREE from 'three';
import { dist, rand, lerpAngle } from './util.js';
import { CTYPES, GOLD, YD, G } from './fieldmodes.js';
import { Scoreboard } from './scoreboard.js';

// The QB Challenge at Harbor Field (mixed into Gridiron: gridiron.js), picked from the field's
// menu. Three stages from the spot, with the throw meter (throwmeter.js: □ bullet, ✕ touch, △
// lob; hold for power, let go in the green, tap again on the line). You stand in the pocket the
// way a quarterback does (footballpose.js pocketStance: side-on, shuffling, stepping round to the
// target).
// The targets pop up out of the grass one at a time, and you get one throw at each (SHOT_T
// seconds to get it off, or it's gone). Each stage has a fixed set of distances, each worth its
// points (SETS), dealt in a random order and set at a random spot across the field: everyone
// gets the same throws, so the same points are there to be had. The last target of each stage
// is the MONEY ring (gold): double.
//   ACCURACY  the rings standing still.
//   MOVING    the rings sliding side to side (the throw's aimed where the ring will be), and the
//             green on the power meter narrower (MOVE_WIN of its width).
//   PRESSURE  a rusher comes at you from 9 m off, from one side or the other. When he's close
//             (JUKE! comes up), juke the other way, away from him (◀ ▶: D-pad, Z / X, the JUKE
//             buttons on a phone): too early and he reads it, the wrong way or not at all and
//             you're sacked. Beat him and he dives past (+1), and a moving ring pops up: hit it.
// Scoring: through the middle of a ring (within 25 cm) is a BULLSEYE, double points. Hits in a
// row build a multiplier: x2 from the third, x3 from the sixth (a miss, too slow or a sack
// resets it).
// Presentation: an intro (the camera flying down the field; skippable), a 3-2-1 before each
// stage, the contest board (the shot clock, the three stages' scores and how far through, the
// multiplier, the record), a hit cam that rides a deep ball in (time slowed), the record banner
// the moment you pass it, and a finish (the camera round you, the final score by stage, NEW
// RECORD). The best total is saved (a new record: +3 cred).

const RING_R = 0.8;
const RING_Y = 1.7;
const QBC_KEY = 'crimecity.qbc.v3';
export const QBC_STAGES = [
  { id: 'acc', name: 'ACCURACY', sub: 'One throw at each ring' },
  { id: 'move', name: 'MOVING', sub: 'Moving rings, a smaller green' },
  { id: 'juke', name: 'PRESSURE', sub: 'Juke the rusher, then hit the ring' },
];
// Each stage's targets: [yards downfield, points]. The same for everyone, in a shuffled order.
const SETS = {
  acc: [[10, 1], [15, 1], [20, 2], [25, 2], [30, 3], [35, 3], [40, 4], [45, 5]],
  move: [[10, 1], [15, 1], [20, 2], [25, 2], [30, 3], [35, 3], [40, 4], [45, 5]],
  juke: [[12, 1], [18, 2], [24, 3], [30, 4], [38, 5]],
};
const COLORS = { 1: 0x6fa8ff, 2: 0x3ddc97, 3: 0xffd23f, 4: 0xff9f43, 5: 0xff4d6d };
const BULL = 0.25; // (through the middle of a ring: a bullseye)
const SHOT_T = 6; // (seconds to get the throw off once a target's up)
const POP_T = 0.45; // (a target rising out of the grass)
const MOVE_WIN = 0.6; // (MOVING: the green window on the power meter, this much of its usual width)
const DEF_START = 9; // (the rusher's mark, meters in front of the spot)
const DEF_SPEED = 4.2;
const JUKE_D = 2.8; // (he's this close: juke now)
const SACK_R = 0.85;
const HITCAM_PTS = 5; // (the hit cam: the deep ring (or the money one) going through)
const HITCAM_GAP = 6; // (seconds, at least, between hit cams)

const ease = (k) => k * k * (3 - 2 * k);

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
    const Q = (this.qbc = { spot: [F.cx, sz], gy, stage: -1, t: -99, score: 0, stageScores: [0, 0, 0], throws: 0, hits: 0, best, passed: false, flights: [], ready: false, stageOver: false, overT: 0, streak: 0, mult: 1, cam: null, camNext: null, lastCam: -99, queue: [], idx: 0, tp: 'wait', tT: 0, shot: SHOT_T, def: null, jk: null });
    Q.ring = this.qbcMakeRing();
    // The rusher for the last stage; everyone else watches from the sideline.
    Q.def = fb.players.slice().sort(() => Math.random() - 0.5)[0] || null;
    for (const q of fb.players) q.fb.qbcRole = null;
    this.toSideline(sz - 4);
    this.qbcPlace(); // (already off the field when the intro starts)
    fb.ball.mesh.visible = false; // (in your hands from stage one: not left hanging where it was under the intro)
    // The intro, then stage one (the game waits under the intro). (Where the targets come up:
    // down the middle, for the camera.)
    const rings = SETS.acc.map(([yd]) => [F.cx, sz - yd * YD]);
    game.qbcCine?.intro({ spot: Q.spot, gy, rings, best }, () => this.qbcStage(0));
    if (!game.qbcCine) this.qbcStage(0);
  },

  // The one ring (it moves to each target in turn, its face showing the points).
  qbcMakeRing() {
    const game = this.game;
    const grp = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, RING_Y - RING_R + 0.05, 6), new THREE.MeshLambertMaterial({ color: 0x2a2f38 }));
    post.position.y = (RING_Y - RING_R) / 2;
    grp.add(post);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.08, 8, 28), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x000000 }));
    ring.position.y = RING_Y;
    grp.add(ring);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const tex = new THREE.CanvasTexture(cv);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(RING_R * 0.92, 28), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    disc.position.y = RING_Y;
    grp.add(disc);
    grp.visible = false;
    game.scene.add(grp);
    return { grp, ring, cv, tex, col: 0xffffff, x: 0, z: 0, x0: 0, gy: 0, pts: 1, amp: 0, ph: 0, per: 3, flash: 0, money: false };
  },
  // (its face: the points, the bullseye; gold for the money ring)
  qbcSkin(T) {
    const g = T.cv.getContext('2d');
    const col = T.money ? 0xffc83a : COLORS[T.pts];
    T.col = col;
    const hex = `#${col.toString(16).padStart(6, '0')}`;
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = hex;
    g.globalAlpha = 0.28;
    g.beginPath();
    g.arc(64, 64, 62, 0, Math.PI * 2);
    g.fill();
    const br = (BULL / (RING_R * 0.92)) * 62;
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
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 30px sans-serif';
    g.fillText(T.money ? 'x2' : `+${T.pts}`, 64, 24);
    g.font = 'bold 15px sans-serif';
    g.fillText(T.money ? `+${T.pts} MONEY` : T.pts > 1 ? 'PTS' : 'PT', 64, 106);
    T.tex.needsUpdate = true;
    T.ring.material.color.setHex(col);
  },

  // A stage: its targets dealt, the 3-2-1.
  qbcStage(i) {
    const game = this.game;
    const fb = this.fb;
    const Q = this.qbc;
    if (!Q) return;
    const S = QBC_STAGES[i];
    Object.assign(Q, { stage: i, t: -3, started: false, stageOver: false, ready: true, streak: 0, mult: 1, idx: 0, tp: 'wait', tT: 0, shot: SHOT_T, jk: null });
    // (the same distances for everyone, in a shuffled order)
    Q.queue = SETS[S.id].slice().sort(() => Math.random() - 0.5);
    this.press = null;
    this.meterS().acc = null;
    fb.ball.mesh.visible = true;
    Q.ring.grp.visible = false;
    const [sx, sz] = Q.spot;
    game.player.x = sx;
    game.player.z = sz;
    game.player.heading = Math.PI;
    for (const q of fb.players) {
      q.fb.qbcRole = null;
      q.fb.route = null;
    }
    this.toSideline(sz - 4);
    if (S.id === 'juke' && Q.def) {
      Q.def.fb.qbcRole = 'rush';
      Q.def.fb.side = null;
      Q.def.fb.mark = [sx, sz - DEF_START];
    }
    this.qbcPlace();
  },

  // Everyone straight to their place, not walking there: the ones watching on the sideline, the
  // rusher on his mark.
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

  // The next target up (or, in the last stage, the next rush first).
  qbcNext() {
    const game = this.game;
    const Q = this.qbc;
    const T = Q.ring;
    const st = QBC_STAGES[Q.stage].id;
    if (Q.idx >= Q.queue.length) {
      Q.stageOver = true;
      Q.overT = Q.t;
      T.grp.visible = false;
      Q.jk = null;
      game.hud.toast(`${QBC_STAGES[Q.stage].name}: ${Q.stageScores[Q.stage]} pts`, '#ffd23f');
      return;
    }
    const [yd, pts] = Q.queue[Q.idx];
    const F = this.fb.site.field;
    const [sx, sz] = Q.spot;
    T.pts = pts;
    T.money = Q.idx === Q.queue.length - 1; // (the last one: the money ring)
    T.z = sz - yd * YD;
    T.gy = game.city.groundY?.(sx, T.z) || Q.gy;
    T.amp = st !== 'acc' ? rand(2.5, 3.6) : 0;
    const room = Math.max(0, Math.min(3 + yd * YD * 0.16, (F.x1 - F.x0) / 2 - 2 - T.amp));
    T.x0 = Math.max(F.x0 + 2 + T.amp, Math.min(F.x1 - 2 - T.amp, sx + rand(-1, 1) * room));
    T.x = T.x0;
    T.ph = rand(0, Math.PI * 2);
    T.per = rand(2.6, 3.8);
    T.flash = 0;
    this.qbcSkin(T);
    if (st === 'juke') {
      // (the rush first: he sets on his mark, then comes from one side)
      Q.jk = { phase: 'reset', t: 0, side: Math.random() < 0.5 ? -1 : 1, juked: false, fail: null, move: null };
      Q.tp = 'wait';
      Q.tT = 0;
      T.grp.visible = false;
    } else this.qbcPop();
  },
  qbcPop() {
    const Q = this.qbc;
    Q.tp = 'pop';
    Q.tT = 0;
    Q.shot = SHOT_T;
    Q.ring.grp.visible = true;
    Q.tStart = Q.t; // (a moving ring starts its slide from here)
  },

  qbcCanThrow() {
    const Q = this.qbc;
    return !!Q && Q.stage >= 0 && Q.t >= 0 && !Q.stageOver && Q.ready && Q.tp === 'live' && !Q.cam && !(this.downT > 0);
  },
  qbcTarget() {
    const Q = this.qbc;
    return Q && Q.stage >= 0 && Q.ring.grp.visible ? Q.ring : null;
  },
  // (where you look and stand side-on to: the ring, or downfield)
  qbcFace() {
    const Q = this.qbc;
    const p = this.game.player;
    const T = this.qbcTarget();
    if (T) return Math.atan2(T.x - p.x, T.z - p.z);
    return Math.atan2(Q.spot[0] - p.x, Q.spot[1] - 30 - p.z);
  },
  // (the green on the power meter: narrower when the rings move; fieldmodes.js winFor)
  qbcWinK() {
    const Q = this.qbc;
    return Q && QBC_STAGES[Q.stage]?.id === 'move' ? MOVE_WIN : 1;
  },
  // (the last stage, while he's coming: ◀ ▶ are the juke; phones show JUKE buttons)
  qbcJukeOn() {
    const Q = this.qbc;
    return !!Q && QBC_STAGES[Q.stage]?.id === 'juke' && !!Q.jk && (Q.jk.phase === 'rush' || Q.jk.phase === 'set');
  },

  // Your buttons: ◀ ▶ juke in the last stage; the meter throws; you shuffle in the pocket.
  qbcInput(dt, a, fire) {
    const inp = this.game.input;
    const Q = this.qbc;
    const R = a.qbR || [];
    if (Q.stage >= 0 && QBC_STAGES[Q.stage].id === 'juke') {
      const dir = (inp.btnHit?.(14) || inp.hit?.('KeyZ') || inp.hit?.('KeyQ') ? -1 : 0) + (inp.btnHit?.(15) || inp.hit?.('KeyX') || inp.hit?.('KeyE') ? 1 : 0);
      const rs = a.rsX || 0;
      const flick = Math.abs(rs) > 0.6 && !(Math.abs(this.prevRs || 0) > 0.6) ? Math.sign(rs) : 0;
      this.prevRs = rs;
      if (dir || flick) this.qbcJuke(dir || flick);
    }
    this.meterInput(dt, a, fire);
    a.sprint = false; // (in the pocket you shuffle, you don't run)
    if (Q.jk?.move) a.moveX = a.moveY = 0;
    this.prevR = R.slice();
    this.prevFire = fire;
  },

  // A juke (dir: -1 screen left, +1 right): away from the side he's coming at, when he's close.
  qbcJuke(dir) {
    const game = this.game;
    const Q = this.qbc;
    const J = Q.jk;
    if (!J || J.phase !== 'rush' || J.juked || J.fail || J.move || this.downT > 0) return;
    const p = game.player;
    const d = Q.def ? dist(Q.def.x, Q.def.z, p.x, p.z) : 99;
    // (screen right: the camera's right)
    const rx = -Math.cos(game.camYaw);
    const rz = Math.sin(game.camYaw);
    J.move = { dir, t: 0, x0: p.x, z0: p.z, tx: p.x + rx * dir * 1.7, tz: p.z + rz * dir * 1.7 };
    if (d > JUKE_D) J.fail = 'early';
    else if (dir === J.side) J.fail = 'wrong'; // (into him)
    else {
      J.juked = true;
      // (he lays out at where you were)
      const f = Q.def.fb;
      f.dive = true;
      f.diveTo = [p.x - rx * dir * 0.6, p.z - rz * dir * 0.6];
      f.downT = f.downLen = 1.4;
      Q.score += 1;
      Q.stageScores[Q.stage] += 1;
      game.hud.toast('Juked him! +1', '#7ee081');
      for (const q of this.fb.fans) q.fb.cheerT = rand(0.8, 1.4);
    }
  },

  // Let go and tapped (fieldmodes.js meterRelease): at the ring (where it'll be, if it's moving).
  qbcThrow(_T, kind, pw, acc, tapN) {
    const game = this.game;
    const p = game.player;
    const Q = this.qbc;
    const b = this.fb.ball;
    const T = Q.ring;
    const [px, pz] = p.pos();
    const TY = CTYPES[kind];
    // (aimed at where the ring will be when it gets there)
    const ft = TY.T(dist(px, pz, T.x, T.z));
    const tx = T.amp ? this.qbcRingX(T, Q.t + ft) : T.x;
    const tz = T.z;
    const d = dist(px, pz, tx, tz) || 1;
    const ux = (tx - px) / d;
    const uz = (tz - pz) / d;
    // (the power sets how far it carries; the tap, how far off line: early left, late right)
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
    Q.tp = 'flight';
    Q.tT = 0;
    Q.throws++;
    this.throwT = 0.26;
    // (a deep one that's going in: the hit cam rides it for the last second; not too often)
    if (Q.t - Q.lastCam > HITCAM_GAP && this.qbcGoingIn(f, T, L, lat, FT)) {
      Q.camNext = { f, at: Math.max(0, (f.ringD / L) * FT - 1.0) };
      Q.lastCam = Q.t;
    }
  },
  // (a moving ring's place at time t)
  qbcRingX(T, t) {
    return T.x0 + T.amp * Math.sin(T.ph + ((t - (this.qbc.tStart || 0)) * Math.PI * 2) / T.per);
  },

  // Will it go in? (for the hit cam: the +5 ring or the money ring, through it)
  qbcGoingIn(f, T, L, lat, FT) {
    if (!(T.pts >= HITCAM_PTS || T.money) || L < f.ringD) return false;
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
    const st = QBC_STAGES[Q.stage].id;
    Q.t += dt;
    if (this.downT > 0) this.downT -= dt;
    // (you throw from the spot: a few steps of room to shuffle in)
    const [sx, sz] = Q.spot;
    p.x = Math.max(sx - 4, Math.min(sx + 4, p.x));
    p.z = Math.max(sz - 1, Math.min(sz + 3, p.z));
    // The camera on the target (or downfield), you squared up to it.
    if (!Q.cam) {
      const face = this.qbcFace();
      game.camYaw = lerpAngle(game.camYaw, face, Math.min(1, dt * 5));
      p.heading = lerpAngle(p.heading, face, Math.min(1, dt * 10));
    }
    // The targets, one at a time.
    const T = Q.ring;
    if (Q.t >= 0 && !Q.stageOver) {
      if (!Q.started) {
        Q.started = true;
        this.qbcNext();
      }
      if (st === 'juke') this.qbcRush(dt);
      Q.tT += dt;
      if (Q.tp === 'pop' && Q.tT >= POP_T) {
        Q.tp = 'live';
        Q.ready = true;
        this.fb.ball.mesh.visible = true;
      } else if (Q.tp === 'live' && !this.press && !this.meterS().acc) {
        Q.shot -= dt;
        if (Q.shot <= 0) {
          this.qbcMiss('Too slow');
          this.qbcDone();
        }
      } else if (Q.tp === 'flight') {
        if (!Q.flights.some((f) => !f.done) && !Q.cam && !Q.camNext) this.qbcDone();
      } else if (Q.tp === 'done' && Q.tT > 0.9) {
        Q.tp = T.grp.visible ? 'sink' : 'next';
        Q.tT = 0;
      } else if ((Q.tp === 'sink' && Q.tT > 0.35) || Q.tp === 'next') {
        Q.idx++;
        this.qbcNext();
      }
    }
    // (rising out of the grass, sinking back into it; sliding, if it moves)
    if (T.grp.visible) {
      const u = Math.min(1, Q.tT / POP_T);
      const rise = Q.tp === 'pop' ? ease(u) * (1 + 0.12 * Math.sin(u * Math.PI)) : Q.tp === 'sink' ? 1 - ease(Math.min(1, Q.tT / 0.35)) : 1;
      if (T.amp) T.x = this.qbcRingX(T, Q.t);
      T.grp.position.set(T.x, T.gy - (1 - rise) * (RING_Y + RING_R + 0.2), T.z);
      T.grp.rotation.y = Math.atan2(p.x - T.x, p.z - T.z);
      T.ring.scale.setScalar(Q.tp === 'live' ? 1 + 0.05 * Math.sin(game.time * 8) : 1);
      if (T.flash > 0) {
        T.flash -= dt;
        T.ring.material.color.setHex(Math.floor(T.flash * 12) % 2 === 0 ? 0xffffff : T.col);
      } else T.ring.material.color.setHex(T.col);
      T.ring.material.emissive.setHex(T.money ? (Math.sin(game.time * 9) > 0 ? 0x9a6a00 : 0x553800) : 0);
    }
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
    // Every target's had its throw: the next stage (or the finish).
    if (Q.stageOver && !Q.cam && !Q.camNext && Q.t > Q.overT + 1.6) {
      if (Q.stage < QBC_STAGES.length - 1) this.qbcStage(Q.stage + 1);
      else this.qbcFinish();
    }
  },
  // (the throw at this target's settled, or it's gone: the ring goes down, the next comes up)
  qbcDone() {
    const Q = this.qbc;
    Q.tp = 'done';
    Q.tT = 0;
    Q.ready = false;
    this.press = null;
    this.meterS().acc = null;
  },

  // PRESSURE: he sets on his mark, comes at you from one side; juke him and the ring comes up.
  qbcRush(dt) {
    const game = this.game;
    const Q = this.qbc;
    const J = Q.jk;
    const D = Q.def;
    if (!J || !D) return;
    const p = game.player;
    J.t += dt;
    // (your juke: a quick hop sideways)
    if (J.move) {
      J.move.t += dt;
      const k = ease(Math.min(1, J.move.t / 0.3));
      p.x = J.move.x0 + (J.move.tx - J.move.x0) * k;
      p.z = J.move.z0 + (J.move.tz - J.move.z0) * k;
      if (J.move.t > 0.45) J.move = null;
    }
    if (J.phase === 'reset') {
      if (dist(D.x, D.z, ...D.fb.mark) < 0.8 && !(D.fb.downT > 0)) Object.assign(J, { phase: 'set', t: 0 });
    } else if (J.phase === 'set') {
      this.fb.ball.mesh.visible = true;
      if (J.t > 1.1) Object.assign(J, { phase: 'rush', t: 0 });
    } else if (J.phase === 'rush') {
      const d = dist(D.x, D.z, p.x, p.z);
      if (J.juked && !J.move) {
        // (beat him: the ring comes up)
        J.phase = 'beat';
        this.qbcPop();
      } else if (!J.juked && d < SACK_R) {
        J.phase = 'sacked';
        J.move = null;
        this.downT = 1.1; // (you hit the turf: gridiron.js late())
        this.fb.ball.mesh.visible = false;
        game.shakeCamera?.(0.05, 0.25);
        this.qbcMiss(J.fail === 'early' ? 'SACKED: too early, he read it' : J.fail === 'wrong' ? 'SACKED: juked into him' : 'SACKED');
        this.qbcDone();
      }
    }
  },

  // Where the challenge's rusher goes (football.js drive → fieldmodes.js drivePlayer).
  driveQbc(p, f, b, goTo, faceAt) {
    const Q = this.qbc;
    const [px, pz] = this.game.player.pos();
    if (f.qbcRole === 'rush') {
      const J = Q.jk;
      if (J?.phase === 'rush' && !J.juked) {
        // (at the side he's attacking: your right (+1) or left, on the camera; wide of you,
        // closing in)
        const rx = -Math.cos(this.game.camYaw);
        const rz = Math.sin(this.game.camYaw);
        const far = dist(p.x, p.z, px, pz);
        const off = Math.min(1.6, far * 0.35) * J.side;
        return { tx: px + rx * off, tz: pz + rz * off, speed: DEF_SPEED };
      }
      if (J?.phase === 'set') {
        faceAt(px, pz);
        return { speed: 0 };
      }
      const g = goTo(f.mark[0], f.mark[1], 4.5);
      if (g) return g;
      faceAt(px, pz);
      return { speed: 0 };
    }
    void b;
    return { speed: 0 };
  },

  // The balls in the air: through the ring, off it, short, wide.
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

  // A ball crossing the ring's plane: through it (it scores, and flies on), off it (knocked
  // back), or past it.
  qbcCross(f, vy) {
    const T = f.tgt;
    const lat = Math.abs((f.x - T.x) * -f.uz + (f.z - T.z) * f.ux);
    const off = Math.hypot(lat, f.y - (T.gy + RING_Y));
    f.done = true;
    if (off < RING_R - 0.11) {
      T.flash = 0.6;
      this.qbcScore(T.pts, { bull: off < BULL, money: T.money, label: off < BULL ? 'Dead center!' : 'Through!' });
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

  // The hit cam: riding behind the ball, looking on to the ring (main.js updateCamera asks; null
  // when it's not on).
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

  // The board, the arrow over the target, the meter, the hint.
  qbcHud() {
    const game = this.game;
    const Q = this.qbc;
    if (!Q || Q.stage < 0) return;
    const stage = QBC_STAGES[Q.stage];
    const aim = this.qbcTarget();
    this.arrow.visible = !!aim && Q.tp === 'live' && !Q.cam;
    if (aim) {
      this.arrow.position.set(aim.x, aim.grp.position.y + RING_Y + RING_R + 0.7 + Math.sin(game.time * 6) * 0.08, aim.z);
      this.arrow.material.color.setHex(aim.money ? 0xffc83a : 0xffd23f);
    }
    this.updateIcons?.();
    const inp = game.input;
    const kb = inp.mode === 'kb' && !inp.touchMode;
    const keys = inp.touchMode ? 'BULLET · TOUCH · LOB' : kb ? 'J · K · L' : '□ · ✕ · △';
    const jk = inp.touchMode ? 'JUKE ◀ ▶' : kb ? 'Z / X' : 'D-pad ◀ ▶';
    const J = Q.jk;
    const close = J?.phase === 'rush' && !J.juked && !J.fail && !!Q.def && dist(Q.def.x, Q.def.z, game.player.x, game.player.z) < JUKE_D;
    const hint =
      Q.t < 0
        ? `${stage.name}: ${stage.sub}`
        : Q.stageOver
          ? `${stage.name} done`
          : this.meterS().acc
            ? 'Tap it again on the line!'
            : close
              ? `JUKE! ${jk}, away from him`
              : J && (J.phase === 'set' || J.phase === 'rush') && !J.juked
                ? `Here he comes: when he's on you, juke away from his side (${jk})`
                : Q.tp === 'live'
                  ? `${keys}: hold, let go in the green, tap on the line · shuffle with the stick`
                  : '';
    game.hud.sport?.(`QB CHALLENGE · STAGE ${Q.stage + 1} OF 3: ${stage.name}`, null, hint);
    if (close !== !!this.jukeCue) {
      this.jukeCue = close;
      if (close) game.hud.toast('JUKE!', '#ffd23f');
    }
    // (the contest board: the 3-point contest's, shared; the clock's the shot clock)
    const sb = (game.sport.scoreboard ||= new Scoreboard());
    const n = Q.queue.length;
    sb.showQbc?.({
      left: Q.tp === 'live' ? Math.max(0, Q.shot) : SHOT_T,
      lowAt: 2,
      count: Math.ceil(-Q.t),
      phase: Q.t < 0 ? 'count' : 'play',
      stage: Q.stage,
      stages: QBC_STAGES.map((s, i) => ({ name: i === Q.stage && n ? `${s.name} ${Math.min(n, Q.idx + (Q.stageOver ? 0 : 1))}/${n}` : s.name, score: Q.stageScores[i], done: i < Q.stage || (i === Q.stage && Q.stageOver) })),
      score: Q.score,
      best: Q.best,
      mult: Q.mult,
      streak: Q.streak,
      sub: stage.sub,
    });
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
    game.sport.scoreboard?.hideContest();
    game.hud.sport?.(null);
    this.arrow.visible = false;
    const done = () => {
      game.hud.toast(`QB Challenge: ${Q.score} points · ${Q.hits} of ${Q.throws} through${rec ? ' · NEW RECORD! +3 cred' : Q.best ? ` · record ${Q.best}` : ''}`, rec ? '#7ee081' : '#ffd23f');
      this.end('qbc');
    };
    if (game.qbcCine) game.qbcCine.outro({ score: Q.score, best: Q.best, newBest: rec, stages: QBC_STAGES.map((s, i) => [s.name, Q.stageScores[i]]), hits: Q.hits, throws: Q.throws }, done);
    else done();
  },

  // Stopped or finished (fieldmodes.js endMode): everything put away.
  qbcEnd(how) {
    const game = this.game;
    const Q = this.qbc;
    game.scene.remove(Q.ring.grp);
    Q.ring.tex.dispose();
    for (const f of Q.flights) game.scene.remove(f.mesh);
    for (const q of this.fb.players) {
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
