import * as THREE from 'three';
import { makeCharacter, makePerson, setHeight, setShirt, bendLeg, bendSpine, crouchPose, restPose, SKIN_TONES, RIG, L1 } from './character.js';
import { safetyAt, turnout } from './safety.js';
import { GANGS } from './turf.js';
import { dist, rand, pick, lerpAngle } from './util.js';
import { PHONE } from './quality.js';
import { segmentBlocked } from './collision.js';

// The people in the Projects' courtyards (projects.js builds the courtyards), and the Southside
// Kings' lookouts and trap stoop.
//
// When you come within NEAR of a block they're out there, by the time of day and how safe it
// feels (safety.js, like the park and the courts): kids on the playground (swings, the slide,
// the spring riders, running about) with a mom on the bench; guys shooting around on the
// half-court; people on the benches talking; old heads at the card table slapping dominoes down;
// a cookout (someone on the grill, people standing round with a plate, a couple at the table);
// someone hanging out washing; someone under the hood of the car on the stands.
// They're people on the street for everything that can happen to them (peds.js 'play': shot,
// punched, scared off by gunfire or a gun on them); scared once, they're off like anyone else.
//
// On a block the Kings hold: a lookout or two on the corners, watching the streets. Cops coming
// (a car or an officer within SPOT) and they whistle ("Five-O!"): the trap's dealer ducks inside,
// buyers walk off, the lookout heads off too; it opens up again a minute or two after the cops
// have gone. The trap stoop (projects.js puts it on the block nearest the Kings' corner): a
// dealer on the steps, and every so often someone off the sidewalk walks up, a quick hand-to-hand,
// and walks off again.

const NEAR = 95;
const FAR = 130;
// (everyone's a whole character to draw: a few to a block, and only so many out at once)
const PER_BLOCK = PHONE ? 7 : 12;
const ALL = PHONE ? 13 : 24;
const SPOT = 45; // (a lookout sees cops this far off)
const KID = 0.62;
const KID_SHIRTS = [0xff5a5f, 0x3fa7d6, 0xfad02c, 0x7bd389, 0xf28dd0, 0xff9f43, 0x9b8cff, 0x5ce1e6];
const SHIRTS = [0xe74c3c, 0x3498db, 0xf1c40f, 0x9b59b6, 0xecf0f1, 0x1abc9c, 0xe67e22, 0x34495e, 0x111111, 0x95a5a6, 0x2c3e50];
const PANTS = [0x22313f, 0x3b3b3b, 0x5d4037, 0x1b2631, 0x2e4053, 0x111111];
const LINES = {
  fiveO: ['Five-O! Five-O!', "Jakes on the block!", "Twelve! Twelve comin'!", 'Boys in blue, y\'all!'],
  clear: ["Aight, they gone.", "We good, they bounced."],
  you: ["Who that?", "Ayo, watch this dude.", "Green Street on the block."],
};

export class ProjectsLife {
  constructor(game, P) {
    this.game = game;
    this.P = P;
    for (const B of P.blocks) {
      B.people = [];
      B.live = false;
      B.spoiled = false;
    }
    // (the court's ball: one, on whichever court has a shooter)
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshLambertMaterial({ color: 0xd35400 }));
    this.ball.visible = false;
    game.scene.add(this.ball);
    // (the grill's smoke: a few puffs, reused)
    const sm = new THREE.MeshLambertMaterial({ color: 0xd8d8d8, transparent: true, opacity: 0.35, depthWrite: false });
    this.puffs = [];
    for (let k = 0; k < 10; k++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.18, 7, 5), sm);
      m.visible = false;
      game.scene.add(m);
      this.puffs.push({ m, t: k / 10, grill: null });
    }
    this.alertUntil = 0; // (the cops are about: the hustle's shut till then)
    this.saidAt = -99;
  }

  hour() {
    return this.game.rhythm ? this.game.rhythm.hour() : 15;
  }

  update(dt) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    // (nearest first: the block you're on gets its people before the ones down the street; if
    // that's more than there's room for, the furthest one's go home)
    const order = this.P.blocks.map((B) => [B, dist(px, pz, B.cx, B.cz)]).sort((p, q) => p[1] - q[1]);
    const total = () => this.P.blocks.reduce((n, q) => n + q.people.length, 0);
    for (const [B, d] of order) {
      if (B.live && d > FAR) this.clear(B);
      else if (!B.live && d < NEAR && game.time >= (B.nextTry || 0)) {
        while (total() + PER_BLOCK > ALL) {
          const far = order.filter(([q, dq]) => q.live && dq > d).pop();
          if (!far) break;
          this.clear(far[0]);
        }
        this.start(B);
      }
      if (B.live) this.drop(B);
    }
    this.watch(dt);
    this.animate(dt);
  }

  // ---- Who's out ----
  add(B, x, z, look = {}) {
    const game = this.game;
    if (B.people.length >= PER_BLOCK) return null;
    if (this.P.blocks.reduce((n, q) => n + q.people.length, 0) >= ALL) return null;
    const female = look.female ?? Math.random() < 0.45;
    const char = look.char || makePerson({ shirt: look.shirt ?? pick(SHIRTS), pants: look.pants ?? pick(PANTS), skin: pick(SKIN_TONES), female });
    game.scene.add(char.group);
    const p = game.peds.addAt(x, z, female, char);
    p.state = 'play';
    p.act = this;
    p.keep = true;
    p.sidewalk = false;
    p.pj = { B, role: 'stand', t: rand(0, 10) };
    p.seed = Math.random() * 20;
    B.people.push(p);
    return p;
  }

  start(B) {
    const game = this.game;
    const h = this.hour();
    const safe = safetyAt(game, B.cx, B.cz);
    const k = safe.k;
    B.nextTry = game.time + 40;
    B.live = true;
    const day = h >= 8 && h < 20;
    const eve = h >= 15 && h < 23;
    // The Kings: lookouts on their corners, the trap stoop (not while the cops are about)
    const T = game.turfWars;
    const kings = T && T.owner?.[B.b.key] === 'kings';
    B.kings = kings;
    if (kings && game.time >= this.alertUntil) this.kingsOut(B, h);
    this.order(B, h, k, day, eve);
  }

  // The Kings' people out on the block: a lookout on a corner or two, the dealer on the stoop.
  // (back: come out of the trap door, and to the corners, once the cops have gone)
  kingsOut(B, h, back = false) {
    const [px, pz] = this.game.player.pos();
    {
      for (const c of B.corners || []) {
        if (Math.random() < 0.25 && h >= 7 && h < 18) continue;
        if (back && dist(px, pz, c.x, c.z) < 35) continue; // (nobody appears right in front of you)
        const p = this.add(B, c.x, c.z, { char: this.kingLook(), female: false });
        if (!p) break;
        p.pj = { B, role: 'lookout', spot: c, t: rand(0, 6) };
        p.heading = c.h;
      }
      if (B.trap) {
        const [dx, dz] = back ? B.trap.door : [B.trap.x, B.trap.z];
        const p = this.add(B, dx, dz, { char: this.kingLook(true), female: false });
        if (p) {
        p.pj = { B, role: 'dealer', spot: B.trap, t: rand(8, 20) };
        p.heading = B.trap.h;
        B.dealer = p;
        }
      }
    }
  }

  // Everyone else, station by station.
  order(B, h, k, day, eve) {
    // (the playground and the court first, then a cookout or the card table, then the rest)
    const TIER = { playground: 0, court: 0, cookout: 1, cards: 1, benches: 2, clothes: 2, jacked: 2 };
    const order = [...B.stations].filter((q) => TIER[q.kind] != null).sort((p, q) => TIER[p.kind] - TIER[q.kind] + (Math.random() - 0.5) * 0.9);
    for (const st of order) {
      if (st.kind === 'playground' && day) {
        const kids = turnout(h < 11 ? 2 : 3.5, k * k, 0.4);
        for (let i = 0; i < kids; i++) {
          const p = this.add(B, st.x + rand(-3, 3), st.z + rand(-2.5, 2.5), { shirt: pick(KID_SHIRTS) });
          if (!p) break;
          p.kid = true;
          p.char.group.scale.setScalar(KID);
          p.walkSpeed = 2.3;
          p.pj = { B, st, role: 'kid', t: 0 };
          this.kidTask(p);
        }
        if (kids && st.seats[0]) this.sitter(B, st, st.seats[0], 'watch', { female: true });
      } else if (st.kind === 'court' && (day || eve) && h < 22.5) {
        const n = turnout(3, k, 0.3);
        st.spots.slice(0, n).forEach((s, i) => {
          const p = this.add(B, s.x, s.z, { female: false });
          if (!p) return;
          p.pj = { B, st, role: i === 0 ? 'hoop' : 'watch', spot: s, t: rand(1, 3) };
          p.heading = s.h;
          if (i === 0) this.shooter = p;
        });
      } else if (st.kind === 'benches') {
        const n = Math.min(2, turnout(h < 7 || h >= 23 ? 1 : 2, k, 0.25));
        st.seats.slice(0, 4).sort(() => Math.random() - 0.5).slice(0, n).forEach((s) => this.sitter(B, st, s, 'talk'));
        if (n >= 2 && Math.random() < 0.35 && st.spots[0]) this.stander(B, st, st.spots[0], 'talk');
      } else if (st.kind === 'cards' && h >= 11 && h < 23.5) {
        const n = turnout(4, Math.sqrt(k), 0.3);
        st.seats.slice(0, n).forEach((s) => this.sitter(B, st, s, 'cards', { female: Math.random() < 0.2, old: true }));
        if (n >= 3 && st.spots[0] && Math.random() < 0.7) this.stander(B, st, st.spots[0], 'watchcards');
      } else if (st.kind === 'cookout' && h >= 12 && h < 21.5) {
        if (Math.random() > 0.65 * k + 0.15) continue;
        const [g0, ...rest] = st.spots;
        const cook = this.stander(B, st, g0, 'grill', { female: false });
        if (!cook) continue;
        cook.pj.grill = st.grill;
        st.grill.lit = true;
        rest.slice(0, 1 + Math.floor(Math.random() * 3)).forEach((s) => this.stander(B, st, s, 'plate'));
        st.seats.slice(0, Math.floor(Math.random() * 3)).forEach((s) => this.sitter(B, st, s, 'eat'));
      } else if (st.kind === 'clothes' && day && h < 18 && Math.random() < 0.55 * k + 0.1) {
        this.stander(B, st, st.spots[0], 'laundry', { female: true });
      } else if (st.kind === 'jacked' && day && Math.random() < 0.7) {
        this.stander(B, st, st.spots[0], 'wrench', { female: false });
      }
    }
  }

  kingLook(hood = false) {
    const K = GANGS.kings;
    const c = makeCharacter({ shirt: hood ? 0x2b2b2b : K.shirt, pants: pick([0x111111, 0x22313f, 0x3b3b3b]), skin: pick(SKIN_TONES), bandana: K.bandana, cap: Math.random() < 0.5 ? 0x111111 : null });
    setHeight(c, rand(1.74, 1.9));
    return c;
  }

  sitter(B, st, s, role, look = {}) {
    if (s.who) return null;
    const p = this.add(B, s.x, s.z, look);
    if (!p) return null;
    if (look.old) setHeight(p.char, rand(1.7, 1.8));
    p.pj = { B, st, role: 'sit', act: role, seat: s, t: rand(0, 10) };
    p.heading = s.h;
    s.who = p;
    return p;
  }

  stander(B, st, s, role, look = {}) {
    const p = this.add(B, s.x, s.z, look);
    if (!p) return null;
    p.pj = { B, st, role, spot: s, t: rand(0, 10), home: [s.x, s.z] };
    p.heading = s.h;
    return p;
  }

  clear(B) {
    for (const p of B.people) if (!p.removed) p.dispose();
    B.people = [];
    B.live = false;
    B.dealer = null;
    B.nextTry = 0;
    for (const st of B.stations) {
      for (const s of st.seats) s.who = null;
      for (const w of st.swings || []) w.who = null;
      for (const r of st.riders || []) r.who = null;
      if (st.grill) st.grill.lit = false;
    }
    if (this.shooter && this.shooter.pj?.B === B) this.shooter = null;
  }

  // Anyone scared off (or hurt) is just someone on the street now.
  drop(B) {
    for (const p of [...B.people]) {
      if (p.state === 'play' && !p.removed) continue;
      B.people.splice(B.people.indexOf(p), 1);
      if (!p.removed && p.state !== 'walk') B.scaredAt = this.game.time; // (scared off, not just on their way)
      p.keep = false;
      p.sidewalk = true;
      p.act = null;
      const c = p.char;
      bendLeg(c.legL, c.kneeL, 0, 0);
      bendLeg(c.legR, c.kneeR, 0, 0);
      restPose(c);
      for (const j of ['armL', 'armR', 'elbowL', 'elbowR', 'wristL', 'wristR']) c[j].rotation.set(0, 0, 0);
      const pj = p.pj;
      if (pj?.seat) {
        pj.seat.who = null;
        p.x += Math.sin(pj.seat.h) * 0.7;
        p.z += Math.cos(pj.seat.h) * 0.7;
      }
      if (pj?.swing) pj.swing.who = null;
      if (pj?.rider) pj.rider.who = null;
      if (pj?.grill) pj.grill.lit = false;
      if (p === this.shooter) this.shooter = null;
      if (p === B.dealer) B.dealer = null;
      p.pj = null;
    }
  }

  // ---- The Kings watching the block ----
  watch(dt) {
    const game = this.game;
    this.watchT = (this.watchT || 0) - dt;
    if (this.watchT > 0) return;
    this.watchT = 0.5;
    // (a car that's after someone, or cops out on foot, they call from SPOT off)
    const cops = [];
    for (const u of game.police?.units || []) {
      if (!u.car || u.car.removed) continue;
      // (a patrol rolling by at speed: they play it cool; slowing up or stopping near the corner,
      // that's the call)
      if (u.patrol && !u.pull) {
        // (stopped right there a few seconds, not just at the stop sign and gone)
        u.pjStop = Math.abs(u.car.speed || 0) < 1 ? (u.pjStop || 0) + 0.5 : 0;
        if (u.pjStop > 3) cops.push([u.car.x, u.car.z, 15]);
      } else cops.push([u.car.x, u.car.z, SPOT]);
    }
    for (const o of game.police?.officers?.() || []) if (o.alive !== false && !o.inCar && o.state !== 'inCar') cops.push([o.x, o.z, SPOT]);
    const [px, pz] = game.player.pos();
    for (const B of this.P.blocks) {
      if (!B.live) continue;
      const looks = B.people.filter((p) => p.pj?.role === 'lookout');
      if (!looks.length) continue;
      const seen = looks.find((p) => cops.some(([x, z, r]) => dist(x, z, p.x, p.z) < r)) || (game.stars > 0 && looks.find((p) => dist(px, pz, p.x, p.z) < 35));
      if (seen && game.time >= this.alertUntil - 50) {
        // Five-O: whistle, the word, the hustle shuts down
        this.alertUntil = game.time + rand(70, 110);
        const d = dist(px, pz, seen.x, seen.z);
        game.sfx.whistle?.(Math.max(0.05, 0.5 - d / 140));
        if (d < 45 && game.time - this.saidAt > 20) {
          this.saidAt = game.time;
          game.hud.toast(`Lookout: "${pick(LINES.fiveO)}"`, '#c39bd3');
        }
        for (const p of B.people) {
          const r = p.pj?.role;
          if (r === 'lookout' || r === 'dealer' || r === 'buyer') {
            p.pj.role = 'scatter';
            p.pj.inside = r === 'dealer' && B.trap?.door;
            p.pj.to = p.pj.inside ? B.trap.door : this.away(B, p);
            p.pj.t = 0;
          }
        }
        B.dealer = null;
      } else if (!seen && looks.length && game.time > this.saidAt + 60 && dist(px, pz, looks[0].x, looks[0].z) < 14 && !game.player.vehicle) {
        // (you, on their corner: they clock you)
        this.saidAt = game.time;
        game.hud.toast(`Lookout: "${pick(LINES.you)}"`, '#c39bd3');
      }
    }
    // (the cops long gone: the Kings back out)
    if (game.time >= this.alertUntil) {
      for (const B of this.P.blocks) {
        if (!B.live || !B.kings || B.people.some((p) => p.pj?.role === 'lookout' || p.pj?.role === 'dealer' || p.pj?.role === 'scatter')) continue;
        if (game.time - (B.scaredAt ?? -999) < 90) continue; // (not with the shooting just now)
        this.kingsOut(B, this.hour(), true);
      }
    }
    // the trap: now and then a buyer off the sidewalk
    for (const B of this.P.blocks) {
      const D = B.dealer;
      if (!B.live || !D || D.removed || game.time < this.alertUntil) continue;
      B.buyT = (B.buyT ?? rand(5, 15)) - 0.5;
      if (B.buyT > 0 || B.people.some((p) => p.pj?.role === 'buyer')) continue;
      B.buyT = rand(18, 40);
      let best = null;
      let bd = 75; // (off the sidewalks round the block: the stoop's in on the courtyard)
      for (const q of game.peds.peds) {
        if (q.keep || q.kid || q.state !== 'walk' || q.removed || q.inStore || q.shopkeeper || q.isPlug || q.loot) continue;
        const d = dist(q.x, q.z, D.x, D.z);
        if (d < bd && d > 6 && !segmentBlocked(q.x, q.z, D.x, D.z, game.city.colliders)) { // (a straight walk over, not round the rows)
          bd = d;
          best = q;
        }
      }
      if (!best) best = this.walkIn(D);
      if (!best) continue;
      best.state = 'play';
      best.act = this;
      best.keep = true;
      best.sidewalk = false;
      best.pj = { B, role: 'buyer', step: 0, t: 0, from: [best.x, best.z] };
      B.people.push(best);
    }
  }

  // Nobody passing to send over: someone comes along a sidewalk nearby, out of sight of the
  // camera (never out of thin air in front of you), and heads for the stoop.
  walkIn(D) {
    const game = this.game;
    const ring = D.pj.B.b.inner;
    const cam = game.camera;
    cam.updateMatrixWorld();
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const v = new THREE.Vector3();
    const ok = [];
    // (in off the street: from the edge of the block, a gap between the rows)
    const pts = [];
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[(i + 1) % ring.length];
      const L = Math.hypot(bx - ax, bz - az);
      for (let t = 2; t < L - 2; t += 4) pts.push({ x: ax + ((bx - ax) * t) / L, z: az + ((bz - az) * t) / L });
    }
    for (const q of pts) {
      const d = dist(q.x, q.z, D.x, D.z);
      if (d < 20 || d > 70) continue;
      if (segmentBlocked(q.x, q.z, D.x, D.z, game.city.colliders)) continue;
      const y = game.city.groundY(q.x, q.z) + 1;
      if (fr.containsPoint(v.set(q.x, y, q.z)) && !segmentBlocked(cam.position.x, cam.position.z, q.x, q.z, game.city.los)) continue;
      ok.push(q);
    }
    if (!ok.length) return null;
    const q = pick(ok);
    return game.peds.addAt(q.x, q.z);
  }

  // Somewhere off the block to head for (the nearest bit of sidewalk outside it, a way on).
  away(B, p) {
    let best = null;
    let bd = Infinity;
    for (const [x, z] of B.b.poly) {
      const d = dist(x, z, p.x, p.z);
      if (d < bd) {
        bd = d;
        best = [x, z];
      }
    }
    return best ? [best[0] + (best[0] - B.cx) * 0.3, best[1] + (best[1] - B.cz) * 0.3] : [p.x + 30, p.z];
  }

  // ---- The moving bits: swings, the ball, the grill's smoke ----
  animate(dt) {
    const game = this.game;
    for (const B of this.P.blocks) {
      if (!B.live && !B.swinging) continue;
      let any = false;
      for (const st of B.stations) for (const w of st.swings || []) {
        w.amp = w.who ? Math.min(0.75, w.amp + dt * 0.18) : Math.max(0, w.amp - dt * 0.3);
        w.t += dt * 2.2;
        w.a = Math.sin(w.t) * w.amp;
        w.piv.rotation.x = -w.a;
        if (w.amp > 0) any = true;
      }
      B.swinging = any;
    }
    // (the shooter's ball: up at the rim, in or off, back down to him)
    const sh = this.shooter;
    const b = this.ball;
    if (sh && !sh.removed && sh.pj?.role === 'hoop') {
      const st = sh.pj.st;
      const c = sh.char;
      const T = sh.pj.shot;
      b.visible = true;
      if (!T) {
        // (holding it, bouncing it)
        const bounce = Math.abs(Math.sin(game.time * 5));
        b.position.set(sh.x + Math.sin(sh.heading) * 0.35 + Math.cos(sh.heading) * 0.2, game.city.groundY(sh.x, sh.z) + 0.12 + bounce * 0.75, sh.z + Math.cos(sh.heading) * 0.35 - Math.sin(sh.heading) * 0.2);
      } else {
        const t = (game.time - T.t0) / T.dur;
        const [hx, hz] = st.hoop;
        if (t < 1) {
          // (up and in: a parabola from his hands to the rim)
          const x = T.x0 + (hx - T.x0) * t;
          const z = T.z0 + (hz - T.z0) * t;
          const y = T.y0 + (st.hoopY + 0.1 - T.y0) * t + Math.sin(t * Math.PI) * 2.2;
          b.position.set(x, y, z);
        } else if (t < 2.2) {
          // (through the net or off the rim, down, bouncing out toward him)
          const k = (t - 1) / 1.2;
          const x = hx + (sh.x - hx) * k * (T.miss ? 1.1 : 0.9);
          const z = hz + (sh.z - hz) * k * (T.miss ? 1.1 : 0.9);
          const gy = game.city.groundY(x, z);
          const y = gy + 0.12 + Math.abs(Math.cos(k * Math.PI * 1.5)) * (st.hoopY - gy) * (1 - k) * 0.9;
          b.position.set(x, y, z);
        } else sh.pj.shot = null;
      }
    } else b.visible = false;
    // (smoke off the lit grills)
    const grills = [];
    for (const B of this.P.blocks) if (B.live) for (const st of B.stations) if (st.grill?.lit) grills.push(st.grill);
    for (const [i, pf] of this.puffs.entries()) {
      const g = grills[i % Math.max(1, grills.length)];
      if (!g) {
        pf.m.visible = false;
        continue;
      }
      pf.t += dt * 0.35;
      if (pf.t > 1) pf.t -= 1;
      pf.m.visible = true;
      const s = 0.6 + pf.t * 2.2;
      pf.m.scale.setScalar(s);
      pf.m.position.set(g.x + Math.sin(i * 2.3 + pf.t * 3) * 0.25 + pf.t * 0.6, g.y + 0.1 + pf.t * 2.4, g.z + Math.cos(i * 1.7) * 0.2);
      pf.m.material.opacity = 0.32 * (1 - pf.t);
    }
    for (const B of this.P.blocks) for (const st of B.stations) if (st.grill) st.grill.coals.material.color.setHex(st.grill.lit ? (Math.sin(game.time * 7) > 0 ? 0xff6a1a : 0xff8a2a) : 0x3a3a3a);
  }

  // ---- Where each one goes (peds.js calls this every frame) ----
  drive(p, dt) {
    const game = this.game;
    const pj = p.pj;
    if (!pj) return { speed: 0 };
    pj.t -= dt;
    const go = (x, z, speed = 1.3) => {
      const o = dist(p.x, p.z, x, z) > 0.3 ? { tx: x, tz: z, speed } : null;
      pj.moving = !!o;
      return o;
    };
    pj.moving = false;
    const face = (h, k = 4) => {
      p.heading = lerpAngle(p.heading, h, Math.min(1, dt * k));
    };
    const faceTo = (x, z, k = 4) => face(Math.atan2(x - p.x, z - p.z), k);
    pj.pose = null;
    if (pj.role === 'sit') {
      p.x = pj.seat.x;
      p.z = pj.seat.z;
      face(pj.seat.h, 8);
      return { speed: 0 };
    }
    if (pj.role === 'kid') return this.kid(p, dt);
    if (pj.role === 'scatter') {
      // (the dealer back in through the door; the rest walk off the block, ordinary people again)
      const o = go(...pj.to, pj.inside ? 1.6 : 2.0);
      if (!o || pj.t < -14) {
        if (pj.inside) p.dispose();
        else p.resumeWalking();
        return { speed: 0 };
      }
      return o;
    }
    if (pj.role === 'buyer') {
      const D = pj.B.dealer;
      if (!D || D.removed || pj.step >= 2) {
        // (done, or no one to buy from: on his way, an ordinary passerby again)
        const o = go(...pj.from, 1.5);
        if (!o) p.resumeWalking();
        return o || { speed: 0 };
      }
      const [tx, tz] = [D.x + Math.sin(D.heading) * 0.8, D.z + Math.cos(D.heading) * 0.8];
      if (pj.step === 0) {
        const o = go(tx, tz, 1.4);
        if (o) return o;
        pj.step = 1;
        pj.t = 2.4;
        D.pj.deal = game.time;
      }
      faceTo(D.x, D.z, 6);
      pj.pose = 'deal';
      if (pj.t <= 0) pj.step = 2;
      return { speed: 0 };
    }
    // everyone else: back to their spot if they've wandered, then about their business
    const s = pj.spot;
    if (s) {
      const o = go(s.x, s.z, 1.2);
      if (o) return o;
    }
    if (pj.role === 'lookout') {
      // (watching the streets: looking one way, then the other)
      face(s.h + Math.sin(game.time * 0.25 + p.seed) * 0.9, 1.5);
    } else if (pj.role === 'dealer') {
      face(s.h, 3);
      if (game.time - (pj.deal || -9) < 2.4) {
        const b = pj.B.people.find((q) => q.pj?.role === 'buyer');
        if (b) faceTo(b.x, b.z, 6);
        pj.pose = 'deal';
      }
    } else if (pj.role === 'hoop') {
      const st = pj.st;
      faceTo(...st.hoop, 5);
      if (!pj.shot && pj.t <= 0) {
        pj.t = rand(2.2, 4.5);
        const [hx, hz] = st.hoop;
        const d = dist(p.x, p.z, hx, hz);
        pj.shot = { t0: game.time + 0.25, dur: 0.55 + d * 0.06, x0: p.x, z0: p.z, y0: game.city.groundY(p.x, p.z) + 2.1, miss: Math.random() < 0.45 };
        // (and now and then, a few steps to a new spot)
        if (Math.random() < 0.35) pj.spot = pick(st.spots.filter((q) => q !== s)) || s;
      }
      if (pj.shot && game.time - pj.shot.t0 < 0.3) pj.pose = 'shoot';
      else pj.pose = 'dribble';
    } else if (pj.role === 'watch') {
      const st = pj.st;
      if (st?.hoop) faceTo(...st.hoop, 2);
      pj.pose = 'fold';
    } else if (pj.role === 'grill') {
      faceTo(pj.grill.x, pj.grill.z, 5);
      pj.pose = 'grill';
    } else if (pj.role === 'plate' || pj.role === 'talk' || pj.role === 'watchcards') {
      const st = pj.st;
      const tx = st?.grill ? (st.grill.x + st.x) / 2 : st?.x ?? p.x;
      const tz = st?.grill ? (st.grill.z + st.z) / 2 : st?.z ?? p.z;
      faceTo(tx, tz, 2);
      pj.pose = pj.role === 'plate' ? 'plate' : 'talk';
    } else if (pj.role === 'laundry') {
      // (between the basket and the line: hang something up, back for the next)
      const st = pj.st;
      if (pj.t <= 0) {
        pj.t = rand(3, 6);
        pj.atLine = !pj.atLine;
        const [x, z] = pj.atLine ? st.W(-1.5 + Math.random() * 3, 0.35) : st.W(-0.75, 1.6);
        pj.spot = { x, z, h: s.h };
      }
      pj.pose = pj.atLine ? 'reach' : 'bend';
      face(pj.atLine ? s.h + Math.PI : s.h, 4);
    } else if (pj.role === 'wrench') {
      face(s.h, 4);
      pj.pose = pj.t % 14 < 11 ? 'engine' : 'stretch';
      if (pj.t < 0) pj.t = 14 * 6;
    }
    return { speed: 0 };
  }

  // A kid's play: the swings, the slide (up the ladder, down the chute), a spring rider, running.
  kidTask(p, not = null) {
    const pj = p.pj;
    const st = pj.st;
    pj.t = rand(10, 25);
    pj.step = 0;
    pj.on = false;
    if (pj.swing) pj.swing.who = null;
    if (pj.rider) pj.rider.who = null;
    pj.swing = pj.rider = null;
    const opts = ['run', 'slide'];
    if (st.swings?.some((w) => !w.who)) opts.push('swing', 'swing');
    if (st.riders?.some((r) => !r.who)) opts.push('rider');
    pj.task = pick(opts.filter((o) => o !== not)) || 'run';
    if (pj.task === 'swing') (pj.swing = st.swings.find((w) => !w.who)).who = p;
    if (pj.task === 'rider') (pj.rider = st.riders.find((r) => !r.who)).who = p;
    if (pj.task === 'run') pj.to = st.W(rand(-4, 4), rand(-3, 3));
  }

  kid(p, dt) {
    const pj = p.pj;
    const st = pj.st;
    const go = (x, z, speed = 2.3) => (dist(p.x, p.z, x, z) > 0.3 ? { tx: x, tz: z, speed } : null);
    pj.pose = null;
    pj.y = 0;
    if (pj.t <= 0 && !(pj.task === 'slide' && pj.step > 0)) {
      this.kidTask(p, pj.task);
    }
    if (pj.task === 'swing') {
      const w = pj.swing;
      const o = !pj.on && go(w.x, w.z);
      if (o) return o;
      pj.on = true;
      // (on the seat, going with it)
      const a = w.a || 0;
      const r = 1.86;
      p.x = w.x + Math.sin(w.h) * Math.sin(a) * r;
      p.z = w.z + Math.cos(w.h) * Math.sin(a) * r;
      p.heading = w.h;
      pj.y = this.game.city.groundY(w.x, w.z) + 2.33 - Math.cos(a) * r + 0.05;
      pj.pose = 'swing';
      return { speed: 0 };
    }
    if (pj.task === 'rider') {
      const r = pj.rider;
      const o = !pj.on && go(r.x, r.z);
      if (o) return o;
      pj.on = true;
      p.x = r.x;
      p.z = r.z;
      p.heading = r.h;
      pj.y = r.y + Math.abs(Math.sin(this.game.time * 5)) * 0.08;
      pj.pose = 'ride';
      return { speed: 0 };
    }
    if (pj.task === 'slide') {
      const S = st.slide;
      if (pj.step === 0) {
        const o = go(...S.ladder);
        if (o) return o;
        pj.step = 1;
        pj.k = 0;
      }
      if (pj.step === 1) {
        // (up the ladder)
        pj.k += dt * 0.9;
        const k = Math.min(1, pj.k);
        p.x = S.ladder[0] + (S.top[0] - S.ladder[0]) * k;
        p.z = S.ladder[1] + (S.top[1] - S.ladder[1]) * k;
        p.heading = S.h;
        pj.y = this.game.city.groundY(p.x, p.z) + (S.topY - this.game.city.groundY(p.x, p.z)) * k;
        pj.pose = 'climb';
        if (k >= 1) {
          pj.step = 2;
          pj.k = 0;
        }
        return { speed: 0 };
      }
      if (pj.step === 2) {
        // (down the chute, sitting)
        pj.k += dt * 1.1;
        const k = Math.min(1, pj.k);
        p.x = S.top[0] + (S.end[0] - S.top[0]) * k;
        p.z = S.top[1] + (S.end[1] - S.top[1]) * k;
        p.heading = S.h;
        pj.y = S.topY + (S.endY - S.topY) * k;
        pj.pose = 'slidedown';
        if (k >= 1) {
          pj.step = 0;
          if (Math.random() < 0.35 || pj.t <= 0) this.kidTask(p, 'slide');
        }
        return { speed: 0 };
      }
    }
    // running about
    const o = go(...pj.to, 2.4);
    if (o) return o;
    pj.to = st.W(rand(-4, 4), rand(-3, 3));
    return { speed: 0 };
  }

  // ---- How they hold themselves ----
  pose(p) {
    const pj = p.pj;
    const c = p.char;
    if (!pj) return 0;
    const game = this.game;
    const t = game.time + (p.seed || 0);
    const gy = game.city.groundY(p.x, p.z);
    const s = c.group.scale.y || 1;
    const hip = RIG.hip * s;
    const arms = (lx, ly, lz, rx, ry, rz, el = 0, er = 0) => {
      c.armL.rotation.set(lx, ly, lz);
      c.armR.rotation.set(rx, ry, rz);
      c.elbowL.rotation.set(el, 0, 0);
      c.elbowR.rotation.set(er, 0, 0);
    };
    if (pj.role === 'sit') {
      // (the thighs on the seat, sloping down to the knee as far as it takes for the shins, straight
      // down, to stand the feet on the ground: a short person's thighs slope more)
      const hy = (pj.seat.y - gy) / s + 0.12; // (the hips over the ground, in the rig's own meters)
      const th = Math.acos(Math.max(Math.cos(1.5), Math.min(Math.cos(1.1), (hy - RIG.knee) / L1)));
      bendLeg(c.legL, c.kneeL, th, th);
      bendLeg(c.legR, c.kneeR, th, th);
      const a = pj.act;
      if (a === 'cards') {
        // (hands forward over the table; now and then one comes up and slaps a domino down)
        const cyc = (t * 0.4) % 1;
        const slap = cyc > 0.85 ? Math.sin(((cyc - 0.85) / 0.15) * Math.PI) : 0;
        bendSpine(c, 0.25, 0, 0);
        arms(-1.1, 0, 0.15, -1.1 - slap * 0.9, 0, -0.15, -0.6, -0.6 + slap * 0.4);
        c.neck.rotation.set(0.35, Math.sin(t * 0.3) * 0.2, 0);
      } else if (a === 'talk') {
        const g = Math.max(0, Math.sin(t * 1.3));
        bendSpine(c, 0.05, Math.sin(t * 0.5) * 0.15, 0);
        arms(-0.5, 0, 0.15, -0.5 - g * 0.6, 0, -0.2, -0.9, -0.9 - g * 0.5);
        c.neck.rotation.set(0, Math.sin(t * 0.4) * 0.5, 0);
      } else if (a === 'eat') {
        const bite = Math.max(0, Math.sin(t * 0.9));
        bendSpine(c, 0.2, 0, 0);
        arms(-0.9, 0, 0.1, -0.9 - bite * 0.9, 0, -0.1, -0.8, -0.8 - bite * 1.0);
      } else {
        // (watching the kids: leaning back, hands in the lap)
        bendSpine(c, -0.05, Math.sin(t * 0.3) * 0.3, 0);
        arms(-0.45, 0, 0.1, -0.45, 0, -0.1, -0.6, -0.6);
        c.neck.rotation.set(0, Math.sin(t * 0.35) * 0.6, 0);
      }
      return pj.seat.y - gy - hip + 0.12 * s; // (the hips half a thigh's depth over the seat: the thighs rest on it, the feet reach the ground)
    }
    if (pj.role === 'kid') {
      const P = pj.pose;
      let y = 0;
      if (P === 'swing') {
        bendLeg(c.legL, c.kneeL, 1.4, 1.2 + Math.sin(t * 2.2) * 0.4);
        bendLeg(c.legR, c.kneeR, 1.4, 1.2 + Math.sin(t * 2.2) * 0.4);
        arms(-2.7, 0, 0, -2.7, 0, 0);
        y = pj.y - gy - (RIG.hip - 0.12) * KID;
      } else if (P === 'ride') {
        bendLeg(c.legL, c.kneeL, 1.3, 1.4);
        bendLeg(c.legR, c.kneeR, 1.3, 1.4);
        arms(-1.3, 0, 0, -1.3, 0, 0, -0.4, -0.4);
        bendSpine(c, 0.2 + Math.sin(t * 5) * 0.1, 0, 0);
        y = pj.y - gy - (RIG.hip - 0.12) * KID;
      } else if (P === 'climb') {
        arms(-2.6 + Math.sin(t * 7) * 0.3, 0, 0, -2.6 - Math.sin(t * 7) * 0.3, 0, 0);
        bendLeg(c.legL, c.kneeL, 0.6 + Math.sin(t * 7) * 0.4, 1);
        bendLeg(c.legR, c.kneeR, 0.6 - Math.sin(t * 7) * 0.4, 1);
        y = pj.y - gy;
      } else if (P === 'slidedown') {
        bendLeg(c.legL, c.kneeL, 1.5, 0.2);
        bendLeg(c.legR, c.kneeR, 1.5, 0.2);
        arms(-2.4, 0, 0.4, -2.4, 0, -0.4);
        y = pj.y - gy - (RIG.hip - 0.12) * KID;
      }
      return y;
    }
    if (pj.moving) return 0; // (walking somewhere: the walk cycle's own)
    const P = pj.pose;
    bendSpine(c, 0, 0, 0);
    c.neck.rotation.set(0, 0, 0);
    if (P === 'deal') {
      // (a hand out low, palm up, the other loose: the hand-to-hand)
      arms(-0.2, 0, 0.1, -0.9, 0, -0.1, -0.2, -0.9);
      c.neck.rotation.set(0.25, 0, 0);
    } else if (pj.role === 'lookout') {
      // (arms folded, looking up and down the street)
      arms(-0.55, 0, 0.35, -0.55, 0, -0.35, -1.75, -1.75);
      c.neck.rotation.set(0, Math.sin(t * 0.7) * 0.6, 0);
    } else if (P === 'dribble') {
      const b = Math.sin(game.time * 10);
      arms(-0.2, 0, 0.1, -0.9 + b * 0.2, 0, -0.15, -0.3, -0.6 - b * 0.2);
      bendSpine(c, 0.2, 0, 0);
      return crouchPose(c, 0.25) * s;
    } else if (P === 'shoot') {
      arms(-2.8, 0, 0.1, -2.9, 0, -0.1, -0.3, -0.2);
    } else if (P === 'fold') {
      arms(-0.55, 0, 0.35, -0.55, 0, -0.35, -1.75, -1.75);
    } else if (P === 'grill') {
      // (the spatula hand busy over the grill, the other on the hip)
      const f = Math.sin(t * 3);
      arms(-0.2, 0, 0.5, -1.2 + f * 0.25, 0, -0.1, -1.2, -0.7 + f * 0.3);
      bendSpine(c, 0.18, 0, 0);
      c.neck.rotation.set(0.35, 0, 0);
    } else if (P === 'plate') {
      // (a plate in the left hand, eating off it with the right; talking between bites)
      const bite = Math.max(0, Math.sin(t * 0.8));
      arms(-0.9, 0, 0.1, -0.7 - bite * 0.8, 0, -0.15, -0.9, -0.9 - bite * 1.0);
      c.neck.rotation.set(0.05, Math.sin(t * 0.4) * 0.4, 0);
    } else if (P === 'talk') {
      const g = Math.max(0, Math.sin(t * 1.2));
      arms(-0.15, 0, 0.1, -0.4 - g * 0.6, 0, -0.25, -0.2, -0.6 - g * 0.6);
      c.neck.rotation.set(0, Math.sin(t * 0.45) * 0.4, 0);
    } else if (P === 'reach') {
      // (pegging something up on the line)
      arms(-2.6 + Math.sin(t * 2) * 0.15, 0, 0.15, -2.7, 0, -0.15, -0.3, -0.3);
      c.neck.rotation.set(-0.3, 0, 0);
    } else if (P === 'bend') {
      bendSpine(c, 1.0, 0, 0);
      arms(-1.2, 0, 0.1, -1.2, 0, -0.1, -0.2, -0.2);
    } else if (P === 'engine') {
      // (bent over under the hood, working on something)
      const w = Math.sin(t * 4);
      bendSpine(c, 0.9, 0, 0);
      arms(-1.5, 0, 0.1, -1.4 + w * 0.2, 0, -0.1, -0.5, -0.5 + w * 0.3);
      c.neck.rotation.set(0.2, 0, 0);
    } else if (P === 'stretch') {
      // (straightening up, a hand on the back)
      bendSpine(c, -0.15, 0, 0);
      arms(-0.1, 0, 0.2, 0.6, 0, -0.3, -0.3, -1.6);
    } else {
      arms(0, 0, 0.05, 0, 0, -0.05);
    }
    return 0;
  }
}
