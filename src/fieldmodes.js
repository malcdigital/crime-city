import * as THREE from 'three';
import { dist, rand } from './util.js';
import { throwPose, catchPose } from './footballpose.js';

// The other games at Harbor Field (mixed into Gridiron: gridiron.js), picked from the field's
// menu the way you pick a game at the courts (courtmenu.js):
//
// QB Challenge (solo, like the 3-point contest): 60 seconds from the spot to put as many balls
//   as you can through five targets downfield (rings on posts at 10, 16, 22, 30 and 40 yards,
//   worth 1, 2, 2, 3 and 5). Each target has its button over it (□ ✕ ○ △ R1, keyboard 1-5,
//   or click the one you look at): tap it for a bullet (fast, flat, wilder the deeper it goes),
//   hold it for a lob (slower, steadier deep). A rack: there's another ball in your hands a beat
//   after each throw. "Moving" slides the targets side to side. The best score is saved (a new
//   record: +3 cred).
// Play catch: with anyone out there (their quarterback, a receiver, a back), from close,
//   medium or far apart. Throw it to him with any face button (keyboard 1-4, or click him;
//   tap: bullet, hold: lob); he throws it back, sometimes off to one side so you have to go get
//   it (you catch it if you're under it). R1 (keyboard X, ROUTE on a phone) sends him out on a
//   route (a go, post, out, slant or curl) to hit him on the run. A drop rolls away: whoever's
//   nearer picks it up. It counts your catches, his, and the best run in a row.
// Both quit like the drive (QUIT on a phone, hold the touchpad / M); walking off the field, a
// car or the police end them.

const YD = 0.9144;
const G = 9.8;
const QBC_T = 60;
const QBC_KEY = 'crimecity.qbc.v1';
const BULLET = 0.22; // (held longer than this it's a lob)
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
const GAPS = { Close: 9, Medium: 15, Far: 24 };
const ROUTES = ['go', 'post', 'out', 'slant', 'curl'];

// The lob's touch: how long to hold it for a throw d meters (0.3 s short to ~0.75 s at 40 yards),
// and how far either side still counts as the green.
const HOLD_MAX = 1;
const LOB_WIN = 0.07;
const lobHold = (d) => Math.max(0.3, Math.min(0.85, 0.22 + d * 0.0145));

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
    if (this.mode === 'qbc') return this.qbc ? this.qbc.targets : [null, null, null, null, null];
    return [this.cat?.mate || null, null, null, null, null];
  },

  // Your buttons.
  modeInput(dt, a, fire) {
    const game = this.game;
    const R = a.qbR || [];
    const pad = game.input.mode === 'pad' && !game.input.touchMode;
    const recv = this.receivers();
    const can = this.canThrowMode();
    if (can && !this.press) {
      for (let i = 0; i < R.length; i++) {
        const w = this.mode === 'catch' ? (i < 4 ? recv[0] : null) : recv[i];
        if (R[i] && !this.prevR[i] && w) {
          this.press = { i, t: 0, w };
          break;
        }
      }
      if (!this.press && fire && !pad && !this.prevFire && this.target) this.press = { i: -1, t: 0, w: this.target };
    } else if (!can) this.press = null;
    if (this.press) {
      const P = this.press;
      const down = P.i >= 0 ? R[P.i] : fire;
      if (down) P.t += dt;
      else {
        this.press = null;
        const kind = P.t < BULLET ? 'bullet' : 'lob';
        if (this.mode === 'qbc') this.qbcThrow(P.w, kind, P.t);
        else this.throwIt(P.w, kind, a);
      }
    }
    if (pad) a.sprint = fire; // (R2 sprints on the controller; ✕ is a button)
    else a.sprint = a.sprint && !R[1];
    if (this.mode === 'catch' && ((R[4] && !this.prevR[4]) || game.input.hit?.('KeyX'))) this.sendRoute();
    this.prevR = R.slice();
    this.prevFire = fire;
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
    this.target = this.canThrowMode() ? this.pickTarget() : null;
    const kb = game.input.mode === 'kb' && !game.input.touchMode;
    this.arrow.visible = !!this.target && kb;
    if (this.target) this.arrow.position.set(this.target.x, 3.4 + Math.sin(game.time * 6) * 0.08, this.target.z);
    this.updateIcons();
    let meter = this.press ? Math.min(1, this.press.t / 0.5) : null;
    if (this.mode === 'qbc') {
      // (the hold: the green zone is the touch that target needs; a tap is a bullet)
      if (this.press) {
        const [px2, pz2] = game.player.pos();
        const ideal = lobHold(dist(px2, pz2, this.press.w.x, this.press.w.z));
        meter = { v: Math.min(1, this.press.t / HOLD_MAX), lo: (ideal - LOB_WIN) / HOLD_MAX, hi: (ideal + LOB_WIN) / HOLD_MAX };
      }
      const Q = this.qbc;
      const left = Math.max(0, Math.ceil(QBC_T - Q.t));
      const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      const keys = kb ? '1-5' : game.input.touchMode ? 'the target\'s button' : '□ ✕ ○ △ R1';
      const hint = Q.t < 0 ? `Get set... ${Math.ceil(-Q.t)}` : Q.over ? 'Time!' : `${keys}: tap a bullet, or hold and let go in the green for a lob · deeper is worth more${kb ? ' · or click the target you look at' : ''}`;
      game.hud.sport?.(`QB CHALLENGE · ${clock} · ${Q.score} pts · ${Q.hits}/${Q.throws}${Q.best ? ` · record ${Q.best}` : ''}`, meter, hint);
    } else {
      const C = this.cat;
      const keys = kb ? '1-4' : game.input.touchMode ? 'any button' : '□ ✕ ○ △';
      const rk = kb ? 'X' : game.input.touchMode ? 'ROUTE' : 'R1';
      const hint = b.holder === 'you' ? `${keys}: throw it (tap: bullet, hold: lob) · ${rk}: send him on a route` : b.mode === 'flight' && b.to === 'you' ? 'Get under it!' : b.mode === 'loose' ? 'Loose ball: go get it' : `${C.mate.ballName} has it`;
      game.hud.sport?.(`PLAYING CATCH · ${C.mate.ballName} · ${C.streak} in a row (best ${C.best})`, meter, hint);
    }
  },

  // Your follow-through and catches (gridiron late()); true if it posed you.
  modeLate(c) {
    const b = this.fb.ball;
    if (this.mode === 'qbc' && !this.press && this.throwT > 0) {
      throwPose(c, 1, 1 - this.throwT / 0.4); // (the follow-through)
      return true;
    }
    if (this.mode === 'catch' && b.mode === 'flight' && b.to === 'you' && b.T - b.t < 0.6) {
      catchPose(c, b.style === 'lob' || b.p1[1] > 1.5); // (hands up for it)
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
    for (const q of fb.players) q.fb.side = null;
    if (fb.ball) fb.ball.mesh.visible = true;
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
    const Q = (this.qbc = { spot: [F.cx, sz], moving, t: -3, score: 0, throws: 0, hits: 0, best, targets: [], flights: [], ready: true, rackAt: 0, over: false, overT: 0 });
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
    this.toSideline(sz - 4);
    game.hud.toast(`QB Challenge${moving ? ' (moving targets)' : ''}: 60 seconds. Put it through the rings: the deeper, the more it's worth`, '#ffd23f');
  },

  // A throw at a target: its own ball (the next one's already in your hands), led to where a
  // moving target will be, a little off by how deep it is and how you threw it.
  qbcThrow(T, kind, hold = 0) {
    const game = this.game;
    const p = game.player;
    const Q = this.qbc;
    const fb = this.fb;
    const b = fb.ball;
    const [px, pz] = p.pos();
    const lob = kind === 'lob';
    const d = dist(px, pz, T.x, T.z);
    const FT = lob ? 0.75 + d / 15 : 0.3 + d / 24;
    const tx = T.amp ? T.x0 + T.amp * Math.sin(T.ph + ((Q.t + FT) * Math.PI * 2) / T.per) : T.x;
    // (bullets get wild deep; a lob's as good as its touch: let go in the green)
    let err = lob ? 0.3 + 0.009 * d + Math.abs(hold - lobHold(d)) * 3.2 : 0.2 + 0.014 * d + Math.max(0, d - 18) * 0.07;
    if (T.amp) err += 0.2;
    if ((p.speed || 0) > 2.5) err += 0.5; // (on the run)
    const ea = rand(0, Math.PI * 2);
    const er = err * Math.sqrt(rand(0, 1)); // (anywhere in the circle)
    const ex = Math.cos(ea) * er;
    const ey = Math.sin(ea) * er * 0.8;
    const L = Math.hypot(tx - px, T.z - pz) || 1;
    const ux = -(T.z - pz) / L;
    const uz = (tx - px) / L;
    const p1 = [tx + ux * ex, T.gy + RING_Y + ey, T.z + uz * ex];
    const mesh = new THREE.Mesh(b.mesh.geometry, b.mesh.material);
    mesh.castShadow = true;
    game.scene.add(mesh);
    const p0 = [b.x, b.y, b.z];
    Q.flights.push({ mesh, p0, p1, T: FT, t: 0, vy0: (p1[1] - p0[1] + 0.5 * G * FT * FT) / FT, tgt: T, mode: 'flight', x: p0[0], y: p0[1], z: p0[2], vx: 0, vy: 0, vz: 0, life: 0 });
    b.mesh.visible = false;
    Q.ready = false;
    Q.rackAt = Q.t + 0.7;
    Q.throws++;
    this.throwT = 0.4;
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
    // The targets (sliding, when they move).
    for (const T of Q.targets) {
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
        if (f.t >= f.T) this.qbcArrive(f, dt);
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

  // A ball gets to the target: through the ring, off it, or wide; it carries on as a loose ball.
  qbcArrive(f, dt) {
    const game = this.game;
    const Q = this.qbc;
    const T = f.tgt;
    const off = Math.hypot(Math.hypot(f.p1[0] - T.x, f.p1[2] - T.z), f.p1[1] - (T.gy + RING_Y));
    const sp = Math.hypot(f.p1[0] - f.p0[0], f.p1[2] - f.p0[2]) / f.T;
    const L = Math.hypot(f.p1[0] - f.p0[0], f.p1[2] - f.p0[2]) || 1;
    const dx = (f.p1[0] - f.p0[0]) / L;
    const dz = (f.p1[2] - f.p0[2]) / L;
    const vy = f.vy0 - G * f.T;
    f.mode = 'loose';
    if (off < RING_R - 0.11) {
      Q.score += T.pts;
      Q.hits++;
      T.flash = 0.6;
      f.vx = dx * sp * 0.6;
      f.vz = dz * sp * 0.6;
      f.vy = vy;
      game.hud.toast(off < 0.25 ? `Dead center! +${T.pts}` : `+${T.pts}`, '#7ee081');
      if (T.pts >= 3) for (const q of this.fb.fans) q.fb.cheerT = rand(1, 1.6);
    } else if (off < RING_R + 0.2) {
      // (off the ring: knocked back)
      f.vx = -dx * sp * 0.25 + rand(-1, 1);
      f.vz = -dz * sp * 0.25;
      f.vy = Math.abs(vy) * 0.3 + 1;
      game.hud.toast('Off the ring', '#ff8080');
    } else {
      f.vx = dx * sp * 0.8;
      f.vz = dz * sp * 0.8;
      f.vy = vy;
    }
    void dt;
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
  startCatch(qb, mate, gapName) {
    const game = this.game;
    const fb = this.fb;
    this.startMode(qb, 'catch');
    const F = fb.site.field;
    const [px, pz] = game.player.pos();
    const gap = GAPS[gapName] || 15;
    // (he goes out downfield from you, or upfield if there's no room)
    let mz = pz - gap;
    if (mz < F.z0 + 3) mz = pz + gap;
    const mx = Math.max(F.x0 + 3, Math.min(F.x1 - 3, px));
    this.cat = { mate, gap, spot: [mx, mz], streak: 0, best: 0, mine: 0, his: 0, holdT: 0, throwing: false, routeOn: false };
    mate.fb.route = null;
    this.toSideline((pz + mz) / 2, mate);
    const btn = game.input.touchMode ? 'any button' : game.input.mode === 'pad' ? 'any face button' : '1-4 or a click';
    game.hud.toast(`Playing catch with ${mate.ballName}. Throw it: ${btn} (tap: bullet, hold: lob)`, '#ffd23f');
  },

  driveMate(p, f, b, goTo, faceAt) {
    const C = this.cat;
    const [px, pz] = this.game.player.pos();
    if (b.mode === 'flight' && b.to === p) {
      const g = goTo(b.p1[0], b.p1[2], 6);
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
    const [px, pz] = game.player.pos();
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
        const lob = d > 20 || far || Math.random() < 0.25;
        const T = (lob ? 0.85 + d / 15 : 0.35 + d / 22) + (far ? 0.25 : 0);
        fb.launch(tx, lob ? 1.7 : 1.35, tz, T, 'pass', 'you');
        b.style = lob ? 'lob' : 'bullet';
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
