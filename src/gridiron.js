import * as THREE from 'three';
import { dist, rand, pick } from './util.js';
import { setShirt } from './character.js';

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
// The receivers' buttons (in the order they line up), their colors, and the keyboard keys.
const ICONS = ['□', '✕', '○', '△', 'R1'];
const ICON_COLORS = ['#ff79c6', '#6fa8ff', '#ff6b6b', '#3ddc97', '#ffd23f'];
const BULLET = 0.22; // (held longer than this it's a lob)

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
    if (this.active || game.player.vehicle || game.stars > 0 || game.stop || !fb?.ball || fb.match) return;
    const qb = fb.qb;
    if (!qb || !qb.fb || !fb.wrs.length || !['reset', 'set'].includes(fb.phase)) return;
    const [px, pz] = game.player.pos();
    if (!this.onField(px, pz) || dist(px, pz, qb.x, qb.z) > 9) return;
    if (a.dealNo) {
      this.betI = (this.betI + 1) % BETS.length;
      a.melee = false;
    }
    let bet = BETS[this.betI];
    while (bet > game.cash && bet > 0) bet = BETS[BETS.indexOf(bet) - 1];
    if (!qb.ballName) qb.ballName = pick(NAMES);
    const betKey = game.input.mode === 'kb' ? 'Q' : '○';
    game.prompt = `${qb.ballName}: "You got an arm? From the 40, four downs. Put it in the end zone." ${game.input.label('interact')} to play · ${betKey} bet: ${bet ? `$${bet}` : 'nothing'}`;
    if (a.interactHeld && !game.interactWasHeld) this.start(qb, bet);
  }

  start(qb, bet) {
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
    this.los = this.goal + 40 * YD;
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
      const d = game.peds.addAt(w.x, w.z - 6);
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
    game.hud.toast(`${qb.ballName}'s squad · ${bet ? `$${bet} says you score` : 'just for fun'}. Get behind the line`, '#ffd23f');
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
      // Behind the line, near the middle, everyone set: ✕ hikes it.
      const ready = fb.phase === 'set' || (fb.phase === 'reset' && fb.players.every((q) => q.fb.role === 'bench' || q.fb.role === 'fan' || dist(q.x, q.z, ...q.fb.home) < 1.5));
      const spot = pz > this.los + 1 && pz < this.los + 8 && Math.abs(px - fb.site.field.cx) < 6;
      this.ready = ready && spot;
      if (hike && this.ready) this.snap();
      return;
    }
    const R = a.qbR || [];
    const pad = game.input.mode === 'pad' && !game.input.touchMode;
    if (this.state === 'play' && b.holder === 'you' && !this.scramble) {
      // A receiver's button (or, with a mouse, a click on the man you're looking at): tap for a
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
    for (const w of fb.wrs) {
      w.fb.route = fb.route(w);
      w.fb.leg = 0;
    }
    fb.target = null;
    this.prevR = [true, true, true, true, true]; // (the ✕ that hiked it isn't a throw)
    this.press = null;
    this.game.hud.toast('Hike!', '#ffd23f');
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
    for (const q of fb.dbs) if (!db || dist(q.x, q.z, b.x, b.z) < dist(db.x, db.z, b.x, b.z)) db = q;
    const dD = db ? dist(db.x, db.z, b.x, b.z) : 99;
    // A bullet: a back sitting on the line of it (the last two thirds) can jump it.
    if (b.style === 'bullet') {
      for (const q of fb.dbs) {
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
    let pr = dW < 0.8 ? 0.9 : dW < 1.6 ? 0.65 : dW < 2.5 ? 0.3 : 0;
    const cover = db && w ? dist(db.x, db.z, w.x, w.z) : 99;
    if (cover < 1.5) pr -= 0.3;
    else if (cover < 2.5) pr -= 0.15;
    if (Math.random() < pr) {
      fb.hold(w);
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
      if (b.holder === 'you') {
        // Scrambling past the line.
        if (pz < this.los) this.scramble = true;
        if (pz <= this.goal) return this.touchdown('you');
        const tackler = fb.dbs.find((q) => dist(q.x, q.z, px, pz) < 0.9);
        if (this.scramble && tackler) {
          game.hud.toast(`Brought down at the ${this.yardLine(pz)}`, '#ffd23f');
          return this.over(pz);
        }
        if (!this.scramble && this.t > SACK) {
          game.hud.toast('SACKED', '#ff8080');
          return this.over(Math.min(this.los + 4 * YD, fb.site.field.z1 - 1));
        }
      }
    } else if (this.state === 'run') {
      const h = b.holder;
      if (!h || h === 'you') return this.over(this.los);
      if (h.z <= this.goal) return this.touchdown(h);
      const tackler = fb.dbs.find((q) => dist(q.x, q.z, h.x, h.z) < 0.9);
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
    // The arrow over who you'd throw to.
    this.target = this.state === 'play' && b.holder === 'you' && !this.scramble ? this.pickTarget() : null;
    const kb = game.input.mode === 'kb';
    this.arrow.visible = !!this.target && kb; // (with a mouse: the man a click goes to)
    if (this.target) this.arrow.position.set(this.target.x, 3.1 + Math.sin(game.time * 6) * 0.08, this.target.z);
    this.updateIcons();
    let hint = '';
    const keys = kb ? '1-4' : '□ ✕ ○ △';
    if (this.state === 'line') hint = this.ready ? `${kb ? 'E' : '✕'} hike · then each receiver's button throws to him` : 'Get behind the line, in the middle';
    else if (this.state === 'play' && b.holder === 'you') hint = this.scramble ? 'Run it in!' : this.t > SACK - 1.5 ? 'Pocket collapsing: throw it!' : `${keys}: tap a bullet, hold a lob · left stick leads him${kb ? ' · or click the man you look at' : ''}`;
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
      b.x = px - fx * 0.2 - fz * 0.35;
      b.z = pz - fz * 0.2 + fx * 0.35;
      b.y = 2.0;
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
    game.hud.toast(who === 'you' ? 'TOUCHDOWN! You took it in yourself' : 'TOUCHDOWN!', '#7ee081');
    this.end('td');
  }

  // Your arms (main.js, after you move).
  late() {
    const game = this.game;
    const p = game.player;
    const c = p.char;
    p.showWeapon('fists');
    const b = this.fb.ball;
    if (b.holder === 'you') {
      if (this.press) {
        c.armR.rotation.x = -2.9;
        c.armL.rotation.x = -1.2;
      } else c.armR.rotation.x = -0.7;
    } else if (this.throwT > 0) c.armR.rotation.x = -2.2; // (follow-through)
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
      fb.players.splice(fb.players.indexOf(d), 1);
      if (fb.dbs.includes(d)) fb.dbs.splice(fb.dbs.indexOf(d), 1);
      if (fb.ball?.holder === d) fb.loose();
      d.keep = false;
      d.sidewalk = true;
      d.act = null;
      if (d.state === 'play' && !d.removed) d.resumeWalking();
    }
    this.extra = [];
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
