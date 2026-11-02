// What you see of a street dice game while you're in it (dice.js): the money and the calls.
//   The money: what everybody has down sits on the ground in front of them as real bills
//   (broken into hundreds, fifties, twenties, tens, fives and ones), a label with the amount over
//   it. Putting money down, people go through it in their hand and set it down (a squat, a bent-
//   over slap, a flick from standing); when a bet's decided the loser's money goes over to the
//   winner and the winner grabs it up (a two-hand scoop, a snatch into the back pocket, a scoop
//   and a kiss on it). People thumb through their money while they wait.
//   The calls: what the roll means, big in the middle (with the dice's street names), +$ / -$
//   floating off whoever won or lost, a tag over each player (name, cash, SHOOTER, what they've
//   got against you), what they say in bubbles over their heads (an offer with a countdown and
//   TAKE / PASS), the point over the dice, a ring under the shooter, the dice popping up big for
//   a beat when they land so you can read them.
// People here are 'you' or a seat (dice.js Circle.peds); 'pot' is cee-lo's money in the middle.
import * as THREE from 'three';
import { bendSpine, crouchPose, restPose } from './character.js';
import { kneelPose } from './combatpose.js';

// The dice's street names.
export const NICK = { 2: 'Snake eyes', 3: 'Ace-deuce', 4: 'Little Joe', 5: 'Fever', 6: 'Sixie', 7: 'Seven', 8: 'Eighter', 9: 'Nina', 10: 'Big Dick', 11: 'Yo', 12: 'Boxcars' };
const WORD = { 4: 'four', 5: 'five', 6: 'six', 8: 'eight', 9: 'nine', 10: 'ten' };
export const pointWord = (n) => WORD[n] || String(n);

// ---- The bills ----
const DENOMS = [100, 50, 20, 10, 5, 1];
const BILL = new THREE.BoxGeometry(0.156, 0.004, 0.066);
const BILL_MATS = {};
const billMat = (d) => (BILL_MATS[d] ||= new THREE.MeshLambertMaterial({ color: { 100: 0x8fb39a, 50: 0x92b08a, 20: 0x86a87a, 10: 0x9cb58c, 5: 0x8eaa84, 1: 0x7f9c72 }[d] }));
const WAD = new THREE.BoxGeometry(0.035, 0.07, 0.12);

// Bills for an amount, biggest first.
function breakDown(v) {
  const out = [];
  let left = Math.max(0, Math.round(v));
  for (const d of DENOMS) {
    while (left >= d && out.length < 40) {
      out.push(d);
      left -= d;
    }
  }
  return out;
}

const ease = (k) => k * k * (3 - 2 * k);
// (which of a die's 3x3 spots have a pip, for each value)
const PIPS = [[2, 3, 4, 5, 6], [], [4, 5, 6], [6], [1, 3, 5], [6], [4, 5, 6], [], [2, 3, 4, 5, 6]];
const seg = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class DiceFX {
  constructor(mgr, circle) {
    this.mgr = mgr;
    this.game = mgr.game;
    this.c = circle;
    this.piles = new Map(); // who -> { amount, x, z, group, el }
    this.flights = [];
    this.acts = new Map(); // who -> the money move they're doing
    this.later = []; // [time, fn]
    this.bubbles = new Map(); // who -> { el, until }
    this.tags = new Map();
    this.root = document.createElement('div');
    this.root.id = 'dice-fx';
    document.body.appendChild(this.root);
    this.callEl = this.div('dfx-call hidden');
    this.pointEl = this.div('dfx-point hidden');
    // (the ring under whoever's shooting)
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.46, 40), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 2;
    this.game.scene.add(this.ring);
    this.wads = new Map(); // character -> { L, R }
  }

  div(cls, parent = this.root) {
    const d = document.createElement('div');
    d.className = cls;
    parent.appendChild(d);
    return d;
  }

  // ---- Who's where ----
  char(who) {
    return who === 'you' ? this.game.player.char : who.p.char;
  }

  pos(who) {
    if (who === 'you') return [this.game.player.x, this.game.player.z];
    return [who.p.x, who.p.z];
  }

  // The spot on the ground in front of somebody (toward the dice), where their money goes.
  front(who) {
    if (who === 'pot') return [this.c.sx - this.c.dir[0] * 0.5, this.c.sz - this.c.dir[1] * 0.5];
    const P = this.c.place(who);
    const dx = this.c.sx - P.x;
    const dz = this.c.sz - P.z;
    const l = Math.hypot(dx, dz) || 1;
    const k = who === this.c.shooter ? 0.42 : 0.5;
    // (a little to the right hand side, where it gets set down)
    return [P.x + (dx / l) * k - (dz / l) * 0.12, P.z + (dz / l) * k + (dx / l) * 0.12];
  }

  // ---- The money ----
  pile(who) {
    let P = this.piles.get(who);
    if (!P) {
      const [x, z] = this.front(who);
      P = { amount: 0, shown: 0, x, z, group: new THREE.Group(), el: this.div('dfx-pile hidden') };
      P.group.position.set(x, this.c.y + 0.003, z);
      this.game.scene.add(P.group);
      this.piles.set(who, P);
    }
    return P;
  }

  // The bills in a pile, laid down loose (a few at most per kind, the label says the rest).
  build(P) {
    if (P.shown === P.amount) return;
    P.shown = P.amount;
    for (const m of [...P.group.children]) P.group.remove(m);
    const bills = breakDown(P.amount);
    const n = Math.min(bills.length, 14);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(BILL, billMat(bills[i]));
      const a = (i * 2.4) % (Math.PI * 2);
      const r = 0.015 + (i % 4) * 0.012;
      m.position.set(Math.sin(a) * r, 0.002 + i * 0.0042, Math.cos(a) * r);
      m.rotation.y = ((i * 1.7) % 1.2) - 0.6;
      P.group.add(m);
    }
    P.el.classList.toggle('hidden', P.amount <= 0);
    P.el.textContent = `$${P.amount}`;
  }

  // Somebody puts money down: they go through it, set it down (one of a few ways), and the bills
  // land on their pile (or the pot).
  stake(who, amount, to = who) {
    if (amount <= 0) return;
    if (who === 'pot') return;
    const go = () => this.move(who, 'place', pick([0, 1, 2]), 1.0, 0.6, () => {
      this.fly(this.hand(who), to, amount, () => (this.pile(to).amount += amount));
    });
    // (already doing something: right after it)
    const A = this.acts.get(who);
    if (A && A.kind !== 'count') A.then = [...(A.then || []), go];
    else go();
  }

  // Money from one pile to another (the loser's going over to the winner), then the winner grabs
  // it up.
  pay(from, to, amount, delay = 0) {
    this.after(delay, () => {
      const P = this.piles.get(from);
      if (!P || P.amount <= 0) return;
      const v = Math.min(amount, P.amount);
      P.amount -= v;
      this.fly([P.x, this.c.y + 0.02, P.z], to, v, () => (this.pile(to).amount += v));
    });
  }

  // Grab up everything in your pile (then, sometimes, count it).
  collect(who, delay = 0) {
    this.after(delay, () => {
      const P = this.piles.get(who);
      if (!P || P.amount <= 0) return;
      const v = pick([0, 0, 1, 2]);
      this.move(who, 'grab', v, 1.5, 0.5, () => {
        P.amount = 0;
        this.build(P);
      }, () => {
        if (who !== 'you' && Math.random() < 0.6) this.move(who, 'count', Math.floor(Math.random() * 3), 2.2);
      });
    });
  }

  // Everything off the ground at once (a raid, everybody walking off).
  clearMoney() {
    for (const P of this.piles.values()) {
      P.amount = 0;
      this.build(P);
    }
    for (const F of this.flights) this.game.scene.remove(F.m);
    this.flights = [];
  }

  // Bills in the air from a point to someone's pile.
  fly(from, to, amount, done) {
    const [tx, tz] = this.pile(to) && [this.pile(to).x, this.pile(to).z];
    const m = new THREE.Group();
    for (let i = 0; i < Math.min(4, 1 + Math.floor(amount / 40)); i++) {
      const b = new THREE.Mesh(BILL, billMat(20));
      b.position.set((i - 1) * 0.02, i * 0.005, 0);
      b.rotation.y = i * 0.4;
      m.add(b);
    }
    m.position.set(...from);
    this.game.scene.add(m);
    this.flights.push({ m, from, to: [tx, this.c.y + 0.01, tz], t: 0, T: 0.45, done });
  }

  // Where somebody's right hand is (a wad in it while they set it down).
  hand(who) {
    const c = this.char(who);
    c.group.updateMatrixWorld(true);
    const v = c.wristR.getWorldPosition(new THREE.Vector3());
    return [v.x, v.y - 0.1, v.z];
  }

  // A knot of bills in somebody's hand (shown while they've got money in it).
  wad(c, side) {
    let W = this.wads.get(c);
    if (!W) {
      W = {};
      for (const s of ['L', 'R']) {
        const m = new THREE.Mesh(WAD, billMat(20));
        m.position.set(0, -0.12, 0.04);
        m.visible = false;
        c[s === 'L' ? 'wristL' : 'wristR'].add(m);
        W[s] = m;
      }
      this.wads.set(c, W);
    }
    return W[side];
  }

  // ---- The money moves (dice.js asks pose() for anybody doing one) ----
  move(who, kind, v, dur, hitAt = 0, onHit = null, onDone = null) {
    this.acts.set(who, { kind, v, t: 0, dur, hitAt, onHit, onDone, hit: false });
  }

  busy(who) {
    return this.acts.has(who);
  }

  // Pose somebody doing a money move. Returns the height offset, or null if they aren't.
  pose(who, c, kneel) {
    const A = this.acts.get(who);
    const W = this.wads.get(c);
    if (W) W.L.visible = W.R.visible = false;
    if (!A) return null;
    const u = A.t;
    const t = this.game.time;
    restPose(c);
    for (const k of ['legL', 'legR', 'kneeL', 'kneeR']) c[k].rotation.set(0, 0, 0);
    let y = kneel ? kneelPose(c) : 0;
    const sp = (x) => bendSpine(c, kneel ? 0.3 + x * 0.3 : x);
    if (A.kind === 'count') {
      // Going through it: thumbing bills off, licking the thumb first, or fanning it out.
      this.wad(c, 'L').visible = true;
      sp(0.15);
      c.neck.rotation.set(0.35, 0, 0);
      c.armL.rotation.set(-0.8, 0, 0.15);
      c.elbowL.rotation.x = -1.45;
      if (A.v === 2) {
        const s = Math.sin(u * 3.2);
        c.armL.rotation.set(-0.9, 0, 0.25 + 0.15 * s);
        c.armR.rotation.set(-0.9, 0, -0.25 - 0.15 * s);
        c.elbowR.rotation.x = -1.3;
        this.wad(c, 'R').visible = true;
      } else if (A.v === 1 && u < 0.5) {
        c.armR.rotation.set(-1.0, 0, -0.5);
        c.elbowR.rotation.x = -2.3;
      } else {
        c.armR.rotation.set(-0.85, 0, -0.15);
        c.elbowR.rotation.x = -1.55 + Math.sin(t * 13) * 0.12;
        c.wristR.rotation.x = Math.sin(t * 13) * 0.35;
      }
      return y;
    }
    if (A.kind === 'place') {
      const k = Math.sin(Math.PI * Math.min(1, u / A.dur));
      const before = u < A.dur * A.hitAt;
      this.wad(c, 'R').visible = before;
      if (A.v === 0) {
        // (down in a squat, set it on the ground)
        if (!kneel) y = crouchPose(c, 0.75 * k);
        sp(0.25 + 0.35 * k);
        c.armR.rotation.set(-0.45 * k, 0, -0.1);
        c.elbowR.rotation.x = -0.25;
      } else if (A.v === 1) {
        // (bent over, slap it down)
        if (!kneel) y = crouchPose(c, 0.25 * k);
        sp(0.85 * k);
        const w = seg(u, 0, A.dur * 0.45);
        const s = seg(u, A.dur * 0.45, A.dur * A.hitAt);
        c.armR.rotation.set(-0.4 - 1.2 * ease(w) + 1.3 * ease(s), 0, -0.1);
        c.elbowR.rotation.x = -0.9 + 0.8 * s;
      } else {
        // (a flick from standing, it lands down there)
        sp(0.2 * k);
        const s = seg(u, A.dur * 0.3, A.dur * A.hitAt);
        c.armR.rotation.set(-0.3 - 0.8 * ease(s), 0, -0.15);
        c.elbowR.rotation.x = -1.3 + 1.1 * s;
        c.wristR.rotation.x = -0.6 * s;
      }
      c.neck.rotation.set(0.3 * k, 0, 0);
      return y;
    }
    if (A.kind === 'grab') {
      const hit = A.dur * A.hitAt;
      const down = u < hit ? ease(seg(u, 0, hit)) : 1 - ease(seg(u, hit, hit + 0.45));
      const after = u >= hit;
      this.wad(c, 'R').visible = after;
      if (!kneel) y = crouchPose(c, (A.v === 1 ? 0.35 : 0.8) * down);
      sp((A.v === 1 ? 0.8 : 0.45) * down + 0.1);
      c.neck.rotation.set(0.35 * down, 0, 0);
      if (!after || down > 0.3) {
        // (reaching down for it, both hands on a scoop)
        c.armR.rotation.set(-0.5 * down, 0, -0.1);
        c.elbowR.rotation.x = -0.25;
        if (A.v !== 1) {
          c.armL.rotation.set(-0.5 * down, 0, 0.1);
          c.elbowL.rotation.x = -0.25;
        }
        return y;
      }
      const k = seg(u, hit + 0.3, A.dur);
      if (A.v === 1) {
        // (into the back pocket)
        c.armR.rotation.set(0.45 * ease(k), 0, -0.25);
        c.elbowR.rotation.x = -0.9 * ease(k);
        this.wad(c, 'R').visible = k < 0.9;
      } else if (A.v === 2) {
        // (up to the mouth for a kiss, then waved up high)
        const kiss = seg(u, hit + 0.3, hit + 0.65);
        const wave = seg(u, hit + 0.65, A.dur);
        c.armR.rotation.set(-1.0 - 1.8 * ease(wave) + Math.sin(t * 10) * 0.15 * wave, 0, -0.45 + 0.3 * wave);
        c.elbowR.rotation.x = -2.25 * (1 - wave) * ease(kiss) - 0.2 * wave;
      } else {
        // (both hands up to the chest with it, going through it)
        c.armR.rotation.set(-0.85 * ease(k), 0, -0.15);
        c.elbowR.rotation.x = -1.5 * ease(k);
        c.armL.rotation.set(-0.8 * ease(k), 0, 0.15);
        c.elbowL.rotation.x = -1.45 * ease(k);
      }
      return y;
    }
    return null;
  }

  // ---- What's said and what it means ----
  // The big call in the middle. tone: 'good' (for you), 'bad', or 'news'.
  call(text, sub = '', tone = 'news', dur = 1.8, dice = null) {
    const el = this.callEl;
    el.className = `dfx-call ${tone}`;
    // (the dice as they landed, drawn big, so you can read them)
    const faces = (dice || []).map((n) => `<span class="dfx-die">${PIPS.map((on) => `<i${on.includes(n) ? ' class="on"' : ''}></i>`).join('')}</span>`).join('');
    el.innerHTML = `${faces ? `<div class="dfx-dice">${faces}</div>` : ''}<div class="dfx-c1"></div><div class="dfx-c2"></div>`;
    el.querySelector('.dfx-c1').textContent = text;
    el.querySelector('.dfx-c2').textContent = sub;
    void el.offsetWidth;
    el.classList.add('show');
    this.callUntil = this.game.time + dur;
  }

  // +$ / -$ floating up off somebody.
  float(who, v) {
    if (!v) return;
    // (yours goes in the big call, when it's up, not on top of it)
    if (who === 'you' && this.callUntil > this.game.time) {
      const c2 = this.callEl.querySelector('.dfx-c2');
      if (c2) {
        const m = document.createElement('span');
        m.className = `dfx-you ${v > 0 ? 'up' : 'down'}`;
        m.textContent = v > 0 ? `  +$${v}` : `  -$${-v}`;
        c2.appendChild(m);
        return;
      }
    }
    const el = this.div(`dfx-float ${v > 0 ? 'up' : 'down'}`);
    el.textContent = v > 0 ? `+$${v}` : `-$${-v}`;
    this.later.push([this.game.time + 1.6, () => el.remove()]);
    el.dataset.t0 = this.game.time;
    el.who = who;
  }

  // Somebody says something (over their head, a couple of seconds).
  // pri: 0 chatter, 1 talk, 2 to you / the shooter, 3 must be seen. Chatter waits its turn:
  // at most two bubbles up at once, and not hard on the heels of the last.
  say(who, text, dur = 2.3, pri = 1) {
    if (!who || who === 'pot') return;
    const now = this.game.time;
    const up = [...this.bubbles.values()].filter((b) => b.until > now && b.el.style.display !== 'none').length;
    if (pri < 2 && (up >= 2 || now - (this.lastTalk || -9) < (pri ? 0.6 : 1.4))) return;
    if (pri < 2) this.lastTalk = now;
    let B = this.bubbles.get(who);
    if (!B) {
      B = { el: this.div('dfx-bubble') };
      this.bubbles.set(who, B);
    }
    B.el.className = 'dfx-bubble';
    B.el.textContent = text;
    B.until = this.game.time + Math.max(dur, 2.2);
    B.offer = null;
    B.pri = pri;
  }

  // An offer to you, over the one making it: a countdown, and what to press.
  offer(who, text, T, keys) {
    let B = this.bubbles.get(who);
    if (!B) {
      B = { el: this.div('dfx-bubble') };
      this.bubbles.set(who, B);
    }
    B.el.className = 'dfx-bubble offer';
    B.el.innerHTML = '<div class="dfx-ot"></div><div class="dfx-ok"><span class="dfx-ring"></span><span class="dfx-keys"></span></div>';
    B.el.querySelector('.dfx-ot').textContent = text;
    B.el.querySelector('.dfx-keys').innerHTML = keys;
    B.until = Infinity;
    B.offer = { T };
    B.pri = 3;
  }

  endOffer() {
    for (const B of this.bubbles.values()) {
      if (B.offer) {
        B.until = 0;
        B.offer = null;
      }
    }
  }

  // The dice pop up big a beat when they land.
  pop() {
    this.popT = this.game.time;
    for (const D of this.c.dice) D.rest = [D.m.position.x, D.m.position.z];
  }

  after(delay, fn) {
    this.later.push([this.game.time + delay, fn]);
  }

  // ---- Every frame ----
  update(dt) {
    const game = this.game;
    const now = game.time;
    for (const L of [...this.later]) {
      if (now >= L[0]) {
        this.later.splice(this.later.indexOf(L), 1);
        L[1]();
      }
    }
    // (the money moves)
    for (const [who, A] of [...this.acts]) {
      A.t += dt;
      if (!A.hit && A.t >= A.dur * A.hitAt) {
        A.hit = true;
        A.onHit?.();
      }
      if (A.t >= A.dur) {
        this.acts.delete(who);
        A.onDone?.();
        for (const f of A.then || []) f();
      }
    }
    // (people with money in hand go through it now and then, while they wait)
    for (const s of this.c.peds) {
      if (this.acts.has(s) || s === this.c.shooter || s.react > now || s.p.speed > 0) continue;
      s.countT = (s.countT ?? 3 + Math.random() * 6) - dt;
      if (s.countT <= 0) {
        s.countT = 5 + Math.random() * 8;
        if (s.role === 'cash' || Math.random() < 0.35) this.move(s, 'count', Math.floor(Math.random() * 3), 1.6 + Math.random() * 1.2);
      }
    }
    // (bills in the air)
    for (const F of [...this.flights]) {
      F.t += dt;
      const k = Math.min(1, F.t / F.T);
      F.m.position.set(F.from[0] + (F.to[0] - F.from[0]) * k, F.from[1] + (F.to[1] - F.from[1]) * k + Math.sin(k * Math.PI) * 0.35, F.from[2] + (F.to[2] - F.from[2]) * k);
      F.m.rotation.y += dt * 9;
      if (k >= 1) {
        game.scene.remove(F.m);
        this.flights.splice(this.flights.indexOf(F), 1);
        F.done?.();
      }
    }
    for (const P of this.piles.values()) this.build(P);
    // (the ring under the shooter)
    const sh = this.c.shooter;
    this.ring.visible = !!sh;
    if (sh) {
      const P = this.c.place(sh);
      this.ring.position.set(P.x, this.c.y + 0.025, P.z);
      this.ring.material.color.set(sh === 'you' ? 0x5ef2b0 : 0xffd23f);
      this.ring.material.opacity = 0.45 + 0.3 * Math.sin(now * 5);
    }
    // (the dice: up big a beat after they land, so you can read them)
    const pk = this.popT != null ? (now - this.popT) / 2.4 : 1;
    const sc = pk < 1 ? 1 + 1.3 * ease(Math.min(1, pk / 0.08)) * (pk < 0.8 ? 1 : 1 - ease((pk - 0.8) / 0.2)) : 1;
    // (popped up big, they move apart into a row across the throw, so they never grow into each
    // other; then back down where they landed)
    const big = Math.max(1, sc);
    const k = (big - 1) / 1.3;
    const n = this.c.dice.length;
    const rested = this.c.dice.every((D) => D.rest);
    const cx = rested ? this.c.dice.reduce((v, D) => v + D.rest[0], 0) / n : 0;
    const cz = rested ? this.c.dice.reduce((v, D) => v + D.rest[1], 0) / n : 0;
    const [ddx, ddz] = this.c.dir;
    this.c.dice.forEach((D, i) => {
      if (this.c.throw) {
        D.m.scale.setScalar(1);
        D.rest = null;
        return;
      }
      D.m.scale.setScalar(big);
      if (rested) {
        const size = D.m.geometry.parameters.width;
        const off = (i - (n - 1) / 2) * size * big * 1.65;
        const rx = cx - ddz * off;
        const rz = cz + ddx * off;
        D.m.position.x = D.rest[0] + (rx - D.rest[0]) * k;
        D.m.position.z = D.rest[1] + (rz - D.rest[1]) * k;
      }
      D.m.position.y = this.c.y + (D.m.geometry.parameters.height / 2) * big;
    });
    this.overlay();
  }

  // Screen position of a point in the world (null: behind you).
  screen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.game.camera);
    if (v.z > 1 || v.z < -1) return null;
    return [((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight];
  }

  // Tags, bubbles, labels and floats over the people and the money, laid out so nothing sits on
  // anything else: the most important placed first (an offer, the point, what you won or lost,
  // what's said, then names and the money labels), each slid up or down to a free spot, and
  // the least important left out when there's no room. The big call, the panel, the info top
  // left and the phone's buttons are kept clear.
  overlay() {
    const now = this.game.time;
    const R = this.mgr.round;
    this.game.camera.updateMatrixWorld();
    const head = (who) => {
      const c = this.char(who);
      const [x, z] = this.pos(who);
      return this.screen(x, c.group.position.y + 2.05, z);
    };
    const items = [];
    const add = (el, p, pri, stack = 0) => {
      if (!p) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      items.push({ el, x: p[0], y: p[1], pri, stack });
    };
    // (bubbles: over the one talking, in place of their tag)
    const talking = new Set();
    for (const [who, B] of [...this.bubbles]) {
      if (now > B.until || (who !== 'you' && !this.c.peds.includes(who))) {
        B.el.remove();
        this.bubbles.delete(who);
        continue;
      }
      if (B.offer && R?.offer) B.el.querySelector('.dfx-ring').style.setProperty('--k', Math.max(0, R.offer.t / B.offer.T).toFixed(3));
      talking.add(who);
      add(B.el, head(who), B.offer ? 9 : 4 + (B.pri || 0));
    }
    // (tags: name, cash, shooter, what they've got against you)
    const people = [...this.c.peds];
    for (const who of people) {
      let el = this.tags.get(who);
      if (!el) {
        el = this.div('dfx-tag');
        this.tags.set(who, el);
      }
      if (!R || talking.has(who)) {
        el.style.display = 'none';
        continue;
      }
      const vs = R.bets.filter((B) => (B.pro === who && B.con === 'you') || (B.con === who && B.pro === 'you'));
      const against = vs.reduce((v, B) => v + (B.pro === who ? B.a : B.b), 0);
      const rolled = R.kind === 'celo' && R.results ? [...R.results].find(([q]) => q.key === who)?.[1]?.label : null;
      const html = `<b></b><span class="dfx-cash">$${who.bank}</span>${who === this.c.shooter ? `<span class="dfx-sh">${R.kind === 'celo' ? 'ROLLING' : 'SHOOTER'}</span>` : ''}${rolled ? `<span class="dfx-sh">${rolled}</span>` : ''}${against ? `<span class="dfx-vs">$${against} vs you</span>` : ''}`;
      if (el.dataset.k !== html + who.name) {
        el.dataset.k = html + who.name;
        el.innerHTML = html;
        el.firstChild.textContent = who.name;
      }
      add(el, head(who), against || who === this.c.shooter ? 3 : 1);
    }
    for (const [who, el] of [...this.tags]) {
      if (!people.includes(who)) {
        el.remove();
        this.tags.delete(who);
      }
    }
    // (what's on the ground)
    for (const P of this.piles.values()) {
      if (P.amount > 0) add(P.el, this.screen(P.x, this.c.y + 0.1, P.z), 2);
      else P.el.style.display = 'none';
    }
    // (the point, over the dice)
    const pt = R?.kind === 'craps' && R.point;
    this.pointEl.classList.toggle('hidden', !pt);
    if (pt) {
      const t = `POINT ${pt} · ${NICK[pt]}`;
      if (this.pointEl.textContent !== t) this.pointEl.textContent = t;
      add(this.pointEl, this.screen(this.c.sx, this.c.y + 0.6, this.c.sz), 8);
    }
    // (+$ / -$ rising)
    for (const el of this.root.querySelectorAll('.dfx-float')) {
      const k = (now - +el.dataset.t0) / 1.6;
      const p = head(el.who);
      el.style.opacity = String(Math.max(0, 1 - k * k));
      add(el, p && [p[0], p[1] - 40 * k], 6);
    }
    if (this.callUntil && now > this.callUntil) {
      this.callEl.classList.remove('show');
      this.callUntil = 0;
    }
    // (lay it all out)
    const W = window.innerWidth;
    const H = window.innerHeight;
    const keep = [];
    const block = (sel) => {
      for (const e of document.querySelectorAll(sel)) {
        const r = e.getBoundingClientRect();
        if (r.width && r.height && getComputedStyle(e).display !== 'none') keep.push([r.left - 4, r.top - 4, r.right + 4, r.bottom + 4]);
      }
    };
    if (this.callUntil) block('#dice-fx .dfx-call');
    block('#dice-panel .dp-box');
    block('#touch .tb:not(.hidden)');
    block('#minimap, #radar');
    keep.push([0, 0, Math.min(W * 0.42, 330), H < 500 ? 56 : 70]); // (the info top left)
    const hits = (r) => keep.some((k) => r[0] < k[2] && r[2] > k[0] && r[1] < k[3] && r[3] > k[1]);
    items.sort((a, b) => b.pri - a.pri);
    for (const it of items) {
      const w = it.el.offsetWidth;
      const h = it.el.offsetHeight;
      const tries = it.pri >= 8 ? [0, -1, 1, -2, 2, -3, 3, -4, 4] : [0, -1, 1, -2, 2, -3];
      const dxs = it.pri >= 8 ? [0, -0.6, 0.6, -1.2, 1.2] : [0, -0.6, 0.6];
      let done = false;
      for (const k of tries) {
        for (const dx of dxs) {
          const x = Math.max(4, Math.min(W - w - 4, it.x - w / 2 + dx * w));
          const y = it.y - h + k * (h + 4);
          const r = [x, y, x + w, y + h];
          if (y < 0 || y + h > H || hits(r)) continue;
          keep.push(r);
          it.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
          done = true;
          break;
        }
        if (done) break;
      }
      // (no room near them: an offer or the point goes to a free spot low in the middle of the
      // screen; the rest sit this one out)
      if (!done && it.pri >= 8) {
        for (let y = H * 0.66; y > H * 0.3 && !done; y -= h + 6) {
          const x = W / 2 - w / 2;
          const r = [x, y, x + w, y + h];
          if (hits(r)) continue;
          keep.push(r);
          it.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
          done = true;
        }
        if (!done) it.el.style.transform = `translate(${Math.round(W / 2 - w / 2)}px, ${Math.round(H * 0.62)}px)`;
      } else if (!done) it.el.style.display = 'none';
    }
  }

  dispose() {
    this.clearMoney();
    for (const P of this.piles.values()) this.game.scene.remove(P.group);
    this.game.scene.remove(this.ring);
    for (const W of this.wads.values()) {
      W.L.removeFromParent();
      W.R.removeFromParent();
    }
    this.root.remove();
  }
}
