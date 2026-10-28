import * as THREE from 'three';
import { dist, rand, pick } from './util.js';
import { setShirt } from './character.js';
import { throwPose, layoutPose, qbStance } from './football.js';

// Quarterback a drive at Harbor Field (football.js runs the passing drill there).
// - Join: walk onto the field while they're lining up; their quarterback offers you the ball.
//   E / D-pad ↑ / USE plays; Q / ○ changes the bet ($0-$500: score on the drive and you take
//   his money too). He steps off to the sideline and watches.
// - The drive: from the 40, four downs to make 10 yards, until you score or lose it.
//   Get behind the line and ✕ / E hikes it. The receivers run their routes with the backs on
//   them. Madden's way: each receiver has a button over his head (□ ✕ ○ △; keyboard 1-4; the
//   same buttons on a phone). Tap it for a bullet (fast and flat: a back near the line of it can
//   jump it), hold it for a lob (high and slower: over the top, he runs under it). The left stick
//   at the release leads him that way. With a mouse you can also look at a man and click (tap /
//   hold the same way). On the controller R2 sprints.
//   Caught: he runs till he's brought down. Dropped or batted away: incomplete. Thrown into
//   coverage: it can be picked off (the drive's over).
//   Hold it too long and you're sacked (5 seconds); run past the line and you're a runner
//   (no throwing from there) till a back brings you down.
// - Walk off the field, get in a car or have the police after you and you forfeit. If they
//   scatter (trouble nearby), it's called off and the bet comes back.
const YD = 0.9144;
const BETS = [0, 50, 100, 250, 500];
const NAMES = ['Coach', 'Big Lou', 'Tre', 'Marcus', 'Deebo', 'Junior', 'Bam'];
const SACK = 4.5;
const DOWNS = ['1st', '2nd', '3rd', '4th'];
// Asking to play, and their quarterback's answers (one of each, at random).
const ASKS = ["Y'all need a QB?", 'Can I throw some?', "Y'all need one more?", 'Let me run one', "What's up, y'all playing?", 'I got an arm, let me in'];
const REPLIES = ['Bet. You got an arm?', 'Yeah, what you wanna run?', "Aight, let's see it. Pick it.", "Say less. What we doing?", "We need a QB anyway. What's it gon' be?", 'Pull up. How you want it?'];
// The receivers' buttons (in the order they line up), their colors, and the keyboard keys.
const ICONS = ['□', '✕', '○', '△', 'R1'];
const ICON_COLORS = ['#ff79c6', '#6fa8ff', '#ff6b6b', '#3ddc97', '#ffd23f'];
const BULLET = 0.22; // (held longer than this it's a lob)
// The playbook (pick one at the line: L1 / R1, keyboard Z / X, PLAY on a phone).
// routes: one per receiver in order (null: he picks); run: a handoff to the back (dive: up the
// middle, toss: outside); pa: play action (a fake handoff first, the defense bites).
const PLAYS = [ // (L1 / R1 on the controller)
  { name: 'Freelance', routes: [null, null, null] },
  { name: 'Slants', routes: ['slant', 'slant', 'slant'] },
  { name: 'Four Verticals', routes: ['go', 'go', 'go'] },
  { name: 'Curls', routes: ['curl', 'curl', 'curl'] },
  { name: 'Smash', routes: ['curl', 'post', 'out'] },
  { name: 'HB Dive', routes: ['go', 'go', 'go'], run: 'dive' },
  { name: 'HB Toss', routes: ['out', 'out', 'out'], run: 'toss' },
  { name: 'PA Deep', routes: ['go', 'post', 'go'], pa: true },
];

export class Gridiron {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.betI = 2;
    this.meter = null;
  }

  get fb() {
    return this.game.football;
  }

  onField(x, z, pad = 0) {
    const F = this.fb.site.field;
    return x > F.x0 - 3 - pad && x < F.x1 + 3 + pad && z > F.z0 - 3 - pad && z < F.z1 + 3 + pad;
  }

  // ---- Joining (main.js handleInteractions, on foot) ----
  offer(a) {
    const game = this.game;
    const fb = this.fb;
    if (this.active || game.player.vehicle || game.stars > 0 || game.stop || !fb?.ball || fb.match || game.time < (this.again || 0)) return;
    const qb = fb.qb;
    const [px, pz] = game.player.pos();
    if (!qb || !qb.fb || !fb.wrs.length || !['reset', 'set'].includes(fb.phase) || !this.onField(px, pz) || dist(px, pz, qb.x, qb.z) > 9) {
      if (!this.talk?.open) this.talk = null; // (walked off before he answered)
      return;
    }
    if (!qb.ballName) qb.ballName = pick(qb.female ? ['Kiki', 'Nae', 'Jada', 'Shay'] : NAMES);
    // You ask; their quarterback answers; the menu comes up (the bet, which drive, or walk away).
    const T = this.talk;
    if (T) {
      if (!T.open && game.time >= T.at) {
        T.open = true;
        game.hud.toast(`${qb.ballName}: "${pick(REPLIES)}"`, '#ffd23f');
        this.menu(qb);
      }
      if (!T.open) game.prompt = '';
      return;
    }
    if (!this.askLine) this.askLine = pick(ASKS);
    game.prompt = `${game.input.label('interact')}: "${this.askLine}"`;
    if (a.interactHeld && !game.interactWasHeld) {
      game.hud.toast(`You: "${this.askLine}"`, '#ffffff');
      this.talk = { at: game.time + 0.9, open: false };
      this.askLine = null; // (something different next time)
    }
  }

  // The menu (the shop menu: the game waits while it's up).
  menu(qb) {
    const game = this.game;
    const shops = game.shops;
    const betNow = () => {
      let bet = BETS[this.betI];
      while (bet > game.cash && bet > 0) bet = BETS[BETS.indexOf(bet) - 1];
      return bet;
    };
    const go = (from) => () => {
      shops.onClose = null;
      shops.close();
      this.talk = null;
      this.start(qb, betNow(), from);
    };
    shops.openCustom(`${qb.ballName}'s squad`, () => {
      const bet = betNow();
      const b = bet ? `$${bet}` : 'nothing';
      return [
        { label: `Bet: ${b}`, price: 0, priceText: 'change', detail: "What's riding on it (he matches it: score and you take his). Pick this to change it, then pick the drive.", can: true, buy: () => (this.betI = (this.betI + 1) % BETS.length) },
        { label: 'Run a drive from the 40', price: 0, priceText: bet ? `$${bet}` : 'free', detail: 'You at quarterback, four downs to make 10 yards, until you score or lose it. They cover every receiver, plus a linebacker.', can: true, buy: go(40) },
        { label: 'Long field: from your own 20', price: 0, priceText: bet ? `$${bet}` : 'free', detail: 'The whole field to go: 80 yards, first downs every 10.', can: true, buy: go(80) },
        { label: 'Red zone: from the 15', price: 0, priceText: bet ? `$${bet}` : 'free', detail: 'Short field, tight windows: they don\'t have to cover as much.', can: true, buy: go(15) },
        { label: pick(["Nah, I'm good", 'Maybe next time', 'Nah, just watching']), price: 0, priceText: '', detail: 'Walk away.', can: true, buy: () => shops.close() },
      ];
    });
    shops.el.querySelector('.shop-help').textContent = game.input.touchMode ? 'Tap to choose, tap again to pick · ○: leave' : game.input.mode === 'pad' ? 'D-pad ↑↓: choose · ✕: pick · ○: leave' : '↑↓ / W S: choose · Enter / click: pick · Esc: leave';
    shops.onClose = () => {
      this.talk = null;
      this.again = game.time + 0.8; // (the button that closed it doesn't ask again)
    };
  }

  start(qb, bet, from = 40) {
    const game = this.game;
    const fb = this.fb;
    const S = fb.site;
    this.active = true;
    this.bet = bet;
    game.cash -= bet; // (held until it's over)
    this.bench = qb;
    qb.fb.role = 'bench';
    // You under center (football.js reads x, z and fb.home off this).
    const p = game.player;
    this.you = { fb: { role: 'qb', home: [0, 0] }, get x() { return p.pos()[0]; }, get z() { return p.pos()[1]; }, get heading() { return p.heading; } };
    fb.qb = this.you;
    fb.match = this;
    this.goal = S.goal0;
    this.los = this.goal + from * YD;
    this.first = this.los - 10 * YD;
    this.down = 0;
    this.snaps = 0; // (plays run: quitting before the first one gets your money back)
    this.meter = null;
    this.state = 'line';
    this.t = 0;
    // Somebody comes off the sideline so every receiver's covered.
    this.extra = [];
    for (const w of fb.wrs) {
      if (fb.dbs.some((d) => d.fb.mark === w)) continue;
      const d = game.peds.addAt(w.x, w.z - 6, Math.random() < 0.2);
      d.state = 'play';
      d.act = fb;
      d.keep = true;
      d.sidewalk = false;
      setShirt(d.char, 0x22416e);
      d.fb = { role: 'db', home: [w.x, w.z - 6], t: 0, mark: w };
      d.heading = 0;
      fb.players.push(d);
      fb.dbs.push(d);
      this.extra.push(d);
    }
    // A running back on your side and a linebacker on theirs.
    const add = (role, x, z, shirt) => {
      const q = game.peds.addAt(x, z, Math.random() < 0.2);
      q.state = 'play';
      q.act = fb;
      q.keep = true;
      q.sidewalk = false;
      setShirt(q.char, shirt);
      q.fb = { role, home: [x, z], t: 0 };
      q.heading = role === 'lb' ? 0 : Math.PI;
      fb.players.push(q);
      this.extra.push(q);
      return q;
    };
    const F = fb.site.field;
    fb.rb = add('rb', F.cx - 1.6, this.los + 7, 0x2e7d32);
    fb.lb = add('lb', F.cx + 0.5, this.los - 4.5, 0x22416e);
    this.playI = this.playI || 0;
    fb.los = this.los;
    fb.setHomes();
    // The ball's yours.
    fb.ball.mode = 'held';
    fb.ball.holder = 'you';
    fb.phase = 'reset';
    fb.t = 0;
    for (const f of fb.fans) f.fb.cheerT = 1;
    // The arrow over your target.
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 4), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    m.rotation.x = Math.PI;
    m.visible = false;
    game.scene.add(m);
    this.arrow = m;
    this.icons = [];
    this.iconMode = null;
    this.prevR = [true, true, true, true, true]; // (nothing counts till it's let go and pressed again)
    this.press = null;
    game.hud.toast(`${qb.ballName}'s squad · from the ${from > 50 ? `own ${100 - from}` : from} · ${bet ? `$${bet} says you score` : 'just for fun'}. Get behind the line`, '#ffd23f');
  }

  yardLine(z) {
    const y = Math.round((z - this.goal) / YD);
    return y > 50 ? 100 - y : y;
  }

  board() {
    const toGo = this.first <= this.goal + 0.01 ? 'Goal' : Math.max(1, Math.round((this.los - this.first) / YD));
    return `${DOWNS[this.down] || '4th'} & ${toGo} · ball on the ${this.yardLine(this.los)}${this.bet ? ` · $${this.bet} on it` : ''}`;
  }

  // ---- Your buttons (main.js, before the weapons) ----
  input(dt, a) {
    const game = this.game;
    const fb = this.fb;
    const fire = a.fire;
    const hike = a.dealYes;
    a.fire = a.firePressed = a.aim = a.aimPressed = a.melee = a.reload = a.dealYes = false;
    const b = fb.ball;
    const [px, pz] = game.player.pos();
    if (this.state === 'line') {
      // The play: D-pad ← / → (Z / X, or PLAY on a phone) before the snap.
      // (L1 / R1 on the controller: the D-pad's the phone)
      const R0 = a.qbR || [];
      const step = (game.input.btnHit?.(4) || game.input.hit?.('KeyZ') ? -1 : 0) + ((R0[4] && !this.prevR[4]) || game.input.hit?.('KeyX') ? 1 : 0);
      this.prevR = R0.slice();
      if (step) {
        this.playI = (this.playI + step + PLAYS.length) % PLAYS.length;
        game.hud.toast(`Play: ${PLAYS[this.playI].name}`, '#ffd23f');
      }
      // Behind the line, near the middle, everyone set: ✕ hikes it.
      const ready = fb.phase === 'set' || (fb.phase === 'reset' && fb.players.every((q) => q.fb.role === 'bench' || q.fb.role === 'fan' || dist(q.x, q.z, ...q.fb.home) < 1.5));
      const spot = pz > this.los + 1 && pz < this.los + 8 && Math.abs(px - fb.site.field.cx) < 6;
      this.ready = ready && spot;
      if (hike && this.ready) this.snap();
      return;
    }
    const R = a.qbR || [];
    const pad = game.input.mode === 'pad' && !game.input.touchMode;
    // Running with it (after a handoff, or scrambling): juke, spin, stiff-arm.
    if (this.state === 'play' && b.holder === 'you' && this.scramble) {
      this.runMoves(dt, a, pad);
      this.prevR = R.slice();
      this.prevFire = fire;
      return;
    }
    if (this.state === 'play' && b.holder === 'you' && !this.scramble) {
      // A receiver's button (or, with a mouse, a click on the player you're looking at): tap for a
      // bullet, hold for a lob; it goes when you let go.
      const recv = this.receivers();
      if (!this.press) {
        for (let i = 0; i < R.length; i++) {
          if (R[i] && !this.prevR[i] && recv[i]) {
            this.press = { i, t: 0, w: recv[i] };
            break;
          }
        }
        if (!this.press && fire && !pad && !this.prevFire && this.target) this.press = { i: -1, t: 0, w: this.target };
      }
      if (this.press) {
        const P = this.press;
        const down = P.i >= 0 ? R[P.i] : fire;
        if (down) P.t += dt;
        else {
          this.press = null;
          if (pz < this.los) game.hud.toast("Past the line: you can't throw now", '#ff8080');
          else if (P.w && fb.players.includes(P.w)) this.throwIt(P.w, P.t < BULLET ? 'bullet' : 'lob', a);
        }
      }
      if (pad) a.sprint = fire; // (R2 sprints on the controller; ✕ is a receiver)
      else a.sprint = a.sprint && !R[1];
      // The drop-back: three quick steps back off the snap, facing downfield (the stick takes
      // over whenever you push it).
      if (this.t < (this.play?.run ? 0.25 : 0.7) && Math.hypot(a.moveX, a.moveY) < 0.2) {
        const yaw = game.camYaw;
        a.moveY = Math.cos(yaw) * 0.75; // (world +z: back from the line)
        a.moveX = Math.sin(yaw) * 0.75;
        a.sprint = false;
        this.dropping = true;
      } else this.dropping = false;
    } else this.press = null;
    this.prevR = R.slice();
    this.prevFire = fire;
  }

  // Who gets which button: the receivers in order (the back gets R1).
  receivers() {
    const fb = this.fb;
    const r = fb.wrs.slice(0, 4);
    while (r.length < 4) r.push(null);
    r.push(fb.rb && fb.players.includes(fb.rb) ? fb.rb : null);
    return r;
  }

  snap() {
    const fb = this.fb;
    this.state = 'play';
    this.snaps = (this.snaps || 0) + 1;
    this.t = 0;
    this.sacked = false;
    fb.phase = 'play';
    fb.t = 0;
    for (const w of fb.wrs) w.fb.leg = 0;
    fb.target = null;
    this.prevR = [true, true, true, true, true]; // (the ✕ that hiked it isn't a throw)
    this.press = null;
    // The play: the routes it calls, the back's job, the fake.
    const P = (this.play = PLAYS[this.playI || 0]);
    fb.wrs.forEach((w, k) => (w.fb.route = fb.route(w, P.routes[k] || null)));
    this.handed = false;
    this.runMove = null;
    if (fb.rb && fb.players.includes(fb.rb)) {
      fb.rb.fb.leg = 0;
      fb.rb.fb.route = P.run ? null : P.pa ? fb.route(fb.rb, 'flat').map(([x, z]) => [x, z - 2]) : fb.route(fb.rb, 'flat');
    }
    this.biteT = P.pa ? 0.9 : 0; // (play action: they bite on the fake)
    fb.biteT = this.biteT;
    this.game.hud.toast(P.run ? `Hike! ${P.name}` : 'Hike!', '#ffd23f');
  }

  // Everyone on defense (the backs and the linebacker), still on the field.
  defenders() {
    const fb = this.fb;
    const d = fb.dbs.slice();
    if (fb.lb && fb.players.includes(fb.lb)) d.push(fb.lb);
    return d;
  }

  // The handoff: the back meets you and takes it, and from here you're him (you swap places:
  // you run with it, he carries on as the quarterback after the fake).
  handoff() {
    const game = this.game;
    const fb = this.fb;
    const rb = fb.rb;
    const p = game.player;
    const [px, pz] = p.pos();
    const rx = rb.x;
    const rz = rb.z;
    rb.x = px;
    rb.z = pz;
    p.x = rx;
    p.z = rz;
    p.heading = Math.PI;
    this.handed = true;
    this.scramble = true; // (a runner now: no throwing)
    this.carrier = true;
    game.hud.toast(`Handoff · ${game.input.mode === 'kb' && !game.input.touchMode ? 'J / L juke · U spin · K stiff-arm' : game.input.touchMode ? 'JUKE · SPIN · STIFF' : 'right stick ← → juke · ↓ spin · □ stiff-arm'}`, '#ffd23f');
  }

  // Your moves with the ball: a juke (a quick cut to one side: whoever's closing in front grabs
  // air and dives at nothing), a spin (through a tackle coming at you) and a stiff-arm (shoves
  // down whoever gets into your hands).
  runMoves(dt, a, pad) {
    const game = this.game;
    const p = game.player;
    if (pad) a.lookX = a.lookY = 0; // (the right stick's for moves now)
    const R = a.qbR || [];
    if (this.moveCd > 0) this.moveCd -= dt;
    let want = null;
    // (the right stick, flicked)
    const sx = pad ? a.rsX || 0 : 0;
    const sy = pad ? a.rsY || 0 : 0;
    const flick = Math.hypot(sx, sy) > 0.75;
    if (flick && !this.flicked) want = Math.abs(sx) > Math.abs(sy) ? { kind: 'juke', side: sx > 0 ? 1 : -1 } : sy > 0 ? { kind: 'spin' } : null;
    this.flicked = Math.hypot(sx, sy) > 0.4;
    if (a.bMove) {
      if (a.bMove.kind === 'cross') want = { kind: 'juke', side: a.bMove.side || (a.moveX < 0 ? -1 : 1) };
      else if (a.bMove.kind === 'spin') want = { kind: 'spin' };
      else if (a.bMove.kind === 'step') want = { kind: 'stiff' };
    }
    if (pad && R[0] && !this.prevR[0]) want = { kind: 'stiff' };
    if (want && !this.runMove && !(this.moveCd > 0)) {
      this.runMove = { ...want, t: 0, T: want.kind === 'juke' ? 0.28 : want.kind === 'spin' ? 0.45 : 0.6, h0: p.heading };
      this.moveCd = 0.35;
      const [px, pz] = p.pos();
      const near = this.defenders().filter((q) => !(q.fb.downT > 0) && dist(q.x, q.z, px, pz) < (want.kind === 'juke' ? 3 : 1.8));
      for (const q of near) {
        if (want.kind === 'juke' && Math.random() < 0.65) {
          // (he dives at where you were)
          q.fb.beatT = 1.2;
          q.fb.dive = true;
          q.fb.diveTo = [px, pz];
          q.fb.downT = q.fb.downLen = 1.0;
        } else if (want.kind === 'spin' && Math.random() < 0.55) q.fb.beatT = 0.8;
      }
      if (want.kind !== 'stiff') game.hud.toast(want.kind === 'juke' ? 'Juke!' : 'Spin!', '#ffd23f');
    }
    const M = this.runMove;
    if (M) {
      M.t += dt;
      if (M.kind === 'juke') {
        // (the cut: a quick shove sideways)
        const k = 1.2 / M.T;
        const rx = -Math.cos(p.heading) * M.side;
        const rz = Math.sin(p.heading) * M.side;
        p.x += rx * k * dt;
        p.z += rz * k * dt;
      }
      if (M.kind === 'stiff') {
        // (anybody getting into your hands goes down, mostly)
        const [px, pz] = p.pos();
        for (const q of this.defenders()) {
          if (q.fb.downT > 0 || q.fb.stiffed) continue;
          if (dist(q.x, q.z, px, pz) < 1.3) {
            q.fb.stiffed = true;
            if (Math.random() < 0.55) {
              q.fb.dive = false;
              q.fb.downT = q.fb.downLen = 1.2;
              q.fb.beatT = 1.4;
              game.hud.toast('STIFF ARM!', '#7ee081');
            }
          }
        }
      }
      if (M.t >= M.T) {
        this.runMove = null;
        for (const q of this.defenders()) q.fb.stiffed = false;
      }
    }
    a.sprint = true; // (running with it: full speed)
  }

  // Who you're looking toward.
  pickTarget() {
    const game = this.game;
    const [px, pz] = game.player.pos();
    const yaw = game.camYaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    let best = null;
    let bs = -2;
    for (const w of this.fb.wrs) {
      const d = dist(px, pz, w.x, w.z) || 1;
      const s = ((w.x - px) * fx + (w.z - pz) * fz) / d;
      if (s > bs) {
        bs = s;
        best = w;
      }
    }
    return best;
  }

  // The throw: a bullet (fast, flat) or a lob (high, slower), led where he'll be, plus the
  // left stick at the release, with a little error (more on the run or with the pocket closing).
  throwIt(w, kind, a) {
    const game = this.game;
    const fb = this.fb;
    const [px, pz] = game.player.pos();
    const p = game.player;
    const b = fb.ball;
    const lob = kind === 'lob';
    const d0 = dist(px, pz, w.x, w.z);
    let T = lob ? 0.75 + d0 / 15 : 0.3 + d0 / 24;
    const sp = w.speed || 0;
    let tx = w.x + Math.sin(w.heading) * sp * T;
    let tz = w.z + Math.cos(w.heading) * sp * T;
    // A route's end: he stops there.
    const end = w.fb.route?.[w.fb.route.length - 1];
    if (end && dist(w.x, w.z, end[0], end[1]) < sp * T) [tx, tz] = end;
    // The left stick leads him (camera-relative).
    const mx = a?.moveX || 0;
    const my = a?.moveY || 0;
    if (Math.hypot(mx, my) > 0.3) {
      const yaw = game.camYaw;
      const lead = lob ? 3.2 : 2;
      tx += (Math.sin(yaw) * my - Math.cos(yaw) * mx) * lead;
      tz += (Math.cos(yaw) * my + Math.sin(yaw) * mx) * lead;
    }
    let err = lob ? 0.8 : 0.45;
    if (this.t > SACK - 1.5) err += 0.5; // (the pocket closing in)
    if ((p.speed || 0) > 2.5) err += 0.5; // (throwing on the run)
    const ea = rand(0, Math.PI * 2);
    const er = err * rand(0, 1);
    tx += Math.cos(ea) * er;
    tz += Math.sin(ea) * er;
    const F = fb.site.field;
    tx = Math.max(F.x0 - 1, Math.min(F.x1 + 1, tx));
    tz = Math.max(F.z0 - 2, tz);
    T = lob ? 0.75 + dist(px, pz, tx, tz) / 15 : 0.3 + dist(px, pz, tx, tz) / 24;
    b.x = px + Math.sin(p.heading) * 0.2;
    b.z = pz + Math.cos(p.heading) * 0.2;
    b.y = 2.0;
    fb.launch(tx, lob ? 1.6 : 1.3, tz, T, 'pass', w);
    b.style = kind;
    this.state = 'air';
    this.throwT = 0.4;
    game.hud.toast(lob ? 'Lob' : 'Bullet', '#ffd23f');
  }

  // The pass gets there (football.js arrived() hands it over).
  arrived() {
    const game = this.game;
    const fb = this.fb;
    const b = fb.ball;
    const w = b.to;
    const dW = w && fb.players.includes(w) ? dist(w.x, w.z, b.x, b.z) : 99;
    let db = null;
    for (const q of this.defenders()) if (!db || dist(q.x, q.z, b.x, b.z) < dist(db.x, db.z, b.x, b.z)) db = q;
    const dD = db ? dist(db.x, db.z, b.x, b.z) : 99;
    // A bullet: a back sitting on the line of it (the last two thirds) can jump it.
    if (b.style === 'bullet') {
      for (const q of this.defenders()) {
        const [x0, , z0] = b.p0;
        const [x1, , z1] = b.p1;
        const L2 = (x1 - x0) ** 2 + (z1 - z0) ** 2 || 1;
        const k = Math.max(0.33, Math.min(0.95, ((q.x - x0) * (x1 - x0) + (q.z - z0) * (z1 - z0)) / L2));
        const off = dist(q.x, q.z, x0 + (x1 - x0) * k, z0 + (z1 - z0) * k);
        // (only one in front of your man, undercutting it: trailing him he can't get there)
        const kw = w ? ((w.x - x0) * (x1 - x0) + (w.z - z0) * (z1 - z0)) / L2 : 1;
        if (off < 0.8 && k < kw - 0.04 && off < dW) {
          const r = Math.random();
          if (r < 0.3) {
            fb.hold(q);
            game.hud.toast('Jumped the route: INTERCEPTED', '#ff8080');
            return this.end('pick');
          }
          if (r < 0.6) {
            b.mode = 'loose';
            b.vx = rand(-2, 2);
            b.vz = rand(-2, 2);
            b.vy = 1;
            game.hud.toast('Knocked down. Incomplete', '#ff8080');
            return this.over(null);
          }
        }
      }
    }
    // Picked off: a back closer to it than your man (less often on a lob he had to run under).
    if (db && dD < 1.6 && dD < dW && Math.random() < (b.style === 'lob' ? 0.45 : 0.55)) {
      fb.hold(db);
      game.hud.toast('INTERCEPTED', '#ff8080');
      return this.end('pick');
    }
    const dove = w && fb.players.includes(w) && fb.diveFor(w, b.x, b.z); // (just out of reach: he lays out)
    let pr = dW < 0.8 ? 0.9 : dW < 1.6 ? 0.65 : dW < 2.5 ? 0.3 : 0;
    if (dove) pr += 0.1;
    const cover = db && w ? dist(db.x, db.z, w.x, w.z) : 99;
    if (cover < 1.5) pr -= 0.3;
    else if (cover < 2.5) pr -= 0.15;
    if (Math.random() < pr) {
      fb.hold(w);
      if (dove) {
        // (a diving catch: down where he caught it)
        for (const f of fb.fans) f.fb.cheerT = rand(1.5, 2.2);
        game.hud.toast('DIVING CATCH!', '#7ee081');
        if (b.z <= this.goal) return this.touchdown(w);
        return this.over(w.z);
      }
      fb.phase = 'run';
      fb.t = 0;
      fb.runFor = 99;
      w.fb.runTo = [w.x, this.goal - 3];
      this.state = 'run';
      this.t = 0;
      for (const f of fb.fans) f.fb.cheerT = rand(1, 1.8);
      game.hud.toast('Caught!', '#7ee081');
      return;
    }
    // Incomplete: it bounces away.
    b.mode = 'loose';
    b.vx = rand(-1.5, 1.5);
    b.vz = rand(-1.5, 1.5);
    b.vy = -2;
    game.hud.toast(dD < 2 ? 'Batted away. Incomplete' : 'Incomplete', '#ff8080');
    this.over(null);
  }

  // ---- Every frame (football.js step) ----
  phase(dt) {
    const game = this.game;
    const fb = this.fb;
    const b = fb.ball;
    const [px, pz] = game.player.pos();
    this.t += dt;
    // Forfeits / called off.
    if (!this.onField(px, pz, 2)) this.outT = (this.outT || 0) + dt;
    else this.outT = 0;
    if (this.outT > 2.5 || game.player.vehicle || game.stars > 0 || game.wastedT > 0 || game.bustedT > 0) return this.end('forfeit');
    if (!fb.wrs.length) return this.end('off');
    if (this.state === 'line') {
      // Lining up (football.js 'reset': everyone walks to their spot).
      if (fb.phase === 'reset' && fb.players.every((q) => q.fb.role === 'bench' || dist(q.x, q.z, ...q.fb.home) < 0.7)) fb.phase = 'set';
    } else if (this.state === 'play') {
      if (this.biteT > 0) this.biteT -= dt;
      fb.biteT = this.biteT;
      // The handoff: the back gets to you.
      if (this.play?.run && !this.handed && b.holder === 'you' && fb.rb && fb.players.includes(fb.rb) && this.t > 0.25 && dist(fb.rb.x, fb.rb.z, px, pz) < 1.3) this.handoff();
      if (b.holder === 'you') {
        // Scrambling past the line.
        if (pz < this.los) this.scramble = true;
        if (pz <= this.goal) return this.touchdown('you');
        const tackler = this.defenders().find((q) => !(q.fb.downT > 0) && !(q.fb.beatT > 0) && dist(q.x, q.z, px, pz) < 0.9);
        if (this.scramble && tackler && !(this.runMove?.kind === 'spin' && Math.random() < 0.5)) {
          game.hud.toast(`Brought down at the ${this.yardLine(pz)}`, '#ffd23f');
          fb.tackle(null, tackler);
          this.downT = 1.1; // (you hit the turf too)
          return this.over(pz);
        }
        if (!this.scramble && this.t > SACK) {
          game.hud.toast('SACKED', '#ff8080');
          this.downT = 1.1;
          return this.over(Math.min(this.los + 4 * YD, fb.site.field.z1 - 1));
        }
      }
    } else if (this.state === 'run') {
      const h = b.holder;
      if (!h || h === 'you') return this.over(this.los);
      if (h.z <= this.goal) return this.touchdown(h);
      const tackler = this.defenders().find((q) => !(q.fb.downT > 0) && !(q.fb.beatT > 0) && dist(q.x, q.z, h.x, h.z) < 0.9);
      if (tackler) fb.tackle(h, tackler);
      if (tackler || this.t > 7 || (h.fb.runTo && dist(h.x, h.z, ...h.fb.runTo) < 0.6)) {
        game.hud.toast(`Brought down at the ${this.yardLine(h.z)}`, '#ffd23f');
        return this.over(h.z);
      }
    } else if (this.state === 'dead') {
      // The ball comes back to you; everyone lines up again.
      if (this.t > 1.6) {
        b.mode = 'held';
        b.holder = 'you';
        fb.los = this.los;
        fb.setHomes();
        for (const w of fb.wrs) w.fb.route = null;
        fb.phase = 'reset';
        fb.t = 0;
        this.state = 'line';
        this.t = 0;
      }
    }
    if (this.throwT > 0) this.throwT -= dt;
    if (this.downT > 0) this.downT -= dt;
    // The arrow over who you'd throw to.
    this.target = this.state === 'play' && b.holder === 'you' && !this.scramble ? this.pickTarget() : null;
    const kb = game.input.mode === 'kb';
    this.arrow.visible = !!this.target && kb; // (with a mouse: the man a click goes to)
    if (this.target) this.arrow.position.set(this.target.x, 3.1 + Math.sin(game.time * 6) * 0.08, this.target.z);
    this.updateIcons();
    let hint = '';
    const keys = kb ? '1-4' : '□ ✕ ○ △';
    const pk = game.input.touchMode ? 'PLAY' : kb ? 'Z / X' : 'L1 / R1';
    const playName = PLAYS[this.playI || 0].name;
    if (this.state === 'line') hint = `Play: ${playName} (${pk} to change) · ${this.ready ? `${kb ? 'E' : '✕'} hike` : 'get behind the line, in the middle'}`;
    else if (this.state === 'play' && this.carrier && b.holder === 'you') hint = kb && !game.input.touchMode ? 'Run! J / L juke · U spin · K stiff-arm' : game.input.touchMode ? 'Run! JUKE · SPIN · STIFF' : 'Run! right stick ← → juke · ↓ spin · □ stiff-arm';
    else if (this.state === 'play' && b.holder === 'you') hint = this.scramble ? (kb && !game.input.touchMode ? 'Run it in! J / L juke · U spin · K stiff-arm' : 'Run it in! juke · spin · stiff-arm') : this.t > SACK - 1.5 ? 'Pocket collapsing: throw it!' : `${keys}: tap a bullet, hold a lob · left stick leads him${kb ? ' · or click the player you look at' : ''}`;
    // (holding a button: how far toward a lob)
    const meter = this.press ? Math.min(1, this.press.t / 0.5) : null;
    game.hud.sport?.(this.board(), meter, hint);
  }

  // The button over each receiver's head (lined up, and while you've got it to throw).
  updateIcons() {
    const game = this.game;
    const kb = game.input.mode === 'kb' && !game.input.touchMode;
    const mode = kb ? 'kb' : 'pad';
    const recv = this.receivers();
    const show = (this.state === 'line' || (this.state === 'play' && this.fb.ball.holder === 'you' && !this.scramble));
    for (let i = 0; i < recv.length; i++) {
      let s = this.icons[i];
      if (!s || this.iconMode !== mode) {
        if (s) game.scene.remove(s);
        s = this.icons[i] = iconSprite(kb ? String(i + 1) : ICONS[i], ICON_COLORS[i]);
        game.scene.add(s);
      }
      const w = recv[i];
      s.visible = !!w && show;
      if (w) {
        const pressed = this.press && this.press.w === w;
        s.position.set(w.x, 2.75, w.z);
        s.scale.setScalar(pressed ? 0.1 : this.state === 'line' ? 0.06 : 0.078); // (a fixed size on screen)
      }
    }
    this.iconMode = mode;
  }

  // The ball in your hands (football.js step).
  carry(b) {
    const p = this.game.player;
    const [px, pz] = p.pos();
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    if (this.press) {
      // (in the throwing hand, by the ear)
      p.char.group.updateMatrixWorld(true);
      const v = p.char.wristR.localToWorld(new THREE.Vector3(0, -0.12, 0.04));
      b.x = v.x;
      b.y = v.y;
      b.z = v.z;
    } else {
      b.x = px + fx * 0.15 - fz * 0.3;
      b.z = pz + fz * 0.15 + fx * 0.3;
      b.y = 1.15;
    }
    b.mesh.rotation.set(0, p.heading, 0);
  }

  // The play's over: spot it (null: incomplete, back where it was) and count the down.
  over(z) {
    const game = this.game;
    const fb = this.fb;
    this.state = 'dead';
    this.t = 0;
    this.scramble = false;
    this.meter = null;
    this.press = null;
    this.dropping = false;
    this.carrier = false;
    this.handed = false;
    this.runMove = null;
    this.biteT = 0;
    fb.biteT = 0;
    fb.phase = 'dead';
    fb.t = 0;
    if (z != null) this.los = Math.max(this.goal + YD, Math.min(fb.site.field.z1 - 1, z));
    if (this.los <= this.first + 0.01) {
      this.down = 0;
      this.first = Math.max(this.goal, this.los - 10 * YD);
      game.hud.toast('First down!', '#7ee081');
      return;
    }
    this.down += 1;
    if (this.down > 3) {
      game.hud.toast('Turnover on downs', '#ff8080');
      this.end('downs');
    }
  }

  touchdown(who) {
    const game = this.game;
    for (const f of this.fb.fans) f.fb.cheerT = 2.5;
    for (const q of this.fb.wrs) q.fb.cheerT = 2;
    game.hud.toast(who === 'you' ? (this.carrier ? 'TOUCHDOWN! Took the handoff to the house' : 'TOUCHDOWN! You took it in yourself') : 'TOUCHDOWN!', '#7ee081');
    this.end('td');
  }

  // Your arms and body (main.js, after you move): the stance at the line, the drop-back, the
  // throw (the same motion as theirs: football.js), the tuck on a scramble, hitting the turf.
  late() {
    const game = this.game;
    const p = game.player;
    const c = p.char;
    p.showWeapon('fists');
    const b = this.fb.ball;
    c.group.rotation.x = 0;
    c.armL.rotation.z = c.armR.rotation.z = 0;
    if (this.downT > 0) {
      const t = 1.1 - this.downT;
      const k = t < 0.25 ? t / 0.25 : this.downT < 0.35 ? this.downT / 0.35 : 1;
      c.group.position.y += layoutPose(c, k, false);
      return;
    }
    if (this.state === 'line' && (p.speed || 0) < 0.3 && this.ready) {
      c.group.position.y += qbStance(c);
      return;
    }
    if (b.holder === 'you') {
      if (this.dropping) {
        p.heading = Math.PI; // (backpedaling, facing downfield)
        c.group.rotation.y = p.heading;
      }
      if (this.press) throwPose(c, Math.min(1, this.press.t / 0.15), 0);
      else if (this.scramble || (p.speed || 0) > 3) {
        // (tucked under the arm, the elbow clamped down on it)
        c.armR.rotation.x = -0.5;
        c.elbowR.rotation.x = -1.6;
      } else {
        // (two hands on it at the chest)
        c.armL.rotation.x = c.armR.rotation.x = -1.1;
        c.elbowL.rotation.x = c.elbowR.rotation.x = -0.9;
      }
    } else if (this.throwT > 0) throwPose(c, 1, 1 - this.throwT / 0.4); // (the follow-through)
  }

  // ---- Over ----
  end(how) {
    const game = this.game;
    const fb = this.fb;
    const bet = this.bet;
    const name = this.bench?.ballName || 'They';
    if (how === 'td') {
      game.cash += bet * 2;
      game.cred += 10;
      game.hud.toast(`You scored on ${name}'s squad${bet ? ` · +$${bet}` : ''} · +10 cred`, '#7ee081');
    } else if (how === 'pick' || how === 'downs') {
      game.hud.toast(`${name}: "Nah, you ain't got it."${bet ? ` · -$${bet}` : ''}`, '#ff8080');
    } else if (how === 'forfeit') {
      game.hud.toast(`You walked off${bet ? ` · -$${bet}` : ''}`, '#ff8080');
    } else {
      game.cash += bet;
      game.hud.toast('Game called off', '#9fc3ff');
    }
    this.active = false;
    this.meter = null;
    fb.match = null;
    game.scene.remove(this.arrow);
    for (const s of this.icons || []) if (s) game.scene.remove(s);
    this.icons = [];
    this.press = null;
    // (the extra back goes home)
    for (const d of this.extra || []) {
      if (fb.players.includes(d)) fb.players.splice(fb.players.indexOf(d), 1);
      if (fb.dbs.includes(d)) fb.dbs.splice(fb.dbs.indexOf(d), 1);
      if (fb.ball?.holder === d) fb.loose();
      d.keep = false;
      d.sidewalk = true;
      d.act = null;
      if (d.state === 'play' && !d.removed) d.resumeWalking();
    }
    this.extra = [];
    fb.rb = fb.lb = null;
    // Their quarterback takes it back (or someone else does if he's gone: football.js).
    const q = this.bench;
    if (q && fb.players.includes(q)) {
      q.fb.role = 'qb';
      fb.qb = q;
    } else fb.qb = null;
    if (fb.qb) {
      fb.setHomes();
      fb.phase = 'back';
      fb.t = 0;
    }
    const b = fb.ball;
    if (b && (b.holder === 'you' || !fb.qb)) {
      if (fb.qb) fb.hold(fb.qb);
      else fb.loose();
    }
    game.hud.sport?.(null);
    game.save();
  }
}

// A receiver's button (a round badge with the symbol) that always faces the camera, the same
// size on screen however far off he is.
function iconSprite(text, color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(10,14,20,.8)';
  g.beginPath();
  g.arc(32, 32, 29, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = color;
  g.stroke();
  g.fillStyle = color;
  g.font = `bold ${text.length > 1 ? 30 : 46}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(cv);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.renderOrder = 10;
  return s;
}
