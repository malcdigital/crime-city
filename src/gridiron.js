import * as THREE from 'three';
import { dist, rand, pick } from './util.js';
import { FieldModes } from './fieldmodes.js';
import { QBChallenge, QBC_KEY } from './qbchallenge.js';
import { DriveReads, DPLAYS, SACK_READ, DRIVE_KEY } from './drivereads.js';
import { CFG } from './config.js';
import { fbPose, POCKET_CLOSE, fbBallAt, fbBallQuat } from './footballpose.js';

const ease = (k) => k * k * (3 - 2 * k);

// Quarterback a drive at Harbor Field (football.js runs the passing drill there).
// - Join: walk onto the field while they're lining up; their quarterback offers you the ball.
//   E / D-pad ↑ / USE plays; Q / ○ changes the bet ($0-$500: score on the drive and you take
//   his money too). He steps off to the sideline and watches.
// - The drive: from the 40, four downs to make 10 yards, until you score or lose it. Three
//   receivers against three defensive backs: call a play at the line (L1 / R1, keyboard Z / X,
//   PLAY on a phone; its routes are drawn on the turf), read the coverage, get behind the line
//   and ✕ / E hikes it. After the drop-back time slows: ◀ ▶ moves you from man to man and the
//   throw meter throws to him (drivereads.js has it all: one man always comes open, for a moment).
//   Caught: he runs till he's brought down. Thrown into coverage: broken up or picked off (the
//   drive's over).
//   Hold it too long and you're sacked; run past the line and you're a runner (no throwing from
//   there) till a back brings you down.
// - Walk off the field, get in a car or have the police after you and you forfeit. If they
//   scatter (trouble nearby), it's called off and the bet comes back.
const YD = 0.9144;
const BETS = [0, 50, 100, 250, 500];
const NAMES = ['Coach', 'Big Lou', 'Tre', 'Marcus', 'Deebo', 'Junior', 'Bam'];
const DOWNS = ['1st', '2nd', '3rd', '4th'];
// Asking to play, and their quarterback's answers (one of each, at random).
const ASKS = ["Y'all need a QB?", 'Can I throw some?', "Y'all need one more?", 'Let me run one', "What's up, y'all playing?", 'I got an arm, let me in'];
const REPLIES = ['Bet. You got an arm?', 'Yeah, what you wanna run?', "Aight, let's see it. Pick it.", "Say less. What we doing?", "We need a QB anyway. What's it gon' be?", 'Pull up. How you want it?'];
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
    // (testing switch: straight into one of the field's games once they're out there)
    if (CFG.START_FIELD_GAME && !this.startDone && !this.active && game.started && game.time > 1.5 && fb?.qb?.fb && fb.wrs.length && !game.player.vehicle && this.onField(...game.player.pos(), 6)) {
      this.startDone = true;
      const qb = fb.qb;
      if (!qb.ballName) qb.ballName = pick(qb.female ? ['Kiki', 'Nae', 'Jada', 'Shay'] : NAMES);
      const w = fb.wrs[0];
      if (!w.ballName) w.ballName = pick(w.female ? ['Kiki', 'Nae', 'Jada', 'Shay'] : NAMES.filter((n) => n !== qb.ballName));
      if (CFG.START_FIELD_GAME === 'qbc') this.startChallenge(qb);
      else if (CFG.START_FIELD_GAME === 'drive') this.start(qb, 0);
      else {
        // (out in the middle of the field, a little toward the south end)
        const F = fb.site.field;
        game.player.x = F.cx;
        game.player.z = (F.z0 + F.z1) / 2 + 10;
        game.player.heading = Math.PI;
        this.startCatch(qb, w);
      }
      return;
    }
    if (this.active || game.player.vehicle || game.stars > 0 || game.stop || !fb?.ball || fb.match || game.time < (this.again || 0) || game.driveCine?.open || game.qbcCine?.open) return; // (not over a game's own screens)
    const qb = fb.qb;
    const [px, pz] = game.player.pos();
    // (anywhere on the field: you call over to their quarterback, wherever he is and whatever
    // they're in the middle of)
    if (!qb || !qb.fb || !fb.wrs.length || !this.onField(px, pz)) {
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

  // The menu of games (courtmenu.js, like the courts': the game waits while it's up): run a
  // drive against their squad, the QB Challenge on your own, or play catch with somebody out
  // there; the house rules for each; START, or walk away.
  menu(qb) {
    const game = this.game;
    const fb = this.fb;
    const bets = BETS.filter((v) => v <= game.cash);
    let bi = bets.indexOf(BETS[this.betI]);
    if (bi < 0) bi = bets.length - 1;
    const mates = [qb, ...fb.players.filter((q) => q !== qb && (q.fb.role === 'wr' || q.fb.role === 'db'))];
    for (const q of mates) if (!q.ballName) q.ballName = pick(q.female ? ['Kiki', 'Nae', 'Jada', 'Shay', 'Tasha'] : NAMES.filter((n) => n !== qb.ballName));
    let best = 0;
    try {
      best = Number(localStorage.getItem(QBC_KEY)) || 0;
    } catch {
      // (storage unavailable)
    }
    let driveBest = 0;
    try {
      driveBest = Number(localStorage.getItem(DRIVE_KEY)) || 0;
    } catch {
      // (storage unavailable)
    }
    game.courtMenu.show({
      title: `${qb.ballName}'s squad`,
      place: fb.site.name || 'Harbor Field',
      games: [
        { id: 'drive', title: `Run a drive vs. ${qb.ballName.toUpperCase()}'s squad`, sub: (st) => `From your own 25 · scored on every throw · ${driveBest ? `record ${driveBest}` : 'set the record'} · ${st.wager ? `$${st.wager} says you score` : 'just for fun'}` },
        { id: 'qbc', title: 'QB Challenge · solo', sub: () => `3 stages, one throw at each target: still rings, moving rings, juke the rush · ${best ? `record ${best}` : 'set the record'}` },
        { id: 'catch', title: 'Play catch', sub: (st) => `With ${st.mate.ballName} · anywhere on the field, within 50 yards · bullet, touch or lob` },
      ],
      rules: [
        { id: 'wager', label: 'Wager', values: bets, i: bi, fmt: (v) => (v ? `$${v}` : 'None'), only: 'drive' },
        { id: 'mate', label: 'Throw with', values: mates, i: 0, fmt: (q) => `${q.ballName}${q === qb ? ' (QB)' : q.fb.role === 'db' ? ' (DB)' : ' (WR)'}`, only: 'catch' },
      ],
      start: (st) => (st.game === 'qbc' ? 'START THE CLOCK' : st.game === 'catch' ? 'START THROWING' : `START THE DRIVE${st.wager ? ` · $${st.wager}` : ''}`),
      watch: pick(["Nah, I'm good", 'Maybe next time', 'Nah, just watching']),
      onChange: (R) => {
        // (remembered for next time)
        if (R.id === 'wager') this.betI = BETS.indexOf(R.values[R.i]);
      },
      onStart: (st) => {
        this.talk = null;
        if (st.game === 'qbc') this.startChallenge(qb);
        else if (st.game === 'catch') this.startCatch(qb, st.mate);
        else this.start(qb, st.wager);
      },
      onClose: () => {
        this.talk = null;
        this.again = game.time + 0.8; // (the button that closed it doesn't ask again)
      },
    });
  }

  start(qb, bet, from = 75) {
    const game = this.game;
    const fb = this.fb;
    const S = fb.site;
    this.active = true;
    this.mode = 'drive';
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
    fb.los = this.los;
    this.extra = [];
    fb.rb = fb.lb = null;
    // The arrow over the man you're reading.
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 4), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    m.rotation.x = Math.PI;
    m.visible = false;
    game.scene.add(m);
    this.arrow = m;
    this.drStart(); // (three on three, the play, the lines on the turf: drivereads.js)
    // The ball's yours.
    fb.ball.mode = 'held';
    fb.ball.holder = 'you';
    fb.phase = 'reset';
    fb.t = 0;
    for (const f of fb.fans) f.fb.cheerT = 1;
    this.prevR = [true, true, true, true, true]; // (nothing counts till it's let go and pressed again)
    this.press = null;
  }

  yardLine(z) {
    const y = Math.round((z - this.goal) / YD);
    return y > 50 ? 100 - y : y;
  }

  board() {
    const toGo = this.first <= this.goal + 0.01 ? 'Goal' : Math.max(1, Math.round((this.los - this.first) / YD));
    const heat = this.heatSt() === 'fire' ? ' · ON FIRE' : this.heatSt() === 'rhythm' ? ' · IN RHYTHM' : '';
    return `${DOWNS[this.down] || '4th'} & ${toGo} · ball on the ${this.yardLine(this.los)} · SCORE ${this.dr?.score || 0}${this.bet ? ` · $${this.bet}` : ''}${heat}`;
  }

  // ---- Your buttons (main.js, before the weapons) ----
  input(dt, a) {
    const game = this.game;
    const fb = this.fb;
    const fire = a.fire;
    const hike = a.dealYes;
    a.fire = a.firePressed = a.aim = a.aimPressed = a.melee = a.reload = a.dealYes = false;
    if (this.mode && this.mode !== 'drive') return this.modeInput(dt, a, fire); // (the QB Challenge, playing catch: fieldmodes.js)
    const b = fb.ball;
    const [px, pz] = game.player.pos();
    if (this.state === 'line') {
      // The play: L1 / R1 (Z / X, or PLAY on a phone) before the snap.
      const R0 = a.qbR || [];
      const step = (game.input.btnHit?.(4) || game.input.hit?.('KeyZ') ? -1 : 0) + ((R0[4] && !this.prevR[4]) || game.input.hit?.('KeyX') ? 1 : 0);
      this.prevR = R0.slice();
      if (step) {
        this.playI = (this.playI + step + DPLAYS.length) % DPLAYS.length;
        this.drLineUp(false);
        this.drSetAll(); // (they shift straight into the new formation: ✕ still hikes it right away)
        game.hud.toast(`Play: ${this.drPlayName()}`, '#ffd23f');
      }
      this.drScan(a); // (◀ ▶ / the stick: scanning the field, before the walk takes the stick)
      // You walk yourself to your spot behind the center (the stick's not needed), then set,
      // facing downfield.
      const [sx, sz] = this.drSpot();
      const d = dist(px, pz, sx, sz);
      const yaw = game.camYaw;
      if (d > 0.25) {
        const k = Math.min(1, d / 1.5) * (d > 4 ? 1 : 0.6);
        const dx = ((sx - px) / d) * k;
        const dz = ((sz - pz) / d) * k;
        a.moveY = Math.sin(yaw) * dx + Math.cos(yaw) * dz;
        a.moveX = -Math.cos(yaw) * dx + Math.sin(yaw) * dz;
        a.sprint = d > 6;
      } else a.moveX = a.moveY = 0;
      // Everyone set: ✕ hikes it.
      const ready = fb.phase === 'set' || (fb.phase === 'reset' && fb.players.every((q) => q.fb.role === 'bench' || q.fb.role === 'fan' || dist(q.x, q.z, ...q.fb.home) < 1.5));
      const spot = d < 1.2;
      // (not under the result transition, or as it slides off: ✕ there was for the card, not a hike)
      const D = this.dr;
      const wiping = !!D?.wipe || game.time - (D?.wipeGone ?? -9) < 0.35;
      this.ready = ready && spot && !wiping;
      if (hike && this.ready) this.snap();
      return;
    }
    const R = a.qbR || [];
    const pad = game.input.mode === 'pad' && !game.input.touchMode;
    // Running with it (scrambling past the line): juke, spin, stiff-arm.
    if (this.state === 'play' && b.holder === 'you' && this.scramble) {
      this.runMoves(dt, a, pad);
      this.prevR = R.slice();
      this.prevFire = fire;
      return;
    }
    if (this.state === 'play' && b.holder === 'you') {
      // The read: ◀ ▶ from man to man; the throw meter throws to him (fieldmodes.js).
      this.drSelect(a);
      this.meterInput(dt, a, fire);
      // The drop-back: quick steps back off the snap, facing downfield (the stick takes over
      // whenever you push it); then the pocket, time slowed while you read.
      if (this.t < this.dr.play.drop && Math.hypot(a.moveX, a.moveY) < 0.2 && !this.press && !this.dr.acc) {
        const yaw = game.camYaw;
        a.moveY = Math.cos(yaw) * 0.75; // (world +z: back from the line)
        a.moveX = Math.sin(yaw) * 0.75;
        a.sprint = false;
        this.dropping = true;
      } else this.dropping = false;
      if (this.press || this.dr.acc) a.moveX = a.moveY = 0; // (set your feet to throw)
    } else {
      this.press = null;
      this.meterInput(dt, a, fire); // (the meter's verdict, and time coming back to normal)
    }
    this.prevR = R.slice();
    this.prevFire = fire;
  }

  // Who gets a button over his head (playing catch, the QB Challenge: none; the drive shows the
  // read numbers instead: drivereads.js).
  receivers() {
    if (this.mode && this.mode !== 'drive') return this.modeReceivers();
    return [null, null, null, null, null];
  }

  snap() {
    const fb = this.fb;
    this.state = 'play';
    this.snaps = (this.snaps || 0) + 1;
    this.t = 0;
    this.sacked = false;
    fb.phase = 'play';
    fb.t = 0;
    fb.target = null;
    this.prevR = [true, true, true, true, true]; // (the ✕ that hiked it isn't a throw)
    this.press = null;
    this.runMove = null;
    this.drSnap(); // (the routes the play calls: drivereads.js)
    this.game.hud.toast('Hike!', '#ffd23f');
  }

  // Everyone on defense (the backs and the linebacker), still on the field.
  defenders() {
    const fb = this.fb;
    const d = fb.dbs.slice();
    if (fb.lb && fb.players.includes(fb.lb)) d.push(fb.lb);
    return d;
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

  // The pass gets there (football.js arrived() hands it over).
  arrived() {
    if (this.mode === 'catch') return this.catchArrived();
    return this.drArrived(); // (the drive: open or covered, drivereads.js)
  }

  // ---- Every frame (football.js step) ----
  phase(dt) {
    // (no minimap in the drive or the QB Challenge: just the game; back when it's over, end)
    const mm = document.getElementById('minimap');
    if (mm) mm.style.visibility = this.mode === 'drive' || this.mode === 'qbc' ? 'hidden' : '';
    if (this.mode && this.mode !== 'drive') return this.modePhase(dt);
    const game = this.game;
    const fb = this.fb;
    const b = fb.ball;
    const [px, pz] = game.player.pos();
    this.t += dt;
    // Forfeits / called off.
    if (!this.onField(px, pz, 2)) this.outT = (this.outT || 0) + dt;
    else this.outT = 0;
    if (this.outT > 2.5 || game.player.vehicle || game.stars > 0 || game.wastedT > 0 || game.bustedT > 0) return this.end('forfeit');
    if (fb.wrs.length < 3 || fb.dbs.length < 3) return this.end('off'); // (somebody ran off)
    if (this.state === 'line') {
      // Lining up (football.js 'reset': everyone walks to their spot).
      if (fb.phase === 'reset' && fb.players.every((q) => q.fb.role === 'bench' || dist(q.x, q.z, ...q.fb.home) < 0.7)) fb.phase = 'set';
    } else if (this.state === 'play') {
      if (b.holder === 'you') {
        // Scrambling past the line.
        if (pz < this.los) this.scramble = true;
        if (pz <= this.goal) return this.touchdown('you');
        const tackler = this.defenders().find((q) => !(q.fb.downT > 0) && !(q.fb.beatT > 0) && dist(q.x, q.z, px, pz) < 0.9);
        if (this.scramble && tackler && !(this.runMove?.kind === 'spin' && Math.random() < 0.5)) {
          this.drRes = { kind: 'run' };
          fb.tackle(null, tackler);
          this.downT = 1.1; // (you hit the turf too)
          return this.over(pz);
        }
        if (!this.scramble && !this.dr.acc && this.t > SACK_READ) {
          this.drRes = { kind: 'sack', why: this.drTold() };
          this.downT = 1.1;
          return this.over(Math.min(this.los + 4 * YD, fb.site.field.z1 - 1));
        }
      }
    } else if (this.state === 'tip') {
      this.drTipStep(); // (tipped, your man under it: drivereads.js)
    } else if (this.state === 'pick') {
      this.drPickStep(); // (picked off: he runs it back, then the drive's over: drivereads.js)
      if (!this.active) return;
    } else if (this.state === 'run') {
      const h = b.holder;
      if (!h || h === 'you') return this.over(this.los);
      if (h.z <= this.goal) return this.touchdown(h);
      const tackler = this.defenders().find((q) => !(q.fb.downT > 0) && !(q.fb.beatT > 0) && dist(q.x, q.z, h.x, h.z) < 1.0);
      const F = fb.site.field;
      if (h.x < F.x0 || h.x > F.x1) {
        this.drRes = { kind: 'complete', why: `Out of bounds at the ${this.yardLine(h.z)} · ${this.drTold()}` };
        return this.over(h.z);
      }
      if (tackler) fb.tackle(h, tackler);
      if (tackler || this.t > 7 || (h.fb.runTo && dist(h.x, h.z, ...h.fb.runTo) < 0.6)) {
        return this.over(h.z);
      }
    } else if (this.state === 'dead') {
      // A beat to see how it ended, then the result wipes across the screen; under it the ball
      // comes back to you and everyone's lined up for the next one (the defense in a new
      // coverage, a new play called): ✕ hikes it as soon as it clears.
      if (this.t > 0.8 && !this.dr.wipe) this.drWipeIn(this.drCard);
      if (this.dr.wipe && this.dr.wipe.t > 0.45) {
        b.mode = 'held';
        b.holder = 'you';
        fb.los = this.los;
        this.playI = Math.floor(Math.random() * DPLAYS.length); // (a new call every down: change it if you want)
        this.drLineUp(true);
        this.drSetAll(); // (everyone straight to his spot, you behind the center)
        this.state = 'line';
        this.ready = false;
        this.t = 0;
      }
    }
    if (this.throwT > 0) this.throwT -= dt;
    if (this.downT > 0) this.downT -= dt;
    this.drStep(dt); // (the open man's window, the lines, the read numbers: drivereads.js)
    this.meterHud();
    const inp = game.input;
    const kb = inp.mode === 'kb' && !inp.touchMode;
    let hint = '';
    const pk = inp.touchMode ? 'PLAY' : kb ? 'Z / X' : 'L1 / R1';
    const sk = inp.touchMode ? '◀ ▶' : kb ? 'Z / X' : 'D-pad ◀ ▶';
    const tk = inp.touchMode ? 'BULLET · TOUCH · LOB' : kb ? 'J · K · L' : '□ · ✕ · △';
    const scanK = inp.touchMode ? '◀ ▶' : kb ? 'A / D' : 'D-pad ◀ ▶';
    if (this.state === 'line') hint = `${this.drPlayName()} (${pk} to change) · ${scanK} scan the field · ${this.ready ? `${kb ? 'E' : '✕'} hike` : 'setting up'}`;
    else if (this.state === 'play' && b.holder === 'you') hint = this.scramble ? (kb ? 'Run it in! J / L juke · U spin · K stiff-arm' : 'Run it in! juke · spin · stiff-arm') : this.t > SACK_READ - 0.9 ? 'Pocket collapsing: throw it!' : `${sk} pick your receiver (gold ring) · ${tk} throw to him`;
    // (the pocket clock, while you've got it in there)
    const clock = this.state === 'play' && b.holder === 'you' && !this.scramble ? { v: Math.max(0, 1 - this.t / SACK_READ), lo: 2, hi: 2 } : null;
    game.hud.sport?.(this.board(), clock, hint);
    // (in rhythm, on fire: the board says so, and glows: fieldmodes.js)
    game.hud.sportEl?.classList.toggle('rhythm', this.heatSt() === 'rhythm');
    game.hud.sportEl?.classList.toggle('onfire', this.heatOn());
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
    } else if (fbBallAt(p.char, _gb)) {
      // (in your hands, wherever your pose put them: footballpose.js)
      b.x = _gb.x;
      b.y = _gb.y;
      b.z = _gb.z;
    } else {
      b.x = px + fx * 0.15 - fz * 0.3;
      b.z = pz + fz * 0.15 + fx * 0.3;
      b.y = 1.15;
    }
    if (!fbBallQuat(p.char, b.mesh.quaternion)) b.mesh.rotation.set(0, p.heading, 0); // (tucked: along the forearm)
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
    this.runMove = null;
    if (this.dr) this.dr.acc = null;
    fb.phase = 'dead';
    fb.t = 0;
    const was = this.los;
    if (z != null) this.los = Math.max(this.goal + YD, Math.min(fb.site.field.z1 - 1, z));
    let first = false;
    if (this.los <= this.first + 0.01) {
      first = true;
      this.down = 0;
      this.first = Math.max(this.goal, this.los - 10 * YD);
    } else this.down += 1;
    // (what the transition says: drivereads.js drCardFor)
    const R = this.drRes || { kind: z == null ? 'incomplete' : 'complete' };
    this.drRes = null;
    const yds = Math.round((was - this.los) / YD);
    this.drCard = this.drCardFor(R, yds, first, this.down > 3);
    this.drScorePlay(R.kind, yds, first, this.drCard); // (the play's points: drivereads.js)
    if (this.down > 3) {
      this.drWipeIn(this.drCard, true);
      this.end('downs');
    }
  }

  touchdown(who) {
    const game = this.game;
    this.tdBy = who; // (who dances in the final screen)
    for (const f of this.fb.fans) f.fb.cheerT = 2.5;
    for (const q of this.fb.wrs) q.fb.cheerT = 2;
    if (this.dr) {
      const yds = Math.round((this.los - this.goal) / YD);
      const card = this.drCardFor({ kind: 'td', why: who === 'you' ? 'You took it in yourself' : `${who.ballName || 'He'} took it to the house` }, yds, false, true);
      this.drScorePlay(who === 'you' && !this.dr.cur ? 'run' : 'complete', yds, false, card, true);
      this.drWipeIn(card, true);
    }
    else game.hud.toast(who === 'you' ? 'TOUCHDOWN! You took it in yourself' : 'TOUCHDOWN!', '#7ee081');
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
    c.group.userData.fbGrip = null;
    c.group.rotation.z = 0;
    // (one lower body and one upper body, or one whole-body move: footballpose.js fbPose, the
    // same as everyone else's in football.js)
    const sp = p.speed || 0;
    const moving = sp > 1.5; // (on the move the legs keep running under a throw)
    const throwL = (cock, release) => ({ lower: moving ? ['run'] : ['step', release > 0 ? 1 : ease(Math.min(1, cock))], upper: ['throw', cock, release] });
    let L = null;
    if (this.downT > 0) {
      const t = 1.1 - this.downT;
      const k = t < 0.25 ? t / 0.25 : this.downT < 0.35 ? this.downT / 0.35 : 1;
      const F = this.youFall;
      c.group.position.y += fbPose(c, F ? { full: ['tackled', k, F.from, F.side] } : { full: ['layout', k, false] }); // (brought down: how depends where he hit you from)
      this.placeBallDown(c, b);
      return;
    }
    this.youFall = null;
    if (this.mode === 'drive' && this.dr?.acc) {
      // (the arm coming through while you time the tap: the ball leaves the hand at the middle)
      L = { ...throwL(1, Math.min(0.34, (this.dr.acc.n / 0.5) * 0.34)), grip: 'throw' };
    } else if (this.mode && this.mode !== 'drive' && (L = this.modeLayers(c))) {
      // (the QB Challenge, playing catch: fieldmodes.js)
    } else if (this.dr?.huddle && sp < 0.3) {
      L = { lower: ['run'], upper: ['huddle'] }; // (calling it in the huddle: bent over with them)
    } else if (this.state === 'line' && sp < 0.3 && this.ready) {
      L = { lower: ['qbSet'], upper: ['snap'] };
    } else if (b.holder === 'you') {
      if (this.dropping) {
        p.heading = Math.PI; // (backpedaling, facing downfield)
        c.group.rotation.y = p.heading;
      }
      const M = this.runMove;
      if (this.press) L = throwL(Math.min(1, this.press.t / 0.15), 0);
      else if (M && M.kind === 'juke') L = { lower: ['plant', M.side, M.t / M.T], upper: ['juke', M.side, M.t / M.T, sp] };
      else if (M && M.kind === 'spin') {
        // (a full turn through the tackle, toward the ball's side; the run carries on the same way)
        const k = Math.min(1, M.t / M.T);
        L = { full: ['spin', k] };
        c.group.rotation.y = p.heading - Math.PI * 2 * (k * k * (3 - 2 * k));
      } else if (M && M.kind === 'stiff') L = { lower: ['run'], upper: ['stiffArm', M.t / M.T, sp] };
      else if (this.scramble || (sp > 3 && !this.dropping)) L = { lower: ['run'], upper: ['tuck', sp] }; // (high and tight; dropping back it stays in both hands)
      else if (this.dropping) L = { lower: ['run'], upper: ['hold', 0] }; // (two hands on it, backpedaling)
      else if (this.mode === 'qbc' && this.qbc?.jk?.move) {
        const J = this.qbc.jk.move; // (the juke past the rusher: thrown toward the side you went)
        L = { lower: ['plant', J.dir, J.t / 0.45], upper: ['juke', J.dir, J.t / 0.45, 4] };
      } else L = this.pocketPose(c, this.mode === 'qbc' ? this.qbcFace() : this.drFace()); // (set in the pocket: side-on, shuffling)
    } else if (this.throwT > 0) L = throwL(1, 1 - this.throwT / 0.4); // (the follow-through)
    if (!L) return;
    c.group.position.y += fbPose(c, L);
    if (L.grip !== undefined) c.group.userData.fbGrip = L.grip;
    this.placeBall(c, b);
  }

  // You in the pocket (the drive, the QB Challenge): side-on to where you're looking (face: the
  // yaw of the target), shuffling as you move, the feet stepping round as you turn to a new one.
  // Returns the layers (fbPose).
  pocketPose(c, face) {
    const game = this.game;
    const p = game.player;
    const dt = Math.min(0.1, game.time - (this.pkT ?? game.time));
    this.pkT = game.time;
    const [px, pz] = p.pos();
    const moved = this.pkP ? Math.hypot(px - this.pkP[0], pz - this.pkP[1]) : 0;
    this.pkP = [px, pz];
    this.pkYaw = this.pkYaw == null ? face : this.pkYaw + Math.atan2(Math.sin(face - this.pkYaw), Math.cos(face - this.pkYaw)) * Math.min(1, dt * 7);
    const turn = Math.abs(Math.atan2(Math.sin(face - this.pkYaw), Math.cos(face - this.pkYaw)));
    this.pkStep = (this.pkStep || 0) + moved * 5 + turn * dt * 14 + dt * 2;
    const moving = Math.min(1, (dt > 0 ? moved / dt : 0) / 1.4 + turn * 1.5);
    c.group.rotation.y = this.pkYaw - POCKET_CLOSE;
    return { lower: ['pocket', this.pkStep, moving], upper: ['pocketHands', 0] };
  }

  // Down with the ball: on the grass at your chest, wherever you're lying.
  placeBallDown(c, b) {
    if (b.holder !== 'you' || b.mode !== 'held') return;
    c.group.updateMatrixWorld(true);
    c.chest.getWorldPosition(_gb);
    _gb.y = Math.max(0.14, _gb.y - 0.12);
    b.x = _gb.x;
    b.y = _gb.y;
    b.z = _gb.z;
    b.mesh.position.copy(_gb);
  }

  // The ball in your hands, where this frame's pose put them.
  placeBall(c, b) {
    if (b.holder !== 'you' || b.mode !== 'held') return;
    if (!fbBallAt(c, _gb)) return;
    b.x = _gb.x;
    b.y = _gb.y;
    b.z = _gb.z;
    b.mesh.position.copy(_gb);
  }

  // ---- Over ----
  end(how) {
    const game = this.game;
    const fb = this.fb;
    const bet = this.bet;
    const name = this.bench?.ballName || 'They';
    if (this.mode && this.mode !== 'drive') this.endMode(how);
    else if (how === 'td') {
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
    const mm = document.getElementById('minimap');
    if (mm) mm.style.visibility = ''; // (the minimap back)
    game.scene.remove(this.arrow);
    for (const s of this.icons || []) if (s) game.scene.remove(s);
    this.icons = [];
    this.press = null;
    if (this.dr) {
      if (this.dr.follow && (how === 'td' || how === 'pick')) this.endFollow = { ...this.dr.follow, until: game.time + 2.6 }; // (the camera stays on it through the last result)
      this.drFinal(how); // (the drive's score, the record, the final screen: drivereads.js)
      this.drEnd();
    }
    // (whoever came off the sideline to make it three on three goes home)
    for (const d of this.extra || []) {
      if (fb.players.includes(d)) fb.players.splice(fb.players.indexOf(d), 1);
      if (fb.dbs.includes(d)) fb.dbs.splice(fb.dbs.indexOf(d), 1);
      if (fb.wrs.includes(d)) fb.wrs.splice(fb.wrs.indexOf(d), 1);
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
    this.mode = null;
    game.hud.sportEl?.classList.remove('rhythm', 'onfire');
    game.hud.sport?.(null);
    game.save();
  }
}
Object.assign(Gridiron.prototype, FieldModes); // (playing catch, the throw meter)
Object.assign(Gridiron.prototype, QBChallenge); // (the QB Challenge)
Object.assign(Gridiron.prototype, DriveReads); // (the drive's three on three: formations, concepts, the read)

const _gb = new THREE.Vector3();
