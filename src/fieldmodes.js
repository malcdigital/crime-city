import * as THREE from 'three';
import { dist, rand, pick, lerpAngle } from './util.js';
import { throwPose, catchPose, holdBall, tuckCarry, fbBallAt } from './footballpose.js';
import { bendLeg, bendSpine, reachArm } from './character.js';
import { ThrowMeter, PERFECT } from './throwmeter.js';

// The other games at Harbor Field (mixed into Gridiron: gridiron.js), picked from the field's
// menu the way you pick a game at the courts (courtmenu.js):
//
// Both throw with the same meter (throwmeter.js): □ bullet, ✕ touch, △ lob (keyboard J / K / L);
// hold for power, let go in the green, tap the same button again on the line for accuracy, time
// at half speed while you do (both dead on: a PERFECT PASS).
// QB Challenge (solo, like the 3-point contest): 60 seconds from the spot to put as many balls
//   as you can through five rings on posts downfield (10, 16, 22, 30 and 40 yards, worth 1, 2,
//   2, 3 and 5). D-pad ◀ ▶ (keyboard Z / X, ◀ ▶ on a phone) picks the ring (the camera locks on
//   it); the ball scores if it's through the ring as it crosses it (short falls short, off line
//   misses wide, close hits the ring). A rack: another ball in your hands a beat after each
//   throw. "Moving" slides the rings side to side. The best score is saved (a new record: +3 cred).
// Play catch: with anyone out there (their quarterback, a receiver, a back), anywhere on the
//   field within 50 yards of each other. He throws it back from wherever he got it, sometimes
//   off to one side so you have to go get it. D-pad ↑ / ↓ calls him long or closer; R1
//   (keyboard X) sends him on a route. A drop rolls away: whoever's nearer picks it up. It counts
//   your catches, his, and the best run in a row.
// Both quit like the drive (QUIT on a phone, hold the touchpad / M); walking off the field, a
// car or the police end them.

const YD = 0.9144;
const G = 9.8;
const QBC_T = 60;
const QBC_KEY = 'crimecity.qbc.v1';
// The targets: [yards downfield, meters across, points]
const QBC_TARGETS = [
  [10, -6, 1],
  [16, 6.5, 2],
  [22, 0, 2],
  [30, -7.5, 3],
  [40, 5, 5],
];
const TARGET_COLORS = [0x6fa8ff, 0x3ddc97, 0xffd23f, 0xff9f43, 0xff4d6d];
const RING_R = 0.8;
const RING_Y = 1.7;
// Playing catch: you can go anywhere on the field as long as you stay within 50 yards of each
// other (past it, backing off fights you and he comes in). Three throws, each held for power:
// the green zone on the meter is the power his distance needs (early: short, late: long).
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const BOTTLE = new THREE.CylinderGeometry(0.035, 0.035, 0.21, 8); // (a sports drink)
const GOLD = new THREE.MeshLambertMaterial({ color: 0xffc83a, emissive: 0x9a6a00 }); // (a perfect pass)
const LEASH = 50 * YD;
const FILL = 0.6; // (game seconds to a full meter: about 1.2 s with time slowed to half)
const ACC_T = 0.45; // (game seconds for the accuracy needle: about 0.9 s slowed; the perfect tap's halfway)
const SLOW = 0.5; // (time while you hold and tap)
const CTYPES = {
  bullet: { max: 40, T: (L) => 0.25 + L / 26, win: 0.05, err: 0.35, h: 1.3 }, // (on a line: quick, the least forgiving)
  touch: { max: 46, T: (L) => 0.5 + L / 19, win: 0.065, err: 0.45, h: 1.35 }, // (over the top of somebody, dropped in)
  lob: { max: 52, T: (L) => 0.8 + L / 15, win: 0.08, err: 0.6, h: 1.5 }, // (high, hangs, the deepest)
};
const ROUTES = ['go', 'post', 'out', 'slant', 'curl'];


export const FieldModes = {
  // ---- Shared ----
  startMode(qb, mode) {
    const game = this.game;
    const fb = this.fb;
    this.active = true;
    this.mode = mode;
    this.bet = 0;
    this.snaps = 0;
    this.bench = qb;
    qb.fb.role = 'bench';
    fb.match = this;
    fb.phase = 'side';
    fb.t = 0;
    this.state = 'play';
    this.t = 0;
    this.outT = 0;
    this.press = null;
    this.throwT = 0;
    this.downT = 0;
    this.scramble = false;
    this.dropping = false;
    this.carrier = false;
    this.runMove = null;
    this.extra = [];
    this.prevR = [true, true, true, true, true]; // (nothing counts till it's let go and pressed again)
    this.prevFire = true;
    this.icons = [];
    this.iconMode = null;
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 4), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    m.rotation.x = Math.PI;
    m.visible = false;
    game.scene.add(m);
    this.arrow = m;
    for (const q of fb.players) {
      q.fb.route = null;
      q.fb.runTo = null;
    }
    fb.ball.mode = 'held';
    fb.ball.holder = 'you';
    fb.ball.mesh.visible = true;
  },

  // Everybody not in it watches from the near sideline, spread out around z.
  toSideline(z, skip = null) {
    const F = this.fb.site.field;
    let k = 0;
    for (const q of this.fb.players) {
      if (q === skip) continue;
      q.fb.side = [F.x0 - 1.4 - (k % 2) * 0.9, Math.max(F.z0 + 2, Math.min(F.z1 - 2, z + (k - 2) * 2.2))];
      k++;
    }
  },

  // football.js drive(): where each player goes in these games (null: the usual).
  drivePlayer(p, f, b, faceAt) {
    const goTo = (x, z, speed) => (dist(p.x, p.z, x, z) > 0.45 ? { tx: x, tz: z, speed } : null);
    if (this.mode === 'catch' && p === this.cat?.mate) return this.driveMate(p, f, b, goTo, faceAt);
    if (f.seat) {
      // (to the bench, then sat facing the field)
      const g = goTo(f.seat[0], f.seat[1], 2.8);
      f.seated = !g;
      if (g) return g;
      p.heading = -Math.PI / 2;
      return { speed: 0 };
    }
    if (f.sideSpot && this.side) return this.driveSide(p, f, goTo, faceAt);
    const g = f.side && goTo(f.side[0], f.side[1], 3.4);
    if (g) return g;
    const [px, pz] = this.game.player.pos();
    if (b?.mode === 'flight') faceAt(b.x, b.z);
    else faceAt(px, pz - 6); // (watching)
    return { speed: 0 };
  },

  // Can you throw right now?
  canThrowMode() {
    const b = this.fb.ball;
    if (this.mode === 'qbc') return !!this.qbc && this.qbc.t >= 0 && !this.qbc.over && this.qbc.ready;
    return b.holder === 'you' && b.mode === 'held';
  },

  modeReceivers() {
    if (this.mode === 'qbc') return [null, null, null, null, null]; // (the buttons are the throws now)
    return [null, null, null, null, null]; // (catch: no buttons over him; the button is the throw)
  },

  // Your buttons.
  modeInput(dt, a, fire) {
    if (this.mode === 'catch') return this.catchInput(dt, a, fire);
    return this.qbcInput(dt, a, fire);
  },

  // Every frame (football.js step → gridiron phase).
  modePhase(dt) {
    const game = this.game;
    const fb = this.fb;
    const b = fb.ball;
    const [px, pz] = game.player.pos();
    this.t += dt;
    if (!this.onField(px, pz, 2)) this.outT = (this.outT || 0) + dt;
    else this.outT = 0;
    if (this.outT > 2.5 || game.player.vehicle || game.stars > 0 || game.wastedT > 0 || game.bustedT > 0) return this.end('forfeit');
    if (this.throwT > 0) this.throwT -= dt;
    if (this.mode === 'qbc') this.qbcStep(dt);
    else this.catchStep(dt);
    if (!this.active) return;
    if (this.mode === 'catch') return this.catchHud();
    // The QB Challenge: the arrow over the ring you've picked, the board and the meter.
    const Q = this.qbc;
    const S = Q.targets[Q.sel];
    this.arrow.visible = !!S && !Q.over;
    if (S) this.arrow.position.set(S.x, S.gy + RING_Y + RING_R + 0.7 + Math.sin(game.time * 6) * 0.08, S.z);
    this.updateIcons();
    const inp = game.input;
    const kb = inp.mode === 'kb' && !inp.touchMode;
    const left = Math.max(0, Math.ceil(QBC_T - Q.t));
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const keys = inp.touchMode ? 'BULLET · TOUCH · LOB' : kb ? 'J bullet · K touch · L lob' : '□ bullet · ✕ touch · △ lob';
    const pickK = inp.touchMode ? '◀ ▶' : kb ? 'Z / X' : 'D-pad ◀ ▶';
    const hint = Q.t < 0 ? `Get set... ${Math.ceil(-Q.t)}` : Q.over ? 'Time!' : Q.acc ? 'Tap it again on the line!' : `${pickK}: pick a ring (${S?.pts} pt${S?.pts > 1 ? 's' : ''}) · ${keys}: hold for power, let go in the green, tap again on the line`;
    game.hud.sport?.(`QB CHALLENGE · ${clock} · ${Q.score} pts · ${Q.hits}/${Q.throws}${Q.best ? ` · record ${Q.best}` : ''}`, null, hint);
    this.meterHud();
    void b;
  },

  // Your follow-through and catches (gridiron late()); true if it posed you.
  modeLate(c) {
    const b = this.fb.ball;
    const MS = this.mode === 'qbc' || this.mode === 'catch' ? this.meterS() : null;
    if (MS?.acc) {
      // (the arm coming through while you time the tap: the ball leaves the hand at the middle)
      throwPose(c, 1, Math.min(0.34, (MS.acc.n / 0.5) * 0.34));
      c.group.userData.fbGrip = 'throw';
      return true;
    }
    if (this.mode === 'catch' && b.mode === 'flight' && b.to === 'you' && b.T - b.t < 0.6) {
      catchPose(c, b.style === 'lob' || b.p1[1] > 1.5); // (hands up for it)
      return true;
    }
    if (this.mode === 'qbc' && !this.press && this.throwT > 0) {
      throwPose(c, 1, 1 - this.throwT / 0.4); // (the follow-through)
      return true;
    }
    return false;
  },

  endMode(how) {
    const game = this.game;
    const fb = this.fb;
    if (this.mode === 'qbc' && this.qbc) {
      for (const T of this.qbc.targets) game.scene.remove(T.grp);
      for (const f of this.qbc.flights) game.scene.remove(f.mesh);
      if (how !== 'qbc') game.hud.toast(how === 'forfeit' ? 'You walked off the QB Challenge' : 'QB Challenge stopped', '#9fc3ff');
      this.qbc = null;
    }
    if (this.mode === 'catch' && this.cat) {
      const C = this.cat;
      game.hud.toast(`Played catch with ${C.mate.ballName}: you caught ${C.mine}, ${C.mate.female ? 'she' : 'he'} caught ${C.his} · best run ${C.best} in a row`, '#9fc3ff');
      if (C.mate.fb) C.mate.fb.route = null;
      this.cat = null;
    }
    for (const q of fb.players) {
      q.fb.side = q.fb.seat = q.fb.sideSpot = null;
      q.fb.seated = false;
      const bt = q.char.group.userData.bottle;
      if (bt) {
        bt.parent?.remove(bt);
        q.char.group.userData.bottle = null;
      }
    }
    if (this.side) {
      game.scene.remove(this.side.mesh);
      this.side = null;
    }
    if (fb.ball) fb.ball.mesh.visible = true;
    game.hud.sportFloat?.(null);
    this.tmeter?.hide();
    if (this.cat?.gold) this.goldBall(false);
    if (game.timeScale !== 1) game.timeScale = 1;
  },

  // ---- QB Challenge ----
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
    const Q = (this.qbc = { spot: [F.cx, sz], moving, t: -3, score: 0, throws: 0, hits: 0, best, targets: [], flights: [], ready: true, rackAt: 0, over: false, overT: 0, sel: 2 });
    const gy = game.city.groundY?.(F.cx, sz) || 0;
    QBC_TARGETS.forEach(([yd, across, pts], i) => {
      const z = sz - yd * YD;
      const x0 = F.cx + across;
      const grp = new THREE.Group();
      const col = TARGET_COLORS[i];
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, RING_Y - RING_R + 0.05, 6), new THREE.MeshLambertMaterial({ color: 0x2a2f38 }));
      post.position.y = (RING_Y - RING_R) / 2;
      grp.add(post);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.08, 8, 28), new THREE.MeshLambertMaterial({ color: col }));
      ring.position.y = RING_Y;
      grp.add(ring);
      // (a see-through face with its points on it)
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const g = cv.getContext('2d');
      g.fillStyle = `#${col.toString(16).padStart(6, '0')}`;
      g.globalAlpha = 0.25;
      g.beginPath();
      g.arc(64, 64, 62, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 0.95;
      g.fillStyle = '#ffffff';
      g.font = 'bold 56px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`+${pts}`, 64, 58); // (its points: "+3", not to be mixed up with its button)
      g.font = 'bold 20px sans-serif';
      g.fillText(pts > 1 ? 'PTS' : 'PT', 64, 98);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(RING_R * 0.92, 28), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      disc.position.y = RING_Y;
      grp.add(disc);
      grp.position.set(x0, gy, z);
      grp.rotation.y = Math.atan2(F.cx - x0, sz - z); // (facing the spot)
      game.scene.add(grp);
      Q.targets.push({ grp, ring, col, x: x0, z, x0, gy, pts, ph: rand(0, Math.PI * 2), amp: moving ? rand(2.5, 4) : 0, per: rand(2.6, 4.2), flash: 0, fb: {}, heading: 0, speed: 0 });
    });
    // (left to right as you look downfield: ◀ ▶ steps through them in that order; the middle
    // one's picked to start)
    Q.targets.sort((a, b) => a.x0 - b.x0);
    this.toSideline(sz - 4);
    game.hud.toast(`QB Challenge${moving ? ' (moving targets)' : ''}: 60 seconds. Put it through the rings: the deeper, the more it's worth`, '#ffd23f');
  },

  // A throw at a target: its own ball (the next one's already in your hands), led to where a
  // moving target will be, a little off by how deep it is and how you threw it.
  qbcThrow(T, kind, pw, acc, tapN) {
    const game = this.game;
    const p = game.player;
    const Q = this.qbc;
    const fb = this.fb;
    const b = fb.ball;
    const [px, pz] = p.pos();
    const TY = CTYPES[kind];
    // (aimed at where the ring will be when it gets there)
    const d0 = dist(px, pz, T.x, T.z);
    const ft = TY.T(d0);
    const tx = T.amp ? T.x0 + T.amp * Math.sin(T.ph + ((Q.t + ft) * Math.PI * 2) / T.per) : T.x;
    const d = dist(px, pz, tx, T.z) || 1;
    const ux = (tx - px) / d;
    const uz = (T.z - pz) / d;
    // (the power sets how far it carries; the tap, how far off line: early left, late right)
    // (dead on the green carries right to the ring; anywhere in the green, close; off it, as far
    // as the power you let go at)
    const off = pw - this.needFor(kind, d);
    const k = Math.abs(off) <= TY.win * 0.5 ? 0.04 : Math.abs(off) <= TY.win ? 0.5 : 1;
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
    Q.flights.push({ mesh, p0, p1, T: FT, t: 0, vy0: (p1[1] - p0[1] + 0.5 * G * FT * FT) / FT, tgt: T, ux, uz, ringD: d, crossed: false, mode: 'flight', x: p0[0], y: p0[1], z: p0[2], vx: 0, vy: 0, vz: 0, life: 0 });
    b.mesh.visible = false;
    Q.ready = false;
    Q.rackAt = Q.t + 0.7;
    Q.throws++;
    this.throwT = 0.26;
  },

  qbcStep(dt) {
    const game = this.game;
    const Q = this.qbc;
    const p = game.player;
    Q.t += dt;
    // (the clock starts after the count)
    if (!Q.ready && Q.t >= Q.rackAt && !Q.over) {
      Q.ready = true;
      this.fb.ball.mesh.visible = true;
    }
    // (you throw from the spot: a few steps of room)
    const [sx, sz] = Q.spot;
    p.x = Math.max(sx - 4, Math.min(sx + 4, p.x));
    p.z = Math.max(sz - 0.5, Math.min(sz + 4, p.z));
    // The camera locked on the ring you've picked, you squared up to it.
    const S = Q.targets[Q.sel];
    if (S) {
      const face = Math.atan2(S.x - p.x, S.z - p.z);
      game.camYaw = lerpAngle(game.camYaw, face, Math.min(1, dt * 6));
      if ((p.speed || 0) < 0.6 || this.press || Q.acc) p.heading = lerpAngle(p.heading, face, Math.min(1, dt * 10));
    }
    // The targets (sliding, when they move); the picked one pulsing.
    for (const T of Q.targets) {
      const on = T === S;
      T.ring.scale.setScalar(on ? 1 + 0.06 * Math.sin(game.time * 8) : 1);
      if (T.amp) T.x = T.x0 + T.amp * Math.sin(T.ph + (Math.max(0, Q.t) * Math.PI * 2) / T.per);
      T.grp.position.x = T.x;
      T.grp.rotation.y = Math.atan2(p.x - T.x, p.z - T.z);
      if (T.flash > 0) {
        T.flash -= dt;
        T.ring.material.color.setHex(T.flash > 0 && Math.floor(T.flash * 12) % 2 === 0 ? 0xffffff : T.col);
      }
    }
    // The balls in the air.
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
            game.hud.toast('Short', '#ff8080');
          }
        }
        if (f.y <= 0.13) {
          f.vx *= 0.97;
          f.vz *= 0.97;
        }
        f.mesh.position.set(f.x, f.y, f.z);
        if (f.life > 2.5) {
          game.scene.remove(f.mesh);
          Q.flights.splice(Q.flights.indexOf(f), 1);
        }
      }
    }
    if (!Q.over && Q.t >= QBC_T) {
      Q.over = true;
      Q.overT = Q.t;
      this.press = null;
      game.hud.toast('Time!', '#ffd23f');
    }
    if (Q.over && (!Q.flights.some((f) => f.mode === 'flight') || Q.t > Q.overT + 4) && Q.t > Q.overT + 1.2) this.qbcFinish();
  },

  // A ball crossing a ring's plane: through it (it scores, and flies on), off it (knocked back),
  // or past it.
  qbcCross(f, vy) {
    const game = this.game;
    const Q = this.qbc;
    const T = f.tgt;
    const lat = Math.abs((f.x - T.x) * -f.uz + (f.z - T.z) * f.ux);
    const off = Math.hypot(lat, f.y - (T.gy + RING_Y));
    if (off < RING_R - 0.11) {
      Q.score += T.pts;
      Q.hits++;
      T.flash = 0.6;
      game.hud.toast(off < 0.25 ? `Dead center! +${T.pts}` : `+${T.pts}`, '#7ee081');
      if (T.pts >= 3) for (const q of this.fb.fans) q.fb.cheerT = rand(1, 1.6);
    } else if (off < RING_R + 0.2) {
      const sp = Math.hypot(f.p1[0] - f.p0[0], f.p1[2] - f.p0[2]) / f.T;
      f.mode = 'loose';
      f.vx = -f.ux * sp * 0.25 + rand(-1, 1);
      f.vz = -f.uz * sp * 0.25;
      f.vy = Math.abs(vy) * 0.3 + 1;
      game.hud.toast('Off the ring', '#ff8080');
    }
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

  qbcFinish() {
    const game = this.game;
    const Q = this.qbc;
    const rec = Q.score > Q.best && Q.score > 0;
    if (rec) {
      try {
        localStorage.setItem(QBC_KEY, String(Q.score));
      } catch {
        // (storage unavailable)
      }
      game.cred += 3;
      for (const q of this.fb.fans) q.fb.cheerT = 2.5;
    }
    game.hud.toast(`QB Challenge: ${Q.score} points · ${Q.hits} of ${Q.throws} through${rec ? ' · NEW RECORD! +3 cred' : Q.best ? ` · record ${Q.best}` : ''}`, rec ? '#7ee081' : '#ffd23f');
    this.end('qbc');
  },

  // ---- Play catch ----
  startCatch(qb, mate) {
    const game = this.game;
    const fb = this.fb;
    this.startMode(qb, 'catch');
    const F = fb.site.field;
    const [px, pz] = game.player.pos();
    // (no set distance: he stays where he is if that's a fair throw, or jogs out about 15 yards)
    // (out in the middle of the field, about 15 yards off, not over by the sideline)
    let spot = [mate.x, mate.z];
    const d0 = dist(px, pz, mate.x, mate.z);
    if (d0 < 6 || d0 > 30 || Math.abs(mate.x - F.cx) > 5) {
      const dir = pz - 14 > F.z0 + 3 ? -1 : 1;
      spot = [F.cx + rand(-2.5, 2.5), pz + dir * 13.7];
    }
    this.cat = { mate, spot, streak: 0, best: 0, mine: 0, his: 0, holdT: 0, throwing: false, routeOn: false, prevHeld: { bullet: true, touch: true, lob: true }, last: null };
    mate.fb.route = null;
    this.setupOthers(mate, (pz + spot[1]) / 2);
    game.hud.toast(`Playing catch with ${mate.ballName}. Go anywhere on the field: stay within 50 yards of each other`, '#ffd23f');
  },

  // Your buttons, playing catch: □ bullet, ✕ touch, △ lob (keyboard J / K / L, or a click for
  // touch): hold for power, let go in the green. D-pad ↑ / ↓ (keyboard E / Q, LONG / CLOSER on a
  // phone): tell him to go long or come closer. R1 (keyboard X): send him on a route.
  // The throw meter's buttons (playing catch and the QB Challenge): □ bullet, ✕ touch, △ lob
  // (keyboard J / K / L, or a click for touch). Hold for power, let go in the green, tap the same
  // button again as the arm comes through; time slows to half while you do.
  meterS() {
    return this.mode === 'qbc' ? this.qbc : this.cat;
  },
  meterTarget() {
    if (this.mode === 'qbc') return this.qbc.targets[this.qbc.sel] || null;
    return this.cat.mate;
  },
  meterCan() {
    const b = this.fb.ball;
    if (this.mode === 'qbc') return this.canThrowMode();
    return b.holder === 'you' && b.mode === 'held';
  },
  meterInput(dt, a, fire) {
    const game = this.game;
    const inp = game.input;
    const S = this.meterS();
    const R = a.qbR || [];
    const key = (c) => !!inp.keys?.has(c);
    const pad = inp.mode === 'pad' && !inp.touchMode;
    const held = { bullet: !!R[0] || key('KeyJ'), touch: !!R[1] || key('KeyK') || (!pad && !!fire), lob: !!R[3] || key('KeyL') };
    const can = this.meterCan();
    S.prevHeld ||= { bullet: true, touch: true, lob: true };
    if (S.acc) {
      // The accuracy tap: the same button again as the needle crosses the middle (no tap by the
      // end: it goes anyway, way off).
      S.acc.n += dt / ACC_T;
      const tap = held[S.acc.kind] && !S.prevHeld[S.acc.kind];
      if (tap || S.acc.n >= 1 || !can) this.meterRelease(tap ? S.acc.n : null, a);
    } else if (can && !this.press) {
      for (const k of ['bullet', 'touch', 'lob']) {
        if (held[k] && !S.prevHeld[k]) {
          this.press = { kind: k, t: 0 };
          break;
        }
      }
    } else if (!can) this.press = null;
    if (this.press) {
      // Power: hold, let go in the green.
      const P = this.press;
      if (held[P.kind]) P.t += dt;
      else {
        this.press = null;
        const T = this.meterTarget();
        const [px, pz] = game.player.pos();
        const d = T ? dist(px, pz, T.x, T.z) : 10;
        const pw = Math.min(1, P.t / FILL);
        const po = Math.abs(pw - this.needFor(P.kind, d));
        const W = CTYPES[P.kind].win;
        // (the power's own animation the moment you let go: dead on, in the green, or off)
        S.acc = { kind: P.kind, power: pw, n: 0, d, tgt: T, pwFx: po <= W * 0.5 ? 'pw-perfect' : po <= W ? 'pw-ok' : 'miss', key: (S.fxN = (S.fxN || 0) + 1) };
      }
    }
    S.prevHeld = held;
    // (time slows to half while you hold and tap, and eases back after)
    const ts = game.timeScale || 1;
    const want = this.press || S.acc ? SLOW : 1;
    game.timeScale = ts + (want - ts) * Math.min(1, (dt / ts) * 9);
    if (Math.abs(game.timeScale - 1) < 0.01) game.timeScale = 1;
    if (pad) a.sprint = fire; // (R2 sprints)
  },
  meterRelease(n, a) {
    const S = this.meterS();
    const A = S.acc;
    S.acc = null;
    const acc = n == null ? (Math.random() < 0.5 ? -0.5 : 0.5) : n - 0.5;
    if (this.mode === 'qbc') this.qbcThrow(A.tgt || this.meterTarget(), A.kind, A.power, acc, n);
    else this.catchThrow(A.kind, A.power, acc, a, n);
  },
  // What the meter shows a moment after a throw (S.last): where you let go and tapped, the
  // verdict and its animation; true for a perfect pass.
  meterResult(S, kind, pw, need, acc, tapN) {
    const game = this.game;
    const TY = CTYPES[kind];
    const off = pw - need;
    const pwr = Math.abs(off) <= TY.win ? '' : off < 0 ? 'SHORT' : 'LONG';
    const aim = tapN == null ? 'NO TAP' : Math.abs(acc) <= PERFECT ? 'PERFECT' : acc < 0 ? 'PULLED' : 'PUSHED';
    const pwPerfect = Math.abs(off) <= TY.win * 0.5;
    const perfect = pwPerfect && aim === 'PERFECT';
    const okish = !pwr && aim === 'PERFECT';
    const fx = perfect ? ['pass-perfect'] : [pwPerfect ? 'pw-perfect' : !pwr ? 'pw-ok' : 'miss', aim === 'PERFECT' ? 'acc-perfect' : Math.abs(acc) <= 0.1 ? 'acc-ok' : 'miss'];
    S.last = { fx, fxKey: (S.fxN = (S.fxN || 0) + 1), v: pw, lo: need - TY.win, hi: need + TY.win, n: null, tap: tapN ?? (acc < 0 ? 0 : 1), label: perfect ? 'PERFECT PASS' : okish ? 'ON THE MONEY' : [pwr, aim === 'PERFECT' ? 'ON LINE' : aim].filter(Boolean).join(' · '), labelClass: perfect || okish ? 'good' : !pwr && Math.abs(acc) <= 0.1 ? 'ok' : 'bad', until: game.time + (perfect ? 1.6 : 1.1) };
    if (perfect) {
      game.shakeCamera?.(0.03, 0.2);
      game.timeScale = 0.3; // (a beat more slow motion as it leaves the hand: it eases back)
    }
    return perfect;
  },
  // The meter beside you while you hold and tap (and its result a moment after).
  meterHud() {
    const game = this.game;
    const S = this.meterS();
    const [px, pz] = game.player.pos();
    const tm = (this.tmeter ||= new ThrowMeter());
    let st = null;
    const style = game.style?.meter || 'arc';
    const T = this.meterTarget();
    if ((this.press || S.acc) && T) {
      const kind = this.press ? this.press.kind : S.acc.kind;
      const W = CTYPES[kind].win;
      const need = this.needFor(kind, S.acc ? S.acc.d : dist(px, pz, T.x, T.z));
      st = { style, v: this.press ? Math.min(1, this.press.t / FILL) : S.acc.power, lo: need - W, hi: need + W, n: S.acc ? S.acc.n : null, tap: null, label: S.acc ? 'TAP!' : '', labelClass: 'cue', fx: S.acc ? [S.acc.pwFx] : null, fxKey: S.acc?.key };
    } else if (S.last && game.time < S.last.until) st = { style, ...S.last };
    game.hud.sportFloat?.(null);
    if (!st) return tm.hide();
    // (beside you: to your screen-left, chest high, all of it on screen)
    const cam = game.camera;
    const v = (this._mv ||= new THREE.Vector3());
    const rx = -Math.cos(game.camYaw);
    const rz = Math.sin(game.camYaw);
    v.set(px - rx * 0.75, 1.3 + (game.player.gy?.() || 0), pz - rz * 0.75).project(cam);
    if (v.z > 1) return tm.hide();
    const W = innerWidth;
    const H = innerHeight;
    const sx = Math.max(80, Math.min(W - 80, ((v.x + 1) / 2) * W));
    const sy = Math.max(110, Math.min(H - 110, ((1 - v.y) / 2) * H));
    tm.show({ x: sx, y: sy }, st);
  },

  catchInput(dt, a, fire) {
    const inp = this.game.input;
    const R = a.qbR || [];
    this.meterInput(dt, a, fire);
    if (inp.btnHit?.(12) || inp.hit?.('KeyE')) this.callMate(1);
    if (inp.btnHit?.(13) || inp.hit?.('KeyQ')) this.callMate(-1);
    if ((R[4] && !this.prevR[4]) || inp.hit?.('KeyX')) this.sendRoute();
    this.prevR = R.slice();
    this.prevFire = fire;
  },

  // The QB Challenge: the same meter; D-pad ◀ ▶ (keyboard Z / X, ◀ ▶ on a phone) picks the ring
  // you're throwing at (the camera locks on to it).
  qbcInput(dt, a, fire) {
    const inp = this.game.input;
    const Q = this.qbc;
    const R = a.qbR || [];
    if (!this.press && !Q.acc) {
      const step = (inp.btnHit?.(14) || inp.hit?.('KeyZ') ? -1 : 0) + (inp.btnHit?.(15) || inp.hit?.('KeyX') ? 1 : 0);
      if (step) Q.sel = (Q.sel + step + Q.targets.length) % Q.targets.length;
    }
    this.meterInput(dt, a, fire);
    this.prevR = R.slice();
    this.prevFire = fire;
  },

  // The power a throw of d meters needs (0..1 on the meter).
  needFor(kind, d) {
    return Math.max(0.08, Math.min(1, d / CTYPES[kind].max));
  },

  // Your throw: as far as the power you let go at (early: short, late: long), toward where he'll
  // be; the tap sets the line (early pulls it to your left, late pushes it right, more the
  // further off and the deeper it goes), plus a touch of wobble (more on the run).
  catchThrow(kind, pw, acc, a, tapN = null) {
    const game = this.game;
    const fb = this.fb;
    const b = fb.ball;
    const C = this.cat;
    const w = C.mate;
    const p = game.player;
    const [px, pz] = p.pos();
    const TY = CTYPES[kind];
    // (where he'll be: standing, or running his route)
    const sp = w.speed || 0;
    const T0 = TY.T(dist(px, pz, w.x, w.z));
    let ax = w.x + Math.sin(w.heading) * sp * T0;
    let az = w.z + Math.cos(w.heading) * sp * T0;
    // (the left stick leads him on a route, camera-relative)
    const mx = a?.moveX || 0;
    const my = a?.moveY || 0;
    if (Math.hypot(mx, my) > 0.3 && sp > 1) {
      const yaw = game.camYaw;
      ax += (Math.sin(yaw) * my - Math.cos(yaw) * mx) * 2.5;
      az += (Math.cos(yaw) * my + Math.sin(yaw) * mx) * 2.5;
    }
    const da = dist(px, pz, ax, az) || 1;
    const need = this.needFor(kind, da);
    const off = pw - need;
    const L = Math.max(2, pw * TY.max);
    const ux = (ax - px) / da;
    const uz = (az - pz) / da;
    let wob = TY.err * 0.3 * (0.4 + da / 45);
    if ((p.speed || 0) > 2.5) wob += 0.6;
    const lat = acc * 18 * (0.5 + da / 45) + rand(-1, 1) * wob; // (+: to your right)
    const F = fb.site.field;
    const tx = Math.max(F.x0 - 4, Math.min(F.x1 + 4, px + ux * L - uz * lat));
    const tz = Math.max(F.z0 - 4, Math.min(F.z1 + 4, pz + uz * L + ux * lat));
    fb.launch(tx, TY.h, tz, TY.T(dist(px, pz, tx, tz)), 'pass', w);
    b.style = kind === 'lob' ? 'lob' : 'bullet';
    b.throwKind = kind;
    this.throwT = 0.26; // (the rest of the follow-through)
    this.state = 'air';
    C.throws = (C.throws || 0) + 1;
    // (the meter's verdict; a perfect pass flies gold)
    if (this.meterResult(C, kind, pw, need, acc, tapN)) this.goldBall(true);
    void off;
  },

  // A perfect pass: the ball glows gold with a trail of afterimages till it gets there.
  goldBall(on) {
    const game = this.game;
    const b = this.fb.ball;
    const C = this.cat;
    if (on && !C.gold) {
      C.gold = { mat: b.mesh.material, ghosts: [], hist: [] };
      b.mesh.material = GOLD;
      for (let i = 0; i < 6; i++) {
        const g = new THREE.Mesh(b.mesh.geometry, new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.45 * (1 - i / 6), depthWrite: false }));
        g.visible = false;
        game.scene.add(g);
        C.gold.ghosts.push(g);
      }
    } else if (!on && C.gold) {
      b.mesh.material = C.gold.mat;
      for (const g of C.gold.ghosts) game.scene.remove(g);
      C.gold = null;
    }
  },

  // D-pad ↑: go long (10 yards further out, up to the limit); ↓: come closer.
  callMate(dir) {
    const game = this.game;
    const C = this.cat;
    const w = C.mate;
    const F = this.fb.site.field;
    const [px, pz] = game.player.pos();
    let ux = C.spot[0] - px;
    let uz = C.spot[1] - pz;
    const cur = Math.hypot(ux, uz);
    if (cur < 0.5) {
      ux = Math.sin(game.player.heading);
      uz = Math.cos(game.player.heading);
    } else {
      ux /= cur;
      uz /= cur;
    }
    const nd = Math.max(5, Math.min(LEASH - 3, cur + dir * 10 * YD));
    C.spot = [Math.max(F.x0 + 1, Math.min(F.x1 - 1, px + ux * nd)), Math.max(F.z0 + 1, Math.min(F.z1 - 1, pz + uz * nd))];
    C.routeOn = false;
    w.fb.route = null;
    const yd = Math.round(dist(px, pz, C.spot[0], C.spot[1]) / YD);
    const line = dir > 0 ? pick(['Going long!', 'Aight, deep!', "Let's see that arm", 'Bet, way back']) : pick(['Coming in', 'Aight, closer', 'Bet', 'Say less']);
    game.hud.toast(`${w.ballName}: "${line}" · ${yd} yds`, '#ffd23f');
  },

  // Your camera playing catch: in close behind you over your throwing (right) shoulder, locked
  // on him (main.js updateCamera).
  camShot() {
    if (!(this.mode === 'catch' && this.cat) && !(this.mode === 'qbc' && this.qbc)) return null;
    return { back: 3.7, up: 0.45, shoulder: 0.85, fov: 58 };
  },

  // The board up top, and the power meter beside you while you hold a throw (and its result a
  // moment after).
  catchHud() {
    const game = this.game;
    const C = this.cat;
    const b = this.fb.ball;
    const inp = game.input;
    const kb = inp.mode === 'kb' && !inp.touchMode;
    const [px, pz] = game.player.pos();
    const yd = Math.round(dist(px, pz, C.mate.x, C.mate.z) / YD);
    const keys = inp.touchMode ? 'BULLET · TOUCH · LOB' : kb ? 'J bullet · K touch · L lob' : '□ bullet · ✕ touch · △ lob';
    const calls = inp.touchMode ? 'LONG / CLOSER' : kb ? 'E go long · Q closer' : 'D-pad ↑ go long · ↓ closer';
    const hint = b.holder === 'you' ? (C.acc ? 'Tap it again on the line!' : `${keys}: hold for power, let go in the green, tap again on the line · ${calls}`) : b.mode === 'flight' && b.to === 'you' ? 'Get under it!' : b.mode === 'loose' ? 'Loose ball: go get it' : `${C.mate.ballName} has it · ${calls}`;
    game.hud.sport?.(`PLAYING CATCH · ${C.mate.ballName} · ${yd} yds · ${C.streak} in a row (best ${C.best})`, null, hint);
    this.meterHud();
  },

  // Everyone else while you play catch: two of them have their own game of catch down the other
  // half of the field; the rest sit on the bench drinking Gatorade.
  setupOthers(mate, zMid) {
    const game = this.game;
    const fb = this.fb;
    const F = fb.site.field;
    const B = fb.site.bench;
    const others = fb.players.filter((q) => q !== mate).sort(() => Math.random() - 0.5);
    const center = (F.z0 + F.z1) / 2;
    const zo = zMid > center ? Math.max(F.z0 + 16, zMid - 45) : Math.min(F.z1 - 16, zMid + 45);
    const pair = others.length >= 2 ? others.slice(0, 2) : [];
    const sit = others.slice(pair.length);
    this.side = null;
    if (pair.length === 2) {
      const [a, c] = pair;
      a.fb.sideSpot = [F.cx - 1 + rand(-2, 2), zo - 8];
      c.fb.sideSpot = [F.cx + 1 + rand(-2, 2), zo + 8];
      const mesh = new THREE.Mesh(fb.ball.mesh.geometry, fb.ball.mesh.material);
      mesh.castShadow = true;
      game.scene.add(mesh);
      this.side = { a, b: c, mesh, holder: a, holdT: 0, winding: false, flight: null, loose: null, x: a.x, y: 1, z: a.z };
    }
    sit.forEach((q, k) => {
      q.fb.seat = B ? B.seats[k % B.seats.length] : [F.x1 + 1, center + k];
      q.fb.sipPh = rand(0, 7);
    });
  },

  // The pair down the other end: to their spots, facing each other, going after it.
  driveSide(p, f, goTo, faceAt) {
    const S = this.side;
    const o = p === S.a ? S.b : S.a;
    if (S.flight && S.flight.to === p) {
      if (S.flight.t < 0.35) {
        faceAt(S.x, S.z);
        return { speed: 0 };
      }
      return goTo(S.flight.p1[0], S.flight.p1[2], 3.6) || (faceAt(S.x, S.z), { speed: 0 });
    }
    if (S.loose && dist(p.x, p.z, S.x, S.z) <= dist(o.x, o.z, S.x, S.z)) return goTo(S.x, S.z, 3.8) || { speed: 0 };
    const g = goTo(f.sideSpot[0], f.sideSpot[1], 3.4);
    if (g) return g;
    faceAt(o.x, o.z);
    return { speed: 0 };
  },

  // Their ball: held a beat, thrown (a bullet, now and then a lob), caught mostly, a drop picked
  // up by whoever's nearer.
  sideStep(dt) {
    const game = this.game;
    const fb = this.fb;
    const S = this.side;
    if (!S) return;
    if (!fb.players.includes(S.a) || !fb.players.includes(S.b)) {
      game.scene.remove(S.mesh);
      this.side = null;
      return;
    }
    if (S.holder) {
      const h = S.holder;
      const o = h === S.a ? S.b : S.a;
      S.holdT += dt;
      if (!S.winding && S.holdT > 1.3 && dist(h.x, h.z, h.fb.sideSpot[0], h.fb.sideSpot[1]) < 0.9 && !h.fb.throwT) {
        h.fb.throwT = 0.35;
        S.winding = true;
      }
      if (fbBallAt(h.char, _v)) [S.x, S.y, S.z] = [_v.x, _v.y, _v.z];
      else [S.x, S.y, S.z] = [h.x, 1.15, h.z];
      if (S.winding && h.fb.throwT <= 0.12) {
        S.winding = false;
        const off = Math.random() < 0.15 ? rand(1.2, 2.2) : rand(0, 0.6);
        const an = rand(0, Math.PI * 2);
        const tx = o.fb.sideSpot[0] + Math.cos(an) * off;
        const tz = o.fb.sideSpot[1] + Math.sin(an) * off;
        const d = dist(S.x, S.z, tx, tz);
        const lob = Math.random() < 0.3;
        const T = lob ? 0.85 + d / 15 : 0.35 + d / 22;
        S.flight = { p0: [S.x, S.y, S.z], p1: [tx, 1.3, tz], T, t: 0, vy0: (1.3 - S.y + 0.5 * G * T * T) / T, to: o, lob };
        S.holder = null;
        h.fb.relT = 0.4;
      }
    } else if (S.flight) {
      const Fl = S.flight;
      Fl.t += dt;
      const k = Math.min(1, Fl.t / Fl.T);
      const ox = S.x;
      const oy = S.y;
      const oz = S.z;
      S.x = Fl.p0[0] + (Fl.p1[0] - Fl.p0[0]) * k;
      S.z = Fl.p0[2] + (Fl.p1[2] - Fl.p0[2]) * k;
      const t = Math.min(Fl.t, Fl.T);
      S.y = Fl.p0[1] + Fl.vy0 * t - 0.5 * G * t * t;
      S.mesh.lookAt(S.x + (S.x - ox) * 10, S.y + (S.y - oy) * 10, S.z + (S.z - oz) * 10);
      S.mesh.rotateZ(Fl.t * 25);
      if (Fl.t >= Fl.T) {
        const o = Fl.to;
        if (dist(o.x, o.z, S.x, S.z) < 1.2 && Math.random() < 0.93) {
          S.holder = o;
          S.holdT = 0;
          o.fb.sideSpot = this.inRange(o, o === S.a ? S.b.fb.sideSpot : S.a.fb.sideSpot, 32);
        } else S.loose = { vx: (Fl.p1[0] - Fl.p0[0]) / Fl.T * 0.3, vz: (Fl.p1[2] - Fl.p0[2]) / Fl.T * 0.3, vy: -2 };
        S.flight = null;
      }
    } else if (S.loose) {
      const L = S.loose;
      L.vy -= G * dt;
      S.x += L.vx * dt;
      S.y += L.vy * dt;
      S.z += L.vz * dt;
      if (S.y < 0.12) {
        S.y = 0.12;
        L.vy = Math.abs(L.vy) > 1.2 ? -L.vy * 0.4 : 0;
        L.vx *= 0.9;
        L.vz *= 0.9;
      }
      for (const q of [S.a, S.b]) {
        if (dist(q.x, q.z, S.x, S.z) < 0.7 && S.y < 0.6) {
          S.holder = q;
          S.holdT = 0;
          q.fb.sideSpot = this.inRange(q, q === S.a ? S.b.fb.sideSpot : S.a.fb.sideSpot, 32);
          S.loose = null;
          break;
        }
      }
    }
    if (!S.flight) S.mesh.rotation.set(0, S.holder ? S.holder.heading : 0, 0);
    S.mesh.position.set(S.x, S.y, S.z);
  },

  // football.js pose(): the bench (sat, sipping now and then) and the other pair's arms; null for
  // everyone else (the usual).
  posePlayer(p, c) {
    const f = p.fb;
    if (this.mode !== 'catch') return null;
    if (f.seat && f.seated) {
      const B = this.fb.site.bench;
      bendLeg(c.legL, c.kneeL, 1.5, 1.5);
      bendLeg(c.legR, c.kneeR, 1.5, 1.5);
      c.legL.rotation.z = 0.12;
      c.legR.rotation.z = -0.12;
      // (a sip every seven seconds or so: the bottle up to the mouth, the head back)
      const k = (this.game.time + f.sipPh) % 7;
      const sip = k < 1.8 ? Math.sin((Math.PI * k) / 1.8) : 0;
      bendSpine(c, 0.28 * (1 - sip) - 0.06 * sip, 0, 0);
      c.neck.rotation.set(-0.08 - 0.5 * sip, 0, 0);
      _v.set(-0.2 + 0.16 * sip, 0.98 + 0.62 * sip, 0.42 - 0.24 * sip);
      reachArm(c, 'R', _v, _w.set(-1, -0.6, -0.2), null, null, 'body');
      c.armL.rotation.set(-0.95, 0, 0.12);
      c.elbowL.rotation.set(-1.1, 0, 0);
      let bt = c.group.userData.bottle;
      if (!bt) {
        bt = c.group.userData.bottle = new THREE.Mesh(BOTTLE, new THREE.MeshLambertMaterial({ color: Math.random() < 0.5 ? 0xff8a1f : 0x8be33a }));
        bt.position.set(0, -0.09, -0.05);
        bt.rotation.z = Math.PI / 2;
        c.wristR.add(bt);
      }
      bt.visible = true;
      return (B?.seatY ?? 0.46) - 0.9;
    }
    const S = this.side;
    if (S && (p === S.a || p === S.b)) {
      c.group.userData.fbGrip = null;
      let y = 0.04;
      if (S.holder === p) {
        if (f.throwT > 0) throwPose(c, 1 - Math.max(0, f.throwT - 0.12) / 0.23, 0);
        else if (p.speed > 0.5) tuckCarry(c, p.speed);
        else y = holdBall(c, 0, true, this.game.time) + 0.04;
      } else if (f.relT > 0) throwPose(c, 1, 1 - f.relT / 0.4);
      else if (S.flight && S.flight.to === p && S.flight.T - S.flight.t < 0.6) catchPose(c, S.flight.lob);
      return y;
    }
    return null;
  },

  // Where he throws it back from: right where he got it, unless that's too far (then in range).
  inRange(q, to, range) {
    const F = this.fb.site.field;
    let x = Math.max(F.x0 + 0.5, Math.min(F.x1 - 0.5, q.x));
    let z = Math.max(F.z0 + 0.5, Math.min(F.z1 - 0.5, q.z));
    const d = dist(x, z, to[0], to[1]);
    if (d > range) {
      x = to[0] + ((x - to[0]) / d) * (range - 2);
      z = to[1] + ((z - to[1]) / d) * (range - 2);
    }
    return [x, z];
  },
  throwFromHere(w) {
    const [px, pz] = this.game.player.pos();
    this.cat.spot = this.inRange(w, [px, pz], LEASH - 6);
    this.cat.routeOn = false;
    w.fb.route = null;
  },

  driveMate(p, f, b, goTo, faceAt) {
    const C = this.cat;
    const [px, pz] = this.game.player.pos();
    if (b.mode === 'flight' && b.to === p) {
      // (reading it a beat, then adjusting to where it's coming down: a few steps, not a
      // sprint, unless he's already running a route; a bad throw stays a bad throw)
      if (b.t < 0.4 && !C.routeOn) {
        faceAt(b.x, b.z);
        return { speed: 0 };
      }
      const g = goTo(b.p1[0], b.p1[2], C.routeOn ? 5.2 : 3.3);
      if (g) return g;
      faceAt(b.x, b.z);
      return { speed: 0 };
    }
    if (b.mode === 'loose') {
      // (whoever's nearer goes and gets it)
      const dm = dist(p.x, p.z, b.x, b.z);
      if (dm < dist(px, pz, b.x, b.z) + 1) {
        if (dm < 0.7 && b.y < 0.8) {
          this.fb.hold(p);
          C.holdT = 0;
          this.throwFromHere(p);
        }
        return { tx: b.x, tz: b.z, speed: 4.5 };
      }
      faceAt(b.x, b.z);
      return { speed: 0 };
    }
    if (f.route && C.routeOn && b.holder !== p) {
      const pt = f.route[f.leg];
      if (pt) {
        if (dist(p.x, p.z, pt[0], pt[1]) < 0.6) f.leg++;
        else return { tx: pt[0], tz: pt[1], speed: 5.6 };
      }
      faceAt(px, pz);
      return { speed: 0 };
    }
    const g = goTo(C.spot[0], C.spot[1], b.holder === p ? 3.4 : 3.8);
    if (g) return g;
    faceAt(px, pz);
    return { speed: 0 };
  },

  // R1: send him out on a route (while you've got it and he's at his spot).
  sendRoute() {
    const game = this.game;
    const fb = this.fb;
    const C = this.cat;
    const w = C.mate;
    if (fb.ball.holder !== 'you' || C.routeOn) return;
    const kind = ROUTES[(C.routeI = ((C.routeI ?? -1) + 1) % ROUTES.length)];
    w.fb.home = C.spot.slice();
    let pts = fb.route(w, kind);
    const [, pz] = game.player.pos();
    if (C.spot[1] > pz) pts = pts.map(([x, z]) => [x, Math.min(fb.site.field.z1 - 2, 2 * C.spot[1] - z)]); // (he's upfield of you: run it the other way)
    w.fb.route = pts;
    w.fb.leg = 0;
    C.routeOn = true;
    game.hud.toast(`${w.ballName}: running a ${kind}`, '#ffd23f');
  },

  catchStep(dt) {
    const game = this.game;
    const fb = this.fb;
    const b = fb.ball;
    const C = this.cat;
    const w = C.mate;
    if (!fb.players.includes(w)) {
      game.hud.toast(`${w.ballName} took off`, '#9fc3ff');
      return this.end('off');
    }
    this.sideStep(dt);
    // (a perfect pass's gold trail, till it lands)
    if (C.gold) {
      if (b.mode !== 'flight') this.goldBall(false);
      else {
        C.gold.hist.unshift([b.x, b.y, b.z, b.mesh.quaternion.clone()]);
        C.gold.hist.length = Math.min(C.gold.hist.length, 13);
        C.gold.ghosts.forEach((g, i) => {
          const h = C.gold.hist[(i + 1) * 2];
          g.visible = !!h;
          if (h) {
            g.position.set(h[0], h[1], h[2]);
            g.quaternion.copy(h[3]);
          }
        });
      }
    }
    const p = game.player;
    let [px, pz] = p.pos();
    // The 50-yard leash: past it, backing off fights you (pulled most of the way back each step)
    // and he comes in toward you.
    const dm = dist(px, pz, w.x, w.z);
    if (dm > LEASH && !p.vehicle) {
      const k = (LEASH + (dm - LEASH) * 0.6) / dm;
      p.x = w.x + (px - w.x) * k;
      p.z = w.z + (pz - w.z) * k;
      [px, pz] = p.pos();
    }
    if (dist(px, pz, C.spot[0], C.spot[1]) > LEASH - 4 && !C.routeOn) {
      const ds = dist(px, pz, C.spot[0], C.spot[1]);
      const k = (LEASH - 8) / ds;
      C.spot = [px + (C.spot[0] - px) * k, pz + (C.spot[1] - pz) * k];
    }
    // The camera locked on him; you square up to him whenever you're not on the move (or you're
    // winding up).
    const face = Math.atan2(w.x - px, w.z - pz);
    game.camYaw = lerpAngle(game.camYaw, face, Math.min(1, dt * 6));
    if ((p.speed || 0) < 0.6 || this.press) p.heading = lerpAngle(p.heading, face, Math.min(1, dt * 10));
    // (a loose ball at your feet: yours)
    if (b.mode === 'loose' && b.y < 0.8 && dist(px, pz, b.x, b.z) < 0.9) {
      fb.hold('you');
      b.holder = 'you';
      this.t = 0;
    }
    if (b.holder === 'you') this.t = Math.min(this.t, 1); // (no pocket closing in: no extra wobble)
    // He throws it back: at his spot, a beat after he's got it, at you (now and then off to one
    // side, so you have to go get it).
    if (b.holder === w && b.mode === 'held') {
      C.holdT += dt;
      C.routeOn = false;
      w.fb.route = null;
      // (he throws it from wherever he got it, unless that's out of range: then he comes in first)
      const atSpot = dist(w.x, w.z, C.spot[0], C.spot[1]) < 0.9;
      if (!C.throwing && !w.fb.throwT && C.holdT > 0.9 && atSpot) {
        w.fb.throwT = 0.35;
        C.throwing = true;
      }
      if (C.throwing && w.fb.throwT <= 0.12) {
        C.throwing = false;
        const far = Math.random() < 0.3;
        const r = far ? rand(1.4, 3) : rand(0, 0.7);
        const a = rand(0, Math.PI * 2);
        const tx = px + Math.cos(a) * r;
        const tz = pz + Math.sin(a) * r;
        const d = dist(w.x, w.z, tx, tz);
        // (his pick: on a line close, dropped in from further, put up high deep)
        const kind = d < 14 ? (Math.random() < 0.7 ? 'bullet' : 'touch') : d < 30 ? pick(['bullet', 'touch', 'touch']) : pick(['touch', 'lob', 'lob']);
        const TY = CTYPES[kind];
        fb.launch(tx, TY.h, tz, TY.T(d) + (far ? 0.2 : 0), 'pass', 'you');
        b.style = kind === 'lob' ? 'lob' : 'bullet';
        w.fb.relT = 0.4;
      }
    } else {
      C.throwing = false;
      C.holdT = 0;
    }
    // (after a throw you're back to having it or waiting on him)
    if (this.state === 'air' && b.mode !== 'flight') this.state = 'play';
  },

  // A throw gets there (football.js arrived): his catch or yours.
  catchArrived() {
    const game = this.game;
    const fb = this.fb;
    const b = fb.ball;
    const C = this.cat;
    const drop = (why) => {
      b.mode = 'loose';
      b.holder = null;
      const L = Math.hypot(b.p1[0] - b.p0[0], b.p1[2] - b.p0[2]) || 1;
      const sp = L / b.T;
      b.vx = ((b.p1[0] - b.p0[0]) / L) * sp * 0.35;
      b.vz = ((b.p1[2] - b.p0[2]) / L) * sp * 0.35;
      b.vy = -2;
      C.streak = 0;
      game.hud.toast(why, '#ff8080');
    };
    this.state = 'play';
    if (b.to === 'you') {
      const [px, pz] = game.player.pos();
      const d = dist(px, pz, b.x, b.z);
      if (d < 1.15 && Math.random() < 0.97) {
        fb.hold('you');
        b.holder = 'you';
        this.t = 0;
        C.mine++;
        C.streak++;
        if (C.streak % 5 === 0) game.hud.toast(`${C.streak} in a row`, '#7ee081');
      } else drop(d < 2.2 ? 'Off your fingertips' : 'Missed it');
    } else if (b.to === C.mate) {
      const w = C.mate;
      const dW = dist(w.x, w.z, b.x, b.z);
      const dove = fb.diveFor(w, b.x, b.z);
      let pr = dW < 0.9 ? 0.95 : dW < 1.6 ? 0.7 : dW < 2.6 ? 0.35 : 0;
      if (dove) pr += 0.1;
      w.fb.route = null;
      C.routeOn = false;
      if (Math.random() < pr) {
        fb.hold(w);
        this.throwFromHere(w);
        C.his++;
        C.streak++;
        C.holdT = 0;
        if (dove) {
          game.hud.toast(`${w.ballName}: DIVING CATCH!`, '#7ee081');
          for (const f of fb.fans) f.fb.cheerT = rand(1.2, 2);
        } else if (C.streak % 5 === 0) game.hud.toast(`${C.streak} in a row`, '#7ee081');
      } else drop(dW < 2.6 ? `${w.ballName} dropped it` : 'Way off');
    } else drop('Incomplete');
    C.best = Math.max(C.best, C.streak);
  },
};
