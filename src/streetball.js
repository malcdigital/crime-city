import { dist, rand, pick, lerpAngle } from './util.js';

// One-on-one to 11 at a basketball court, against one of the people shooting there (hoops.js).
// - Join: on the court, on foot, nobody after you. E starts it; Q / ○ changes the bet
//   ($0, $50, $100, $250, $500 - he matches it; you can't bet more cash than you've got).
// - Scoring: 1 a basket, 2 from beyond the arc. First to 11. A miss is a loose ball: whoever
//   gets there first. After a defensive rebound the ball has to be taken back past the arc
//   before a basket counts. After a basket the other one gets it at the top of the key.
// - You with the ball: move as usual (you dribble). Hold FIRE (R2, the mouse, the FIRE button)
//   and let go at the top of the meter: timing, distance and how close he is decide it.
// - Him with the ball: get in his face (it throws him off), □ / R to try for a steal when
//   you're on him, ✕ / E to go up for the block as he shoots.
// - Walk off the court, get in a car or have the police after you and you forfeit (the bet
//   too). If he gets scared off or hurt, it's called off and the bet comes back.
// (Betting against another player waits for multiplayer: the wager is held the same way.)
const TO = 11;
const ARC = 6.75;
const BETS = [0, 50, 100, 250, 500];
const NAMES = ['Dre', 'Tank', 'Lil Mike', 'Jojo', 'Smoke', 'Ray', 'Peanut', 'Boogie', 'Shorty', 'Deuce'];
const G = 9.8;

export class Streetball {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.betI = 2;
    this.meter = null;
  }

  // ---- Joining (main.js handleInteractions, on foot) ----
  // Returns the court's hoops game and group you're standing by, or null.
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

  offer(a) {
    const game = this.game;
    if (this.active || game.player.vehicle || game.stars > 0 || game.stop) return;
    const near = this.nearGame();
    if (!near) return;
    const L = (k) => game.input.label(k);
    if (a.dealNo) {
      this.betI = (this.betI + 1) % BETS.length;
      a.melee = false; // (○ changes the bet here, it doesn't throw a punch)
    }
    let bet = BETS[this.betI];
    while (bet > game.cash && bet > 0) bet = BETS[BETS.indexOf(bet) - 1];
    const opp = near.g.players[0];
    if (!opp.ballName) opp.ballName = pick(NAMES);
    const betKey = game.input.mode === 'kb' ? 'Q' : '○';
    game.prompt = `${opp.ballName}: "Run it? One-on-one, to 11." ${L('interact')} to play · ${betKey} bet: ${bet ? `$${bet}` : 'nothing'}`;
    if (a.interactHeld && !game.interactWasHeld) this.start(near.H, near.g, opp, bet);
  }

  start(H, g, opp, bet) {
    const game = this.game;
    this.active = true;
    this.H = H;
    this.g = g;
    this.opp = opp;
    this.rim = g.rim;
    this.bet = bet;
    game.cash -= bet; // (held until it's over)
    this.score = { you: 0, opp: 0 };
    this.cleared = true;
    this.shot = null;
    this.blockT = 0;
    this.stealT = 0;
    this.outT = 0;
    this.dead = null;
    this.lastShooter = null;
    g.match = this;
    // Everyone else at that basket steps off and watches from the side.
    const C = H.site.court;
    const side = [];
    for (const q of g.players) if (q !== opp) side.push(q);
    side.forEach((q, k) => {
      q.hp.role = 'watch';
      const nx = this.rim.dz !== 0; // (court runs along z)
      q.hp.spot = nx ? [C.x0 - 1.2, this.rim.z + this.rim.dz * (5 + k * 2.5)] : [this.rim.x + this.rim.dx * (5 + k * 2.5), C.z0 - 1.2];
    });
    opp.hp.role = 'opp';
    this.give(Math.random() < 0.5 ? 'you' : 'opp', true);
    game.hud.toast(`One-on-one with ${opp.ballName}${bet ? ` · $${bet} on it` : ''}. First to 11`, '#ffd23f');
    game.hud.sport?.(this.board());
  }

  onCourt(x, z) {
    const C = this.H.site.court;
    return [Math.max(C.x0 + 0.6, Math.min(C.x1 - 0.6, x)), Math.max(C.z0 + 0.6, Math.min(C.z1 - 0.6, z))];
  }

  // ---- Possession ----
  topOfKey() {
    return [this.rim.x + this.rim.dx * 8, this.rim.z + this.rim.dz * 8];
  }

  give(who, check = false) {
    const b = this.g.ball;
    this.has = who;
    b.mode = 'held';
    b.holder = who === 'you' ? 'you' : this.opp;
    this.oppPlan = null;
    this.cleared = check ? true : this.cleared;
    if (who === 'opp') {
      this.opp.hp.role = 'opp';
      this.opp.hp.phase = 'walk';
      this.opp.hp.t = 0;
      this.oppPlan = { spot: check ? this.topOfKey() : null, setT: 0 };
    }
  }

  board() {
    const you = this.score.you;
    const opp = this.score.opp;
    return `YOU ${you} — ${opp} ${this.opp.ballName.toUpperCase()}${this.bet ? ` · $${this.bet} on it` : ''}`;
  }

  // ---- Your buttons (main.js, before the weapons; they're taken off the action list) ----
  input(dt, a) {
    const game = this.game;
    const fire = a.fire;
    const steal = a.reload;
    const block = a.dealYes;
    a.fire = a.firePressed = a.aim = a.aimPressed = a.melee = a.reload = a.dealYes = false;
    this.stealT = Math.max(0, this.stealT - dt);
    this.beatT = Math.max(0, (this.beatT || 0) - dt);
    this.blockT = Math.max(0, this.blockT - dt);
    const p = game.player;
    const [px, pz] = p.pos();
    const opp = this.opp;
    // Shooting: hold, let go at the top.
    if (this.has === 'you' && this.g.ball.mode === 'held') {
      if (fire) {
        this.meter = this.meter || { t: 0 };
        this.meter.t += dt;
      } else if (this.meter) {
        const v = this.meterValue();
        this.meter = null;
        this.shoot(v);
      }
    } else this.meter = null;
    // Defense.
    if (this.has === 'opp' && this.g.ball.mode === 'held' && opp.standing) {
      const d = dist(px, pz, opp.x, opp.z);
      if (steal && this.stealT <= 0) {
        this.stealT = 1.4;
        this.armsUp = 0.35;
        if (d < 1.5 && Math.random() < 0.22) {
          game.hud.toast('Picked his pocket!', '#7ee081');
          this.give('you');
          this.cleared = false; // (take it back)
        } else if (d < 2.5) this.beatT = 1.6; // (reached and missed: he's by you, an open look)
      }
      if (block && this.blockT <= 0) {
        this.blockT = 1.2;
        this.jumpT = 0.5;
        if (opp.hp.phase === 'shoot' && opp.hp.t < 0.3 && d < 1.6 && Math.random() < 0.3) {
          // Swatted: the ball goes loose.
          const b = this.g.ball;
          b.mode = 'loose';
          b.holder = null;
          b.vx = (opp.x - px) * 2;
          b.vz = (opp.z - pz) * 2;
          b.vy = 2;
          opp.hp.phase = 'walk';
          this.has = null;
          this.lastShooter = 'opp'; // (so it's yours to take back if you get it)
          game.hud.toast('Get that outta here!', '#7ee081');
        }
      }
    }
  }

  // The shot meter: up over 0.7 s, then back down (0..1).
  meterValue() {
    if (!this.meter) return 0;
    const t = this.meter.t % 1.4;
    return t < 0.7 ? t / 0.7 : 1 - (t - 0.7) / 0.7;
  }

  // Your shot: timing, distance, his hand in your face.
  shoot(v) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    const rim = this.rim;
    const d = dist(px, pz, rim.x, rim.z);
    const q = v >= 0.82 ? 1.25 : v >= 0.55 ? 0.75 : 0.3;
    const opp = this.opp;
    const close = dist(opp.x, opp.z, px, pz) < 1.6 && dist(opp.x, opp.z, rim.x, rim.z) < d;
    let pr = this.base(d) * q * (close ? 0.5 : 1);
    pr = Math.max(0.03, Math.min(0.95, pr));
    const make = Math.random() < pr;
    this.launchShot(px, pz, 2.3, make, 'you', d > ARC ? 2 : 1);
    this.jumpT = 0.5;
    game.hud.toast(v >= 0.82 ? 'Perfect release' : v >= 0.55 ? 'Good release' : 'Bad release', v >= 0.82 ? '#7ee081' : v >= 0.55 ? '#ffd23f' : '#ff8080');
  }

  base(d) {
    return d < 2 ? 0.72 : Math.max(0.28, 0.78 - d * 0.055);
  }

  launchShot(x, z, y, make, by, pts) {
    const b = this.g.ball;
    const rim = this.rim;
    b.x = x;
    b.z = z;
    b.y = y;
    const miss = make ? 0 : rand(0.22, 0.4);
    const a = rand(0, Math.PI * 2);
    const d = dist(x, z, rim.x, rim.z);
    this.H.launch(b, rim.x + Math.cos(a) * miss, rim.y + 0.08, rim.z + Math.sin(a) * miss * 0.6, 0.75 + d * 0.06);
    b.kind = 'shot';
    b.make = make;
    this.shot = { by, pts, counts: this.cleared };
    this.has = null;
  }

  // ---- The match, every frame (hoops.js hands the group over) ----
  step(dt) {
    const game = this.game;
    const b = this.g.ball;
    const H = this.H;
    const [px, pz] = game.player.pos();
    // Called off / forfeits.
    const opp = this.opp;
    if (opp.removed || opp.state !== 'play') return this.end('off');
    const P = H.site.pad;
    const off = px < P.x0 - 1 || px > P.x1 + 1 || pz < P.z0 - 1 || pz > P.z1 + 1;
    this.outT = off ? this.outT + dt : 0;
    if (this.outT > 2.5 || game.player.vehicle || game.stars > 0 || game.wastedT > 0 || game.bustedT > 0) return this.end('forfeit');
    // The ball.
    if (b.mode === 'flight') {
      b.t += dt;
      const k = Math.min(1, b.t / b.T);
      b.x = b.p0[0] + (b.p1[0] - b.p0[0]) * k;
      b.z = b.p0[2] + (b.p1[2] - b.p0[2]) * k;
      const t = Math.min(b.t, b.T);
      b.y = b.p0[1] + b.vy0 * t - 0.5 * G * t * t;
      if (b.t >= b.T) this.landed();
    } else if (b.mode === 'loose') {
      H.roll(b, dt);
      // After a basket: a dead ball, then it's checked.
      if (this.dead) {
        this.dead.t -= dt;
        if (this.dead.t <= 0) {
          const who = this.dead.who;
          this.dead = null;
          this.give(who, true);
        }
      // Whoever gets to it first.
      } else if (dist(px, pz, b.x, b.z) < 1.0 && b.y < 1.5) {
        const def = this.lastShooter === 'opp';
        this.give('you');
        if (def) this.cleared = false;
      } else if (dist(opp.x, opp.z, b.x, b.z) < 0.8 && b.y < 1.4) {
        const def = this.lastShooter === 'you';
        this.give('opp');
        if (def) {
          this.cleared = false;
          this.oppPlan = { spot: null, setT: 0 };
        }
      }
    }
    // Taking it back past the arc after a defensive board.
    const holder = this.has === 'you' ? [px, pz] : this.has === 'opp' ? [opp.x, opp.z] : null;
    if (holder && !this.cleared && dist(holder[0], holder[1], this.rim.x, this.rim.z) > ARC + 0.3) this.cleared = true;
    // The ball in hand.
    if (b.mode === 'held') {
      if (this.has === 'you') {
        const p = game.player;
        const h = p.heading;
        const fx = Math.sin(h);
        const fz = Math.cos(h);
        this.dribble = (this.dribble || 0) + dt * 9;
        if (this.meter) {
          b.x = px + fx * 0.3;
          b.z = pz + fz * 0.3;
          b.y = 1.3 + this.meterValue() * 0.9;
        } else {
          b.x = px + fx * 0.4 - fz * 0.3;
          b.z = pz + fz * 0.4 + fx * 0.3;
          b.y = 0.18 + Math.abs(Math.sin(this.dribble)) * 0.8;
        }
      } else if (this.has === 'opp') {
        const hp = opp.hp;
        const fx = Math.sin(opp.heading);
        const fz = Math.cos(opp.heading);
        if (hp.phase === 'walk') {
          hp.dribble = (hp.dribble || 0) + dt * 9;
          b.x = opp.x + fx * 0.4 - fz * 0.3;
          b.z = opp.z + fz * 0.4 + fx * 0.3;
          b.y = 0.18 + Math.abs(Math.sin(hp.dribble)) * 0.8;
        } else {
          const up = hp.phase === 'shoot' ? Math.min(1, hp.t / 0.25) : 0;
          b.x = opp.x + fx * 0.3;
          b.z = opp.z + fz * 0.3;
          b.y = 1.2 + up + (hp.jump || 0);
        }
      }
    }
    b.mesh.position.set(b.x, b.y, b.z);
    if (b.mode !== 'held') b.mesh.rotation.x += dt * 9;
    const kb = game.input.mode === 'kb';
    const hint = this.has === 'you' && !this.cleared ? 'Take it back past the arc'
      : this.has === 'opp' ? `${kb ? 'R' : '□'} steal · ${kb ? 'E' : '✕'} block`
      : this.has === 'you' ? `Hold ${game.input.label('fire')}, let go in the green` : 'Loose ball!';
    game.hud.sport?.(this.board(), this.meter ? this.meterValue() : null, hint);
  }

  landed() {
    const game = this.game;
    const b = this.g.ball;
    const s = this.shot;
    this.shot = null;
    this.lastShooter = s ? s.by : null;
    b.mode = 'loose';
    if (b.make) {
      b.x = this.rim.x;
      b.z = this.rim.z;
      b.vx = b.vz = 0;
      b.vy = -1.5;
      if (s && s.counts) {
        this.score[s.by] += s.pts;
        game.hud.toast(s.by === 'you' ? `Bucket! +${s.pts}` : `${this.opp.ballName} scores${s.pts > 1 ? ' from deep' : ''}`, s.by === 'you' ? '#7ee081' : '#ff8080');
        for (const q of this.g.players) if (q.hp.role === 'watch') q.hp.cheerT = 0.9;
      } else if (s) game.hud.toast("Doesn't count: take it back first", '#ffd23f');
      if (this.score.you >= TO || this.score.opp >= TO) return this.end(this.score.you >= TO ? 'win' : 'lose');
      // The other one checks it at the top (a moment to let it drop through).
      this.dead = { who: s && s.by === 'you' ? 'opp' : 'you', t: 0.9 };
      this.has = null;
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
    hp.jump = 0;
    const face = (x, z) => {
      p.heading = lerpAngle(p.heading, Math.atan2(x - p.x, z - p.z), Math.min(1, dt * 7));
    };
    if (p !== this.opp) {
      // Watching from the side.
      hp.cheerT = Math.max(0, (hp.cheerT || 0) - dt);
      if (dist(p.x, p.z, ...hp.spot) > 0.4) return { tx: hp.spot[0], tz: hp.spot[1], speed: 1.6 };
      face(b.x, b.z);
      return { speed: 0 };
    }
    // A dead ball after a basket: back to the top if it's his, or back on D.
    if (this.dead) {
      const [tx, tz] = this.dead.who === 'opp' ? this.topOfKey() : [rim.x + rim.dx * 3, rim.z + rim.dz * 3];
      if (dist(p.x, p.z, tx, tz) > 0.4) return { tx, tz, speed: 2.4 };
      face(px, pz);
      return { speed: 0 };
    }
    // Loose ball: go get it.
    if (b.mode === 'loose' || (b.mode === 'flight' && b.T - b.t < 0.3)) return { tx: b.x + b.vx * 0.3, tz: b.z + b.vz * 0.3, speed: 3.8 };
    if (this.has === 'opp') {
      const plan = this.oppPlan || (this.oppPlan = { spot: null, setT: 0 });
      hp.t += dt;
      if (hp.phase === 'walk') {
        if (plan.clearing && this.cleared) {
          plan.clearing = false; // (taken back: now find a shot)
          plan.spot = null;
          hp.t = 0;
        }
        if (!plan.spot) {
          // A spot to shoot from (past the arc first if he has to take it back).
          plan.clearing = !this.cleared;
          const r = this.cleared ? rand(1.5, 7.5) : rand(7.3, 8.5);
          const ang = rand(-1.1, 1.1);
          plan.spot = this.onCourt(rim.x + (rim.dx * Math.cos(ang) - rim.dz * Math.sin(ang)) * r, rim.z + (rim.dz * Math.cos(ang) + rim.dx * Math.sin(ang)) * r);
        }
        if (dist(p.x, p.z, ...plan.spot) > 0.45 && hp.t < 4.5) return { tx: plan.spot[0], tz: plan.spot[1], speed: 3.0 };
        if (plan.clearing) {
          // (the spot got pulled in by the sideline: straight out instead)
          plan.spot = this.onCourt(rim.x + rim.dx * 8.2, rim.z + rim.dz * 8.2);
          hp.t = 0;
          return { speed: 0 };
        }
        hp.phase = 'set';
        hp.t = 0;
        hp.setT = rand(0.3, 0.8);
        return { speed: 0 };
      }
      if (hp.phase === 'set') {
        face(rim.x, rim.z);
        if (hp.t > hp.setT) {
          hp.phase = 'shoot';
          hp.t = 0;
        }
        return { speed: 0 };
      }
      if (hp.phase === 'shoot') {
        face(rim.x, rim.z);
        hp.jump = hp.t < 0.5 ? Math.sin((Math.PI * hp.t) / 0.5) * 0.45 : 0;
        if (hp.t >= 0.25 && b.mode === 'held' && this.has === 'opp') {
          const d = dist(p.x, p.z, rim.x, rim.z);
          const contested = dist(px, pz, p.x, p.z) < 1.6 && !(this.beatT > 0);
          const make = Math.random() < this.base(d) * 1.1 * (contested ? 0.55 : 1);
          this.launchShot(p.x + Math.sin(p.heading) * 0.3, p.z + Math.cos(p.heading) * 0.3, 2.3 + hp.jump, make, 'opp', d > ARC ? 2 : 1);
        }
        if (hp.t > 0.7) {
          hp.phase = 'walk';
          hp.t = 0;
        }
        return { speed: 0 };
      }
    }
    // Defending: between you and the basket, a step off you.
    if (this.has === 'you') {
      const d = dist(px, pz, rim.x, rim.z) || 1;
      const k = Math.min(1.3, d * 0.5);
      const tx = px + ((rim.x - px) / d) * k;
      const tz = pz + ((rim.z - pz) / d) * k;
      face(px, pz);
      if (dist(p.x, p.z, tx, tz) > 0.3) return { tx, tz, speed: 3.6 };
      // A swipe at the ball now and then.
      this.oppSwipeT = (this.oppSwipeT ?? rand(2, 4)) - dt;
      if (this.oppSwipeT <= 0 && dist(p.x, p.z, px, pz) < 1.4 && !this.meter) {
        this.oppSwipeT = rand(2.5, 5);
        if (Math.random() < 0.18) {
          game.hud.toast(`${p.ballName} pokes it away!`, '#ff8080');
          this.give('opp');
          this.cleared = false;
        }
      }
      return { speed: 0 };
    }
    face(b.x, b.z);
    return { speed: 0 };
  }

  pose(p) {
    const hp = p.hp;
    const c = p.char;
    if (p === this.opp && this.has === 'opp') {
      if (hp.phase === 'walk') c.armR.rotation.x = -0.5 - Math.abs(Math.cos(hp.dribble || 0)) * 0.35;
      else if (hp.phase === 'shoot') c.armL.rotation.x = c.armR.rotation.x = -1.4 - Math.min(1, hp.t / 0.25) * 1.5;
      else c.armL.rotation.x = c.armR.rotation.x = -1.3;
    } else if (p === this.opp) {
      c.armL.rotation.x = c.armR.rotation.x = -1.0; // (hands up on defense)
    } else if (hp.cheerT > 0) c.armR.rotation.x = -2.9;
    return 0.06 + (hp.jump || 0);
  }

  // Your arms (main.js, after you move).
  late(dt) {
    const game = this.game;
    const p = game.player;
    const c = p.char;
    p.showWeapon('fists');
    this.jumpT = Math.max(0, (this.jumpT || 0) - dt);
    this.armsUp = Math.max(0, (this.armsUp || 0) - dt);
    if (this.has === 'you' && this.g.ball.mode === 'held') {
      if (this.meter) c.armL.rotation.x = c.armR.rotation.x = -1.4 - this.meterValue() * 1.4;
      else c.armR.rotation.x = -0.5 - Math.abs(Math.cos(this.dribble || 0)) * 0.35;
    } else if (this.jumpT > 0 || this.armsUp > 0) {
      c.armL.rotation.x = c.armR.rotation.x = -2.8;
    } else if (this.has === 'opp') c.armL.rotation.x = c.armR.rotation.x = -1.0;
    if (this.jumpT > 0) c.group.position.y += Math.sin((this.jumpT / 0.5) * Math.PI) * 0.45;
  }

  // ---- Over ----
  end(how) {
    const game = this.game;
    const name = this.opp?.ballName || 'He';
    const bet = this.bet;
    if (how === 'win') {
      game.cash += bet * 2;
      game.cred += 8;
      game.hud.toast(`You beat ${name} ${this.score.you}-${this.score.opp}${bet ? ` · +$${bet}` : ''} · +8 cred`, '#7ee081');
    } else if (how === 'lose') {
      game.hud.toast(`${name} wins ${this.score.opp}-${this.score.you}${bet ? ` · -$${bet}` : ''}`, '#ff8080');
    } else if (how === 'forfeit') {
      game.hud.toast(`You walked off: ${name} takes it${bet ? ` · -$${bet}` : ''}`, '#ff8080');
    } else {
      game.cash += bet; // (called off: money back)
      game.hud.toast('Game called off', '#9fc3ff');
    }
    this.active = false;
    this.meter = null;
    this.dead = null;
    const g = this.g;
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
