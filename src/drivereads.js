import * as THREE from 'three';
import { dist, rand, pick, clamp, lerpAngle } from './util.js';
import { setShirt } from './character.js';
import { CTYPES } from './fieldmodes.js';

// The drive's passing game (mixed into Gridiron: gridiron.js): three receivers against three
// defensive backs, real formations and pass concepts, and one read.
//
// - At the line: L1 / R1 (keyboard Z / X, PLAY on a phone) calls the play. Its routes are drawn
//   on the turf (the play art), each receiver numbered in the order you read him. The defense
//   lines up in its coverage, and the alignment gives it away: pressed up tight is man, three
//   backs deep is Cover 3, two safeties deep with a corner up is Cover 2.
// - After the drop-back time slows. ◀ ▶ (D-pad, keyboard Z / X or Q / E, the ◀ ▶ buttons on a
//   phone) moves you from receiver to receiver; the throw meter throws to him (□ bullet, ✕
//   touch, △ lob: hold for power, let go in the green, tap again for accuracy).
// - Every play, the concept beats the coverage somewhere: exactly one receiver comes open, out of
//   his break, for a moment, then his man closes back on him. Start the throw while he's open
//   and his man stays beaten till the ball gets there; throw it anywhere else (or before he
//   breaks, or after the window shuts) and it's contested: broken up or picked off.
// - The blue line is the line of scrimmage, the yellow one the line to gain (red on 4th down,
//   gone when it's goal to go); the down and distance is painted on the turf till the snap.
//
// Routes are in yards: [out (toward his own sideline), downfield]; brk: the point he breaks at
// (the window opens just after), or depth: a vertical opens past that depth; W: how long he's
// open (game seconds; time runs at half speed while you read).
const YD = 0.9144;
const XS = 0.55; // (across: the field's about half as wide as a real one)
export const SACK_READ = 4.2; // (game seconds after the snap)
const PEAK = 3.5; // (how far his man trails him at the most, metres)
const ROUTES = {
  flat: { pts: [[1, 1], [6, 2.5], [10, 3]], brk: 0, W: 0.9, name: 'flat' },
  slant: { pts: [[0, 3], [-6, 7.5], [-12, 10]], brk: 0, W: 0.8, name: 'slant' },
  fade: { pts: [[1.2, 7], [2.2, 32]], depth: 11, W: 0.9, name: 'fade' },
  go: { pts: [[0, 32]], depth: 12, W: 0.9, name: 'go' },
  seam: { pts: [[0.6, 8], [1.4, 32]], depth: 10, W: 0.9, name: 'seam' },
  hitch: { pts: [[0, 6], [-0.5, 5]], brk: 0, W: 0.85, name: 'hitch' },
  stick: { pts: [[0, 6], [1, 5.5]], brk: 0, W: 0.85, name: 'stick' },
  corner: { pts: [[0, 10], [7, 16], [9, 23]], brk: 0, W: 0.85, name: 'corner' },
  sail: { pts: [[0, 11], [11, 12.5]], brk: 0, W: 0.8, name: 'sail' },
  in: { pts: [[0, 5], [-10, 5.5], [-18, 6]], brk: 0, W: 0.8, name: 'in' },
  dig: { pts: [[0, 11], [-11, 11], [-20, 11.5]], brk: 0, W: 0.8, name: 'dig' },
  curl: { pts: [[0, 12], [-1.2, 10.5]], brk: 0, W: 0.85, name: 'curl' },
  post: { pts: [[0, 11], [-8, 22]], brk: 0, W: 0.85, name: 'post' },
  shallow: { pts: [[-1, 2], [-15, 5], [-28, 5.5]], brk: 1, W: 0.85, name: 'crosser' },
};
// Formations: where the three line up (metres across from the ball toward the strong side, and
// off the line: a slot a step off it). Flipped at random, right or left.
const FORMS = {
  trips: { name: 'Trips', at: [[11.5, 0], [7.4, 0.9], [3.8, 0]] },
  twins: { name: 'Twins', at: [[11.5, 0], [6.6, 0.9], [-11.5, 0]] },
  bunch: { name: 'Bunch', at: [[6.6, 0], [5.4, 0.9], [7.9, 0.9]] },
};
// The playbook: the routes in the formation's order, the read order, the drop (game seconds of
// backpedal) and who the concept frees against each coverage (one picked at random if two).
export const DPLAYS = [
  { name: 'Slant-Flat', form: 'twins', routes: ['slant', 'flat', 'fade'], read: [1, 0, 2], drop: 0.45, beat: { man: [2], c3: [0], c2: [0] } },
  { name: 'Stick', form: 'trips', routes: ['fade', 'flat', 'stick'], read: [1, 2, 0], drop: 0.45, beat: { man: [2], c3: [2], c2: [1] } },
  { name: 'Smash', form: 'twins', routes: ['hitch', 'corner', 'dig'], read: [1, 0, 2], drop: 0.6, beat: { man: [1], c3: [0], c2: [1] } },
  { name: 'Flood', form: 'trips', routes: ['go', 'sail', 'flat'], read: [1, 2, 0], drop: 0.7, beat: { man: [2], c3: [1], c2: [2] } },
  { name: 'Levels', form: 'bunch', routes: ['dig', 'in', 'seam'], read: [0, 1, 2], drop: 0.6, beat: { man: [0], c3: [0, 1], c2: [0] } },
  { name: 'Mesh', form: 'twins', routes: ['shallow', 'corner', 'shallow'], read: [1, 0, 2], drop: 0.5, beat: { man: [0, 2], c3: [0, 2], c2: [0, 2] } },
  { name: 'Curl-Flat', form: 'twins', routes: ['curl', 'flat', 'post'], read: [0, 1, 2], drop: 0.7, beat: { man: [0], c3: [0, 1], c2: [0] } },
  { name: '3 Verts', form: 'twins', routes: ['go', 'seam', 'go'], read: [1, 0, 2], drop: 0.7, beat: { man: [0, 2], c3: [1], c2: [1] } },
];
const COVS = { man: 'Man', c3: 'Cover 3', c2: 'Cover 2' };
const READ_COLORS = ['#3ddc97', '#ffd23f', '#ff79c6'];
const SIT = new Set(['hitch', 'curl', 'stick']); // (routes that settle down facing you)
const OFFENSE = 0x2e7d32;
const DEFENSE = 0x22416e;

export const DriveReads = {
  // ---- Setting up (gridiron start) ----
  drStart() {
    const game = this.game;
    const fb = this.fb;
    const F = fb.site.field;
    // (three receivers and three backs: somebody comes off the sideline to make it up)
    const add = (role, x, z, shirt) => {
      const q = game.peds.addAt(x, z, Math.random() < 0.2);
      q.state = 'play';
      q.act = fb;
      q.keep = true;
      q.sidewalk = false;
      setShirt(q.char, shirt);
      q.fb = { role, home: [x, z], t: 0 };
      q.heading = role === 'db' ? 0 : Math.PI;
      fb.players.push(q);
      this.extra.push(q);
      return q;
    };
    while (fb.wrs.length < 3) fb.wrs.push(add('wr', F.x1 + 1.5, this.los + rand(-4, 4), OFFENSE));
    while (fb.dbs.length < 3) fb.dbs.push(add('db', F.x1 + 1.5, this.los - rand(2, 8), DEFENSE));
    this.dr = { prevHeld: { bullet: true, touch: true, lob: true } };
    // The broadcast lines on the turf (just over the grass, under the players).
    const line = (color) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(F.x1 - F.x0, 0.36), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(F.cx, 0.065, 0);
      m.renderOrder = 2;
      game.scene.add(m);
      return m;
    };
    this.drLines = { los: line(0x2f6bff), first: line(0xffd800) };
    // (the down and distance, painted flat on the turf just past the line)
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 128;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const dd = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    dd.rotation.x = -Math.PI / 2;
    dd.renderOrder = 2;
    game.scene.add(dd);
    this.drLines.dd = { mesh: dd, cv, tex, text: '' };
    // (the man you're reading: a ring at his feet)
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.8, 32), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 3;
    ring.visible = false;
    game.scene.add(ring);
    this.drRing = ring;
    this.drBadges = [];
    this.drArt = null;
    this.playI = Math.floor(Math.random() * DPLAYS.length); // (a play called for you: change it at the line)
    this.drLineUp(true);
    // The defense already lined up; your receivers and you in a huddle behind the line (it
    // breaks as the intro cuts in behind you: drStep), then the intro.
    this.drSetAll();
    const H = [F.cx, this.los + 7];
    this.dr.huddle = { t: 0, c: H };
    fb.wrs.slice(0, 3).forEach((w, k) => {
      const a = [-Math.PI / 2, Math.PI, Math.PI / 2][k]; // (west, north, east of the middle; you're south)
      w.fb.huddle = [H[0] + Math.sin(a) * 1.05, H[1] + Math.cos(a) * 1.05];
      w.fb.huddleC = H;
      [w.x, w.z] = w.fb.huddle;
      w.heading = Math.atan2(H[0] - w.x, H[1] - w.z);
    });
    fb.phase = 'reset';
    const p = game.player;
    [p.x, p.z] = this.drSpot();
    p.heading = game.camYaw = Math.PI;
    this.dr.introAt = game.time + 0.12; // (a few frames for everyone to settle into their stance first: drStep)
  },
  drIntro() {
    const game = this.game;
    this.dr.introAt = null;
    game.driveCine?.intro({ spot: this.drSpot(), los: this.los, cx: this.fb.site.field.cx, squad: this.bench?.ballName || 'their', from: this.drFromText(), bet: this.bet, play: this.drPlayName() }, () => {
      game.camYaw = Math.PI;
    });
  },
  drFromText() {
    const y = Math.round((this.los - this.goal) / YD);
    return y > 50 ? `FROM YOUR OWN ${100 - y}` : y <= 20 ? `FROM THE ${y} (RED ZONE)` : `FROM THE ${y}`;
  },

  // Everyone to their spots for the play called: the formation (flipped at random), and the
  // defense's coverage, which its alignment gives away.
  drLineUp(newCov) {
    const fb = this.fb;
    const F = fb.site.field;
    const D = this.dr;
    const P = DPLAYS[this.playI];
    if (newCov || D.side == null) D.side = Math.random() < 0.5 ? 1 : -1;
    if (newCov || !D.cov) D.cov = pick(['man', 'c3', 'c2']);
    D.play = P;
    if (fb.phase === 'set') fb.phase = 'reset'; // (a new call: everyone gets set again before the snap)
    const form = FORMS[P.form];
    // (the receivers left to right as you look downfield, so ◀ ▶ go the way they look)
    D.slots = form.at.map(([x, off], k) => ({ k, x: F.cx + x * D.side, z: this.los + off, route: P.routes[k] }));
    D.order = D.slots.slice().sort((a, b) => a.x - b.x).map((s) => s.k);
    fb.wrs.slice(0, 3).forEach((w, k) => {
      w.fb.home = [D.slots[k].x, D.slots[k].z];
      w.fb.slot = k;
      w.fb.route = null;
    });
    // The backs: one on each receiver, lined up by the coverage.
    fb.dbs.slice(0, 3).forEach((d, k) => {
      const s = D.slots[k];
      const out = Math.sign(s.x - F.cx) || D.side;
      const wide = Math.abs(s.x - F.cx) > 9;
      let x = s.x;
      let z = this.los - 1.2;
      if (D.cov === 'man') {
        x = s.x - out * 0.5; // (pressed up, shaded inside)
        z = this.los - (s.z > this.los + 0.5 ? 3.2 : 1.2);
      } else if (D.cov === 'c3') {
        // (three deep: the corners 5 yards off, the safety 7 in the middle)
        x = wide ? s.x - out * 0.6 : F.cx + (s.x - F.cx) * 0.6;
        z = this.los - (wide ? 5 : 7) * YD;
      } else {
        // (Cover 2: the corner up with outside leverage, two safeties deep on the halves)
        x = wide ? s.x + out * 0.8 : F.cx + (s.x - F.cx) * 0.7;
        z = this.los - (wide ? 3 : 7.5) * YD;
      }
      d.fb.home = [clamp(x, F.x0 + 1, F.x1 - 1), z];
      d.fb.mark = fb.wrs[k];
    });
    // Who the concept frees against this coverage.
    D.openK = pick(P.beat[D.cov]);
    D.openW = fb.wrs[D.openK];
    D.openAt = D.closeAt = null;
    D.sel = P.read[0];
    D.lock = null;
    D.last = null;
    // (the pre-snap scan: your eyes from man to man, left to right, starting straight downfield)
    const left = D.order.filter((k) => D.slots[k].x < F.cx);
    const right = D.order.filter((k) => D.slots[k].x >= F.cx);
    D.scanList = [...left, null, ...right];
    D.scanI = left.length;
    this.drPlayArt();
  },

  // The play art: each route drawn on the turf from where he lines up, in his read color.
  drPlayArt() {
    const game = this.game;
    if (this.drArt) {
      game.scene.remove(this.drArt);
      this.drArt.traverse((o) => o.geometry?.dispose());
    }
    const D = this.dr;
    const g = new THREE.Group();
    D.slots.forEach((s) => {
      const pts = [[s.x, s.z], ...this.drRoute(s, true)];
      const n = D.play.read.indexOf(s.k);
      const m = new THREE.Mesh(ribbon(pts, 0.22), new THREE.MeshBasicMaterial({ color: READ_COLORS[n], transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = 2;
      g.add(m);
    });
    g.position.y = 0.07;
    game.scene.add(g);
    this.drArt = g;
  },

  // A route's points on the field (from his slot), kept inside the sidelines.
  drRoute(s, art = false) {
    const F = this.fb.site.field;
    const out = Math.sign(s.x - F.cx) || this.dr.side;
    const cx = (x) => clamp(x, F.x0 + 1.2, F.x1 - 1.2);
    const cz = (z) => Math.max(F.z0 + 2, z);
    const pts = ROUTES[s.route].pts.map(([dx, dy]) => [cx(s.x + dx * YD * XS * out), cz(this.los - dy * YD)]);
    // (after his last cut he keeps running, as receivers do: on across the field, or turned
    // upfield along the sideline when he runs out of room; a hitch, curl or stick man sits down.
    // The play art shows the route as called, without it.)
    if (art || SIT.has(s.route)) return pts;
    const [ax, az] = pts.length > 1 ? pts[pts.length - 2] : [s.x, s.z];
    const [bx, bz] = pts[pts.length - 1];
    const L = Math.hypot(bx - ax, bz - az) || 1;
    const ex = cx(bx + ((bx - ax) / L) * 14);
    const ez = cz(bz + ((bz - az) / L) * 14);
    pts.push([ex, ez]);
    if (Math.hypot(ex - bx, ez - bz) < 10) pts.push([ex, cz(ez - 20)]); // (out of room at the sideline: up it)
    return pts;
  },

  // ---- The snap ----
  drSnap() {
    const fb = this.fb;
    const D = this.dr;
    fb.wrs.slice(0, 3).forEach((w, k) => {
      w.fb.route = this.drRoute(D.slots[k]);
      w.fb.leg = 0;
      w.fb.mh = Math.PI;
    });
    D.openAt = D.closeAt = null;
    D.lock = null;
    const scanned = D.scanList?.[D.scanI];
    D.sel = scanned != null ? scanned : D.play.read[0]; // (the read starts on whoever you were looking at)
    // (the ✕ that hiked it is also TOUCH: it's not a throw till it's let go and pressed again)
    D.prevHeld = { bullet: true, touch: true, lob: true };
    D.acc = null;
    this.press = null;
  },
  // Before the snap: ◀ ▶ (D-pad, the phone's buttons, the stick or A / D) scans the field.
  drScan(a) {
    const inp = this.game.input;
    const D = this.dr;
    if (!D?.scanList) return;
    const sx = a.moveX || 0;
    const flick = Math.abs(sx) > 0.6 && !(Math.abs(this.scanPrevX || 0) > 0.6) ? Math.sign(sx) : 0;
    this.scanPrevX = sx;
    const step = (inp.btnHit?.(14) ? -1 : 0) + (inp.btnHit?.(15) ? 1 : 0) || flick;
    if (step) D.scanI = clamp(D.scanI + step, 0, D.scanList.length - 1);
  },

  // ---- Your buttons while you've got it ----
  // ◀ ▶ (D-pad, L1 / R1, Z / X or Q / E): the next man over.
  drSelect(a) {
    const inp = this.game.input;
    const D = this.dr;
    const R = a.qbR || [];
    const step = (inp.btnHit?.(14) || inp.btnHit?.(4) || inp.hit?.('KeyZ') || inp.hit?.('KeyQ') ? -1 : 0) + (inp.btnHit?.(15) || (R[4] && !this.prevR[4]) || inp.hit?.('KeyX') || inp.hit?.('KeyE') ? 1 : 0);
    if (!step || this.press || D.acc) return;
    const i = D.order.indexOf(D.sel);
    D.sel = D.order[clamp(i + step, 0, D.order.length - 1)];
  },
  // (where you stand side-on to in the pocket: the man you're reading, or straight downfield)
  drFace() {
    const p = this.game.player;
    const b = this.fb.ball;
    if (this.state === 'line') {
      const k = this.dr?.scanList?.[this.dr.scanI];
      const s = k != null ? this.fb.wrs[k] : null;
      return s ? Math.atan2(s.x - p.x, s.z - p.z) : Math.PI;
    }
    const w = this.state === 'air' && b.to && b.to !== 'you' ? b.to : this.drSelW();
    return w && this.mode === 'drive' && (this.state === 'play' || this.state === 'air') ? Math.atan2(w.x - p.x, w.z - p.z) : Math.PI;
  },
  drSelW() {
    return this.dr ? this.fb.wrs[this.dr.sel] || null : null;
  },
  // Reading the field: after the drop, the ball still yours, not past the line.
  drReading() {
    const b = this.fb.ball;
    return this.mode === 'drive' && this.state === 'play' && b.holder === 'you' && !this.scramble && this.t >= (this.dr?.play?.drop ?? 0.6);
  },
  drCanThrow() {
    const b = this.fb.ball;
    return this.state === 'play' && b.holder === 'you' && b.mode === 'held' && !this.scramble && this.game.player.pos()[1] >= this.los;
  },
  // The meter's man: where he'll be when it gets there (along his route).
  drAim(want = null) {
    const D = this.dr;
    const w = D.lock?.w || this.drSelW();
    if (!w) return null;
    const [px, pz] = this.game.player.pos();
    const kind = want || this.press?.kind || D.acc?.kind || 'touch'; // (the throw's own flight time: a lob hangs, a bullet's there quick)
    let p = [w.x, w.z];
    for (let i = 0; i < 3; i++) {
      const T = CTYPES[kind].T(dist(px, pz, p[0], p[1]));
      p = ahead(w, routeSpeed(w) * T);
    }
    return { x: p[0], z: p[1], w };
  },
  // The throw's started (the meter's first press): on the open man in his window (or anyone
  // with real daylight between him and his man), his man stays beaten till it's there; anyone
  // else, too early or too late, it's contested.
  drPress() {
    const D = this.dr;
    const w = this.drSelW();
    if (!w) return;
    const t = this.t;
    const db = this.fb.dbs.find((q) => q.fb.mark === w);
    const gap = db ? dist(db.x, db.z, w.x, w.z) : 9;
    let why = 'covered';
    if (w === D.openW) why = D.openAt == null || t < D.openAt - 0.3 ? 'early' : t > D.closeAt ? 'late' : 'open';
    if (gap >= 3 && t >= D.play.drop) why = 'open'; // (real daylight, once he's into his route)
    D.lock = { w, open: why === 'open', why, sep: why === 'open' ? Math.max(2.4, gap) : 0 };
  },

  // The throw (the meter let go and tapped): as far as the power, the line off the tap.
  drThrow(kind, pw, acc, tapN) {
    const game = this.game;
    const fb = this.fb;
    const b = fb.ball;
    const D = this.dr;
    const p = game.player;
    const [px, pz] = p.pos();
    const A = this.drAim(kind);
    const w = A?.w || this.drSelW();
    if (!A || !w) return;
    const TY = CTYPES[kind];
    const da = dist(px, pz, A.x, A.z) || 1;
    const need = this.needFor(kind, da);
    const L = Math.max(2, pw * TY.max);
    const ux = (A.x - px) / da;
    const uz = (A.z - pz) / da;
    let wob = TY.err * 0.3 * (0.4 + da / 45);
    if ((p.speed || 0) > 2.5) wob += 0.6;
    const lat = acc * 18 * (0.5 + da / 45) + rand(-1, 1) * wob; // (+: to your right)
    const F = fb.site.field;
    const tx = clamp(px + ux * L - uz * lat, F.x0 - 3, F.x1 + 3);
    const tz = clamp(pz + uz * L + ux * lat, F.z0 - 3, F.z1 + 3);
    b.x = px + Math.sin(p.heading) * 0.2;
    b.z = pz + Math.cos(p.heading) * 0.2;
    fb.launch(tx, TY.h, tz, TY.T(dist(px, pz, tx, tz)), 'pass', w);
    b.style = kind === 'lob' ? 'lob' : 'bullet';
    b.throwKind = kind;
    this.throwT = 0.26;
    this.state = 'air';
    D.perfect = this.meterResult(D, kind, pw, need, acc, tapN);
    if (D.perfect) this.goldBall(true);
  },

  // ---- Every frame ----
  drStep(dt) {
    const D = this.dr;
    if (!D) return;
    if (D.introAt != null && this.game.time >= D.introAt) this.drIntro();
    // The huddle breaks on the intro's cut in behind you (or straight away if it's skipped):
    // the cut lands on everyone lined up, you behind the center.
    if (D.huddle) {
      D.huddle.t += dt;
      const C = this.game.driveCine;
      if ((C?.open && C.t >= C.T * 0.6) || (D.introAt == null && !C?.open)) {
        D.huddle = null;
        this.drSetAll();
      }
    }
    if (D.wipe) {
      D.wipe.t += dt;
      if (D.wipe.t >= 2.0) this.drWipeOut();
    }
    // The open man's window: just after he's out of his break.
    const w = D.openW;
    if (this.state !== 'line' && w && D.openAt == null && w.fb.route) {
      const R = ROUTES[D.play.routes[D.openK]];
      const out = R.depth != null ? (this.los - w.z) / YD >= R.depth : w.fb.leg > R.brk;
      if (out) {
        D.openAt = this.t + 0.15;
        D.closeAt = D.openAt + R.W;
      }
    }
    this.goldStep(D);
    this.heatStep(dt);
    this.drLook(dt);
    this.drDraw(dt);
  },

  // How far the open man's back trails him right now (0: on him).
  drSep(w) {
    const D = this.dr;
    if (!D || this.state === 'line') return 0;
    if (D.lock?.w === w && D.lock.open) return Math.max(D.lock.sep, w === D.openW && D.openAt != null ? PEAK : 0);
    if (w !== D.openW || D.openAt == null) return 0;
    const t = this.t;
    let s = PEAK * clamp((t - (D.openAt - 0.15)) / 0.45, 0, 1);
    if (t > D.closeAt - 0.3) s = Math.max(0.3, PEAK - (t - (D.closeAt - 0.3)) * 6);
    return s;
  },

  // A back in the play (football.js drive): on his man's hip, or, if his man's the one the
  // concept freed, beaten and trailing for the window, then closing back on him. Null: football.js
  // carries on (after a catch, everyone goes for the ball).
  drDB(p, f, b, faceAt) {
    const fb = this.fb;
    const D = this.dr;
    if (!D || fb.phase !== 'play' || this.state === 'line' || this.state === 'dead') return null;
    const w = f.mark;
    if (!w || !fb.players.includes(w)) return null;
    if (w.speed > 0.5) w.fb.mh = w.heading;
    const h = w.fb.mh ?? Math.PI;
    const ux = Math.sin(h);
    const uz = Math.cos(h);
    const F = fb.site.field;
    const sep = this.drSep(w);
    let tx;
    let tz;
    if (D.cov !== 'man' && this.t < 0.12) {
      // (zone: the first steps are a backpedal into it)
      tx = f.home[0];
      tz = f.home[1] - 2;
    } else if (sep > 0.3) {
      tx = w.x - ux * sep;
      tz = w.z - uz * sep;
    } else {
      // (on him: a step ahead along his way, inside, between him and the goal)
      const inw = Math.sign(F.cx - w.x) || 1;
      tx = w.x + ux * 0.4 + inw * 0.45;
      tz = w.z + uz * 0.4 - 0.5;
    }
    const d = dist(p.x, p.z, tx, tz);
    if (d < 0.25) {
      if (b.mode === 'flight') faceAt(b.x, b.z);
      else faceAt(w.x, w.z);
      return { speed: 0 };
    }
    return { tx, tz, speed: Math.min(8.5, 1.2 + d * 3.6) }; // (closing on him: flat out)
  },

  // The pass gets there: open (thrown in his window) it's his if it's on him; covered, it's a
  // fight for it, and they win most of them.
  drArrived() {
    const game = this.game;
    const fb = this.fb;
    const b = fb.ball;
    const D = this.dr;
    const w = b.to;
    const here = w && fb.players.includes(w);
    let dW = here ? dist(w.x, w.z, b.x, b.z) : 99;
    const db = fb.dbs.find((q) => q.fb.mark === w);
    const dD = db ? dist(db.x, db.z, b.x, b.z) : 99;
    const L = D.lock;
    const open = !!(L && L.w === w && L.open);
    const told = this.drTold();
    const fail = (why) => {
      b.mode = 'loose';
      b.vx = rand(-1.5, 1.5);
      b.vz = rand(-1.5, 1.5);
      b.vy = -2;
      this.drRes = { kind: 'incomplete', why: `${why} · ${told}` };
      this.heatMiss();
      this.over(null);
    };
    if (!open) {
      const why = L?.why === 'early' ? "Too early: he hadn't come open yet" : L?.why === 'late' ? 'Too late: his man closed' : 'Into coverage';
      if (dD < 2.2 && Math.random() < (b.throwKind === 'bullet' ? 0.4 : b.throwKind === 'lob' ? 0.38 : 0.32)) {
        fb.hold(db);
        this.heatMiss();
        this.drWipeIn(this.drCardFor({ kind: 'pick', why: `${why} · ${told}` }, 0, false, true), true);
        return this.end('pick');
      }
      if (dW < 1.2 && Math.random() < (D.perfect ? 0.35 : 0.15)) return this.drCaught(w, false, 'Contested catch!');
      if (db && dD < 2.5) {
        db.fb.relT = 0;
        return fail(`Broken up. ${why}`);
      }
      return fail(dW < 2.6 ? `Incomplete. ${why}` : 'Incomplete');
    }
    if (w?.fb?.reachBack) dW = Math.max(0, dW - 0.5); // (reaching back: a longer grab, an arm's length behind him)
    const dove = dW >= 0.95 && dW < 2.6 && fb.diveFor(w, b.x, b.z);
    const pr = dW < 1.0 ? 0.97 : dW < 1.8 ? 0.82 : dW < 2.6 ? 0.5 : 0;
    if (Math.random() < (D.perfect && dW < 2.6 ? 1 : pr)) return this.drCaught(w, dove, dove ? 'DIVING CATCH!' : D.perfect ? 'Dropped in the bucket!' : 'Caught!');
    const off = b.p1 ? (this.los - b.p1[2]) - (this.los - w.z) : 0;
    fail(dW < 2.6 ? 'Off his hands. Incomplete' : off > 1.5 ? 'Overthrown' : off < -1.5 ? 'Underthrown' : 'Off target');
  },
  drCaught(w, dove, text) {
    const game = this.game;
    const fb = this.fb;
    const b = fb.ball;
    fb.hold(w);
    this.drRes = { kind: 'complete', why: this.drTold() };
    for (const f of fb.fans) f.fb.cheerT = rand(1, 2);
    game.hud.toast(text, '#7ee081');
    this.heatHit(b.x, Math.max(1, b.y), b.z); // (in rhythm, on fire: fieldmodes.js)
    if (dove) {
      if (b.z <= this.goal) return this.touchdown(w);
      return this.over(w.z);
    }
    fb.phase = 'run';
    fb.t = 0;
    fb.runFor = 99;
    w.fb.runTo = [w.x, this.goal - 3];
    this.state = 'run';
    this.t = 0;
  },
  // (what the defense was in, and who was open: shown after every play to learn the read)
  drTold() {
    const D = this.dr;
    return `vs ${COVS[D.cov]}: the ${ROUTES[D.play.routes[D.openK]].name} was open`;
  },

  // ---- What's drawn ----
  drDraw(dt) {
    const game = this.game;
    const D = this.dr;
    const fb = this.fb;
    const Ls = this.drLines;
    if (!Ls) return;
    const goal = this.first <= this.goal + 0.01;
    Ls.los.position.z = this.los;
    Ls.first.position.z = this.first;
    Ls.first.visible = !goal;
    Ls.first.material.color.set(this.down >= 3 ? 0xe8262a : 0xffd800); // (red on 4th down)
    // (the down and distance, faded out once it's snapped)
    const dd = Ls.dd;
    const text = this.drDownText();
    if (text !== dd.text) {
      dd.text = text;
      const g = dd.cv.getContext('2d');
      g.clearRect(0, 0, 512, 128);
      g.font = 'bold 84px Arial Black, Impact, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 10;
      g.strokeStyle = 'rgba(0,0,0,.55)';
      g.strokeText(text, 256, 66);
      g.fillStyle = '#ffffff';
      g.fillText(text, 256, 66);
      dd.tex.needsUpdate = true;
    }
    const on = this.state === 'line';
    const cine = !!game.driveCine?.open; // (the intro: no play art, no numbers, no ring)
    dd.mesh.material.opacity += ((on ? 0.9 : 0) - dd.mesh.material.opacity) * Math.min(1, dt * 6);
    dd.mesh.visible = dd.mesh.material.opacity > 0.02;
    dd.mesh.position.set(fb.site.field.cx + (D.side || 1) * -6.5, 0.066, this.los - 3.2);
    if (this.drArt) this.drArt.visible = on && !cine;
    // The read numbers over the receivers (and the man you're on, bigger, with a ring).
    const reading = this.drReading() || (this.state === 'play' && fb.ball.holder === 'you' && !this.scramble);
    const show = (on || reading) && !cine;
    for (let n = 0; n < 3; n++) {
      if (!this.drBadges[n]) {
        this.drBadges[n] = badge(String(n + 1), READ_COLORS[n]);
        game.scene.add(this.drBadges[n]);
      }
      const k = D.play.read[n];
      const w = fb.wrs[k];
      const s = this.drBadges[n];
      s.visible = show && !!w;
      if (!w) continue;
      const sel = !on && k === D.sel;
      s.position.set(w.x, sel ? 2.85 : 2.6, w.z);
      s.scale.setScalar(sel ? 0.085 : on ? 0.055 : 0.06);
      s.material.opacity = on || sel ? 1 : 0.7;
    }
    const sk = on ? D.scanList?.[D.scanI] : null;
    const sw = !on && reading ? this.drSelW() : sk != null ? fb.wrs[sk] : null;
    this.drRing.visible = !!sw && !cine;
    if (sw) {
      this.drRing.position.set(sw.x, 0.075, sw.z);
      this.drRing.scale.setScalar(1 + Math.sin(game.time * 7) * 0.07);
    }
    this.arrow.visible = !!sw && !cine;
    if (sw) this.arrow.position.set(sw.x, 3.35 + Math.sin(game.time * 6) * 0.08, sw.z);
  },
  // The camera (the QB Challenge's, over your shoulder: fieldmodes.js camShot) turned to where
  // you're looking: downfield at the line, the man you're on while you read, the ball's man while
  // it's in the air. Your eyes go where the ◀ ▶ take them.
  drLook(dt) {
    const game = this.game;
    const b = this.fb.ball;
    if (this.scramble || !(this.state === 'line' || this.state === 'play' || this.state === 'air') || (this.state === 'play' && b.holder !== 'you')) return;
    const face = this.drFace();
    // (the camera turns most of the way to him, not all of it: the rest of the field stays in
    // the picture so you can still find the open man)
    const off = Math.atan2(Math.sin(face - Math.PI), Math.cos(face - Math.PI));
    game.camYaw = lerpAngle(game.camYaw, Math.PI + off * 0.7, Math.min(1, dt * 5));
    const walking = this.state === 'line' && dist(...game.player.pos(), ...this.drSpot()) > 0.4; // (on the way to the spot: facing where you're going)
    if (this.state !== 'air' && !this.dropping && !walking) game.player.heading = lerpAngle(game.player.heading, face, Math.min(1, dt * 10));
  },
  // At the line you walk yourself to your spot behind the center (input: gridiron.js).
  drSpot() {
    const H = this.dr?.huddle;
    if (H) return [H.c[0], H.c[1] + 1.05]; // (in the huddle, its south side)
    return [this.fb.site.field.cx, this.los + 3.2];
  },
  // Everyone straight to his spot for the next play (under the transition): the receivers and
  // backs at their homes, set; you behind the center looking downfield.
  drSetAll() {
    const game = this.game;
    const fb = this.fb;
    for (const q of [...fb.wrs.slice(0, 3), ...fb.dbs.slice(0, 3)]) {
      [q.x, q.z] = q.fb.home;
      q.heading = q.fb.role === 'db' ? 0 : Math.PI;
      Object.assign(q.fb, { adjV: null, reachBack: 0, route: null, runTo: null, downT: 0, pickT: 0, dive: false, beatT: 0, relT: 0, throwT: 0, hurry: false, huddle: null });
    }
    fb.phase = 'set';
    fb.t = 0;
    this.downT = 0;
    this.throwT = 0;
    const p = game.player;
    [p.x, p.z] = [fb.site.field.cx, this.los + 3.2];
    p.heading = game.camYaw = Math.PI;
    this.pkYaw = null;
  },
  // ---- The transition between plays ----
  // What it says: the result (big), the yards, the down and distance next (or how the drive
  // ended), and why (who was open, what went wrong).
  drCardFor(R, yds, first, final) {
    const BIG = { complete: 'COMPLETE', incomplete: 'INCOMPLETE', sack: 'SACKED', run: 'SCRAMBLE', td: 'TOUCHDOWN!', pick: 'INTERCEPTED' };
    let big = BIG[R.kind] || 'PLAY OVER';
    let tone = R.kind === 'complete' || R.kind === 'run' || R.kind === 'td' ? 'good' : 'bad';
    if (first && R.kind !== 'td') {
      big = 'FIRST DOWN!';
      tone = 'gold';
    }
    if (R.kind === 'td') tone = 'gold';
    const yd = R.kind === 'incomplete' || R.kind === 'pick' ? '' : yds > 0 ? `+${yds} YDS` : yds < 0 ? `−${-yds} YDS` : 'NO GAIN';
    let next = '';
    if (R.kind === 'td') next = 'DRIVE OVER · YOU SCORED';
    else if (R.kind === 'pick') next = 'DRIVE OVER';
    else if (final) next = 'TURNOVER ON DOWNS · DRIVE OVER';
    else next = `${this.drDownText()} · BALL ON THE ${this.yardLine(this.los)}`;
    return { big, tone, yd, next, why: R.why || this.drTold(), kind: R.kind };
  },
  drWipeIn(card, final = false) {
    if (!card) return;
    let el = document.getElementById('drwipe');
    if (!el) {
      el = document.createElement('div');
      el.id = 'drwipe';
      el.innerHTML = '<div class="dw-shade"></div><div class="dw-band"><div class="dw-edge"></div><div class="dw-txt"><b class="dw-big"></b><span class="dw-yd"></span><span class="dw-next"></span><small class="dw-why"></small></div></div>';
      document.body.appendChild(el);
    }
    el.querySelector('.dw-big').textContent = card.big;
    el.querySelector('.dw-yd').textContent = card.yd;
    el.querySelector('.dw-next').textContent = card.next;
    el.querySelector('.dw-why').textContent = card.why;
    el.className = `on ${card.tone} k-${card.kind}`;
    void el.offsetWidth;
    el.classList.add('in');
    if (this.dr) this.dr.wipe = { t: 0 };
    // (the drive's over: nothing steps it out, so a timer does)
    if (final) setTimeout(() => el.classList.add('out'), 2100);
  },
  drWipeOut() {
    const el = document.getElementById('drwipe');
    if (el) el.classList.add('out');
    if (this.dr) this.dr.wipe = null;
  },
  drDownText() {
    const toGo = this.first <= this.goal + 0.01 ? 'GOAL' : Math.max(1, Math.round((this.los - this.first) / YD));
    return `${['1ST', '2ND', '3RD', '4TH'][Math.min(3, this.down)]} & ${toGo}`;
  },
  // The play's name for the board: formation, side, concept.
  drPlayName() {
    const D = this.dr;
    const P = DPLAYS[this.playI];
    return `${FORMS[P.form].name} ${D?.side === -1 ? 'Left' : 'Right'} · ${P.name}`;
  },

  drEnd() {
    const game = this.game;
    for (const m of [this.drLines?.los, this.drLines?.first, this.drLines?.dd?.mesh, this.drRing, this.drArt, ...(this.drBadges || [])]) if (m) game.scene.remove(m);
    this.drLines = null;
    this.drRing = null;
    this.drArt = null;
    this.drBadges = [];
    if (this.dr?.gold) this.goldBall(false);
    this.tmeter?.hide();
    this.hfx?.clear();
    this.dr = null;
    if (game.timeScale !== 1) game.timeScale = 1;
  },
};

// How fast he'll go on: running his route, or stopped at its end.
function routeSpeed(w) {
  const r = w.fb.route;
  if (!r || w.fb.leg >= r.length) return 0;
  return 5.6;
}
// Where he'll be s metres further along his route.
function ahead(w, s) {
  const r = w.fb.route;
  let x = w.x;
  let z = w.z;
  if (!r) return [x, z];
  for (let k = w.fb.leg || 0; k < r.length && s > 0; k++) {
    const d = dist(x, z, r[k][0], r[k][1]);
    if (d >= s) return [x + ((r[k][0] - x) * s) / d, z + ((r[k][1] - z) * s) / d];
    s -= d;
    [x, z] = r[k];
  }
  return [x, z];
}

// A flat strip along a path on the turf (x, z points), with an arrowhead at its end.
function ribbon(pts, w) {
  const pos = [];
  const tri = (a, b, c) => pos.push(a[0], 0, a[1], b[0], 0, b[1], c[0], 0, c[1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[i + 1];
    const L = Math.hypot(x1 - x0, z1 - z0) || 1;
    const nx = (-(z1 - z0) / L) * (w / 2);
    const nz = ((x1 - x0) / L) * (w / 2);
    const last = i === pts.length - 2;
    const ex = last ? x1 - ((x1 - x0) / L) * 0.6 : x1;
    const ez = last ? z1 - ((z1 - z0) / L) * 0.6 : z1;
    const a = [x0 + nx, z0 + nz];
    const b = [x0 - nx, z0 - nz];
    const c = [ex + nx, ez + nz];
    const d = [ex - nx, ez - nz];
    tri(a, b, c);
    tri(b, d, c);
    if (last) tri([ex + nx * 3, ez + nz * 3], [ex - nx * 3, ez - nz * 3], [x1, z1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// A read number over a receiver's head: always facing you, the same size on screen.
function badge(text, color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(10,14,20,.82)';
  g.beginPath();
  g.arc(32, 32, 29, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = color;
  g.stroke();
  g.fillStyle = color;
  g.font = 'bold 42px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 32, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true, sizeAttenuation: false }));
  s.renderOrder = 10;
  return s;
}
