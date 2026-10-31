import * as THREE from 'three';
import { dist, rand, pick, clamp, lerpAngle } from './util.js';
import { setShirt } from './character.js';
import { CTYPES } from './fieldmodes.js';
import { CATCHES } from './footballpose.js';
import { HeatFx } from './heatfx.js';
import { PERFECT } from './throwmeter.js';

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
export const SACK_READ = 4.2;
export const DRIVE_KEY = 'crimecity.driveBest'; // (the best drive score, kept like the QB Challenge's)
// The drive's score (every drive from your own 25, so they compare):
//   each pass, up to 100: timing 40 / 25 / 10 for starting the throw in the early, middle or late
//   third of the open man's window (0 too early, too late or into coverage; 25 for a man with
//   real daylight who wasn't the play's), power 20 dead center of the green / 10 in it,
//   accuracy 20 perfect / 10 close, +20 a perfect pass (a bad read keeps a quarter of it);
//   ×1.5 in rhythm, ×2 on fire.
//   the play: +10 caught, +1 a yard, +15 a first down, +100 a touchdown; −20 a sack, −50 a pick.
//   the drive: +10 for every play under 8 on a touchdown drive. // (game seconds after the snap)
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
// Which way each route breaks: 'out' toward his sideline (or an outside release up it), 'in'
// toward the middle (or back inside). His man shaded inside gives up the out-breakers; shaded
// outside, the in-breakers (drFree).
const BREAKS = { flat: 'out', corner: 'out', sail: 'out', fade: 'out', go: 'out', stick: 'out', slant: 'in', in: 'in', dig: 'in', post: 'in', shallow: 'in', seam: 'in', hitch: 'in', curl: 'in' };
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
const _cw = new THREE.Vector3();
const _cl = new THREE.Vector3();
const _cv = new THREE.Vector3();
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
    let best = 0;
    try {
      best = Number(localStorage.getItem(DRIVE_KEY)) || 0;
    } catch {
      // (storage unavailable)
    }
    game.driveCine?.intro({ best, spot: this.drSpot(), los: this.los, cx: this.fb.site.field.cx, squad: this.bench?.ballName || 'their', from: this.drFromText(), bet: this.bet, play: this.drPlayName() }, () => {
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
    if (newCov || !D.cov) {
      // (the coverage, and a third of the time it shows you another one before the snap and
      // rotates into the real one after it; each back's leverage, inside or outside his man)
      D.cov = pick(['man', 'c3', 'c2']);
      D.show = Math.random() < 0.34 ? pick(['man', 'c3', 'c2'].filter((c) => c !== D.cov)) : D.cov;
      D.lev = [0, 1, 2].map(() => (Math.random() < 0.5 ? 'in' : 'out'));
    }
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
    // The backs: one on each receiver, lined up by the coverage they're showing, shaded to
    // their leverage (inside or outside him, a good metre: you can see it); after the snap a
    // disguise rotates into the real one (drSnap).
    fb.dbs.slice(0, 3).forEach((d, k) => {
      d.fb.home = this.drDBSpot(k, D.show);
      d.fb.rot = null;
      d.fb.mark = fb.wrs[k];
    });
    // Who's open: drFree.
    this.drFree();
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

  // Where back k lines up in a coverage: man is pressed up (off a step on a slot), Cover 3 has
  // the corners 5 yards off and the middle man 7 deep, Cover 2 the corners up at 3 and the
  // safeties 7.5 deep; always shaded to his leverage.
  drDBSpot(k, cov) {
    const D = this.dr;
    const F = this.fb.site.field;
    const s = D.slots[k];
    const out = Math.sign(s.x - F.cx) || D.side;
    const wide = Math.abs(s.x - F.cx) > 9;
    const lev = D.lev[k] === 'out' ? 1 : -1;
    let x = s.x + out * lev * 1.1;
    let z;
    if (cov === 'man') z = this.los - (s.z > this.los + 0.5 ? 3.2 : 1.2);
    else if (cov === 'c3') z = this.los - (wide ? 5 : 7) * YD;
    else z = this.los - (wide ? 3 : 7.5) * YD;
    if (cov !== 'man' && !wide) x = s.x + out * lev * 1.4; // (a deep man: a bit wider off him)
    return [clamp(x, F.x0 + 1, F.x1 - 1), z];
  },
  // Who comes open this play: whoever's route breaks away from his man's leverage (BREAKS; you
  // can see the shade before the snap), and if that's more than one, or nobody, the concept's
  // answer to the real coverage (DPLAYS beat); still tied, at random. And the defense learns: a play you've completed twice this drive, they
  // sit on the man who beat them with it last (D.sitOn: covered, and jumped if you go there),
  // and the next man in the read comes open instead.
  drFree() {
    const D = this.dr;
    const fb = this.fb;
    const P = DPLAYS[this.playI];
    const seen = D.seen?.[this.playI];
    D.sitOn = seen && seen.n >= 2 ? seen.last : null;
    const score = [0, 1, 2].map((k) => {
      if (k === D.sitOn) return -9;
      let v = 0;
      if (P.beat[D.cov].includes(k)) v += 1;
      const br = BREAKS[P.routes[k]];
      if ((br === 'out' && D.lev[k] === 'in') || (br === 'in' && D.lev[k] === 'out')) v += 2;
      return v;
    });
    if (D.sitOn != null) {
      // (the next read after the man they're sitting on)
      const i = P.read.indexOf(D.sitOn);
      score[P.read[(i + 1) % 3]] += 5;
    }
    const best = Math.max(...score);
    D.openK = pick([0, 1, 2].filter((k) => score[k] === best));
    D.openW = fb.wrs[D.openK];
    D.levBeat = (() => {
      const br = BREAKS[P.routes[D.openK]];
      return (br === 'out' && D.lev[D.openK] === 'in') || (br === 'in' && D.lev[D.openK] === 'out');
    })();
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
    // (a disguise: at the snap the backs rotate into the coverage they're really in)
    if (D.show !== D.cov) fb.dbs.slice(0, 3).forEach((d, k) => (d.fb.rot = this.drDBSpot(k, D.cov)));
    D.camT = 0; // (the camera's move in starts now: drStep)
    this.tip = null;
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
    // (the read and the timing: where in his window you started it)
    let timing = 0;
    let tag = why === 'early' ? 'TOO EARLY' : why === 'late' ? 'TOO LATE' : 'INTO COVERAGE';
    if (why === 'open' && w === D.openW && D.openAt != null) {
      const k = (t - (D.openAt - 0.15)) / Math.max(0.2, D.closeAt - (D.openAt - 0.15)); // (from his cut to his man closing)
      [timing, tag] = k < 1 / 3 ? [40, 'EARLY READ'] : k < 2 / 3 ? [25, 'ON TIME'] : [10, 'LATE READ'];
    } else if (why === 'open') [timing, tag] = [25, 'GOOD READ'];
    D.grade = { timing, tag };
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
    // (how high it gets to him: on the power it's chest high; short, it dies low at his knees;
    // long, it sails up over his head. That picks his catch: drCatchKind)
    const ty = clamp(TY.h + clamp(((pw - need) / this.winFor(kind, need)) * 0.5, -1, 0.9) + rand(-0.12, 0.12), 0.45, 2.3);
    fb.launch(tx, ty, tz, TY.T(dist(px, pz, tx, tz)), 'pass', w);
    b.style = kind === 'lob' ? 'lob' : 'bullet';
    b.throwKind = kind;
    this.throwT = 0.26;
    this.state = 'air';
    D.follow = { pos: null, look: null, w, h: w.heading }; // (the camera takes the ball to him, then him: drCamFollow)
    D.perfect = this.meterResult(D, kind, pw, need, acc, tapN);
    if (D.perfect) this.goldBall(true);
    // (the pass's points: the read and timing at the press, the power and the tap now)
    const W = this.winFor(kind, need);
    const po = Math.abs(pw - need);
    const power = po <= W * 0.5 ? 20 : po <= W ? 10 : 0;
    const aim = tapN != null && Math.abs(acc) <= PERFECT ? 20 : tapN != null && Math.abs(acc) <= 0.1 ? 10 : 0;
    const G = D.grade || { timing: 0, tag: 'INTO COVERAGE' };
    const heat = this.heatSt();
    const mult = heat === 'fire' ? 2 : heat === 'rhythm' ? 1.5 : 1;
    // (a bad read, into coverage or out of his window, keeps only a quarter: the throw's no good
    // if it's to the wrong man)
    const base = (G.timing + power + aim + (D.perfect ? 20 : 0)) * (G.timing > 0 ? 1 : 0.25);
    D.cur = { pts: Math.round(base * mult), tags: [G.tag, D.perfect ? 'PERFECT PASS' : '', mult > 1 ? `×${mult} ${heat === 'fire' ? 'ON FIRE' : 'IN RHYTHM'}` : ''].filter(Boolean) };
    D.passes = (D.passes || 0) + 1;
  },

  // ---- Every frame ----
  drStep(dt) {
    const D = this.dr;
    if (!D) return;
    if (D.introAt != null && this.game.time >= D.introAt) this.drIntro();
    if (this.state !== 'line') D.camT = (D.camT || 0) + dt / (this.game.timeScale || 1); // (real seconds: the slow motion doesn't stretch the camera's move)
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
    if (f.rot && this.t < 0.7 && sep <= 0.3) {
      // (the disguise rotating: rolling down / bailing out to where the real coverage has him)
      tx = f.rot[0];
      tz = f.rot[1] - (D.cov === 'man' ? 0 : 1.5);
    } else if (D.cov !== 'man' && this.t < 0.12) {
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
    // (out of bounds: over the sideline or past the back of the end zone, it doesn't count)
    const F0 = fb.site.field;
    const outB = here && (w.x < F0.x0 || w.x > F0.x1 || w.z < F0.z0 || b.x < F0.x0 - 0.3 || b.x > F0.x1 + 0.3 || b.z < F0.z0 - 0.3);
    const db = fb.dbs.find((q) => q.fb.mark === w);
    const dD = db ? dist(db.x, db.z, b.x, b.z) : 99;
    const L = D.lock;
    const open = !!(L && L.w === w && L.open);
    const told = this.drTold();
    if (outB) {
      b.mode = 'loose';
      b.vx = rand(-1, 1);
      b.vz = rand(-1, 1);
      b.vy = -1;
      this.drRes = { kind: 'incomplete', why: `Out of bounds · ${told}` };
      this.heatMiss();
      return this.over(null);
    }
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
      const sat = D.sitOn != null && w === fb.wrs[D.sitOn]; // (they were sitting on him: jumped)
      if (dD < 2.2 && Math.random() < (b.throwKind === 'bullet' ? 0.4 : b.throwKind === 'lob' ? 0.38 : 0.32) * (sat ? 1.6 : 1)) {
        // (picked: how depends on the ball and him (drPickKind), then he runs it back; the drive
        // ends when he's done)
        this.heatMiss();
        const t0 = game.time;
        const kind = this.drPickKind(db, w, b, dW, dD);
        db.fb.runTo = [clamp(db.x + rand(-3, 3), fb.site.field.x0 + 1, fb.site.field.x1 - 1), Math.min(fb.site.field.z1 - 2, db.z + 16)];
        if (kind === 'tip') {
          // (off your man's hands: it pops up, he's under it and takes it out of the air)
          b.mode = 'loose';
          b.holder = null;
          b.vx = (db.x - b.x) * 1.2;
          b.vz = (db.z - b.z) * 1.2;
          b.vy = 3.4;
          b.y = Math.max(b.y, 1.6);
          this.tip = { who: db, at: t0 + 0.55 };
          if (here) w.fb.act = { kind: 'denied', t0, T: 0.7 };
        } else {
          fb.hold(db);
          if (kind === 'dive') {
            // (laid out for it: down where he lands, no return)
            db.heading = Math.atan2(b.x - db.x, b.z - db.z);
            Object.assign(db.fb, { dive: true, diveTo: [b.x, b.z], downT: 1.3, downLen: 1.3, fall: null, runTo: null });
          } else {
            if (kind !== 'pickRun' && kind !== 'pickShoulder') db.heading = Math.atan2(b.x - db.x, b.z - db.z);
            const lx = Math.cos(db.heading);
            const lz = -Math.sin(db.heading);
            const T = { pick: 0.9, pickRun: 0.7, pickShoulder: 0.9, pickScoop: 0.8 }[kind];
            db.fb.act = { kind, t0, T, side: (b.p0[0] - db.x) * lx + (b.p0[2] - db.z) * lz >= 0 ? 1 : -1 };
            if (kind === 'pickRun' || kind === 'pickShoulder') {
              // (caught on the run: a stride or two on the way he was going if that's toward your
              // end, then he turns it back upfield, the other way, drifting the side he was going)
              const F = fb.site.field;
              const hx = Math.sin(db.heading);
              const hz = Math.cos(db.heading);
              db.fb.runVia = hz < 0.3 ? [clamp(db.x + hx * 2, F.x0 + 1, F.x1 - 1), db.z + hz * 2] : null;
              db.fb.runTo = [clamp(db.x + hx * 6, F.x0 + 1, F.x1 - 1), Math.min(F.z1 - 2, db.z + 16)];
            }
          }
          if (here) w.fb.act = { kind: 'denied', t0, T: 0.7 };
        }
        this.drPickKindNow = kind;
        fb.phase = 'run';
        this.state = 'pick';
        this.t = 0;
        this.drPickWhy = `${why} · ${told}`;
        game.hud.toast('INTERCEPTED!', '#ff8080');
        return;
      }
      if (db && dD < 2.2 && dW < 1.2 && Math.random() < 0.2) {
        // (tipped: the back gets a hand on it, it pops up and your man stays with it and takes it
        // out of the air: drTipStep)
        const t0 = game.time;
        const lx = Math.cos(db.heading);
        const lz = -Math.sin(db.heading);
        db.fb.act = { kind: 'swat', t0, T: 0.7, side: (b.x - db.x) * lx + (b.z - db.z) * lz >= 0 ? 1 : -1 };
        db.fb.relT = 0;
        w.fb.act = null;
        b.mode = 'loose';
        b.holder = null;
        b.vx = (w.x + Math.sin(w.heading) * 1.2 - b.x) * 1.4;
        b.vz = (w.z + Math.cos(w.heading) * 1.2 - b.z) * 1.4;
        b.vy = 3.4;
        b.y = Math.max(b.y, 1.6);
        this.tip = { who: w, at: t0 + 0.55, catch: true };
        this.state = 'tip';
        this.t = 0;
        game.hud.toast('TIPPED!', '#ffd166');
        return;
      }
      if (dW < 1.2 && Math.random() < (D.perfect ? 0.35 : 0.15)) return this.drCaught(w, false, 'Contested catch!');
      if (db && dD < 2.5) {
        // (broken up: he goes up and swats it, it pops away off his hand; your man's left reaching)
        db.fb.relT = 0;
        const t0 = game.time;
        const lx = Math.cos(db.heading);
        const lz = -Math.sin(db.heading);
        db.fb.act = { kind: 'swat', t0, T: 0.7, side: (b.x - db.x) * lx + (b.z - db.z) * lz >= 0 ? 1 : -1 };
        if (here) w.fb.act = { kind: 'denied', t0, T: 0.7 };
        fail(`Broken up. ${why}`);
        const ux = b.x - db.x;
        const uz = b.z - db.z;
        const L = Math.hypot(ux, uz) || 1;
        b.vx = (ux / L) * 3.5 + rand(-1, 1);
        b.vz = (uz / L) * 3.5 + rand(-1, 1);
        b.vy = 3.2;
        b.y = Math.max(b.y, 2.0);
        return;
      }
      return fail(dW < 2.6 ? `Incomplete. ${why}` : 'Incomplete');
    }
    if (w?.fb?.reachBack) dW = Math.max(0, dW - 0.5); // (reaching back: a longer grab, an arm's length behind him)
    const dove = dW >= 0.95 && dW < 2.6 && fb.diveFor(w, b.x, b.z);
    const pr = dW < 1.0 ? 0.97 : dW < 1.8 ? 0.82 : dW < 2.6 ? 0.5 : 0;
    if (Math.random() < (D.perfect && dW < 2.6 ? 1 : pr)) return this.drCaught(w, dove, dove ? 'DIVING CATCH!' : D.perfect ? 'Dropped in the bucket!' : 'Caught!');
    const off = b.p1 ? (this.los - b.p1[2]) - (this.los - w.z) : 0;
    fail(dW < 2.6 ? 'Off his hands. Incomplete' : off > 1.5 ? 'Overthrown' : off < -1.5 ? 'Underthrown' : 'Off target');
    if (dW < 1.4) {
      b.vy = 2.4; // (off his hands: it pops up off them)
      if (here) w.fb.act = { kind: 'denied', t0: game.time, T: 0.6 };
    }
  },
  drCaught(w, dove, text) {
    const game = this.game;
    const fb = this.fb;
    const b = fb.ball;
    fb.hold(w);
    this.drRes = { kind: 'complete', why: this.drTold() };
    this.dr.caught = (this.dr.caught || 0) + 1;
    // (the defense remembers what beat it: drFree)
    const D0 = this.dr;
    D0.seen = D0.seen || {};
    const rec = (D0.seen[this.playI] = D0.seen[this.playI] || { n: 0, last: null });
    rec.n++;
    rec.last = fb.wrs.indexOf(w);
    // (how he takes it: the catch he went up/down/round for as it came (football.js, drCatchKind),
    // or into the chest first, then the tuck)
    const a = w.fb.act;
    const going = a && CATCHES[a.kind] && game.time - a.t0 < a.T;
    if (!dove && !going) w.fb.act = { kind: 'secure', t0: game.time, T: 0.3 };
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
    const R = ROUTES[D.play.routes[D.openK]].name;
    const cov = D.show !== D.cov ? `${COVS[D.cov]} (showed ${COVS[D.show]})` : COVS[D.cov];
    const why = D.sitOn != null ? `they sat on the ${ROUTES[D.play.routes[D.sitOn]].name}, ` : D.levBeat ? `his man was shaded ${D.lev[D.openK] === 'in' ? 'inside' : 'outside'}, ` : '';
    return `vs ${cov}: ${why}the ${R} was open`;
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
      // (the man you're on: bigger, bobbing, a beat of pulse; the rest smaller and dimmer)
      const bob = sel ? Math.sin(game.time * 5) * 0.06 : 0;
      s.position.set(w.x, 2.15 + bob, w.z);
      const base = sel ? 0.11 : on ? 0.08 : 0.07;
      s.scale.set(base * (1 + (sel ? Math.sin(game.time * 9) * 0.04 : 0)), base * (152 / 128) * (1 + (sel ? Math.sin(game.time * 9) * 0.04 : 0)), 1);
      s.material.opacity = on || sel ? 1 : 0.55;
    }
    const sk = on ? D.scanList?.[D.scanI] : null;
    const sw = !on && reading ? this.drSelW() : sk != null ? fb.wrs[sk] : null;
    this.drRing.visible = !!sw && !cine;
    if (sw) {
      this.drRing.position.set(sw.x, 0.075, sw.z);
      this.drRing.scale.setScalar(1 + Math.sin(game.time * 7) * 0.07);
    }
    this.arrow.visible = false; // (the badge's own pointer marks him now)
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
      Object.assign(q.fb, { adjV: null, reachBack: 0, route: null, runTo: null, runVia: null, downT: 0, pickT: 0, dive: false, beatT: 0, relT: 0, throwT: 0, hurry: false, huddle: null });
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
  // A tackle's puff of turf (football.js tackle): a few clods and a little dust out of the hit.
  tackleDust(x, z) {
    const fx = (this.hfx ||= new HeatFx(this.game.scene));
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      fx.spawn('smoke', x + Math.cos(a) * 0.2, 0.15, z + Math.sin(a) * 0.2, { T: 0.6 + Math.random() * 0.4, vx: Math.cos(a) * 1.6, vy: 0.5 + Math.random() * 0.6, vz: Math.sin(a) * 1.6, s0: 0.25, s1: 0.8, a0: 0.55, color: 0xb9a77f });
    }
  },
  // Which interception (drArrived): a tip off your man's hands; a diving one for a ball just out of
  // reach; a scoop for a low one; over the shoulder for a deep ball he's running under the same way;
  // jumping the route for a flat one he's in front of and moving on; else high-pointing it.
  drPickKind(db, w, b, dW, dD) {
    const L = Math.hypot(b.p1[0] - b.p0[0], b.p1[2] - b.p0[2]) || 1;
    const ux = (b.p1[0] - b.p0[0]) / L;
    const uz = (b.p1[2] - b.p0[2]) / L;
    const dir = Math.sin(db.heading) * ux + Math.cos(db.heading) * uz; // (+: he's running the ball's way)
    const moving = (db.speed || 0) > 2.5;
    if (w && dW < 0.9 && Math.random() < 0.45) return 'tip';
    if (dD > 1.1 && dD < 2.4) return 'dive';
    if (b.y < 0.8) return 'pickScoop';
    if (moving && dir > 0.55 && L > 14) return 'pickShoulder';
    if (moving && b.style !== 'lob' && b.y < 1.7) return 'pickRun';
    return 'pick';
  },
  // How your receiver takes it (football.js starts it CATCHES[kind].lead s before it gets there,
  // so he's at the top, in stride or round as it arrives): a low one he scoops; a deep one coming
  // over him as he runs away (a deep ball or a lob), over the shoulder; one sailing high, he high-points it; on the move
  // otherwise, he takes it in stride out in front; standing, a plain catch at the chest (null).
  // (diving for one out of reach, reaching back for one behind him and a tip he stays with are
  // decided as it gets there: drArrived.) The same catches as the backs' picks (drPickKind).
  drCatchKind(w, b) {
    const y = b.p1[1];
    const L = Math.hypot(b.p1[0] - b.p0[0], b.p1[2] - b.p0[2]) || 1;
    const ux = (b.p1[0] - b.p0[0]) / L;
    const uz = (b.p1[2] - b.p0[2]) / L;
    const dir = Math.sin(w.heading) * ux + Math.cos(w.heading) * uz; // (+: running the ball's way)
    const moving = (w.fb.adjV ?? w.speed ?? 0) > 2.5;
    if (y < 0.95) return 'pickScoop';
    if (moving && dir > 0.55 && (L > 24 || (b.style === 'lob' && L > 14))) return 'pickShoulder';
    if (y > 1.6) return 'pick';
    if (moving) return 'pickRun';
    return null;
  },
  // A tip your man stays with (the 'tip' state): it comes down to him, a snatch up high.
  drTipStep() {
    const T = this.tip;
    if (!T || this.game.time < T.at) return;
    this.tip = null;
    const w = T.who;
    if (!this.fb.players.includes(w)) return this.over(null);
    w.fb.act = { kind: 'pick', t0: this.game.time - 0.35, T: 0.9 };
    this.drCaught(w, false, 'TIPPED... AND CAUGHT!');
  },
  // The pick run back (gridiron phase): done when he's there or down, then the card and the end.
  drPickStep() {
    const fb = this.fb;
    const b = fb.ball;
    const T = this.tip;
    if (T && this.game.time >= T.at) {
      // (the tip comes down to him: a quick grab up high)
      this.tip = null;
      fb.hold(T.who);
      T.who.fb.act = { kind: 'pick', t0: this.game.time - 0.35, T: 0.9 };
    }
    if (this.tip) return;
    const h = b.holder;
    const dove = this.drPickKindNow === 'dive';
    const done = dove ? this.t > 1.6 : this.t > 2.6 || !h || h === 'you' || (h.fb?.runTo && dist(h.x, h.z, ...h.fb.runTo) < 0.8);
    if (!done) return;
    const card = this.drCardFor({ kind: 'pick', why: this.drPickWhy || '' }, 0, false, true);
    this.drScorePlay('pick', 0, false, card, true);
    this.drWipeIn(card, true);
    this.end('pick');
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
  // The play's points (over() / touchdown / a pick): the pass's own, then what it got you; onto
  // the card and the drive's total.
  drScorePlay(kind, yds, first, card, td = false) {
    const D = this.dr;
    if (!D) return;
    const pass = D.cur?.pts || 0;
    const tags = D.cur?.tags ? [...D.cur.tags] : [];
    let pts = pass;
    if (kind === 'complete' || kind === 'run') pts += (kind === 'complete' && D.cur ? 10 : 0) + Math.max(0, yds);
    if (first) pts += 15;
    if (td || kind === 'td') pts += 100;
    if (kind === 'sack') pts -= 20;
    if (kind === 'pick') pts -= 50;
    D.cur = null;
    D.grade = null;
    D.plays = (D.plays || 0) + 1;
    D.score = (D.score || 0) + pts;
    if (pass > (D.bestThrow || 0)) D.bestThrow = pass;
    D.log = [...(D.log || []), pts];
    if (card) {
      card.pts = pts;
      card.tags = tags;
    }
  },
  // The drive's over (end()): the finish bonus, the record, and the final screen once the last
  // transition's gone by.
  drFinal(how) {
    const game = this.game;
    const D = this.dr;
    if (!D || how === 'forfeit' || how === 'off' || how === 'x') return;
    const plays = D.plays || 0;
    const bonus = how === 'td' ? Math.max(0, 8 - plays) * 10 : 0;
    D.score = (D.score || 0) + bonus;
    let best = 0;
    try {
      best = Number(localStorage.getItem(DRIVE_KEY)) || 0;
    } catch {
      // (storage unavailable)
    }
    const newBest = D.score > best;
    if (newBest) {
      try {
        localStorage.setItem(DRIVE_KEY, String(D.score));
      } catch {
        // (storage unavailable)
      }
    }
    // (who the final screen's on: whoever scored, doing the Griddy; after a turnover, you, gutted)
    const dancer = how === 'td' && this.tdBy && this.tdBy !== 'you' ? this.tdBy : 'you';
    const info = { score: D.score, best, newBest, how, plays, bonus, passes: D.passes || 0, caught: D.caught || 0, bestThrow: D.bestThrow || 0, dancer, emote: how === 'td' ? 'griddy' : 'upset' };
    this.again = game.time + 9; // (no asking for another game till the final screen's been and gone)
    setTimeout(() => {
      if (game.courtMenu?.open || this.active || game.driveCine?.open) return; // (something else up already: no final screen over it)
      if (dancer !== 'you') {
        if (!this.fb.players.includes(dancer)) info.dancer = 'you';
        else dancer.fb.dance = { t0: game.time };
      }
      game.driveCine?.outro(info, () => {
        this.again = game.time + 0.8;
        if (dancer !== 'you' && dancer.fb) dancer.fb.dance = null;
      });
    }, 2300);
  },
  drWipeIn(card, final = false) {
    if (!card) return;
    let el = document.getElementById('drwipe');
    if (!el) {
      el = document.createElement('div');
      el.id = 'drwipe';
      el.innerHTML = '<div class="dw-shade"></div><div class="dw-band"><div class="dw-edge"></div><div class="dw-txt"><b class="dw-big"></b><span class="dw-yd"></span><span class="dw-pts"></span><span class="dw-next"></span><small class="dw-why"></small></div></div>';
      document.body.appendChild(el);
    }
    el.querySelector('.dw-big').textContent = card.big;
    el.querySelector('.dw-yd').textContent = card.yd;
    el.querySelector('.dw-pts').textContent = card.pts != null ? [`${card.pts >= 0 ? '+' : '−'}${Math.abs(card.pts)} PTS`, ...(card.tags || [])].join(' · ') : '';
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
    if (this.dr) {
      this.dr.wipe = null;
      this.dr.wipeGone = this.game.time; // (no hike till it's off: gridiron.js)
    }
  },
  // The drive's camera shot (fieldmodes.js camShot → main.js): wide at the line, easing back in
  // over your shoulder on the drive curve over CAM_MOVE real seconds from the snap.
  drCamShot() {
    const D = this.dr;
    const k = this.state === 'line' ? 0 : driveCurve((D?.camT || 0) / CAM_MOVE);
    const sh = {};
    for (const key of Object.keys(SHOT_NEAR)) sh[key] = SHOT_WIDE[key] + (SHOT_NEAR[key] - SHOT_WIDE[key]) * k;
    sh.look = null;
    sh.snapFov = true; // (the fov follows the curve as it is, not eased again)
    return sh;
  },
  // The follow camera (the QB Challenge's, main.js camOverride): from the throw it chases the ball
  // from behind and above all the way to him, then rides behind him with it till he's down; an
  // incompletion, it holds and watches the ball. Every move is eased from where the camera is.
  // It lets go under the transition, when everyone's lined up again.
  drCamFollow(dt) {
    const game = this.game;
    const D = this.endFollow ? { follow: this.endFollow } : this.dr; // (the drive's over: still on the scorer or the pick till the final screen)
    const F = D?.follow;
    if (this.endFollow && (game.time > this.endFollow.until || game.driveCine?.open)) {
      this.endFollow = null;
      return null;
    }
    if (!F || (!this.endFollow && (this.state === 'line' || this.state === 'play'))) {
      if (D) D.follow = null;
      return null;
    }
    const b = this.fb.ball;
    const w = F.w;
    if (!F.pos) {
      F.pos = game.camera.position.clone();
      const fwd = new THREE.Vector3();
      game.camera.getWorldDirection(fwd);
      F.look = F.pos.clone().add(fwd.multiplyScalar(10));
    }
    let want;
    let look;
    let rate = 6;
    if (b.mode === 'flight' && b.kind === 'pass') {
      // (behind the ball and a little to the side, looking on down its line, onto him as it gets there)
      const L = Math.hypot(b.p1[0] - b.p0[0], b.p1[2] - b.p0[2]) || 1;
      const ux = (b.p1[0] - b.p0[0]) / L;
      const uz = (b.p1[2] - b.p0[2]) / L;
      // (rising only partway with a high ball, so he stays in the picture with it)
      want = _cw.set(b.x - ux * 3.6 + uz * 1.0, Math.max(1.6, 1.3 + b.y * 0.45), b.z - uz * 3.6 - ux * 1.0);
      const near = clamp(1 - (b.T - b.t) / 0.6, 0, 1);
      look = _cl.set(b.x + ux * 6, b.y * 0.5 + 0.6, b.z + uz * 6).lerp(_cv.set(w.x, 1.2, w.z), 0.35 + near * 0.55);
    } else if (b.holder && b.holder !== 'you' && this.fb.players.includes(b.holder)) {
      // (whoever's got it: him after the catch, a back after a pick)
      const h = b.holder;
      if (h !== F.w) {
        F.w = h;
        F.h = h.heading;
      }
      if (h.speed > 0.5) F.h = F.h + Math.atan2(Math.sin(h.heading - F.h), Math.cos(h.heading - F.h)) * Math.min(1, dt * 3);
      const fx = Math.sin(F.h);
      const fz = Math.cos(F.h);
      want = _cw.set(h.x - fx * 4.6, 2.3, h.z - fz * 4.6);
      look = _cl.set(h.x + fx * 5, 1.1, h.z + fz * 5);
      rate = 4;
    } else {
      // (incomplete or knocked down: hold there, watching the ball)
      want = F.pos;
      look = _cl.set(b.x, Math.max(0.4, b.y), b.z);
      rate = 3;
    }
    const a = 1 - Math.exp(-dt * rate);
    if (want !== F.pos) F.pos.lerp(want, a);
    F.look.lerp(look, Math.min(1, a * 1.5));
    return { pos: F.pos, look: F.look };
  },
  drDownText() {
    const toGo = this.first <= this.goal + 0.01 ? 'GOAL' : Math.max(1, Math.round((this.los - this.first) / YD));
    return `${['1ST', '2ND', '3RD', '4TH'][Math.min(3, this.down)]} & ${toGo}`;
  },
  // The play's name for the board: formation, side, concept.
  drPlayName() {
    const D = this.dr;
    const P = DPLAYS[this.playI];
    const seen = D?.seen?.[this.playI]?.n >= 2 ? " · THEY'VE SEEN IT" : '';
    return `${FORMS[P.form].name} ${D?.side === -1 ? 'Left' : 'Right'} · ${P.name}${seen}`;
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

// The camera's ease from the wide pre-snap shot back in over your shoulder, over CAM_MOVE real
// seconds from the snap: a cubic Bezier from (0,0) to (1,1), the first handle straight up to
// (0, 0.646), the second back to (0.638, 0.996) (x: how far through the move, 0..1 → y: how far
// the camera's come). Quick off the snap, then a long settle.
export const CAM_MOVE = 2.0;
const CBX = [0, 0, 0.6379928, 1];
const CBY = [0, 0.645614, 0.9964912, 1];
export function driveCurve(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bz = (p, t) => {
    const u = 1 - t;
    return u * u * u * p[0] + 3 * u * u * t * p[1] + 3 * u * t * t * p[2] + t * t * t * p[3];
  };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (bz(CBX, m) < x) lo = m;
    else hi = m;
  }
  return bz(CBY, (lo + hi) / 2);
}
const SHOT_NEAR = { back: 3.7, up: 0.45, shoulder: 0.85, fov: 58 }; // (the QB Challenge's, over your shoulder)
const SHOT_WIDE = { back: 8.7, up: 1.5, shoulder: 0.4, fov: 67 }; // (pre-snap: 5 m further back, up a bit, wider: half way to the old wide shot)

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
  // (a glossy disc in the read color, a bold white number with a dark edge, a ring of light
  // round it and a little pointer down to his head; drawn at 2x so it stays crisp)
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 152;
  const g = cv.getContext('2d');
  const cx = 64;
  const cy = 62;
  // (the glow)
  const glow = g.createRadialGradient(cx, cy, 30, cx, cy, 62);
  glow.addColorStop(0, color);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = 0.45;
  g.fillStyle = glow;
  g.beginPath();
  g.arc(cx, cy, 62, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  // (the pointer)
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(cx - 13, cy + 40);
  g.lineTo(cx + 13, cy + 40);
  g.lineTo(cx, cy + 62);
  g.closePath();
  g.fill();
  // (the disc: dark rim, then the color with a highlight across the top)
  g.fillStyle = '#0b1018';
  g.beginPath();
  g.arc(cx, cy, 47, 0, Math.PI * 2);
  g.fill();
  const body = g.createLinearGradient(0, cy - 42, 0, cy + 42);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.18, color);
  body.addColorStop(1, shade(color, 0.55));
  g.fillStyle = body;
  g.beginPath();
  g.arc(cx, cy, 41, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,.22)';
  g.beginPath();
  g.ellipse(cx, cy - 20, 30, 15, 0, 0, Math.PI * 2);
  g.fill();
  // (the number)
  g.font = '900 64px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 9;
  g.strokeStyle = 'rgba(8,12,20,.9)';
  g.strokeText(text, cx, cy + 3);
  g.fillStyle = '#ffffff';
  g.fillText(text, cx, cy + 3);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.center.set(0.5, 0.1); // (anchored at the pointer's tip, just over his head)
  s.renderOrder = 10;
  return s;
}
// A color darkened (k 0..1 of it kept).
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const gg = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${gg},${b})`;
}
