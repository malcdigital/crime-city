import * as THREE from 'three';
import { dist, rand, pick, lerpAngle, clamp, wrapAngle } from './util.js';
import { crouchPose, bendLeg } from './character.js';
import { ballMesh } from './court.js';
import { CFG } from './config.js';

const px0 = (p) => p.pos()[0];
const pz0 = (p) => p.pos()[1];
const SHOT_NAMES = { jumper: 'Jump shot', layup: 'Layup', floater: 'Floater', dunk: 'Dunk' };

// One-on-one at a basketball court against one of the people shooting there (hoops.js),
// played like NBA 2K's Blacktop.
//
// Joining: on the court, on foot, nobody after you. E / D-pad ↑ / USE plays. Q / ○ changes the
// bet ($0-$500; he matches it, never more than your cash), R / □ the game (to 11, 15 or 21).
// Each player has an overall rating (60-90), shown when he offers.
//
// Rules: 1s and 2s (2 from beyond the arc). A miss is a live ball. After a defensive rebound or
// a steal the ball has to be taken back past the arc before a basket counts. After a basket
// the other player checks it at the top. No free throws: a reach-in keeps the ball with the
// offense; a foul on a made shot is an and-one (+1).
//
// Controls (NBA 2K's layout on the controller; input.js has the keyboard and touch versions):
//   Offense  □ hold, let go at the top of the meter = shoot (a quick tap is a pump fake).
//            What you get depends on where you are: a jumper, a layup driving in close, a
//            floater sprinting in from mid-range, a dunk sprinting at the rim.
//            R2 / ✕ sprint (it costs energy). Right stick = Pro Stick dribble moves: flick left
//            or right a crossover, up a hesitation (hold up to size him up), down a step-back,
//            down-left / down-right a spin, up-left / up-right behind the back. On the controller
//            the camera looks down the court on its own while you play.
//   Defense  L2 hold = intense D (face him, slide; drive into you and you cut him off; box out
//            on a shot). □ steal (the timing matters: easier while he's doing a move; reach
//            twice in a row and it's a foul). △ block as he goes up / jump for a rebound.
// The shot meter: a perfect release ("Excellent", green) always goes in. The green window
// shrinks when he's in your face, when you shoot on the run or from deep, and when you're
// tired. Anything else is a "Slightly Early", "Late", "Very Late"... and only a chance.
// Energy: sprinting and moves drain it; standing still brings it back. Tired players are
// slower, shoot worse and get beaten off the dribble.
// Ankles: chain moves (or size him up first) and a move that beats your man can put him on the
// floor for a second. He can do it to you too.
// Walk off the court, get in a car or have the police after you and you forfeit (the bet too).
// If he gets scared off or hurt, it's called off and the bet comes back.
// (Betting against another player waits for multiplayer: the wager is held the same way.)
const ARC = 6.75;
const BETS = [0, 50, 100, 250, 500];
const TARGETS = [11, 15, 21];
const NAMES = ['Dre', 'Tank', 'Lil Mike', 'Jojo', 'Smoke', 'Ray', 'Peanut', 'Boogie', 'Shorty', 'Deuce'];
const G = 9.8;
const _axis = new THREE.Vector3();
// Shots: T = seconds to the perfect release, W = green window (seconds, its full width).
// (NBA 2K's green window is about 40-60 ms; ours is wider for a browser and a phone screen.)
const SHOTS = {
  jumper: { T: 0.5, W: 0.08 }, // (a quick jump: the top of it is the release)
  layup: { T: 0.45, W: 0.13 },
  floater: { T: 0.45, W: 0.09 },
  dunk: { T: 0.42, W: 0 },
};
const LATE = 0.35; // (held this long past the top it goes up anyway: very late)
// The green window by shot (seconds, full width). A three from the arc out to 8 m keeps its
// 80 ms; everything else is set from there: wide for layups, wider the closer a jumper is, and
// shrinking fast past 8 m (half court ~20 ms, three-quarter court a couple of ms).
function greenWindow(type, d) {
  if (type === 'layup') return 0.2;
  if (type === 'floater') return 0.12;
  return jumperWindow(d) * 1.15; // (+15% since the jump got quicker: a three is now ~92 ms)
}
function jumperWindow(d) {
  if (d <= 2) return 0.15;
  if (d <= 4.5) return 0.15 - (d - 2) * 0.012;
  if (d <= ARC) return 0.12 - ((d - 4.5) / (ARC - 4.5)) * 0.04;
  if (d <= 8) return 0.08;
  if (d <= 14) return 0.08 * Math.pow(0.7, d - 8);
  return Math.max(0.002, 0.0094 * Math.pow(0.8, d - 14));
}
// Dribble moves: how long they take, the chance they beat a good defender, the chance of
// losing it if you do it right into him.
const MOVES = {
  cross: { T: 0.32, beat: 0.3, risk: 0, name: 'Crossover' },
  behind: { T: 0.38, beat: 0.33, risk: 0.1, name: 'Behind the back' },
  spin: { T: 0.48, beat: 0.4, risk: 0.08, name: 'Spin' },
  hesi: { T: 0.48, beat: 0.3, risk: 0, name: 'Hesi' },
  step: { T: 0.34, beat: 0, risk: 0, name: 'Step-back' },
  legs: { T: 0.32, beat: 0.32, risk: 0.04, name: 'Between the legs' },
};
// How the ball changes hands: in front of you (a crossover), down under you (between the legs)
// or round your back. Returns [side (-1 your left .. 1 your right), forward, height].
const HANDOFF = { cross: 'front', spin: 'front', behind: 'behind', legs: 'legs' };
function handoff(kind, from, to, k) {
  const s = from + (to - from) * k;
  const m = Math.sin(Math.PI * k);
  const low = Math.abs(Math.cos(Math.PI * k)) * 0.55;
  if (kind === 'legs') return [s, 0.4 - 0.45 * m, 0.18 + low];
  if (kind === 'behind') return [s, 0.4 - 0.78 * m, 0.25 + low + m * 0.4];
  return [s, 0.42 + 0.06 * m, 0.18 + low];
}
const OPEN = ['Wide Open', 'Open', 'Contested', 'Heavily Contested'];
const OPEN_WINDOW = [1, 1, 0.7, 0.45]; // (green window)
const OPEN_MAKE = [1.08, 1, 0.75, 0.45]; // (a white release's chance)

export class Streetball {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.betI = 2;
    this.toI = 0;
    this.shot = null;
    this.spares = this.placeSpares();
  }

  // Spare balls lying around each court: along both sidelines, between the lines and the fence.
  // Walk up to one and pick it up to shoot around; put it down and it stays where you left it.
  placeSpares() {
    const list = [];
    for (const H of this.game.hoops || []) {
      const C = H.site.court;
      const P = H.site.pad;
      const alongZ = C.z1 - C.z0 > C.x1 - C.x0;
      // (a random 3 to 6 of them, anywhere along either sideline)
      const spots = [];
      for (const f of [0.15, 0.3, 0.45, 0.6, 0.75, 0.88]) {
        for (const side of [0, 1]) {
          const j = rand(-0.03, 0.03);
          const off = rand(-0.5, 0.5);
          if (alongZ) spots.push([side ? (C.x1 + P.x1) / 2 + off : (C.x0 + P.x0) / 2 + off, C.z0 + (C.z1 - C.z0) * (f + j)]);
          else spots.push([C.x0 + (C.x1 - C.x0) * (f + j), side ? (C.z1 + P.z1) / 2 + off : (C.z0 + P.z0) / 2 + off]);
        }
      }
      for (let i = spots.length - 1; i > 0; i--) {
        const k = Math.floor(Math.random() * (i + 1));
        [spots[i], spots[k]] = [spots[k], spots[i]];
      }
      spots.length = 3 + Math.floor(Math.random() * 4);
      for (const [x, z] of spots) {
        const mesh = ballMesh();
        mesh.position.set(x, 0.18, z);
        mesh.rotation.set(rand(0, 6), rand(0, 6), 0);
        this.game.scene.add(mesh);
        list.push({ H, mesh, home: [x, z] });
      }
    }
    return list;
  }

  nearSpare() {
    const [px, pz] = this.game.player.pos();
    let best = null;
    for (const sp of this.spares) {
      if (!sp.mesh.visible) continue;
      const d = dist(px, pz, sp.mesh.position.x, sp.mesh.position.z);
      if (d < 1.6 && (!best || d < best.d)) best = { sp, d };
    }
    return best?.sp || null;
  }

  // The basket to shoot at: the nearest one nobody's using (or just the nearest).
  soloRim(H) {
    const [px, pz] = this.game.player.pos();
    const rims = [...H.site.hoops].sort((a, b) => dist(px, pz, a.x, a.z) - dist(px, pz, b.x, b.z));
    return rims.find((rim) => !H.groups.some((g) => g.rim === rim && g.players.length)) || rims[0];
  }

  // ---- Joining (main.js handleInteractions, on foot) ----
  nearGame() {
    const game = this.game;
    const [px, pz] = game.player.pos();
    for (const H of game.hoops || []) {
      const P = H.site.pad;
      if (px < P.x0 || px > P.x1 || pz < P.z0 || pz > P.z1) continue;
      let best = null;
      for (const g of H.groups) {
        if (!g.players.length || g.match) continue;
        const d = dist(px, pz, g.rim.x, g.rim.z);
        if (!best || d < best.d) best = { H, g, d };
      }
      return best;
    }
    return null;
  }

  // A basket nobody's using (on the court you're standing on): yours to shoot around at.
  freeBasket() {
    const game = this.game;
    const [px, pz] = game.player.pos();
    for (const H of game.hoops || []) {
      const P = H.site.pad;
      if (px < P.x0 || px > P.x1 || pz < P.z0 || pz > P.z1) continue;
      let best = null;
      for (const rim of H.site.hoops) {
        if (H.groups.some((g) => g.rim === rim && g.players.length)) continue;
        const d = dist(px, pz, rim.x, rim.z);
        if (!best || d < best.d) best = { H, rim, d };
      }
      return best;
    }
    return null;
  }

  offer(a) {
    const game = this.game;
    if (this.active || game.player.vehicle || game.stars > 0 || game.stop || game.time < (this.again || 0)) return;
    const near = this.nearGame();
    const spare = this.nearSpare();
    if (spare) {
      game.prompt = `Pick up the ball and shoot around: ${game.input.label('interact')}`;
      if (a.interactHeld && !game.interactWasHeld) this.startSolo(spare.H, this.soloRim(spare.H), spare);
      return;
    }
    if (!near) return;
    const kb = game.input.mode === 'kb';
    if (a.dealNo) {
      this.betI = (this.betI + 1) % BETS.length;
      a.melee = false; // (○ changes the bet here, it doesn't throw a punch)
    }
    if (a.reload) {
      this.toI = (this.toI + 1) % TARGETS.length;
      a.reload = false;
    }
    let bet = BETS[this.betI];
    while (bet > game.cash && bet > 0) bet = BETS[BETS.indexOf(bet) - 1];
    const opp = near.g.players[0];
    if (!opp.ballName) opp.ballName = pick(NAMES);
    if (!opp.ballR) opp.ballR = Math.round(clamp(rand(58, 92) * 0.5 + rand(58, 92) * 0.5, 60, 90));
    const to = TARGETS[this.toI];
    game.prompt = `${opp.ballName} (${opp.ballR} OVR): "Run it? One-on-one, to ${to}." ${game.input.label('interact')} to play · ${kb ? 'Q' : '○'} bet: ${bet ? `$${bet}` : 'nothing'} · ${kb ? 'R' : '□'} game to ${to}`;
    if (a.interactHeld && !game.interactWasHeld) this.start(near.H, near.g, opp, bet, to);
  }

  start(H, g, opp, bet, to) {
    const game = this.game;
    this.active = true;
    this.H = H;
    this.g = g;
    this.opp = opp;
    this.rim = g.rim;
    this.bet = bet;
    this.to = to;
    this.r = opp.ballR || 75;
    game.cash -= bet; // (held until it's over)
    this.score = { you: 0, opp: 0 };
    this.cleared = true;
    this.shot = null;
    this.outT = 0;
    this.dead = null;
    this.lastShooter = null;
    this.clock = 0;
    this.you = { st: 1, beatT: 0, fallT: 0, jumpT: 0, move: null, combo: 0, lastMoveEnd: -9, rhythm: 0, hand: 1, stealT: 0, lastSteal: -9, blockT: 0, intense: false, ps: { on: false, t: 0, x: 0, y: 0 }, sizeUp: false };
    g.match = this;
    // Everyone else at that basket steps off and watches from the side.
    const C = H.site.court;
    const side = g.players.filter((q) => q !== opp);
    side.forEach((q, k) => {
      q.hp.role = 'watch';
      const along = this.rim.dz !== 0; // (the court runs along z)
      q.hp.spot = along ? [C.x0 - 1.2, this.rim.z + this.rim.dz * (5 + k * 2.5)] : [this.rim.x + this.rim.dx * (5 + k * 2.5), C.z0 - 1.2];
    });
    const hp = opp.hp;
    hp.role = 'opp';
    hp.st = 1;
    hp.beatT = 0;
    hp.fallT = 0;
    hp.lagT = 0;
    hp.combo = 0;
    hp.style = pick(['slasher', 'shooter', 'balanced']);
    this.solo = false;
    this.checkup(Math.random() < 0.5 ? 'you' : 'opp');
    game.hud.toast(`One-on-one with ${opp.ballName} (${this.r} OVR)${bet ? ` · $${bet} on it` : ''}. First to ${to}`, '#ffd23f');
  }

  // ---- Shooting around on your own ----
  // The same ball handling and shot meter, no opponent: you rebound your own misses. A stand-in
  // "opponent" stays far off the court so everything that looks for him finds nobody.
  startSolo(H, rim, spare = null) {
    const game = this.game;
    // (the ball you picked up is the one you play with)
    if (spare) this.spares.splice(this.spares.indexOf(spare), 1);
    this.strays = [];
    this.fetch = null;
    this.active = true;
    this.solo = true;
    this.H = H;
    this.rim = rim;
    this.bet = 0;
    this.to = Infinity;
    this.r = 75;
    this.score = { you: 0, opp: 0 };
    this.stats = { att: 0, made: 0, streak: 0, best: 0 };
    this.cleared = true;
    this.shot = null;
    this.outT = 0;
    this.dead = null;
    this.check = null;
    this.flight = null;
    this.lastShooter = null;
    this.clock = 0;
    this.you = { st: 1, beatT: 0, fallT: 0, jumpT: 0, move: null, combo: 0, lastMoveEnd: -9, rhythm: 0, hand: 1, stealT: 0, lastSteal: -9, blockT: 0, intense: false, ps: { on: false, t: 0, x: 0, y: 0 }, sizeUp: false };
    this.opp = { x: 1e5, z: 1e5, heading: 0, speed: 0, state: 'play', removed: false, ballName: '', hp: { st: 1, beatT: 0, fallT: 0, lagT: 0, jumpT: 0 } };
    let mesh = spare?.mesh;
    if (!mesh) {
      mesh = ballMesh();
      game.scene.add(mesh);
    }
    const [px, pz] = game.player.pos();
    this.g = { rim, players: [], match: this, ball: { mesh, x: px, y: 1, z: pz, vx: 0, vy: 0, vz: 0, mode: 'held', holder: 'you', t: 0 } };
    this.give('you');
    game.hud.toast(`Shooting around. ${game.input.label('interact')} to put the ball down`, '#ffd23f');
  }

  // ---- Check up ----
  // Pickup ball: before the game, after every bucket and after a foul or a stoppage, you both
  // go back to the top of the key, face to face (the one with the ball just past the arc, the
  // defender a step in front of him). The ball goes to the defender, he checks it back, and
  // it's live. You check it with ✕ / E (the SHOOT button on a phone).
  checkup(off, why = '') {
    const game = this.game;
    const rim = this.rim;
    const p = game.player;
    const opp = this.opp;
    const hp = opp.hp;
    const b = this.g.ball;
    const O = this.onCourt(rim.x + rim.dx * 8.2, rim.z + rim.dz * 8.2);
    const D = this.onCourt(rim.x + rim.dx * 6.8, rim.z + rim.dz * 6.8);
    const [yx, yz] = off === 'you' ? O : D;
    const [hx, hz] = off === 'you' ? D : O;
    p.x = yx;
    p.z = yz;
    p.speed = 0;
    p.heading = Math.atan2(hx - yx, hz - yz);
    opp.x = hx;
    opp.z = hz;
    opp.speed = 0;
    opp.heading = Math.atan2(yx - hx, yz - hz);
    const Y = this.you;
    Y.move = null;
    Y.dunk = null;
    Y.swap = null;
    Y.beatT = Y.fallT = Y.jumpT = 0;
    Y.sizeUp = false;
    for (const k of ['beatT', 'fallT', 'lagT', 'jumpT', 'closeT']) hp[k] = 0;
    hp.state = 'check';
    hp.boxed = false;
    this.shot = null;
    this.dead = null;
    this.flight = null;
    this.cleared = true;
    this.has = 'check';
    this.check = { off, stage: off === 'you' ? 'ready' : 'wait', t: 0 };
    b.mode = 'held';
    b.holder = off === 'you' ? 'you' : opp;
    if (why) game.hud.toast(why, '#9fc3ff');
  }

  // The ball going across at the check.
  checkPass(to) {
    const b = this.g.ball;
    const [tx, tz] = to === 'you' ? this.game.player.pos() : [this.opp.x, this.opp.z];
    this.H.launch(b, tx, 1.2, tz, 0.4);
    b.kind = 'check';
    b.to = to;
  }

  checkArrive() {
    const b = this.g.ball;
    const C = this.check;
    b.mode = 'held';
    b.holder = b.to === 'you' ? 'you' : this.opp;
    C.t = 0;
    if (C.stage === 'toDef') C.stage = 'defHolds';
    else if (C.stage === 'toYou') C.stage = 'youHold';
    else if (C.stage === 'back') {
      // Checked: ball's in.
      const off = C.off;
      this.check = null;
      this.give(off, true);
      this.game.hud.toast("Ball's in", '#ffd23f');
    }
  }

  // ---- Passing (shooting around) ----
  // Anyone on the court who hasn't got a ball: people shooting around who are waiting, people
  // watching, passers-by on the court. (Other players too, once there's multiplayer.)
  passTargets() {
    const game = this.game;
    const P = this.H.site.pad;
    const [px, pz] = game.player.pos();
    const busy = new Set();
    for (const H of game.hoops || []) for (const g of H.groups) if (g.ball.holder && g.ball.holder !== 'you') busy.add(g.ball.holder);
    return game.peds.peds.filter((q) => !q.removed && q.standing && !q.kid && q.state !== 'flee' && !busy.has(q)
      && q.x > P.x0 && q.x < P.x1 && q.z > P.z0 && q.z < P.z1 && dist(px, pz, q.x, q.z) < 22 && dist(px, pz, q.x, q.z) > 1);
  }

  // Who you're facing (your body first, then the camera).
  facingTarget(list) {
    const game = this.game;
    const p = game.player;
    const [px, pz] = p.pos();
    let best = null;
    let bs = -Infinity;
    for (const yaw of [p.heading, game.camYaw]) {
      for (const q of list) {
        const d = dist(px, pz, q.x, q.z) || 1;
        const c = ((q.x - px) * Math.sin(yaw) + (q.z - pz) * Math.cos(yaw)) / d;
        const s = c - d * 0.01;
        if (c > 0.5 && s > bs) {
          bs = s;
          best = q;
        }
      }
      if (best) return best;
    }
    return null;
  }

  // The next one over on screen (dir 1: to the right).
  nextOver(cur, dir, list) {
    const cam = this.game.camera;
    const v = new THREE.Vector3();
    v.set(cur.x, 1.3, cur.z).project(cam);
    const x0 = v.x;
    let best = null;
    let bs = Infinity;
    for (const q of list) {
      if (q === cur) continue;
      v.set(q.x, 1.3, q.z).project(cam);
      if (v.z > 1) continue;
      const dx = (v.x - x0) * dir;
      if (dx > 0.01 && dx < bs) {
        bs = dx;
        best = q;
      }
    }
    return best;
  }

  // ✕ held: locked on (the arrow over him); flick or swipe to change who; let go and it's thrown.
  // Returns true while it's taking your buttons.
  passing(dt, a) {
    const game = this.game;
    const b = this.g.ball;
    const held = a.bPass;
    const can = this.has === 'you' && b.mode === 'held' && !this.shot && !this.you.move;
    if (!can && !this.pass && held && !this.prevPass && b.mode === 'loose' && !this.fetch) {
      const [px, pz] = game.player.pos();
      if (dist(px, pz, b.x, b.z) > 7) this.callFetch();
    }
    if (!this.pass) {
      if (held && !this.prevPass && can) {
        const list = this.passTargets();
        this.pass = { target: this.facingTarget(list) || list[0] || null, acc: 0, flick: false };
        if (!this.pass.target) {
          this.pass = null;
          game.hud.toast('Nobody to pass to', '#9fc3ff');
        }
      }
      this.prevPass = held;
      if (!this.pass) {
        this.passMarkShow(null);
        return false;
      }
    }
    this.prevPass = held;
    const P = this.pass;
    const list = this.passTargets();
    if (P.target && !list.includes(P.target)) P.target = this.facingTarget(list);
    // Picking: the right stick on a controller, the camera (mouse / swipe) otherwise.
    let dir = 0;
    if (game.input.mode === 'pad' && !game.input.touchMode) {
      const x = a.bStickX || 0;
      if (Math.abs(x) > 0.6 && !P.flick) {
        dir = Math.sign(x);
        P.flick = true;
      } else if (Math.abs(x) < 0.3) P.flick = false;
    } else {
      P.acc += a.lookX;
      if (Math.abs(P.acc) > 0.06) {
        dir = P.acc < 0 ? 1 : -1;
        P.acc = 0;
      }
    }
    a.lookX = a.lookY = 0;
    if (dir && P.target) P.target = this.nextOver(P.target, dir, list) || P.target;
    // Face him while you pick (you can still walk).
    if (P.target) {
      const p = game.player;
      p.heading = Math.atan2(P.target.x - p.x, P.target.z - p.z);
    }
    this.passMarkShow(P.target);
    if (!held) {
      // Let go: it's on its way.
      this.pass = null;
      this.passMarkShow(null);
      if (P.target && can) this.throwPass(P.target);
      return false;
    }
    return true;
  }

  passMarkShow(q) {
    if (!this.passMark) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.36, 4), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
      m.rotation.x = Math.PI;
      this.game.scene.add(m);
      this.passMark = m;
    }
    this.passMark.visible = !!q;
    if (q) this.passMark.position.set(q.x, 2.55 + Math.sin(this.game.time * 6) * 0.07, q.z);
  }

  throwPass(q) {
    const game = this.game;
    const b = this.g.ball;
    const p = game.player;
    const [px, pz] = p.pos();
    const d = dist(px, pz, q.x, q.z);
    b.x = px + Math.sin(p.heading) * 0.35;
    b.z = pz + Math.cos(p.heading) * 0.35;
    b.y = 1.25;
    // (lead him a little if he's walking)
    const T = 0.25 + d / 15;
    const sp = q.speed || 0;
    this.H.launch(b, q.x + Math.sin(q.heading) * sp * T, 1.2, q.z + Math.cos(q.heading) * sp * T, T);
    b.kind = 'pass';
    b.to = q;
    this.has = null;
    this.you.armsT = 0.3;
  }

  // He catches it (or it gets away and rolls).
  passArrive() {
    const b = this.g.ball;
    const q = b.to;
    if (q && !q.removed && q.standing && dist(q.x, q.z, b.x, b.z) < 1.6) {
      b.mode = 'held';
      b.holder = q;
      this.has = 'npc';
      this.npc = { q, t: 0, hold: rand(0.6, 1.2) };
      return;
    }
    b.mode = 'loose';
    b.vx = rand(-1, 1);
    b.vz = rand(-1, 1);
    b.vy = -1;
  }

  // His pass back: yours if you're there for it.
  backArrive() {
    const b = this.g.ball;
    const [px, pz] = this.game.player.pos();
    if (dist(px, pz, b.x, b.z) < 2) return this.give('you');
    b.mode = 'loose';
    b.vx = rand(-1, 1);
    b.vz = rand(-1, 1);
    b.vy = -1;
  }

  // Whoever you passed to: a look at the basket, then he shoots it or gives it back.
  npcBall(dt) {
    const N = this.npc;
    if (this.has !== 'npc' || !N) return;
    const game = this.game;
    const b = this.g.ball;
    const q = N.q;
    N.t += dt;
    if (q.removed || !q.standing || q.state === 'flee') {
      this.npc = null;
      b.mode = 'loose';
      b.vx = rand(-1, 1);
      b.vz = rand(-1, 1);
      b.vy = 0;
      this.has = null;
      return;
    }
    if (N.t < N.hold) return;
    this.npc = null;
    const rim = this.rim;
    const dR = dist(q.x, q.z, rim.x, rim.z);
    if (!N.back && dR < 8.5 && Math.random() < 0.5) {
      // Puts it up himself (you rebound it), squared up to the rim.
      q.heading = Math.atan2(rim.x - q.x, rim.z - q.z);
      const make = Math.random() < this.base(dR) * 0.8;
      const miss = make ? 0 : rand(0.22, 0.4);
      const ang = rand(0, Math.PI * 2);
      b.y = 2.2;
      this.H.launch(b, rim.x + Math.cos(ang) * miss, rim.y + 0.08, rim.z + Math.sin(ang) * miss * 0.6, 0.75 + dR * 0.06);
      b.kind = 'npcShot';
      b.make = make;
      this.has = null;
      return;
    }
    // Back to you.
    const [px, pz] = game.player.pos();
    b.y = 1.25;
    this.H.launch(b, px, 1.2, pz, 0.25 + dist(q.x, q.z, px, pz) / 15);
    b.kind = 'back';
    this.has = null;
    if (this.fetch && this.fetch.q === q) this.releaseFetch();
  }

  // ---- Shooting around: the whole court ----
  // Past 5/8 of the way to the other end, that basket's yours (the camera swings round to it).
  // Walk over any other ball lying about and you've got it (the one you had stays where it rolls).
  soloCourt(dt, px, pz) {
    const game = this.game;
    const rim = this.rim;
    const other = this.H.site.hoops.find((r) => r !== rim);
    if (other) {
      const L = dist(rim.x, rim.z, other.x, other.z) || 1;
      if (((px - rim.x) * rim.dx + (pz - rim.z) * rim.dz) / L > 5 / 8) {
        this.rim = other;
        this.g.rim = other;
        this.camSwingT = 0.9;
      }
    }
    // Strays: balls you left rolling. When they stop they're spares again.
    for (const st of [...(this.strays || [])]) {
      const b = st.b;
      if (b.mode === 'flight') {
        b.t += dt;
        const k = Math.min(1, b.t / b.T);
        b.x = b.p0[0] + (b.p1[0] - b.p0[0]) * k;
        b.z = b.p0[2] + (b.p1[2] - b.p0[2]) * k;
        const t = Math.min(b.t, b.T);
        b.y = b.p0[1] + b.vy0 * t - 0.5 * G * t * t;
        if (b.t >= b.T) {
          b.mode = 'loose';
          b.vx = b.vx || rand(-1, 1);
          b.vz = b.vz || rand(-1, 1);
          b.vy = -1;
        }
      } else this.H.roll(b, dt);
      b.mesh.position.set(b.x, b.y, b.z);
      if (b.mode === 'loose' && b.y <= 0.2 && Math.hypot(b.vx, b.vz) < 0.08 && Math.abs(b.vy) < 0.1) {
        this.strays.splice(this.strays.indexOf(st), 1);
        this.spares.push({ H: this.H, mesh: b.mesh, home: [b.x, b.z] });
      }
    }
    // Picking up another ball (when yours is loose and not on its way to someone).
    const b = this.g.ball;
    if (this.has !== 'you' && b.mode === 'loose' && !this.fetch) {
      let pick = null;
      for (const sp of this.spares) {
        if (sp.H !== this.H || !sp.mesh.visible) continue;
        const d = dist(px, pz, sp.mesh.position.x, sp.mesh.position.z);
        if (d < 0.9 && (!pick || d < pick.d)) pick = { sp, d };
      }
      for (const st of this.strays || []) {
        const d = dist(px, pz, st.b.x, st.b.z);
        if (st.b.y < 1.5 && d < 0.9 && (!pick || d < pick.d)) pick = { st, d };
      }
      if (pick && dist(px, pz, b.x, b.z) > 1.2) {
        (this.strays ||= []).push({ b }); // (yours keeps rolling where it is)
        let nb;
        if (pick.sp) {
          this.spares.splice(this.spares.indexOf(pick.sp), 1);
          const m = pick.sp.mesh;
          nb = { mesh: m, x: m.position.x, y: m.position.y, z: m.position.z, vx: 0, vy: 0, vz: 0, mode: 'held', holder: 'you', t: 0 };
        } else {
          this.strays.splice(this.strays.indexOf(pick.st), 1);
          nb = pick.st.b;
        }
        this.g.ball = nb;
        this.give('you');
      }
    }
  }

  // "Get that for me": the nearest one on the court without a ball goes after yours and
  // passes it back.
  callFetch() {
    const game = this.game;
    const b = this.g.ball;
    let q = null;
    for (const c of this.passTargets()) if (!q || dist(c.x, c.z, b.x, b.z) < dist(q.x, q.z, b.x, b.z)) q = c;
    // Somebody with a ball closer to you than anybody can get to yours: he gives you his and
    // his group goes and gets the loose one.
    const [px, pz] = game.player.pos();
    let hg = null;
    for (const G of this.H.groups) {
      const h = G.ball.holder;
      if (G.ball.mode !== 'held' || !h || h === 'you' || h.removed || h.state !== 'play') continue;
      if (!hg || dist(h.x, h.z, px, pz) < dist(hg.ball.holder.x, hg.ball.holder.z, px, pz)) hg = G;
    }
    if (hg && (!q || dist(hg.ball.holder.x, hg.ball.holder.z, px, pz) < dist(q.x, q.z, b.x, b.z))) return this.swapWith(hg);
    if (!q) return game.hud.toast('Nobody around to get it', '#9fc3ff');
    this.fetch = { q, saved: { act: q.act, state: q.state, keep: q.keep, sidewalk: q.sidewalk }, t: 0 };
    q.act = this;
    q.state = 'play';
    q.keep = true;
    q.sidewalk = false;
    game.hud.toast('"Aye, grab that for me!"', '#ffd23f');
  }

  // His ball comes to you; yours (where it lies) becomes his group's, and they go get it.
  swapWith(G) {
    const game = this.game;
    const mine = this.g.ball;
    const his = G.ball;
    const h = his.holder;
    const old = { mesh: mine.mesh, x: mine.x, y: mine.y, z: mine.z, vx: mine.vx, vy: mine.vy, vz: mine.vz };
    // (the balls trade places: the one in his hands is yours now)
    mine.mesh = his.mesh;
    mine.x = his.x;
    mine.y = Math.max(1.1, his.y);
    mine.z = his.z;
    his.mesh = old.mesh;
    Object.assign(his, { x: old.x, y: old.y, z: old.z, vx: old.vx, vy: old.vy, vz: old.vz, mode: 'loose', holder: null });
    his.mesh.position.set(his.x, his.y, his.z);
    if (h.hp?.role === 'hold') this.H.toWait(h);
    h.heading = Math.atan2(game.player.pos()[0] - h.x, game.player.pos()[1] - h.z);
    const [px, pz] = game.player.pos();
    this.H.launch(mine, px, 1.2, pz, 0.25 + dist(h.x, h.z, px, pz) / 15);
    mine.kind = 'back';
    this.has = null;
    game.hud.toast('"Here, take mine"', '#ffd23f');
  }

  fetchDrive(p, dt) {
    const F = this.fetch;
    const b = this.g.ball;
    F.t += dt;
    if (this.has === 'npc' && b.holder === p) {
      const [px, pz] = this.game.player.pos();
      p.heading = lerpAngle(p.heading, Math.atan2(px - p.x, pz - p.z), Math.min(1, dt * 8));
      return { speed: 0 };
    }
    if (b.mode !== 'loose' || this.has === 'you' || F.t > 15) {
      this.releaseFetch();
      return { speed: 0 };
    }
    if (dist(p.x, p.z, b.x, b.z) < 0.8 && b.y < 1.2) {
      b.mode = 'held';
      b.holder = p;
      this.has = 'npc';
      this.npc = { q: p, t: 0, hold: 0.45, back: true };
      return { speed: 0 };
    }
    return { tx: b.x + b.vx * 0.3, tz: b.z + b.vz * 0.3, speed: 3.8 };
  }

  releaseFetch() {
    const F = this.fetch;
    if (!F) return;
    this.fetch = null;
    const q = F.q;
    if (q.removed) return;
    q.act = F.saved.act;
    q.keep = F.saved.keep;
    q.sidewalk = F.saved.sidewalk;
    if (F.saved.state === 'play' && F.saved.act?.toWait && q.hp?.g) {
      q.state = 'play';
      F.saved.act.toWait(q);
    } else if (q.standing && q.state !== 'flee') q.resumeWalking();
  }

  // ---- Helpers ----
  topOfKey() {
    return [this.rim.x + this.rim.dx * 8, this.rim.z + this.rim.dz * 8];
  }

  onCourt(x, z) {
    const C = this.H.site.court;
    return [clamp(x, C.x0 + 0.6, C.x1 - 0.6), clamp(z, C.z0 + 0.6, C.z1 - 0.6)];
  }

  // How open a shooter at (sx, sz) is with the defender at (dx, dz): 0 wide open .. 3 heavily.
  openness(sx, sz, dx, dz, beaten, handsUp) {
    if (beaten) return 0;
    const d = dist(sx, sz, dx, dz);
    const rx = this.rim.x - sx;
    const rz = this.rim.z - sz;
    const rl = Math.hypot(rx, rz) || 1;
    const front = ((dx - sx) * rx + (dz - sz) * rz) / ((d || 1) * rl) > 0.2;
    if (!front && d > 1.2) return 0;
    let lv = d > 3 ? 0 : d > 2 ? 1 : d > 1.05 ? 2 : 3;
    if (handsUp && d < 1.6) lv = Math.min(3, lv + 1);
    return lv;
  }

  // A white (non-green) release's chance before timing and the defense: falls off past 9 m
  // to next to nothing from half court on.
  base(d) {
    if (d < 2) return 0.72;
    if (d <= 9) return Math.max(0.3, 0.8 - d * 0.055);
    return Math.max(0.001, 0.305 * Math.pow(0.6, d - 9));
  }

  give(who, check = false) {
    const b = this.g.ball;
    this.has = who;
    b.mode = 'held';
    b.holder = who === 'you' ? 'you' : this.opp;
    this.shot = null;
    if (check) this.cleared = true;
    if (who === 'opp') {
      const hp = this.opp.hp;
      hp.role = 'opp';
      hp.state = 'walk';
      hp.t = 0;
      hp.plan = { spot: check ? this.topOfKey() : null };
      hp.combo = 0;
      hp.holdT = 0;
    }
  }

  board() {
    return `YOU ${this.score.you} — ${this.score.opp} ${this.opp.ballName.toUpperCase()} · to ${this.to}${this.bet ? ` · $${this.bet}` : ''}`;
  }

  keys() {
    const inp = this.game.input;
    if (inp.touchMode) return { shoot: 'SHOOT', sprint: 'push the stick', d: 'D', steal: 'STEAL', block: '△', moves: 'CROSS / HESI / STEP / SPIN' };
    if (inp.mode === 'pad') return { shoot: '□', sprint: 'R2', d: 'L2', steal: '□', block: '△', moves: 'right stick' };
    return { shoot: 'hold click / Space', sprint: 'Shift', d: 'right-click', steal: 'click / R', block: 'F', moves: 'J L I K U O' };
  }

  // Unit vectors: toward the rim, and to the camera's right.
  dirs(x, z) {
    const rx = this.rim.x - x;
    const rz = this.rim.z - z;
    const rl = Math.hypot(rx, rz) || 1;
    const yaw = this.game.camYaw;
    return { ux: rx / rl, uz: rz / rl, d: rl, sx: -Math.cos(yaw), sz: Math.sin(yaw) };
  }

  // ---- Your buttons (main.js, before you move; they're taken off the action list) ----
  input(dt, a) {
    const game = this.game;
    const p = game.player;
    const Y = this.you;
    const opp = this.opp;
    const hp = opp.hp;
    const b = this.g.ball;
    const shootHeld = a.bShoot;
    const stealHit = a.bSteal;
    const blockHit = a.bBlock;
    const intense = a.bIntense;
    let sprint = this.solo ? a.bSprintNoX : a.bSprint; // (shooting around, ✕ passes)
    if (this.solo && this.passing(dt, a)) {
      a.fire = a.firePressed = a.aim = a.aimPressed = a.melee = a.reload = a.dealYes = a.enter = a.crouch = false;
      a.sprint = sprint;
      this.prevShoot = a.bShoot;
      return;
    }
    const stick = this.proStick(dt, a);
    const checkHit = a.dealYes || (a.interactHeld && !game.interactWasHeld && !this.solo) || (shootHeld && !this.prevShoot);
    if (this.solo && a.interactHeld && !game.interactWasHeld) {
      this.end('done');
      return;
    }
    a.fire = a.firePressed = a.aim = a.aimPressed = a.melee = a.reload = a.dealYes = a.enter = a.crouch = false;
    // Switched baskets (shooting around): the camera swings round to the new one.
    if (this.camSwingT > 0) {
      this.camSwingT -= dt;
      const [qx, qz] = game.player.pos();
      game.camYaw = lerpAngle(game.camYaw, Math.atan2(this.rim.x - this.rim.dx * 1.5 - qx, this.rim.z - this.rim.dz * 1.5 - qz), Math.min(1, dt * 5));
    }
    // On the controller the right stick is the Pro Stick: the camera looks down the court.
    if (game.input.mode === 'pad' && !game.input.touchMode) {
      a.lookX = a.lookY = 0;
      // (at the basket from wherever you are: aimed at a spot just behind the rim, so from the top
      // of the key it's straight down the court and from a corner it still has the hoop in view)
      const [qx, qz] = game.player.pos();
      const want = Math.atan2(this.rim.x - this.rim.dx * 1.5 - qx, this.rim.z - this.rim.dz * 1.5 - qz);
      game.camYaw = lerpAngle(game.camYaw, want, Math.min(1, dt * 2.5));
    }
    // Checking it up: nobody moves.
    if (this.check) {
      this.clock += dt;
      a.moveX = a.moveY = 0;
      a.sprint = false;
      const C = this.check;
      if (checkHit && C.stage === 'ready') {
        C.stage = 'toDef';
        this.checkPass('opp');
      } else if (checkHit && C.stage === 'youHold') {
        C.stage = 'back';
        this.checkPass('opp');
      }
      this.prevShoot = shootHeld;
      return;
    }
    this.clock += dt;
    Y.stealT = Math.max(0, Y.stealT - dt);
    Y.blockT = Math.max(0, Y.blockT - dt);
    Y.jumpT = Math.max(0, Y.jumpT - dt);
    Y.beatT = Math.max(0, Y.beatT - dt);
    const [px, pz] = p.pos();
    const D = this.dirs(px, pz);
    const moving = Math.hypot(a.moveX, a.moveY) > 0.3;
    // Energy.
    if (Y.st < 0.12) sprint = false;
    if (sprint && moving) Y.st = Math.max(0, Y.st - dt * 0.06); // (your energy lasts ~50% longer than his)
    else Y.st = Math.min(1, Y.st + dt * (moving ? 0.04 : 0.08));
    // On the floor (ankles): nothing.
    if (Y.fallT > 0) {
      Y.fallT -= dt;
      a.moveX = a.moveY = 0;
      a.sprint = false;
      this.prevShoot = shootHeld;
      return;
    }
    // A dunk in progress (the glide up, the hang, the drop): it moves you, not the stick.
    if (Y.dunk) {
      this.updateDunk(dt);
      a.moveX = a.moveY = 0;
      a.sprint = false;
      if (this.shot) this.shooting(dt, a, shootHeld, null);
      this.prevShoot = shootHeld;
      return;
    }
    Y.intense = false;
    hp.boxed = false;
    // (how you've been moving lately: for telling a drive to the rim)
    Y.vx = (Y.vx || 0) + ((p.vx || 0) - (Y.vx || 0)) * Math.min(1, dt * 8);
    Y.vz = (Y.vz || 0) + ((p.vz || 0) - (Y.vz || 0)) * Math.min(1, dt * 8);
    this.approaching = false;
    // ---- Offense ----
    if (this.has === 'you' && b.mode === 'held') {
      if (this.shot) {
        this.shooting(dt, a, shootHeld, stick);
        if (this.approaching) sprint = true;
      } else {
        // A dribble move (Pro Stick) or a size-up.
        Y.stickIdle = Math.hypot(a.moveX, a.moveY) < 0.2;
        if (stick && !Y.move) this.startMove(stick.kind, stick.side, sprint);
        Y.sizeUp = !!a.bSizeUp || this.psHoldUp;
        if (Y.sizeUp && !Y.move) {
          Y.rhythm = Math.min(0.3, Y.rhythm + dt * 0.25);
          a.moveX = a.moveY = 0;
        } else if (this.clock - Y.lastMoveEnd > 1.5) Y.rhythm = Math.max(0, Y.rhythm - dt * 0.2);
        if (Y.move) {
          const big = Y.move.big;
          this.doMove(dt, a);
          sprint = big; // (with R2 a move's a burst; without, it's a quick one on the spot)
        }
        // Facing up: hold L2 (right-click) and you stay square to the basket whichever way you
        // go: backing up is a low shuffle, sideways a side-step (slower, no sprint). Without it,
        // going away from the basket you just turn and go. (On a phone the back-pedal's automatic.)
        Y.backpedal = Y.squareUp = false;
        if (!Y.move && !Y.sizeUp && Math.hypot(a.moveX, a.moveY) > 0.3) {
          const yaw = game.camYaw;
          const wx = Math.sin(yaw) * a.moveY - Math.cos(yaw) * a.moveX;
          const wz = Math.cos(yaw) * a.moveY + Math.sin(yaw) * a.moveX;
          const away = (wx * D.ux + wz * D.uz) / Math.hypot(wx, wz) < -0.3;
          if (a.bIntense || (game.input.touchMode && away)) {
            Y.squareUp = true;
            Y.backpedal = away;
            const k = away ? 0.65 : 0.8;
            a.moveX *= k;
            a.moveY *= k;
            sprint = false;
          }
        }
        // Keep it in the outside hand, away from trouble.
        // (the steps into a layup or dunk are a run)
        if (!Y.move && !Y.sizeUp) this.protect(dt);
        // The shot (on the press).
        if (shootHeld && !this.prevShoot && !this.shot) this.startShot(a, sprint, moving, D);
        // △: off the backboard to yourself (an alley-oop) from 3 to 9.5 m out.
        else if (blockHit && !this.shot && D.d > 3 && D.d < 9.5 && (this.solo || this.cleared)) this.tossOop();
      }
    } else {
      if (this.shot) this.shot = null;
      Y.move = null;
      Y.sizeUp = false;
    }
    // ---- Defense ----
    if (this.has === 'opp' || b.mode !== 'held') {
      const dO = dist(px, pz, opp.x, opp.z);
      if (intense && this.has === 'opp') {
        Y.intense = true;
        sprint = false;
        a.moveX *= 0.85;
        a.moveY *= 0.85;
      }
      // Box out: intense D while the shot's up or the ball's loose.
      hp.boxed = intense && b.mode !== 'held' && dO < 1.7;
      if (stealHit && this.has === 'opp' && Y.stealT <= 0) this.trySteal(dO);
      if (blockHit && Y.blockT <= 0) {
        Y.blockT = 0.9;
        Y.jumpT = 0.55;
        if (this.has === 'opp' && hp.state === 'shoot') this.tryBlock(dO);
      }
    }
    // Beaten off the dribble: a step slow.
    if (Y.beatT > 0) {
      a.moveX *= 0.35;
      a.moveY *= 0.35;
      sprint = false;
    }
    // Tired: slower.
    const k = 0.75 + 0.25 * Y.st;
    a.moveX *= k;
    a.moveY *= k;
    a.sprint = sprint;
    this.prevShoot = shootHeld;
  }

  // The right stick (controller): a quick flick is a move; held up, a size-up.
  // Keyboard and touch send their moves straight in (a.bMove).
  proStick(dt, a) {
    if (a.bMove) return a.bIntense && a.bMove.kind === 'cross' ? { kind: 'legs', side: a.bMove.side } : a.bMove;
    const ps = this.you.ps;
    const x = a.bStickX || 0;
    const y = a.bStickY || 0;
    const m = Math.hypot(x, y);
    this.psHoldUp = false;
    if (m > 0.7) {
      if (!ps.on) Object.assign(ps, { on: true, t: 0, x, y });
      else ps.t += dt;
      if (ps.t > 0.3 && ps.y < -0.6) this.psHoldUp = true;
      return null;
    }
    if (m < 0.3 && ps.on) {
      ps.on = false;
      if (ps.t > 0.3) return null;
      const ang = Math.atan2(ps.x, -ps.y); // 0 = up, + = right
      const s = Math.sign(ang) || 1;
      const A = Math.abs(ang);
      if (A < 0.5) return { kind: 'hesi', side: 0 };
      if (A < 1.1) return { kind: 'behind', side: s };
      if (A < 2.0) return { kind: a.bIntense ? 'legs' : 'cross', side: s }; // (L2 held: between the legs)
      if (A < 2.6) return { kind: 'spin', side: s };
      return { kind: 'step', side: 0 };
    }
    return null;
  }

  // big: R2 (sprint) held: the exaggerated, burst version. Without it a crossover is a quick
  // one right in front of you (a small step to the side, chainable), and a flick toward the hand
  // the ball's already in is a hesitation (a hitch and a dip; with R2 the full stop-and-go).
  startMove(kind, side, big = false) {
    const Y = this.you;
    if (!MOVES[kind] || this.shot) return;
    // (Y.hand: the hand the ball's in, 1 right, -1 left. The moves that switch hands take it to
    // the side you're going: a crossover to the right ends in your right hand.)
    const p = this.game.player;
    const rx = -Math.cos(p.heading);
    const rz = Math.sin(p.heading);
    const D = this.dirs(...p.pos());
    const switches = kind === 'cross' || kind === 'behind' || kind === 'spin' || kind === 'legs';
    if (switches && !side) {
      // (no way given: the other hand, whichever way that is on screen)
      side = Math.sign((rx * D.sx + rz * D.sz) * -Y.hand) || 1;
    }
    const chain = this.clock - Y.lastMoveEnd < 0.7;
    Y.combo = chain ? Math.min(3, Y.combo + 1) : 0;
    Y.swap = null;
    const from = Y.hand;
    let to = switches ? Math.sign((D.sx * side) * rx + (D.sz * side) * rz) || -Y.hand : Y.hand;
    // (a crossover flicked toward the hand that's already got it: a hesitation that way)
    if (kind === 'cross' && to === from) kind = 'hesi';
    if (kind === 'hesi') to = from;
    const M = MOVES[kind];
    const quick = !big && (kind === 'cross' || kind === 'hesi');
    const T = quick ? (kind === 'cross' ? 0.2 : 0.28) : M.T;
    Y.move = { kind, side, t: 0, T: T * (1.15 - 0.15 * Y.st), from, to, big: !quick };
    Y.st = Math.max(0, Y.st - 0.027);
    Y.hand = to;
    Y.sizeUp = false;
    this.react(kind, Y.combo, Y.rhythm, !quick);
    Y.rhythm = 0;
  }

  // His read on your move: beaten, on the floor, picked, or he stays with you.
  react(kind, combo, rhythm, big = true) {
    const game = this.game;
    const opp = this.opp;
    const hp = opp.hp;
    const [px, pz] = game.player.pos();
    const d = dist(px, pz, opp.x, opp.z);
    if (d > 3.5 || hp.fallT > 0) return;
    const M = MOVES[kind];
    const def = 1.45 - this.r / 100;
    if (kind === 'step') {
      if (Math.random() < 0.65 * def * 1.2) hp.lagT = 0.7; // (he doesn't close out in time)
      return;
    }
    // Into him, the risky ones can get picked.
    if (M.risk && d < 1.0 && Math.random() < M.risk * (this.r / 75)) {
      game.hud.toast(`${opp.ballName} picked your pocket`, '#ff8080');
      this.give('opp');
      this.cleared = false;
      this.lastShooter = 'you';
      return;
    }
    const p = (M.beat * (big ? 1 : 0.6) + combo * 0.1 + rhythm) * def * (0.6 + 0.4 * this.you.st) * (0.8 + 0.2 * (1 - hp.st)); // (the quick ones beat him less on their own, more in a chain)
    if (Math.random() < p) {
      const already = hp.beatT > 0;
      hp.beatT = 0.75;
      if ((combo >= 1 || rhythm >= 0.15 || already) && Math.random() < 0.3) {
        hp.fallT = 1.2;
        game.hud.toast(`ANKLE BREAKER! ${opp.ballName}'s on the floor`, '#7ee081');
        for (const q of this.g.players) if (q.hp.role === 'watch') q.hp.cheerT = 1.2;
      } else game.hud.toast(`${M.name}: you got by him`, '#7ee081');
    }
  }

  // A move in progress: the burst (it steers you), the ball switching hands.
  doMove(dt, a) {
    const game = this.game;
    const Y = this.you;
    const mv = Y.move;
    mv.t += dt;
    const [px, pz] = game.player.pos();
    const D = this.dirs(px, pz);
    let wx = 0;
    let wz = 0;
    const s = mv.side;
    let mag = 1;
    if (!mv.big && mv.kind === 'cross') {
      // (quick crossover: just a little step to that side, right where you are)
      wx = D.sx * s;
      wz = D.sz * s;
      mag = 0.35;
    } else if (!mv.big && mv.kind === 'hesi') {
      // (quick hesitation: a hitch on the spot)
    } else if (mv.kind === 'cross' || mv.kind === 'behind' || mv.kind === 'legs') {
      wx = D.sx * s * 0.85 + D.ux * 0.5;
      wz = D.sz * s * 0.85 + D.uz * 0.5;
    } else if (mv.kind === 'spin') {
      const k = mv.t / mv.T;
      wx = D.sx * s * (1 - k) + D.ux * (0.4 + k);
      wz = D.sz * s * (1 - k) + D.uz * (0.4 + k);
    } else if (mv.kind === 'hesi') {
      if (mv.t > 0.2) {
        wx = D.ux;
        wz = D.uz;
      }
    } else if (mv.kind === 'step') {
      wx = -D.ux;
      wz = -D.uz;
    }
    const L = Math.hypot(wx, wz);
    if (L > 0.01) {
      // (world direction -> stick, camera-relative)
      const fx = Math.sin(game.camYaw);
      const fz = Math.cos(game.camYaw);
      a.moveY = ((wx * fx + wz * fz) / L) * mag;
      a.moveX = ((wx * -fz + wz * fx) / L) * mag;
      a.bSprint = mv.big;
    } else a.moveX = a.moveY = 0;
    if (mv.t >= mv.T) {
      Y.lastMoveEnd = this.clock;
      Y.lastMove = mv.kind;
      Y.move = null;
      // (after a crossover you square back up to the basket, unless you're steering somewhere)
      if (mv.kind === 'cross' || mv.kind === 'legs' || mv.kind === 'behind') Y.squareT = 0.4;
    }
  }

  // ---- Your shot ----
  startShot(a, sprint, moving, D) {
    const Y = this.you;
    const game = this.game;
    const p = game.player;
    // Driving at the rim: how fast you've actually been going its way (the last ~0.2 s).
    const toward = Y.vx * D.ux + Y.vz * D.uz > 2.2;
    // The left stick right now, on the court: pulled back away from the rim = a floater.
    const yaw = game.camYaw;
    const sx = Math.sin(yaw) * a.moveY - Math.cos(yaw) * a.moveX;
    const sz = Math.cos(yaw) * a.moveY + Math.sin(yaw) * a.moveX;
    const pullBack = Math.hypot(sx, sz) > 0.4 && (sx * D.ux + sz * D.uz) / Math.hypot(sx, sz) < -0.4;
    let type = 'jumper';
    if (toward && pullBack && D.d > 1.5 && D.d < 6.5) type = 'floater';
    else if (D.d <= 3.8 && sprint && toward) type = 'dunk';
    else if (D.d <= 5 && toward) type = 'layup';
    const stepback = Y.move?.kind === 'step' || (Y.lastMove === 'step' && this.clock - Y.lastMoveEnd < 0.5);
    Y.move = null;
    // A fadeaway: a jumper going away from the basket (drifting back, the stick pulled back, or
    // off a step-back).
    const away = Y.vx * D.ux + Y.vz * D.uz < -1.2;
    const fade = type === 'jumper' && (away || stepback || (pullBack && !toward));
    // Square up: a small turn happens on the way up; facing away (over ~70°) you pivot on your
    // foot first, which takes a moment (half a turn ~0.35 s), and the meter waits for it.
    const off = Math.abs(wrapAngle(Math.atan2(D.ux, D.uz) - p.heading));
    const pivot = off > 1.2;
    const turnT = pivot ? off / 9 : 0;
    this.shot = { type, t: 0, T: SHOTS[type].T + turnT, W: greenWindow(type, D.d), d0: D.d, pts: D.d > ARC ? 2 : 1, onRun: moving && p.speed > 3, sprint, stepback, euro: false, pivot, turnT };
    // Layups and dunks: the gather, then the steps (the gather doesn't count as one: two are
    // allowed), then up off the last one. A layup goes up off the foot opposite the shooting
    // hand. A dunk from close in is a jump stop (both feet), from 1-2 m one step, beyond that two.
    let how = '';
    if (type === 'layup' || type === 'dunk') {
      const steps = type === 'layup' ? 2 : D.d > 2.5 ? 2 : D.d > 1.2 ? 1 : 0;
      // (where you go up from: 1.5 m out for a layup, 1.6 m for a dunk, or right here)
      const out = type === 'layup' ? 1.5 : 1.6;
      // (at the speed you were already going: the steps keep your momentum; close in, you just
      // go up nearer the rim rather than slowing down)
      const sp = Math.max(4.5, Math.hypot(Y.vx, Y.vz));
      const T = steps ? clamp((D.d - out) / sp, 0.25, 0.7) : 0.15;
      const go = steps ? clamp(sp * T, 0, D.d - (type === 'layup' ? 0.9 : 0.7)) : 0;
      this.shot.approach = { T, steps, tx: px0(p) + D.ux * go, tz: pz0(p) + D.uz * go };
      how = steps ? ` (gather + ${steps} step${steps > 1 ? 's' : ''})` : ' (jump stop)';
      if (type === 'layup') this.shot.T = T + 0.3; // (then up: the top of the jump is the release)
      else this.shot.T = T + 0.55;
    }
    Y.jumpT = 0;
    Y.fall = null; // (the jump's timed to the shot: the top of it is the perfect release)
    this.shot.fade = fade;
    if (CFG.SHOT_TYPE_DEBUG) game.hud.toast(`[test] ${SHOT_NAMES[type]}${how}${stepback ? ' (step-back)' : ''}${fade ? ' (fadeaway)' : ''}${pivot ? ' (turnaround)' : ''}`, '#c9a7ff');
    Y.st = Math.max(0, Y.st - 0.013);
    // He closes out.
    this.opp.hp.closeT = 1;
  }

  shooting(dt, a, held, stick) {
    const s = this.shot;
    s.t += dt;
    a.moveX = a.moveY = 0;
    // The gather and the steps: you carry on to where you go up from, at the pace that gets you
    // there in time. Then the dunk takes over from the takeoff.
    const A = s.approach;
    if (A && !this.you.dunk) {
      const p = this.game.player;
      const [px, pz] = p.pos();
      if (s.t < A.T) {
        const r = dist(px, pz, A.tx, A.tz);
        if (r > 0.05) {
          const v = Math.min(8.5, r / Math.max(0.04, A.T - s.t));
          const wx = (A.tx - px) / r;
          const wz = (A.tz - pz) / r;
          const yaw = this.game.camYaw;
          const fx = Math.sin(yaw);
          const fz = Math.cos(yaw);
          const len = Math.min(1, v / 7.5);
          a.moveY = (wx * fx + wz * fz) * len;
          a.moveX = (wx * -fz + wz * fx) * len;
          this.approaching = true;
        }
      } else if (s.type === 'dunk') {
        // Up: from here to the rim.
        this.startDunk(0);
        this.you.dunk.rise = s.T - s.t;
      } else if (s.type === 'layup' && s.t < s.T) {
        // In the air, still carrying in toward the rim (to about half a meter out).
        const fx = this.rim.x + this.rim.dx * 0.6;
        const fz = this.rim.z + this.rim.dz * 0.6;
        const r = dist(px, pz, fx, fz);
        if (r > 0.05) {
          const step = Math.min(r, (r / Math.max(0.05, s.T - s.t)) * dt);
          p.x += ((fx - px) / r) * step;
          p.z += ((fz - pz) / r) * step;
        }
      }
    }
    // Turning to the basket: pivoting on the floor first if he's facing away, then in the air.
    const p = this.game.player;
    const [px, pz] = p.pos();
    const want = Math.atan2(this.rim.x - px, this.rim.z - pz);
    const d = wrapAngle(want - p.heading);
    const rate = s.t < s.turnT ? 9 : 14;
    p.heading += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    // Fading: drifting back through the jump, quickest on the way up.
    if (s.fade) this.fadeDrift(p, px, pz, Math.min(1, Math.max(0, s.t - s.turnT - 0.03) / 0.6), dt);
    a.bSprint = false;
    // Euro step: a Pro Stick move during the layup gather.
    if (s.type === 'layup' && stick && !s.euro && s.t < 0.3) {
      s.euro = true;
      this.game.hud.toast('Euro step', '#ffd23f');
    }
    if (s.type === 'dunk') {
      if (s.t >= s.T) this.resolveYou(0);
      return;
    }
    if (!held || s.t >= s.T + LATE) {
      // A quick tap on a jumper: a pump fake.
      if (s.type === 'jumper' && s.t < 0.12 && !s.stepback) return this.pumpFake();
      // (let go sometime during the last frame: count it from the middle of it)
      this.resolveYou(held ? s.t - s.T : s.t - dt / 2 - s.T);
    }
  }

  // (the backward drift of a fadeaway, easing off over the jump; k 0..1)
  fadeDrift(p, px, pz, k, dt) {
    if (k >= 1) return;
    const rx = this.rim.x - px;
    const rz = this.rim.z - pz;
    const L = Math.hypot(rx, rz) || 1;
    const v = 2.2 * (1 - k);
    const [nx, nz] = this.onCourt(px - (rx / L) * v * dt, pz - (rz / L) * v * dt);
    p.x = nx;
    p.z = nz;
  }

  // Your height in a jump shot: a quick gather (after any pivot), up to the top of the jump right
  // at the perfect release, then coming down if you're still holding it.
  shotHeight(s) {
    const H = s.type === 'jumper' ? 0.45 : 0.55;
    const g0 = s.approach ? s.approach.T : s.turnT + 0.08;
    if (s.t < g0) return 0;
    const up = s.T - g0;
    const k = (s.t - g0) / Math.max(0.05, up);
    if (k <= 1) return H * Math.sin((k * Math.PI) / 2);
    return H * Math.max(0, Math.cos(Math.min(1, (s.t - s.T) / 0.3) * (Math.PI / 2)));
  }

  // ---- Dunks ----
  // Gather and glide in to just in front of the rim, rise (0.55 s), throw it down, hang on the
  // rim a moment if it went in, drop. Styles: two-hand, one-hand, windmill, tomahawk.
  startDunk(t0) {
    const p = this.game.player;
    const [px, pz] = p.pos();
    const rim = this.rim;
    this.you.dunk = {
      x0: px, z0: pz, ax: rim.x + rim.dx * 0.45, az: rim.z + rim.dz * 0.45,
      style: pick(['two', 'two', 'one', 'one', 'windmill', 'tomahawk']), t: t0, rise: 0.55, hang: 0.35, drop: 0.28, hangs: false,
    };
  }

  updateDunk(dt) {
    const Y = this.you;
    const D = Y.dunk;
    const p = this.game.player;
    D.t += dt;
    const k = Math.min(1, D.t / D.rise);
    const e = 1 - (1 - k) * (1 - k);
    p.x = D.x0 + (D.ax - D.x0) * e;
    p.z = D.z0 + (D.az - D.z0) * e;
    p.speed = 0;
    p.heading = Math.atan2(this.rim.x - p.x, this.rim.z - p.z);
    const end = D.rise + (D.hangs ? D.hang : 0) + D.drop;
    if (D.t >= end && !this.shot) Y.dunk = null;
  }

  dunkHeight() {
    const D = this.you.dunk;
    if (!D) return 0;
    const H = 0.95;
    if (D.t < D.rise) return H * Math.sin((D.t / D.rise) * Math.PI * 0.5);
    let t = D.t - D.rise;
    if (D.hangs) {
      if (t < D.hang) return H;
      t -= D.hang;
    }
    return H * Math.max(0, 1 - (t / D.drop) ** 2);
  }

  // Arm angles (up from hanging straight down): right, left.
  dunkArms() {
    const D = this.you.dunk;
    const k = Math.min(1, D.t / D.rise);
    if (D.t >= D.rise) return D.hangs && D.t < D.rise + D.hang ? [3.0, 3.0] : [2.0, 1.6];
    if (D.style === 'two') return [1.2 + k * 1.9, 1.2 + k * 1.9];
    if (D.style === 'one') return [1.2 + k * 1.9, 1.0];
    if (D.style === 'windmill') return [0.4 + k * 2.6 + Math.sin(k * Math.PI) * 3.2, 1.0]; // (the ball goes round)
    return [k < 0.7 ? 1.4 + (k / 0.7) * 2.4 : 3.8 - ((k - 0.7) / 0.3) * 0.8, 1.2]; // tomahawk: cocked behind the head
  }

  // ---- Alley-oop off the backboard ----
  tossOop() {
    const game = this.game;
    const b = this.g.ball;
    const p = game.player;
    const [px, pz] = p.pos();
    const rim = this.rim;
    // (the glass is 0.4 m behind the rim)
    const bx = rim.x - rim.dx * 0.3;
    const bz = rim.z - rim.dz * 0.3;
    b.x = px + Math.sin(p.heading) * 0.3;
    b.z = pz + Math.cos(p.heading) * 0.3;
    b.y = 2.0;
    this.H.launch(b, bx, 3.5, bz, 0.4 + dist(px, pz, bx, bz) / 14);
    b.kind = 'oop';
    this.has = null;
    this.oopCleared = this.cleared;
    this.you.armsT = 0.3;
    game.hud.toast('Off the glass!', '#ffd23f');
  }

  // Off the board and back out over the rim: catch it in the air and finish.
  oopBounce() {
    const b = this.g.ball;
    const rim = this.rim;
    this.H.launch(b, rim.x + rim.dx * 1.2, 2.9, rim.z + rim.dz * 1.2, 0.55);
    b.kind = 'oop2';
  }

  catchOop() {
    const game = this.game;
    const b = this.g.ball;
    const [px, pz] = game.player.pos();
    const d = dist(px, pz, this.rim.x, this.rim.z);
    b.mode = 'held';
    b.holder = 'you';
    this.has = 'you';
    this.cleared = this.oopCleared ?? this.cleared;
    this.startDunk(0.22); // (you've already left the floor)
    const D = this.you.dunk;
    this.shot = { type: 'dunk', t: 0, T: D.rise - D.t, W: 0, d0: d, pts: 1, oop: true, turnT: 0 };
    if (CFG.SHOT_TYPE_DEBUG) game.hud.toast('[test] Alley-oop dunk', '#c9a7ff');
    this.opp.hp.closeT = 1;
  }

  // ---- Ball protection ----
  // Turned sideways to trouble (him if he's close, otherwise the basket side), a ballhandler
  // switches it to the outside hand, the one away from it.
  // How he switches depends on which way he turned: toward the trouble, behind the back (the
  // ball never crosses in front of it); away from it, a crossover in front or between the legs.
  protect(dt) {
    const Y = this.you;
    const p = this.game.player;
    const [px, pz] = p.pos();
    const near = !this.solo && dist(px, pz, this.opp.x, this.opp.z) < 4.5;
    const tx = near ? this.opp.x : this.rim.x;
    const tz = near ? this.opp.z : this.rim.z;
    if (Y.swap) {
      Y.swap.t += dt;
      if (Y.swap.t >= Y.swap.T) Y.swap = null;
      return;
    }
    if (this.clock < (Y.swapCd || 0)) return;
    const side = this.threatSide(px, pz, p.heading, tx, tz);
    if (Math.abs(side) > 0.6 && Math.sign(side) === Y.hand) {
      Y.swap = this.switchHands(Y.hand, px, pz, p.heading, tx, tz);
      Y.hand = -Y.hand;
      Y.swapCd = this.clock + 0.9;
    }
  }

  // (the trouble still out in front: he turned toward it, so round the back; behind him: he
  // turned away, so a crossover in front or between the legs is safe)
  switchHands(hand, x, z, h, tx, tz) {
    const ahead = (tx - x) * Math.sin(h) + (tz - z) * Math.cos(h) > 0;
    const kind = ahead ? 'behind' : Math.random() < 0.5 ? 'front' : 'legs';
    return { from: hand, to: -hand, t: 0, T: kind === 'behind' ? 0.32 : kind === 'legs' ? 0.3 : 0.25, kind };
  }

  protectHim(p, dt) {
    const hp = p.hp;
    hp.hand = hp.hand || 1;
    const [px, pz] = this.game.player.pos();
    const near = dist(px, pz, p.x, p.z) < 4.5;
    const tx = near ? px : this.rim.x;
    const tz = near ? pz : this.rim.z;
    if (hp.swap) {
      hp.swap.t += dt;
      if (hp.swap.t >= hp.swap.T) hp.swap = null;
      return;
    }
    if (this.clock < (hp.swapCd || 0)) return;
    const side = this.threatSide(p.x, p.z, p.heading, tx, tz);
    if (Math.abs(side) > 0.6 && Math.sign(side) === hp.hand) {
      hp.swap = this.switchHands(hp.hand, p.x, p.z, p.heading, tx, tz);
      hp.hand = -hp.hand;
      hp.swapCd = this.clock + 0.9;
    }
  }

  // Which side of a player (facing h) a point is on: +1 his right .. -1 his left.
  threatSide(x, z, h, tx, tz) {
    const vx = tx - x;
    const vz = tz - z;
    const L = Math.hypot(vx, vz) || 1;
    return (vx * -Math.cos(h) + vz * Math.sin(h)) / L;
  }

  pumpFake() {
    const game = this.game;
    const hp = this.opp.hp;
    this.shot = null;
    this.you.jumpT = 0;
    hp.closeT = 0;
    const [px, pz] = game.player.pos();
    if (dist(px, pz, this.opp.x, this.opp.z) < 2.6 && hp.fallT <= 0 && hp.beatT <= 0 && Math.random() < 0.6 - (this.r - 60) / 100) {
      hp.jumpT = 0.7;
      hp.beatT = 0.85;
      game.hud.toast(`${this.opp.ballName} bit on the pump fake`, '#7ee081');
    }
  }

  // The green window right now (it shrinks when he's on you, on the run, from deep, tired).
  windowNow() {
    const s = this.shot;
    const game = this.game;
    const [px, pz] = game.player.pos();
    const opp = this.opp;
    const hp = opp.hp;
    let lv = this.openness(px, pz, opp.x, opp.z, hp.beatT > 0.2 || hp.fallT > 0, (hp.jumpT || 0) > 0);
    if (s.fade) lv = Math.max(0, lv - 1); // (fading away from his hand)
    let w = s.W * OPEN_WINDOW[lv];
    if (s.fade) w *= 0.9; // (harder going backward)
    if (s.type === 'jumper' && s.sprint) w *= 0.6;
    else if (s.type === 'jumper' && s.onRun) w *= 0.85;
    if (s.stepback) w *= 0.9;
    if (s.pivot) w *= 0.85; // (a turnaround's harder)
    if (this.you.st < 0.4) w *= 0.75;
    if (game.input.touchMode) w *= 1.4;
    return { w, lv };
  }

  resolveYou(e) {
    const game = this.game;
    const s = this.shot;
    const opp = this.opp;
    const hp = opp.hp;
    const [px, pz] = game.player.pos();
    const { w, lv } = this.windowNow();
    this.shot = null;
    let make;
    let grade = '';
    let green = false;
    if (s.type === 'dunk') {
      // At the rim: a contact dunk if he's there.
      const contact = lv >= 3;
      if (contact && Math.random() < 0.15 * (this.r / 75)) return this.swatted(px, pz, `${opp.ballName} STUFFED the dunk!`, 'you');
      make = Math.random() < (contact ? 0.6 : s.oop ? 0.88 : 0.95);
      const name = { two: 'Two-hand slam!', one: 'One-hand jam!', windmill: 'WINDMILL!', tomahawk: 'Tomahawk!' }[this.you.dunk?.style] || 'Slam!';
      grade = make ? (contact ? 'POSTERIZED HIM!' : s.oop ? `ALLEY-OOP! ${name}` : name) : 'Rimmed it out';
      game.shakeCamera?.(make ? 0.14 : 0.07, 0.4); // (the rim rattles)
      if (this.you.dunk) this.you.dunk.hangs = make; // (hang on the rim after a make)
    } else {
      const m = Math.abs(e) - w / 2;
      green = m <= 0 && (s.d0 <= 14 || Math.random() < 0.5); // (from way out even a perfect one can miss)
      const when = e < 0 ? 'Early' : 'Late';
      grade = green ? 'EXCELLENT' : m < 0.06 ? `Slightly ${when}` : m < 0.16 ? when : `Very ${when}`;
      const tm = green ? 1 : m < 0.06 ? 0.7 : m < 0.16 ? 0.4 : 0.12;
      // His contest: a block on a heavy contest.
      const blockP = { jumper: 0.1, layup: 0.2, floater: 0.12 }[s.type] * (this.r / 75) * (s.euro ? 0.5 : 1);
      if (lv >= 2 && (hp.jumpT || 0) > 0 && Math.random() < blockP) return this.swatted(px, pz, `Blocked by ${opp.ballName}`, 'you');
      const base = s.type === 'layup' ? 0.82 : s.type === 'floater' ? 0.55 : this.base(s.d0);
      make = green || Math.random() < base * tm * OPEN_MAKE[lv] * (0.7 + 0.3 * this.you.st);
    }
    // A foul on the shot: and-one if it goes, your ball again if not.
    this.foulOnShot = lv >= 3 && Math.random() < 0.08;
    game.hud.toast(this.solo ? grade : `${grade} · ${OPEN[lv]}`, green || (s.type === 'dunk' && make) ? '#7ee081' : make ? '#ffd23f' : '#ff8080');
    if (s.type === 'dunk') {
      this.g.ball.y = Math.max(this.g.ball.y, this.rim.y + 0.15); // (from your hands, through the rim)
      this.launch(make, 'you', s.pts, 0.14);
    } else {
      this.launch(make, 'you', s.pts);
      // Back down from wherever you let it go.
      const h = this.shotHeight(s);
      this.you.fall = { h0: h, t: 0, T: Math.max(0.12, Math.sqrt((2 * h) / 9.8)), fade: s.fade ? Math.min(1, Math.max(0, s.t - s.turnT - 0.03) / 0.6) : null };
    }
  }

  swatted(x, z, text, shooter) {
    const b = this.g.ball;
    this.shot = null;
    b.mode = 'loose';
    b.holder = null;
    b.y = Math.max(b.y, 2);
    b.vx = (b.x - x) * 3 + rand(-2, 2);
    b.vz = (b.z - z) * 3 + rand(-2, 2);
    b.vy = 2;
    this.has = null;
    this.lastShooter = shooter; // (whoever gets it back: the other one's a defensive board)
    this.game.hud.toast(text, shooter === 'you' ? '#ff8080' : '#7ee081');
  }

  // The ball goes up from whoever's shooting.
  launch(make, by, pts, T) {
    const b = this.g.ball;
    const rim = this.rim;
    const shooter = by === 'you' ? this.game.player.pos() : [this.opp.x, this.opp.z];
    const h = by === 'you' ? this.game.player.heading : this.opp.heading;
    if (!T) {
      b.x = shooter[0] + Math.sin(h) * 0.3;
      b.z = shooter[1] + Math.cos(h) * 0.3;
      b.y = 2.4;
    }
    const miss = make ? 0 : rand(0.22, 0.4);
    const a = rand(0, Math.PI * 2);
    const d = dist(b.x, b.z, rim.x, rim.z);
    this.H.launch(b, rim.x + Math.cos(a) * miss, rim.y + 0.08, rim.z + Math.sin(a) * miss * 0.6, T || 0.75 + d * 0.06);
    b.kind = 'shot';
    b.make = make;
    this.flight = { by, pts, counts: this.cleared, foul: this.foulOnShot };
    this.foulOnShot = false;
    this.has = null;
  }

  // ---- Your defense ----
  trySteal(d) {
    const game = this.game;
    const Y = this.you;
    const opp = this.opp;
    const hp = opp.hp;
    const b = this.g.ball;
    const [px, pz] = game.player.pos();
    Y.stealT = 0.7;
    Y.armsT = 0.35;
    const again = this.clock - Y.lastSteal < 1.2;
    Y.lastSteal = this.clock;
    const dB = dist(px, pz, b.x, b.z);
    if (d > 1.6 || dB > 1.7) return;
    // From behind or reaching twice: a foul. Into a move: the best chance.
    const behind = ((px - opp.x) * Math.sin(opp.heading) + (pz - opp.z) * Math.cos(opp.heading)) < -0.3;
    const foulP = 0.1 + (again ? 0.2 : 0) + (behind ? 0.15 : 0);
    if (Math.random() < foulP) {
      this.checkup('opp', `Reach-in foul. ${opp.ballName}'s ball, check it up`);
      return;
    }
    const p = (0.08 + (hp.state === 'move' ? 0.25 : 0) + (dB < 1 ? 0.06 : 0)) * (1.3 - this.r / 100);
    if (Math.random() < p) {
      game.hud.toast('Stolen!', '#7ee081');
      this.give('you');
      this.cleared = false;
      this.lastShooter = 'opp';
      return;
    }
    Y.beatT = Math.max(Y.beatT, 0.35); // (gambled and missed: off balance)
  }

  tryBlock(d) {
    const game = this.game;
    const opp = this.opp;
    const hp = opp.hp;
    const [px, pz] = game.player.pos();
    if (d > 1.8) return;
    const front = ((px - opp.x) * (this.rim.x - opp.x) + (pz - opp.z) * (this.rim.z - opp.z)) > 0;
    const timing = Math.abs(hp.t - hp.rel) < 0.2 ? 1 : 0.5;
    const base = { jumper: 0.35, layup: 0.45, floater: 0.4, dunk: 0.2 }[hp.shot] || 0.3;
    if (Math.random() < 0.08 + (front ? 0 : 0.25)) {
      hp.fouled = true; // (and-one if it goes in, his ball again if not)
      game.hud.toast('Foul on the shot', '#ff8080');
      return;
    }
    if (hp.t <= hp.rel && Math.random() < base * timing * (front ? 1 : 0.6)) {
      hp.state = 'read';
      hp.t = 0;
      this.swatted(opp.x, opp.z, 'Get that outta here! BLOCKED', 'opp');
      for (const q of this.g.players) if (q.hp.role === 'watch') q.hp.cheerT = 1;
    }
  }

  // ---- The match, every frame (hoops.js hands the group over) ----
  step(dt) {
    const game = this.game;
    const b = this.g.ball;
    const H = this.H;
    const opp = this.opp;
    const hp = opp.hp;
    const [px, pz] = game.player.pos();
    if (opp.removed || opp.state !== 'play') return this.end('off');
    const P = H.site.pad;
    const off = px < P.x0 - 1 || px > P.x1 + 1 || pz < P.z0 - 1 || pz > P.z1 + 1;
    this.outT = off ? this.outT + dt : 0;
    if (this.outT > 2.5 || game.player.vehicle || game.stars > 0 || game.wastedT > 0 || game.bustedT > 0) return this.end(this.solo ? 'done' : 'forfeit');
    if (this.solo) {
      this.cleared = true;
      this.npcBall(dt);
      this.soloCourt(dt, px, pz);
    }
    // Checking it up: the defender holds it a moment and checks it back; he checks it to you.
    const C = this.check;
    if (C) {
      C.t += dt;
      if (C.stage === 'defHolds' && C.t > 0.5) {
        C.stage = 'back';
        this.checkPass('you');
      } else if (C.stage === 'wait' && C.t > 0.8) {
        C.stage = 'toYou';
        this.checkPass('you');
      }
    }
    for (const k of ['beatT', 'fallT', 'lagT', 'jumpT', 'closeT', 'stealT']) hp[k] = Math.max(0, (hp[k] || 0) - dt);
    // His energy.
    if (hp.state === 'drive' || hp.state === 'move' || (this.has !== 'opp' && opp.speed > 3.5)) hp.st = Math.max(0, hp.st - dt * 0.07);
    else hp.st = Math.min(1, hp.st + dt * 0.06);
    // The ball.
    // Coming down off the glass: go up and get it.
    if (b.mode === 'flight' && b.kind === 'oop2' && this.you.fallT <= 0 && !this.you.dunk && b.t > 0.15 && dist(px, pz, b.x, b.z) < 1.4 && b.y > 2.2 && b.y < 3.6) this.catchOop();
    if (b.mode === 'flight') {
      // (a pass goes to his hands, wherever he's moved to)
      if (b.kind === 'pass' && b.to && !b.to.removed) {
        b.p1[0] = b.to.x;
        b.p1[2] = b.to.z;
      }
      b.t += dt;
      const k = Math.min(1, b.t / b.T);
      b.x = b.p0[0] + (b.p1[0] - b.p0[0]) * k;
      b.z = b.p0[2] + (b.p1[2] - b.p0[2]) * k;
      const t = Math.min(b.t, b.T);
      b.y = b.p0[1] + b.vy0 * t - 0.5 * G * t * t;
      if (b.t >= b.T) {
        if (b.kind === 'check') this.checkArrive();
        else if (b.kind === 'pass') this.passArrive();
        else if (b.kind === 'back') this.backArrive();
        else if (b.kind === 'oop') this.oopBounce();
        else if (b.kind === 'oop2') {
          b.mode = 'loose';
          b.vx = rand(-0.5, 0.5);
          b.vz = rand(-0.5, 0.5);
          b.vy = -1;
        }
        else this.landed();
      }
      if (!this.active) return; // (that was the game-winner: the scoreboard's gone)
    } else if (b.mode === 'loose') {
      H.roll(b, dt);
      if (this.dead) {
        this.dead.t -= dt;
        if (this.dead.t <= 0) {
          const who = this.dead.who;
          this.dead = null;
          this.checkup(who);
        }
      } else {
        // Rebounds: you reach further jumping for it (△), he's slower boxed out.
        const Y = this.you;
        const yourReach = Y.jumpT > 0 ? 1.4 : 0.95;
        const yourTop = Y.jumpT > 0 ? 2.8 : 1.5;
        const hisReach = hp.boxed ? 0.45 : (hp.jumpT || 0) > 0 ? 1.35 : 0.95;
        if (Y.fallT <= 0 && dist(px, pz, b.x, b.z) < yourReach && b.y < yourTop) {
          const def = this.lastShooter === 'opp';
          this.give('you');
          if (def) this.cleared = false;
        } else if (hp.fallT <= 0 && dist(opp.x, opp.z, b.x, b.z) < hisReach && b.y < 1.6) {
          const def = this.lastShooter === 'you';
          this.give('opp');
          if (def) {
            this.cleared = false;
            hp.plan = { spot: null };
          }
        }
      }
    }
    // Taking it back past the arc.
    const holder = this.has === 'you' ? [px, pz] : this.has === 'opp' ? [opp.x, opp.z] : null;
    if (holder && !this.cleared && dist(holder[0], holder[1], this.rim.x, this.rim.z) > ARC + 0.3) this.cleared = true;
    // His reach-ins on you.
    if (this.has === 'you' && b.mode === 'held' && !this.shot && hp.fallT <= 0 && hp.beatT <= 0) {
      hp.stealT2 = (hp.stealT2 ?? rand(2, 4)) - dt;
      if (hp.stealT2 <= 0 && dist(px, pz, opp.x, opp.z) < 1.25) {
        hp.stealT2 = rand(2.2, 4.5);
        hp.armsT = 0.35;
        const exposed = this.you.move && MOVES[this.you.move.kind].risk ? 0.15 : 0;
        const r = Math.random();
        if (r < 0.12) return this.checkup('you', `Reach-in on ${opp.ballName}. Check it up`);
        else if (r < 0.12 + (0.06 + exposed) * (this.r / 75)) {
          game.hud.toast(`${opp.ballName} poked it away!`, '#ff8080');
          this.give('opp');
          this.cleared = false;
          this.lastShooter = 'you';
        }
      }
    }
    this.carry(dt);
    b.mesh.position.set(b.x, b.y, b.z);
    if (b.mode === 'flight') b.mesh.rotation.x += dt * 9; // (backspin in the air)
    else if (b.mode === 'loose') {
      // Rolling: turns with how fast it's going along the ground, and stops when it stops.
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 0.05) {
        _axis.set(b.vz / sp, 0, -b.vx / sp);
        b.mesh.rotateOnWorldAxis(_axis, (sp / 0.12) * dt);
      }
    }
    this.hud();
  }

  // The ball in somebody's hands.
  carry(dt) {
    const game = this.game;
    const b = this.g.ball;
    if (b.mode !== 'held') return;
    if (this.has === 'npc') {
      const q = b.holder;
      b.x = q.x + Math.sin(q.heading) * 0.35;
      b.z = q.z + Math.cos(q.heading) * 0.35;
      b.y = 1.2;
      return;
    }
    if (this.has === 'check') {
      // (held at the chest, face to face)
      const h = b.holder === 'you' ? this.game.player : this.opp;
      const [hx, hz] = b.holder === 'you' ? h.pos() : [h.x, h.z];
      b.x = hx + Math.sin(h.heading) * 0.35;
      b.z = hz + Math.cos(h.heading) * 0.35;
      b.y = 1.2;
      return;
    }
    if (this.has === 'you') {
      const p = game.player;
      const [px, pz] = p.pos();
      const fx = Math.sin(p.heading);
      const fz = Math.cos(p.heading);
      const Y = this.you;
      this.dribble = (this.dribble || 0) + dt * (Y.sizeUp ? 12 : 9);
      if (Y.dunk) {
        // (in the hand going up: where the arm puts it)
        const [ar, al] = this.dunkArms();
        const th = Y.dunk.style === 'two' ? (ar + al) / 2 : ar;
        const side = Y.dunk.style === 'two' ? 0 : 0.37;
        const h = this.dunkHeight();
        b.x = px + fx * (0.7 * Math.sin(th) + 0.1) - fz * side;
        b.z = pz + fz * (0.7 * Math.sin(th) + 0.1) + fx * side;
        b.y = 1.56 + h - 0.7 * Math.cos(th) + 0.1;
        return;
      }
      if (this.shot) {
        const k = Math.min(1, this.shot.t / (this.shot.type === 'jumper' ? this.shot.T / 1.5 : this.shot.T));
        b.x = px + fx * 0.3;
        b.z = pz + fz * 0.3;
        b.y = 1.3 + k * 1.0 + this.shotHeight(this.shot);
      } else {
        // (the hand it's in: a crossover takes it across in front)
        let side = Y.hand;
        let fwd = 0.4;
        let y = 0.18 + Math.abs(Math.sin(this.dribble)) * (Y.sizeUp ? 0.55 : 0.8);
        // (changing hands: in front, between the legs or behind the back)
        let path = null;
        if (Y.swap) path = [Y.swap.kind, Y.swap.from, Y.swap.to, Math.min(1, Y.swap.t / Y.swap.T)];
        else if (Y.move && Y.move.from !== Y.move.to) path = [HANDOFF[Y.move.kind] || 'front', Y.move.from, Y.move.to, Math.min(1, Y.move.t / (Y.move.T * 0.6))];
        this.legsK = this.behindK = 0;
        if (path) {
          [side, fwd, y] = handoff(...path);
          const m = Math.sin(Math.PI * path[3]);
          if (path[0] === 'legs') this.legsK = m;
          if (path[0] === 'behind') this.behindK = m;
        }
        this.ballSide = side;
        // (your right: (-fz, fx))
        b.x = px + fx * fwd - fz * 0.32 * side;
        b.z = pz + fz * fwd + fx * 0.32 * side;
        b.y = y;
      }
    } else if (this.has === 'opp') {
      const opp = this.opp;
      const hp = opp.hp;
      const fx = Math.sin(opp.heading);
      const fz = Math.cos(opp.heading);
      if (hp.state === 'shoot' && hp.appr && hp.t < hp.appr.T) {
        b.x = opp.x + fx * 0.32;
        b.z = opp.z + fz * 0.32;
        b.y = 1.2; // (gathered: at the chest)
      } else if (hp.state === 'shoot') {
        const a0 = hp.appr ? hp.appr.T : 0;
        const up = Math.min(1, (hp.t - a0) / Math.max(0.1, hp.rel - a0));
        b.x = opp.x + fx * 0.3;
        b.z = opp.z + fz * 0.3;
        b.y = hp.shot === 'dunk' ? 1.7 + up * 1.4 + (hp.jump || 0) : 1.2 + up + (hp.jump || 0);
      } else {
        hp.dribble = (hp.dribble || 0) + dt * 9;
        hp.hand = hp.hand || 1;
        let side = hp.hand;
        let fwd = 0.4;
        let y = 0.18 + Math.abs(Math.sin(hp.dribble)) * 0.8;
        let path = null;
        if (hp.swap) path = [hp.swap.kind, hp.swap.from, hp.swap.to, Math.min(1, hp.swap.t / hp.swap.T)];
        else if (hp.state === 'move' && hp.mv && hp.mv.from !== hp.mv.to) path = [HANDOFF[hp.mv.kind] || 'front', hp.mv.from, hp.mv.to, Math.min(1, hp.t / (hp.mv.T * 0.6))];
        hp.legsK = hp.behindK = 0;
        if (path) {
          [side, fwd, y] = handoff(...path);
          const m = Math.sin(Math.PI * path[3]);
          if (path[0] === 'legs') hp.legsK = m;
          if (path[0] === 'behind') hp.behindK = m;
        }
        hp.ballSide = side;
        b.x = opp.x + fx * fwd - fz * 0.3 * side;
        b.z = opp.z + fz * fwd + fx * 0.3 * side;
        b.y = y;
      }
    }
  }

  hud() {
    const game = this.game;
    if (!this.active) return;
    const K = this.keys();
    let meter = null;
    if (this.shot && this.shot.type !== 'dunk') {
      const s = this.shot;
      const { w } = this.windowNow();
      const span = s.T + LATE;
      meter = { v: s.t / span, lo: (s.T - w / 2) / span, hi: (s.T + w / 2) / span };
    }
    let hint = '';
    const C = this.check;
    const ck = game.input.touchMode ? 'SHOOT' : game.input.mode === 'pad' ? '✕' : 'E';
    if (this.solo) {
      const S = this.stats;
      const pct = S.att ? ` (${Math.round((S.made / S.att) * 100)}%)` : '';
      const put = `${game.input.label('interact')} put it down`;
      const pk = game.input.touchMode ? 'PASS' : game.input.mode === 'pad' ? '✕' : 'Q';
      if (this.pass) hint = `Passing to ${this.pass.target ? 'him' : 'nobody'}: ${game.input.mode === 'pad' ? 'flick the right stick' : 'move the camera'} to pick, let go to pass`;
      else if (this.has === 'npc') hint = 'He\'s got it...';
      else if (this.fetch) hint = 'He\'s getting it for you';
      else if (this.g.ball.mode === 'loose' && dist(...game.player.pos(), this.g.ball.x, this.g.ball.z) > 7) hint = `Go get it, grab another ball, or ${pk} get somebody to fetch it · ${put}`;
      else hint = this.has === 'you' ? (this.shot ? 'Let go in the green' : `${K.shoot} shoot · ${pk} pass (hold to pick who) · ${K.d} hold: face up · ${K.block} off the glass · moves: ${K.moves} · ${put}`) : `Go get it · ${put}`;
      game.hud.sport?.(`SHOOTAROUND · ${S.made}/${S.att}${pct} · streak ${S.streak} (best ${S.best})`, null, hint, null);
      this.floatHud(meter);
      return;
    }
    if (C) hint = C.stage === 'ready' ? `${ck} check it up` : C.stage === 'youHold' ? `${ck} check it back` : 'Checking it up...';
    else if (this.you.fallT > 0) hint = 'Ankles broken...';
    else if (this.has === 'you' && !this.cleared) hint = 'Take it back past the arc';
    else if (this.has === 'you') hint = this.shot ? 'Let go in the green' : `${K.shoot} shoot (tap: pump fake) · ${K.sprint} sprint · ${K.d} hold: face up · ${K.block} off the glass · moves: ${K.moves}`;
    else if (this.has === 'opp') hint = `${K.d} intense D · ${K.steal} steal · ${K.block} block`;
    else if (this.g.ball.kind === 'oop' || this.g.ball.kind === 'oop2') hint = 'Get under it: go up and get it';
    else if (!this.dead) hint = `Rebound! ${K.block} jump · ${K.d} box out`;
    game.hud.sport?.(this.board(), null, hint, null);
    this.floatHud(meter);
  }

  // The shot meter beside you (upright) and your energy under your feet, wherever you are on
  // screen.
  floatHud(meter) {
    const game = this.game;
    const p = game.player;
    const [px, pz] = p.pos();
    const cam = game.camera;
    const v = (this._v ||= new THREE.Vector3());
    const W = innerWidth;
    const H = innerHeight;
    const lift = this.you.dunk ? this.dunkHeight() : this.shot && this.shot.type !== 'dunk' ? this.shotHeight(this.shot) : 0;
    // (beside him: half a meter to his screen-right, chest high)
    const rx = -Math.cos(game.camYaw);
    const rz = Math.sin(game.camYaw);
    v.set(px + rx * 0.55, 1.2 + lift, pz + rz * 0.55).project(cam);
    if (v.z > 1) return game.hud.sportFloat(null);
    const at = { mx: ((v.x + 1) / 2) * W, my: ((1 - v.y) / 2) * H };
    v.set(px, 0.02, pz).project(cam);
    at.ex = ((v.x + 1) / 2) * W;
    at.ey = ((1 - v.y) / 2) * H + 34; // (well below his feet)
    game.hud.sportFloat(at, meter, this.you.st);
  }

  landed() {
    const game = this.game;
    const b = this.g.ball;
    const s = this.flight;
    this.flight = null;
    this.lastShooter = s ? s.by : null;
    b.mode = 'loose';
    if (this.solo) {
      const S = this.stats;
      const mine = b.kind === 'shot'; // (not his shot after your pass)
      if (mine) S.att += 1;
      if (b.make) {
        if (mine) {
          S.made += 1;
          S.streak += 1;
          S.best = Math.max(S.best, S.streak);
        }
        b.x = this.rim.x;
        b.z = this.rim.z;
        b.vx = b.vz = 0;
        b.vy = -1.5;
        game.sfx?.swish?.();
        if (mine && S.streak >= 3) game.hud.toast(`${S.streak} straight!`, '#7ee081');
      } else {
        if (mine) S.streak = 0;
        const side = rand(-1, 1);
        const sp = rand(1.5, 3.2);
        const L = Math.hypot(side, 1);
        b.vx = ((this.rim.dx - this.rim.dz * side) / L) * sp;
        b.vz = ((this.rim.dz + this.rim.dx * side) / L) * sp;
        b.vy = rand(0.8, 2.6);
      }
      return;
    }
    const hp = this.opp.hp;
    const foul = s && (s.foul || (s.by === 'opp' && hp.fouled));
    hp.fouled = false;
    if (b.make) {
      b.x = this.rim.x;
      b.z = this.rim.z;
      b.vx = b.vz = 0;
      b.vy = -1.5;
      game.sfx?.swish?.();
      if (s && s.counts) {
        const pts = s.pts + (foul ? 1 : 0);
        this.score[s.by] += pts;
        const who = s.by === 'you' ? 'You' : this.opp.ballName;
        game.hud.toast(foul ? `AND ONE! ${who} +${pts}` : s.by === 'you' ? `Bucket! +${pts}` : `${who} scores${s.pts > 1 ? ' from deep' : ''}`, s.by === 'you' ? '#7ee081' : '#ff8080');
        for (const q of this.g.players) if (q.hp.role === 'watch') q.hp.cheerT = 0.9;
      } else if (s) game.hud.toast("Doesn't count: take it back first", '#ffd23f');
      if (this.score.you >= this.to || this.score.opp >= this.to) return this.end(this.score.you >= this.to ? 'win' : 'lose');
      this.dead = { who: s && s.by === 'you' ? 'opp' : 'you', t: 0.9 };
      this.has = null;
      return;
    }
    // Fouled on a miss: the shooter's ball again.
    if (foul) {
      this.dead = { who: s.by, t: 0.9 };
      this.has = null;
      game.hud.toast(`Foul. ${s.by === 'you' ? 'Your' : `${this.opp.ballName}'s`} ball`, '#9fc3ff');
      b.vx = b.vz = 0;
      b.vy = 1;
      return;
    }
    const side = rand(-1, 1);
    const sp = rand(1.5, 3.2);
    const L = Math.hypot(side, 1);
    b.vx = ((this.rim.dx - this.rim.dz * side) / L) * sp;
    b.vz = ((this.rim.dz + this.rim.dx * side) / L) * sp;
    b.vy = rand(0.8, 2.6);
  }

  // ---- His game (hoops.js asks for his moves while the match is on) ----
  drive(p, dt) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    const rim = this.rim;
    const b = this.g.ball;
    const hp = p.hp;
    hp.jump = (hp.jumpT || 0) > 0 ? Math.sin(Math.min(1, hp.jumpT / 0.6) * Math.PI) * 0.5 : 0;
    const face = (x, z) => {
      p.heading = lerpAngle(p.heading, Math.atan2(x - p.x, z - p.z), Math.min(1, dt * 8));
    };
    if (this.fetch && p === this.fetch.q) return this.fetchDrive(p, dt);
    if (p === this.opp && dt > 0) {
      // (how he's actually moving: for the back-pedal)
      hp.vx = (p.x - (hp.lx ?? p.x)) / dt;
      hp.vz = (p.z - (hp.lz ?? p.z)) / dt;
      hp.lx = p.x;
      hp.lz = p.z;
    }
    if (p !== this.opp) {
      // Watching from the side.
      hp.cheerT = Math.max(0, (hp.cheerT || 0) - dt);
      if (dist(p.x, p.z, ...hp.spot) > 0.4) return { tx: hp.spot[0], tz: hp.spot[1], speed: 1.6 };
      face(b.x, b.z);
      return { speed: 0 };
    }
    // Checking it up: stand there, face to face.
    if (this.check) {
      face(px, pz);
      return { speed: 0 };
    }
    // On the floor.
    if (hp.fallT > 0) return { speed: 0 };
    const tired = 0.7 + 0.3 * hp.st;
    const slow = hp.beatT > 0 ? 0.3 : 1;
    // A dead ball after a basket: back to the top if it's his, back on D if not.
    if (this.dead) {
      const [tx, tz] = this.dead.who === 'opp' ? this.topOfKey() : [rim.x + rim.dx * 3, rim.z + rim.dz * 3];
      if (dist(p.x, p.z, tx, tz) > 0.4) return { tx, tz, speed: 2.4 };
      face(px, pz);
      return { speed: 0 };
    }
    // Just let a shot go: he finishes the jump (the follow-through, the fade, hanging on the
    // rim after a dunk) before he goes anywhere.
    if (hp.state === 'shoot' && this.has !== 'opp' && hp.t <= hp.rel + 0.6) return this.offense(p, dt, face, tired);
    // Loose ball or a shot coming down: go get it (unless you've boxed him out).
    if (b.mode === 'loose' || (b.mode === 'flight' && b.T - b.t < 0.35)) {
      if (dist(p.x, p.z, b.x, b.z) < 2 && b.y > 1.2 && Math.random() < dt * 4 && !hp.jumpT) hp.jumpT = 0.6;
      return { tx: b.x + b.vx * 0.3, tz: b.z + b.vz * 0.3, speed: (hp.boxed ? 1.6 : 3.9) * tired };
    }
    if (this.has === 'opp') return this.faceUp(p, hp, this.offense(p, dt, face, tired));
    // Defending you: between you and the basket.
    if (this.has === 'you' || b.mode === 'flight') {
      const d = dist(px, pz, rim.x, rim.z) || 1;
      // (closing out on a shot; sagging off a long way out; caught behind a step-back)
      let gap = d > ARC + 2 ? 2.2 : 1.4;
      if (hp.lagT > 0) gap = 3.2;
      if (hp.closeT > 0 && this.shot) {
        gap = 0.9;
        // Up for the contest as you release.
        const s = this.shot;
        if (!hp.jumpT && hp.beatT <= 0 && s.type !== 'dunk' && s.t > s.T - 0.2 && dist(p.x, p.z, px, pz) < 2.2 && Math.random() < 0.4 + this.r / 200) hp.jumpT = 0.6;
      }
      const k = Math.min(gap, d * 0.5);
      const tx = px + ((rim.x - px) / d) * k;
      const tz = pz + ((rim.z - pz) / d) * k;
      face(px, pz);
      if (dist(p.x, p.z, tx, tz) > 0.25) return { tx, tz, speed: 4.2 * tired * slow };
      return { speed: 0 };
    }
    face(b.x, b.z);
    return { speed: 0 };
  }

  // His possession: walk it up, read you, make a move, drive, shoot.
  offense(p, dt, face, tired) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    const rim = this.rim;
    const hp = p.hp;
    const Y = this.you;
    hp.t += dt;
    hp.holdT = (hp.holdT || 0) + dt;
    if (hp.state !== 'move' && hp.state !== 'shoot') this.protectHim(p, dt);
    const dR = dist(p.x, p.z, rim.x, rim.z);
    const dY = dist(p.x, p.z, px, pz);
    // Are you between him and the basket?
    const between = dY < 2.6 && ((px - p.x) * (rim.x - p.x) + (pz - p.z) * (rim.z - p.z)) / ((dY || 1) * (dR || 1)) > 0.5 && Y.fallT <= 0 && Y.beatT <= 0;
    const plan = hp.plan || (hp.plan = { spot: null });
    if (hp.state === 'walk') {
      if (!this.cleared && !plan.spot) plan.spot = this.onCourt(rim.x + rim.dx * 8.2, rim.z + rim.dz * 8.2);
      if (plan.spot && dist(p.x, p.z, ...plan.spot) > 0.5 && hp.t < 5) return { tx: plan.spot[0], tz: plan.spot[1], speed: 3 * tired };
      if (!this.cleared) {
        plan.spot = this.onCourt(rim.x + rim.dx * 8.5, rim.z + rim.dz * 8.5);
        hp.t = 0;
        return { speed: 0 };
      }
      plan.spot = null;
      hp.state = 'read';
      hp.t = 0;
      hp.next = rand(0.3, 0.8);
    }
    if (hp.state === 'read') {
      face(rim.x, rim.z);
      if (hp.t < hp.next) return { speed: 0 };
      hp.t = 0;
      hp.next = rand(0.35, 0.8);
      const shooter = hp.style === 'shooter' ? 1.4 : hp.style === 'slasher' ? 0.6 : 1;
      if (!between && dR < 11) return this.goDrive(hp);
      if (dY > 2.4 && dR < 8.6 && Math.random() < 0.55 * shooter) return this.goShoot(p, hp, 'jumper');
      if (dY <= 2.6) return this.goMove(p, hp);
      if (hp.holdT > 7 || Math.random() < 0.3) return dR < 8.6 ? this.goShoot(p, hp, 'jumper') : this.goDrive(hp);
      // Walk him down a step or two.
      const [tx, tz] = this.onCourt(p.x + (rim.x - p.x) * 0.25, p.z + (rim.z - p.z) * 0.25);
      hp.state = 'jab';
      hp.to = [tx, tz];
      return { speed: 0 };
    }
    if (hp.state === 'jab') {
      if (dist(p.x, p.z, ...hp.to) > 0.4 && hp.t < 1.5) return { tx: hp.to[0], tz: hp.to[1], speed: 2.4 * tired };
      hp.state = 'read';
      hp.t = 0;
      return { speed: 0 };
    }
    if (hp.state === 'move') {
      const mv = hp.mv;
      const ux = (rim.x - p.x) / (dR || 1);
      const uz = (rim.z - p.z) / (dR || 1);
      let tx = p.x;
      let tz = p.z;
      if (mv.kind === 'step') {
        tx -= ux * 3;
        tz -= uz * 3;
      } else if (mv.kind === 'hesi') {
        if (hp.t > 0.2) {
          tx += ux * 3;
          tz += uz * 3;
        }
      } else {
        tx += (-uz * mv.side * 0.85 + ux * 0.5) * 3;
        tz += (ux * mv.side * 0.85 + uz * 0.5) * 3;
      }
      if (hp.t >= mv.T) {
        hp.lastMoveEnd = this.clock;
        if (mv.kind === 'step') return this.goShoot(p, hp, 'jumper', true);
        if (mv.beat) return this.goDrive(hp);
        hp.state = 'read';
        hp.t = 0;
        hp.next = rand(0.15, 0.4);
        return { speed: 0 };
      }
      [tx, tz] = this.onCourt(tx, tz);
      if (mv.kind === 'step') {
        // A push off and a little hop back: quick out, settling as he lands.
        const k = Math.min(1, hp.t / mv.T);
        hp.jump = 0.14 * Math.sin(Math.PI * k);
        return { tx, tz, speed: 7.5 * (1 - 0.75 * k) * tired };
      }
      return { tx, tz, speed: 6.5 * tired };
    }
    if (hp.state === 'drive') {
      // Close enough to finish: a layup from 5 m, a dunk from 3.8 m (he makes up his mind at 5).
      if (dR <= 5) {
        if (hp.wantDunk == null) {
          const clear = dY > 1.3 || Y.beatT > 0 || Y.fallT > 0;
          hp.wantDunk = this.r > 70 && clear && Math.random() < 0.5;
        }
        if (!hp.wantDunk) return this.goShoot(p, hp, 'layup');
        if (dR <= 3.8) return this.goShoot(p, hp, 'dunk');
      }
      // Cut off: you're square in front of him in intense D.
      const front = ((px - p.x) * (rim.x - p.x) + (pz - p.z) * (rim.z - p.z)) > 0;
      if (Y.intense && dY < 1.0 && front && Y.beatT <= 0 && !hp.cutOnce) {
        hp.cutOnce = true; // (once a drive: after that he goes around or pulls up)
        hp.st = Math.max(0, hp.st - 0.03);
        if (Math.random() < 0.15) {
          const b = this.g.ball;
          b.mode = 'loose';
          b.holder = null;
          b.vx = rand(-2, 2);
          b.vz = rand(-2, 2);
          b.vy = 1;
          this.has = null;
          this.lastShooter = 'opp';
          game.hud.toast('Cut him off: he lost it!', '#7ee081');
        } else game.hud.toast('Cut off', '#9fc3ff');
        // Next he goes to a move or pulls up.
        if (this.has === 'opp') {
          if (Math.random() < 0.5) return this.goMove(p, hp);
          if (dR < 8.6) return this.goShoot(p, hp, 'jumper');
        }
        hp.state = 'read';
        hp.t = 0;
        hp.next = rand(0.3, 0.6);
        return { speed: 0 };
      }
      if (hp.t > 3) {
        hp.state = 'read';
        hp.t = 0;
        return { speed: 0 };
      }
      return { tx: rim.x + rim.dx * 0.8, tz: rim.z + rim.dz * 0.8, speed: 5 * tired };
    }
    if (hp.state === 'shoot' && hp.shot === 'dunk') {
      // Up to the rim, through it, hang a moment, down.
      face(rim.x, rim.z);
      const a0 = hp.appr ? hp.appr.T : 0;
      if (hp.t < a0) {
        // (the gather and steps to the takeoff)
        hp.jump = 0;
        const r = dist(p.x, p.z, hp.appr.tx, hp.appr.tz);
        return r > 0.05 ? { tx: hp.appr.tx, tz: hp.appr.tz, speed: Math.min(8, r / Math.max(0.04, a0 - hp.t)) } : { speed: 0 };
      }
      const t = hp.t - a0;
      const R = hp.rel - a0;
      hp.jump = t < R ? 0.95 * Math.sin((Math.min(1, t / R) * Math.PI) / 2) : t < R + 0.3 ? 0.95 : 0.95 * Math.max(0, 1 - ((t - R - 0.3) / 0.25) ** 2);
      const b = this.g.ball;
      if (t >= R && b.mode === 'held' && this.has === 'opp') this.resolveHim(p, hp);
      if (t > R + 0.6) {
        hp.state = 'read';
        hp.t = 0;
        hp.jump = 0;
      }
      const ax = rim.x + rim.dx * 0.45;
      const az = rim.z + rim.dz * 0.45;
      if (t < R && dist(p.x, p.z, ax, az) > 0.1) return { tx: ax, tz: az, speed: Math.min(7, dist(p.x, p.z, ax, az) / Math.max(0.05, R - t)) };
      return { speed: 0 };
    }
    if (hp.state === 'shoot' && hp.appr && hp.t < hp.appr.T) {
      // (the gather and steps into his layup)
      face(rim.x, rim.z);
      hp.jump = 0;
      const r = dist(p.x, p.z, hp.appr.tx, hp.appr.tz);
      return r > 0.05 ? { tx: hp.appr.tx, tz: hp.appr.tz, speed: Math.min(8, r / Math.max(0.04, hp.appr.T - hp.t)) } : { speed: 0 };
    }
    if (hp.state === 'shoot' && hp.shot === 'layup' && hp.appr && hp.t < hp.rel) {
      // (in the air, still carrying in toward the rim)
      face(rim.x, rim.z);
      const st = hp.rel - 0.25;
      hp.jump = hp.t < st ? 0 : 0.5 * Math.sin(((hp.t - st) / 0.25) * (Math.PI / 2));
      const fx = rim.x + rim.dx * 0.6;
      const fz = rim.z + rim.dz * 0.6;
      const r = dist(p.x, p.z, fx, fz);
      return r > 0.05 ? { tx: fx, tz: fz, speed: Math.min(8, r / Math.max(0.05, hp.rel - hp.t)) } : { speed: 0 };
    }
    if (hp.state === 'shoot') {
      face(rim.x, rim.z);
      // (his jump's timed to the shot too: the top of it at the release)
      const H = hp.shot === 'jumper' ? 0.45 : 0.5;
      const st = hp.rel - 0.25;
      hp.jump = hp.t < st ? 0 : hp.t < hp.rel ? H * Math.sin(((hp.t - st) / 0.25) * (Math.PI / 2)) : H * Math.max(0, Math.cos(Math.min(1, (hp.t - hp.rel) / 0.3) * (Math.PI / 2)));
      const b = this.g.ball;
      if (hp.t >= hp.rel && b.mode === 'held' && this.has === 'opp') this.resolveHim(p, hp);
      if (hp.t > hp.rel + 0.45) {
        hp.state = 'read';
        hp.t = 0;
        hp.fade = false;
        p.char.group.rotation.x = 0;
      }
      if (hp.fade && hp.shot === 'jumper' && hp.t > st - 0.05 && hp.t < hp.rel + 0.3) {
        // (drifting back through the jump: quickest on the way up, easing off coming down)
        const k = Math.min(1, (hp.t - (st - 0.05)) / 0.6);
        const ux = (rim.x - p.x) / (dR || 1);
        const uz = (rim.z - p.z) / (dR || 1);
        const [tx, tz] = this.onCourt(p.x - ux * 2, p.z - uz * 2);
        return { tx, tz, speed: 2.2 * (1 - k) };
      }
      return { speed: 0 };
    }
    hp.state = 'read';
    return { speed: 0 };
  }

  // His face-up (your L2): with you close (or backing it out), he stays square to the basket
  // whichever way he goes: backing up at 65%, sideways at 80%. Driving or walking to a spot
  // with nobody near, he just turns and goes.
  faceUp(p, hp, r) {
    hp.faceUp = false;
    if (!r || r.tx == null || !['walk', 'jab', 'read'].includes(hp.state)) return r;
    const rim = this.rim;
    const mx = r.tx - p.x;
    const mz = r.tz - p.z;
    const ml = Math.hypot(mx, mz);
    if (ml < 0.05) return r;
    const ux = rim.x - p.x;
    const uz = rim.z - p.z;
    const c = (mx * ux + mz * uz) / (ml * (Math.hypot(ux, uz) || 1));
    const [qx, qz] = this.game.player.pos();
    const away = c < -0.3;
    if (!away && dist(p.x, p.z, qx, qz) >= 3.5) return r;
    if (c > 0.7) return r; // (straight at the basket: he's facing it anyway)
    hp.faceUp = true;
    return { ...r, speed: r.speed * (away ? 0.65 : 0.8) };
  }

  goDrive(hp) {
    hp.state = 'drive';
    hp.wantDunk = null;
    hp.cutOnce = false;
    hp.t = 0;
    return { speed: 0 };
  }

  goMove(p, hp) {
    const game = this.game;
    const kind = pick(hp.style === 'shooter' ? ['step', 'step', 'hesi', 'cross'] : ['cross', 'behind', 'spin', 'hesi', 'step', 'legs']);
    const chain = this.clock - (hp.lastMoveEnd ?? -9) < 0.8;
    hp.combo = chain ? Math.min(3, hp.combo + 1) : 0;
    hp.state = 'move';
    hp.t = 0;
    const M = MOVES[kind];
    hp.hand = hp.hand || 1;
    const switches = kind === 'cross' || kind === 'behind' || kind === 'spin' || kind === 'legs';
    // (the moves that switch hands go toward the new hand's side: right hand, his right)
    const to = switches ? -hp.hand : hp.hand;
    const ux = (this.rim.x - p.x) || 1e-6;
    const uz = this.rim.z - p.z;
    const ul = Math.hypot(ux, uz) || 1;
    // (offense() moves him along (-uz, ux) * side: match it to his right hand when to = 1)
    const rx = -Math.cos(p.heading);
    const rz = Math.sin(p.heading);
    const sideFor = Math.sign(((-uz / ul) * rx + (ux / ul) * rz) * to) || 1;
    hp.mv = { kind, side: switches ? sideFor : Math.random() < 0.5 ? -1 : 1, T: M.T, beat: false, from: hp.hand, to };
    hp.hand = to;
    hp.st = Math.max(0, hp.st - 0.04);
    if (kind === 'step') return { speed: 0 };
    // Does it beat you? Less if you're in intense D, more if you're tired.
    const Y = this.you;
    const pr = (M.beat + hp.combo * 0.1) * (this.r / 75) * (Y.intense ? 0.7 : 1) * (1.2 - 0.4 * Y.st);
    if (Math.random() < pr) {
      hp.mv.beat = true;
      Y.beatT = 0.7;
      if (hp.combo >= 1 && Math.random() < 0.25) {
        Y.fallT = 1.1;
        game.hud.toast(`${p.ballName} broke your ankles`, '#ff8080');
        for (const q of this.g.players) if (q.hp.role === 'watch') q.hp.cheerT = 1.2;
      } else game.hud.toast(`${M.name}: ${p.ballName} got by you`, '#ff8080');
    }
    return { speed: 0 };
  }

  goShoot(p, hp, type, stepback = false) {
    hp.state = 'shoot';
    hp.shot = type;
    // A fadeaway: always off a step-back, sometimes when you're right on him.
    const [qx, qz] = this.game.player.pos();
    hp.fade = type === 'jumper' && (stepback || (dist(p.x, p.z, qx, qz) < 1.6 && Math.random() < 0.4));
    hp.t = 0;
    hp.rel = type === 'jumper' ? 0.32 : type === 'dunk' ? 0.5 : 0.28;
    // Layups and dunks: the same footwork as yours. The gather, two steps (a dunk from 1-2 m:
    // one; inside 1 m: a jump stop), up off the last one. The release comes after that.
    hp.appr = null;
    let how = '';
    if (type === 'layup' || type === 'dunk') {
      const rim = this.rim;
      const dR = dist(p.x, p.z, rim.x, rim.z) || 1;
      const steps = type === 'layup' ? 2 : dR > 2.5 ? 2 : dR > 1.2 ? 1 : 0;
      const sp = Math.max(4.5, p.speed || 0);
      const T = steps ? clamp((dR - (type === 'layup' ? 1.5 : 1.6)) / sp, 0.25, 0.7) : 0.15; // (keeping his speed)
      const go = steps ? clamp(sp * T, 0, dR - (type === 'layup' ? 0.9 : 0.7)) : 0;
      hp.appr = { T, tx: p.x + ((rim.x - p.x) / dR) * go, tz: p.z + ((rim.z - p.z) / dR) * go };
      hp.rel = T + (type === 'layup' ? 0.3 : 0.5);
      how = steps ? ` (gather + ${steps} step${steps > 1 ? 's' : ''})` : ' (jump stop)';
    }
    if (CFG.SHOT_TYPE_DEBUG) this.game.hud.toast(`[test] ${p.ballName}: ${SHOT_NAMES[type]}${how}${stepback ? ' (step-back)' : ''}`, '#c9a7ff');
    // (squaring up first: a pivot if he's facing away)
    const off = Math.abs(wrapAngle(Math.atan2(this.rim.x - p.x, this.rim.z - p.z) - p.heading));
    hp.rel += Math.max(0, off - 0.4) / 9;
    hp.stepback = stepback;
    hp.jumpT = 0;
    return { speed: 0 };
  }

  // His shot goes up.
  resolveHim(p, hp) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    const Y = this.you;
    p.heading = Math.atan2(this.rim.x - p.x, this.rim.z - p.z); // (square to the rim at the release)
    let lv = this.openness(p.x, p.z, px, pz, Y.beatT > 0.2 || Y.fallT > 0, Y.jumpT > 0);
    const d = dist(p.x, p.z, this.rim.x, this.rim.z);
    const r = this.r;
    let make;
    if (hp.shot === 'dunk') make = Math.random() < (lv >= 3 ? 0.6 : 0.95);
    else {
      // The same green windows as yours. His timing's off by a random amount that depends on
      // his rating (typically ~90 ms at 60 OVR, ~60 ms at 90), and it's green when that lands
      // inside the window for this shot, shrunk the same ways yours is.
      if (hp.fade) lv = Math.max(0, lv - 1); // (fading away from your hand)
      let w = greenWindow(hp.shot, d) * OPEN_WINDOW[lv];
      if (hp.stepback) w *= 0.9;
      if (hp.fade) w *= 0.9; // (harder to shoot going backward)
      if (hp.st < 0.4) w *= 0.75;
      const u = 1 - Math.random();
      const e = ((150 - r) / 1000) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
      const m = Math.abs(e) - w / 2;
      const green = m <= 0 && (d <= 14 || Math.random() < 0.5);
      const tm = green ? 1 : m < 0.06 ? 0.7 : m < 0.16 ? 0.4 : 0.12;
      const base = hp.shot === 'layup' ? 0.82 : hp.shot === 'floater' ? 0.55 : this.base(d);
      make = green || Math.random() < base * tm * OPEN_MAKE[lv] * (0.7 + 0.3 * hp.st);
    }
    const pts = d > ARC ? 2 : 1;
    if (hp.shot === 'dunk') {
      const b = this.g.ball;
      b.y = Math.max(b.y, this.rim.y + 0.15);
      this.launch(make, 'opp', pts, 0.14);
      game.hud.toast(make ? `${p.ballName} throws it down` : `${p.ballName} rims out the dunk`, make ? '#ff8080' : '#7ee081');
      game.shakeCamera?.(make ? 0.07 : 0.04, 0.3);
    } else this.launch(make, 'opp', pts);
  }

  pose(p) {
    const hp = p.hp;
    const c = p.char;
    c.legL.rotation.z = c.legR.rotation.z = 0;
    if (this.fetch && p === this.fetch.q) {
      if (this.g.ball.holder === p) c.armL.rotation.x = c.armR.rotation.x = -1.2;
      return 0.04;
    }
    // His back-pedal: moving backward from what he's facing (the basket with the ball, you on
    // D), he keeps facing it and shuffles back, low, like you do.
    if (p === this.opp && hp.fallT <= 0 && !this.check && !this.dead && hp.state !== 'shoot' && hp.state !== 'move' && !(hp.jumpT > 0)) {
      const sp = Math.hypot(hp.vx || 0, hp.vz || 0);
      const [qx, qz] = this.game.player.pos();
      const look = this.has === 'opp' ? [this.rim.x, this.rim.z] : this.has === 'you' ? [qx, qz] : null;
      if (look && this.has === 'opp' && hp.faceUp) {
        // (his face-up side-step: square to the basket; his walk does the legs)
        p.heading = Math.atan2(look[0] - p.x, look[1] - p.z);
        c.group.rotation.y = p.heading;
      }
      if (look && sp > 0.5) {
        const fx = look[0] - p.x;
        const fz = look[1] - p.z;
        const fl = Math.hypot(fx, fz) || 1;
        if ((hp.vx * fx + hp.vz * fz) / (sp * fl) < -0.3) {
          p.heading = Math.atan2(fx, fz);
          c.group.rotation.y = p.heading;
          const drop = this.shuffleLegs(c, this.clock * (4 + sp * 2.2));
          if (this.has === 'opp') {
            (hp.ballSide < 0 ? c.armL : c.armR).rotation.x = -0.5 - Math.abs(Math.cos(hp.dribble || 0)) * 0.35;
            (hp.ballSide < 0 ? c.armR : c.armL).rotation.x = -0.6; // (the other arm out)
          } else c.armL.rotation.x = c.armR.rotation.x = -1.0; // (hands up on D)
          return 0.06 + drop;
        }
      }
    }
    if (p === this.opp && hp.fallT > 0) {
      // On the floor: sat down hard.
      const y = crouchPose(c, 1);
      c.armL.rotation.x = c.armR.rotation.x = 0.6;
      return y - 0.35;
    }
    const fading = hp.state === 'shoot' && hp.fade && hp.shot === 'jumper';
    if (p === this.opp && this.has !== 'you' && ((hp.state === 'move' && hp.mv?.kind === 'step') || fading)) {
      // (his step-back or fadeaway: turning smoothly to face the basket while he goes back)
      // (held on the basket: the walk would otherwise turn him to where he's going, backward)
      p.heading = Math.atan2(this.rim.x - p.x, this.rim.z - p.z);
      c.group.rotation.y = p.heading;
      // (leaning back on the fade, most at the top of the jump)
      if (fading) c.group.rotation.x = -0.25 * Math.min(1, (hp.jump || 0) / 0.45);
    }
    if (p === this.opp && this.has === 'opp') {
      if (hp.state === 'shoot' && hp.appr && hp.t < hp.appr.T) c.armL.rotation.x = c.armR.rotation.x = -1.3; // (gathered)
      else if (hp.state === 'shoot' && hp.shot === 'dunk') c.armL.rotation.x = c.armR.rotation.x = -1.6 - Math.min(1, (hp.t - (hp.appr?.T || 0)) / (hp.rel - (hp.appr?.T || 0))) * 1.5;
      else if (hp.state === 'shoot') c.armL.rotation.x = c.armR.rotation.x = -1.4 - Math.min(1, hp.t / Math.max(0.1, hp.rel)) * 1.5;
      else {
        (hp.ballSide < 0 ? c.armL : c.armR).rotation.x = hp.behindK ? 0.9 * hp.behindK : -0.5 - Math.abs(Math.cos(hp.dribble || 0)) * 0.35; // (the hand with the ball)
        c.legL.rotation.z = 0.3 * (hp.legsK || 0);
        c.legR.rotation.z = -0.3 * (hp.legsK || 0);
      }
    } else if (p === this.opp) {
      // Hands up on defense; a swipe; up for a contest or a rebound.
      c.armL.rotation.x = c.armR.rotation.x = hp.jumpT > 0 ? -2.8 : hp.armsT > 0 ? -1.6 : -1.0;
      if (!hp.jumpT && this.has === 'you') return 0.06 + crouchPose(c, 0.25);
    } else if (hp.cheerT > 0) c.armR.rotation.x = -2.9;
    return 0.06 + (hp.jump || 0);
  }

  // The backward shuffle's legs (knees bent, short steps reaching back) at step phase ph;
  // returns the height change.
  shuffleLegs(c, ph) {
    const sw = Math.sin(ph);
    const dl = bendLeg(c.legL, c.kneeL, 0.45 - 0.4 * sw, 0.8 + 0.35 * Math.max(0, Math.cos(ph)));
    const dr = bendLeg(c.legR, c.kneeR, 0.45 + 0.4 * sw, 0.8 + 0.35 * Math.max(0, -Math.cos(ph)));
    return -Math.min(dl, dr);
  }

  // Your arms and stance (main.js, after you move).
  late(dt) {
    const game = this.game;
    const p = game.player;
    const c = p.char;
    const Y = this.you;
    p.showWeapon('fists');
    c.legL.rotation.z = c.legR.rotation.z = 0;
    c.group.rotation.x = 0;
    Y.armsT = Math.max(0, (Y.armsT || 0) - dt);
    if (Y.fallT > 0) {
      const y = crouchPose(c, 1);
      c.armL.rotation.x = c.armR.rotation.x = 0.6;
      c.group.position.y += y - 0.35;
      return;
    }
    // A dunk: up, the arms (by style), hanging on the rim, down.
    if (Y.dunk) {
      const [ar, al] = this.dunkArms();
      c.armR.rotation.x = -ar;
      c.armL.rotation.x = -al;
      c.group.rotation.y = p.heading;
      c.group.position.y += this.dunkHeight();
      return;
    }
    // Squaring back up after a crossover (the left stick left alone).
    if (Y.squareT > 0) {
      Y.squareT -= dt;
      if (Y.stickIdle && !Y.move && !this.shot && this.has === 'you') {
        p.heading = lerpAngle(p.heading, Math.atan2(this.rim.x - p.x, this.rim.z - p.z), Math.min(1, dt * 12));
        c.group.rotation.y = p.heading;
      }
    }
    // A quick hesitation: a dip on the spot.
    if (Y.move?.kind === 'hesi' && !Y.move.big && this.has === 'you') c.group.position.y += crouchPose(c, 0.35 * Math.sin(Math.PI * Math.min(1, Y.move.t / Y.move.T)));
    // A step-back or a back-pedal: going back, still facing the basket.
    if ((Y.move?.kind === 'step' || (Y.squareUp && !this.shot)) && this.has === 'you') {
      p.heading = Math.atan2(this.rim.x - p.x, this.rim.z - p.z);
      c.group.rotation.y = p.heading;
    }
    // Intense D (L2): your back to the basket, square to the play, low. Retreating toward the
    // rim it's the backward shuffle.
    if (Y.intense) {
      p.heading = Math.atan2(p.x - this.rim.x, p.z - this.rim.z);
      c.group.rotation.y = p.heading;
      const [qx, qz] = p.pos();
      const tx = this.rim.x - qx;
      const tz = this.rim.z - qz;
      const tl = Math.hypot(tx, tz) || 1;
      const vx = p.vx || 0;
      const vz = p.vz || 0;
      const sp = Math.hypot(vx, vz);
      if (sp > 0.5 && (vx * tx + vz * tz) / (sp * tl) > 0.3) {
        Y.bpPhase = (Y.bpPhase || 0) + dt * (4 + sp * 2.2);
        c.group.position.y += this.shuffleLegs(c, Y.bpPhase);
      } else c.group.position.y += crouchPose(c, 0.3);
    }
    if (this.has === 'you' && this.g.ball.mode === 'held') {
      if (this.shot) {
        const k = Math.min(1, this.shot.t / (this.shot.type === 'jumper' ? this.shot.T / 1.5 : this.shot.T)); // (arms up quick on a jumper)
        c.armL.rotation.x = c.armR.rotation.x = -1.4 - k * 1.4;
        c.group.rotation.y = p.heading; // (squaring up to the basket)
      } else {
        const arm = (this.ballSide ?? Y.hand) < 0 ? c.armL : c.armR; // (the hand with the ball)
        arm.rotation.x = this.behindK ? 0.9 * this.behindK : -0.5 - Math.abs(Math.cos(this.dribble || 0)) * 0.35;
        // (between the legs: feet apart, down a little)
        c.legL.rotation.z = 0.3 * (this.legsK || 0);
        c.legR.rotation.z = -0.3 * (this.legsK || 0);
        if (this.legsK) c.group.position.y += crouchPose(c, 0.3 * this.legsK);
        // Back-pedaling: a low shuffle backward, short steps, each foot reaching back.
        if (Y.backpedal && p.speed > 0.3 && !this.legsK) {
          Y.bpPhase = (Y.bpPhase || 0) + dt * (4 + p.speed * 2.2);
          c.group.position.y += this.shuffleLegs(c, Y.bpPhase);
          const free = (this.ballSide ?? Y.hand) < 0 ? c.armR : c.armL; // (the other arm out, for balance)
          free.rotation.x = -0.6;
        }
      }
      if (Y.sizeUp) c.group.position.y += crouchPose(c, 0.35);
    } else if (Y.jumpT > 0) c.armL.rotation.x = c.armR.rotation.x = -2.8;
    else if (Y.armsT > 0) c.armR.rotation.x = -1.6;
    else if (this.has === 'opp') c.armL.rotation.x = c.armR.rotation.x = -1.0;
    // Off the floor: the shot's own jump, coming down after it, or a block / rebound jump.
    if (this.shot && this.shot.approach && this.shot.t < this.shot.approach.T && this.has === 'you') {
      // (gathered: ball at the chest, two hands, on the run)
      c.armL.rotation.x = c.armR.rotation.x = -1.3;
    } else if (this.shot && this.shot.type !== 'dunk' && this.has === 'you') {
      const s = this.shot;
      const h = this.shotHeight(s);
      c.group.position.y += h > 0 ? h : s.t > s.turnT ? crouchPose(c, 0.3) : 0; // (the gather: a dip, then up)
      if (s.fade) c.group.rotation.x = -0.25 * Math.min(1, h / 0.45); // (leaning back on the fade)
      c.group.rotation.y = p.heading;
    } else if (Y.fall) {
      Y.fall.t += dt;
      const k = Math.min(1, Y.fall.t / Y.fall.T);
      c.group.position.y += Y.fall.h0 * (1 - k * k);
      if (Y.fall.fade != null) {
        // (still drifting back and leaning as you come down)
        const fk = Math.min(1, Y.fall.fade + Y.fall.t / 0.6);
        const [qx, qz] = p.pos();
        this.fadeDrift(p, qx, qz, fk, dt);
        c.group.rotation.x = -0.25 * (1 - k);
      }
      if (k >= 1) Y.fall = null;
    } else if (Y.jumpT > 0) c.group.position.y += Math.sin((Y.jumpT / 0.55) * Math.PI) * 0.5;
  }

  // ---- Over ----
  end(how) {
    const game = this.game;
    const name = this.opp?.ballName || 'He';
    const bet = this.bet;
    if (how === 'win') {
      const cred = this.r >= 82 ? 12 : 8;
      game.cash += bet * 2;
      game.cred += cred;
      game.hud.toast(`You beat ${name} ${this.score.you}-${this.score.opp}${bet ? ` · +$${bet}` : ''} · +${cred} cred`, '#7ee081');
    } else if (how === 'lose') {
      game.hud.toast(`${name} wins ${this.score.opp}-${this.score.you}${bet ? ` · -$${bet}` : ''}`, '#ff8080');
    } else if (how === 'done') {
      const S = this.stats;
      game.hud.toast(S.att ? `Shot ${S.made}/${S.att} (${Math.round((S.made / S.att) * 100)}%) · best streak ${S.best}` : 'Put the ball down', '#9fc3ff');
    } else if (how === 'forfeit') {
      game.hud.toast(`You walked off: ${name} takes it${bet ? ` · -$${bet}` : ''}`, '#ff8080');
    } else {
      game.cash += bet; // (called off: money back)
      game.hud.toast('Game called off', '#9fc3ff');
    }
    this.active = false;
    this.again = game.time + 0.6; // (the press that ended it doesn't start another)
    this.shot = null;
    this.dead = null;
    this.check = null;
    this.flight = null;
    const g = this.g;
    if (this.passMark) this.passMark.visible = false;
    this.pass = null;
    if (this.solo) {
      this.solo = false;
      this.releaseFetch();
      // Every ball stays on the court where it is (yours put down in front of you).
      const P = this.H.site.pad;
      const onPad = (x, z) => [clamp(x, P.x0 + 0.4, P.x1 - 0.4), clamp(z, P.z0 + 0.4, P.z1 - 0.4)];
      const leave = (b, x, z) => {
        const [lx, lz] = onPad(x, z);
        b.mesh.position.set(lx, 0.18, lz);
        b.mesh.visible = true;
        this.spares.push({ H: this.H, mesh: b.mesh, home: [lx, lz] });
      };
      const b = g.ball;
      if (b.mode === 'held' && b.holder === 'you') {
        const [px, pz] = game.player.pos();
        leave(b, px + Math.sin(game.player.heading) * 0.6, pz + Math.cos(game.player.heading) * 0.6);
      } else leave(b, b.x, b.z);
      for (const st of this.strays || []) leave(st.b, st.b.x, st.b.z);
      this.strays = [];
      game.hud.sport?.(null);
      return;
    }
    if (g) {
      g.match = null;
      // Back to shooting around.
      if (g.ball.mode === 'held' && g.ball.holder === 'you') g.ball.mode = 'loose';
      for (const q of g.players) if (!q.removed) this.H.toWait(q);
      if (g.ball.mode === 'held' && g.ball.holder === this.opp) this.H.giveBall(g, this.opp);
    }
    game.hud.sport?.(null);
    game.save();
  }
}
