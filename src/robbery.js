import * as THREE from 'three';
import { reachArm } from './character.js';
import { dist, pick, rand } from './util.js';
import { streetAt, districtAt } from './city.js';

// What's under the counter (or on the guard's hip).
export const STORE_GUNS = {
  pistol: { size: [0.05, 0.12, 0.28], color: 0x222222, dmg: 14, kind: 'pistol', every: 0.75 },
  shotgun: { size: [0.06, 0.1, 0.92], color: 0x3a2a1a, dmg: 26, kind: 'shotgun', every: 1.1 },
};

// Robbing a store (storerooms.js builds them; this runs the stick-up). Walk in and press USE at
// the counter (or just put a gun on the clerk). You don't need a gun, but without one the clerk
// and the customers are a lot more likely to fight you.
//
// The clerk does one of these (his nerve, what's under the counter, whether you're armed, how
// often the store's been hit, whose turf it is):
//   comply  - hands up, then fills a bag at the register while you keep him covered; turn away
//             and he gets ideas
//   stall   - slow ("the drawer's stuck"); USE tells him to hurry up, which might push him into
//             something stupid
//   alarm   - goes along with it, then a hand goes under the counter: catch it (USE) and he
//             stops; miss it and the silent alarm's gone off (the cops are already coming)
//   fight   - goes for what's under the counter (a shotgun, a pistol, a bat) and comes up with it
//   run     - bolts for the back room and locks the door; the register's yours to empty, slowly
//   refuse  - (a liquor store) he's behind bulletproof glass: he gets down and hits the alarm.
//             Shoot the glass and it cracks; scare him enough and he'll pass it through the tray
// Customers each: hit the floor, run out the door (and call the cops), film you on their phone,
// or have a go at you (much likelier if you're not armed). A guard (Hilltop Market) draws on you
// or puts his hands up. Once you've got the register, make the clerk open the safe in the back.
//
// The cameras see your face unless your bandana's up (USE in the store, away from the counter),
// or you shoot them out. When it's reported (you walk out; the alarm or a caller sooner), it's
// an armed robbery; seen on camera or by a witness who got out, they've got your description
// too (more heat). A store that's been hit is ready for you next time (the clerk's armed, his
// nerve up), and the register's light for a while after.

const TAKE = {
  register: { mart: [250, 650], market: [450, 1000], liquor: [300, 750], deli: [150, 450], pawn: [350, 800] },
  safe: { mart: [1200, 2400], market: [2500, 4500], liquor: [1500, 3000], deli: [800, 1600], pawn: [3000, 6000] },
};
const BAG_T = { comply: 6, stall: 13, alarm: 7 };
const LINES = {
  hands: ['Okay, okay! Don\'t shoot!', 'Whoa, whoa! Easy!', 'Please, I got kids!', 'Alright man, take it easy.'],
  handsFists: ['You serious right now?', 'With what, your hands?', 'Get outta my store.'],
  stall: ['The drawer\'s stuck, hold on…', 'I gotta… I gotta find the key…', 'It don\'t open till the sale goes through…'],
  hurry: ['Okay! Okay! I\'m going!', 'I\'m hurrying, I\'m hurrying!', 'Relax, relax…'],
  bagged: ['That\'s all of it. Now go.', 'Take it. Just go.', 'That\'s everything, I swear.'],
  stopped: ['Okay! I\'m not doing nothing!', 'Sorry! Sorry!', 'My hands are up, see?'],
  fight: ['Not in my store!', 'Wrong store, pal.', 'You picked the wrong one.'],
  run: ['Nope!', 'I\'m not dying for this job!'],
  refuse: ['Glass is bulletproof, genius.', 'Cops are already on the way.', 'You can\'t touch me in here.'],
  giveIn: ['Okay! Okay! Here, take it!', 'Stop shooting! I\'ll give it to you!'],
  safe: ['The safe? Alright… alright.', 'It\'s on a timer, I swear… okay, okay.'],
  masked: ['Take that thing off in my store.', 'Mask off in here, man.'],
  hi: ['Hey, welcome in.', 'How you doing?', 'Let me know if you need anything.'],
  alarmed: ['Take it. You ain\'t got long.', 'Here, take it and go. Go.', 'Sure, sure. Take your time.', 'Whatever you say, man.'],
};

export class Robbery {
  constructor(game, rooms) {
    this.game = game;
    this.rooms = rooms;
    this.aimT = 0;
    this.holdT = 0;
    this.maskT = 0;
    this.pending = []; // (reports on their way: { r, at, kind })
  }

  // Your bandana pulled up over your face (made the first time).
  setMask(on) {
    const game = this.game;
    game.masked = on;
    const c = game.player.char;
    if (!this.mask) {
      this.mask = new THREE.Mesh(new THREE.BoxGeometry(0.345, 0.17, 0.345), new THREE.MeshLambertMaterial({ color: 0x1e7d32 }));
      this.mask.position.set(0, 1.72 - 1.62, 0.006);
      c.neck.add(this.mask);
    }
    this.mask.visible = on;
  }

  say(r, who, text) {
    if (!text) return;
    r.sayT = this.game.time;
    this.game.hud.toast(`${who}: "${text}"`, '#ffd479');
  }

  // ---- Starting it ----
  start(r, how) {
    const game = this.game;
    const k = r.clerk;
    if (!k || !k.standing) return;
    const n = Math.min(1, (k.nerve || 0.5) + 0.22 * Math.min(2, r.robbedN));
    // (hit before: he's not getting caught without something under the counter again)
    if (r.robbedN > 0 && !k.storeWeapon) k.storeWeapon = r.kind === 'market' ? null : 'pistol';
    const crew = game.turfWars?.turfAt?.(r.cx, r.cz) === 'crew';
    let plan;
    if (r.glass) plan = how === 'gun' && Math.random() < 0.45 - 0.25 * n ? 'comply' : 'refuse';
    else {
      const wpn = !!k.storeWeapon;
      let pFight = wpn ? (how === 'gun' ? 0.1 + 0.3 * n : 0.45 + 0.4 * n) : how === 'gun' ? 0.02 : 0.25 + 0.35 * n;
      let pAlarm = 0.16 + 0.2 * n + (game.masked ? 0.08 : 0);
      if (crew) {
        // (your people run this block: he knows better)
        pFight *= 0.4;
        pAlarm *= 0.5;
      }
      const pRun = how === 'gun' ? 0.12 : 0.05;
      const pStall = 0.22;
      const x = Math.random();
      plan = x < pFight ? 'fight' : x < pFight + pAlarm ? 'alarm' : x < pFight + pAlarm + pRun ? 'run' : x < pFight + pAlarm + pRun + pStall ? 'stall' : 'comply';
    }
    r.rob = {
      t: 0, how, plan, phase: 'hands', phaseT: 0, bag: 0, need: BAG_T[plan] || 8, uncovered: 0, alarm: false, reported: false,
      idd: false, tellAt: plan === 'alarm' ? rand(1.2, 2.6) : -1, stops: 0, bagged: false, safe: null, register: 0, crew,
    };
    this.say(r, r.prof.name, pick(how === 'gun' ? LINES.hands : LINES.handsFists));
    // (the guard, the customers)
    if (r.guard?.standing) {
      r.guard.ss = Math.random() < (how === 'gun' ? 0.5 : 0.85) ? 'fight' : 'hands';
      if (r.guard.ss === 'fight') this.rooms.arm(r.guard);
    }
    for (const c of r.customers) {
      if (!c.standing) continue;
      const x = Math.random();
      const hero = how === 'gun' ? 0.07 : 0.35;
      c.ss = x < hero ? 'hero' : x < hero + 0.25 ? 'flee' : x < hero + 0.4 ? 'film' : 'drop';
      c.ssT = rand(0.2, 1.0); // (a beat before they move)
    }
    this.seen(r);
    game.robbing = r.store;
  }

  // The cameras get a look at you (bandana down, a camera still working).
  seen(r) {
    if (!r.rob || this.game.masked) return;
    if (r.cams.some((c) => c.alive)) r.rob.idd = true;
  }

  // ---- Is he covered: a gun on him, or you right on him with your fists up ----
  covered(r, p) {
    const game = this.game;
    const pl = game.player;
    const d = dist(pl.x, pl.z, p.x, p.z);
    const w = game.arsenal.current();
    if (w && !w.melee) {
      if (!game.aimingNow || d > 14) return false;
      const dir = game.camera.getWorldDirection(new THREE.Vector3());
      const a = Math.atan2(p.x - pl.x, p.z - pl.z) - Math.atan2(dir.x, dir.z);
      return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.5;
    }
    return d < (r.glass ? 3.2 : 2.6);
  }

  // ---- Every frame ----
  update(dt) {
    const game = this.game;
    const R = this.rooms;
    const inside = R.inside;
    // (the bandana comes down on its own once you're out and clear)
    if (game.masked) {
      this.maskT = !inside && game.stars === 0 ? this.maskT + dt : 0;
      if (this.maskT > 25) {
        this.setMask(false);
        game.hud.toast('You pull your bandana down.', '#9fc3ff');
      }
    }
    // (walking in with it up: the clerk clocks it)
    if (inside !== this.wasIn) {
      if (inside && !inside.rob && inside.clerk?.standing && game.time - (inside.hiT ?? -99) > 40) {
        inside.hiT = game.time;
        this.say(inside, inside.prof.name, pick(game.masked ? LINES.masked : LINES.hi));
        if (game.masked) inside.wary = game.time;
      }
      this.wasIn = inside;
    }
    // (put a gun on the clerk and it's a stick-up)
    if (inside && !inside.rob && inside.clerk?.standing && !game.arsenal.current()?.melee && this.covered(inside, inside.clerk)) {
      this.aimT += dt;
      if (this.aimT > 0.35) this.start(inside, 'gun');
    } else this.aimT = 0;
    for (const r of R.rooms) {
      const rob = r.rob;
      if (!rob) continue;
      rob.t += dt;
      // (a shot fired in here: everyone jumps; the clerk hurries, or snaps)
      if (inside === r && game.lastShot > (rob.lastShotSeen ?? game.lastShot - 1) && game.time - game.lastShot < 0.1) {
        rob.lastShotSeen = game.lastShot;
        if (rob.phase === 'bag') {
          rob.bag += 2.5;
          if (Math.random() < 0.15 && r.clerk?.storeWeapon && !rob.alarm) this.tell(r, 'fight');
        }
      }
      rob.lastShotSeen ??= game.lastShot;
      // (you walked out: it's over, and it gets called in)
      if (inside !== r) {
        const [lx, lz] = R.local(r, game.player.x, game.player.z);
        if (lz < -0.3 || Math.abs(lx) > r.hw + 1 || game.player.vehicle) this.end(r);
      }
    }
    // (reports coming in: the alarm, a customer who got out and called, the clerk after)
    for (const q of this.pending) {
      if (game.time < q.at) continue;
      q.done = true;
      this.report(q);
    }
    this.pending = this.pending.filter((q) => !q.done);
    this.poseYou();
  }

  // The silent alarm or a 911 call: the cops are on their way to the store now.
  // The alarm's tripped (the button under the counter, or someone's on the phone to 911): the
  // register's light goes red, and 20-28 s later dispatch puts it out to the units (then the
  // star, the radio call, the nearest car on its way: about half a minute or more all told).
  alarm(r, why) {
    const rob = r.rob;
    if (rob && rob.alarm) return;
    if (rob) rob.alarm = true;
    const game = this.game;
    r.alarmLit = game.time;
    this.pending.push({ r, at: game.time + rand(20, 28), kind: 'dispatch', why });
  }

  // The robbery's over (you left): it's reported now, or a little later if there's nobody left
  // who can.
  end(r) {
    const rob = r.rob;
    r.rob = null;
    const game = this.game;
    if (game.robbing === r.store) game.robbing = null;
    r.robbedN++;
    if (rob.register || rob.bagged) r.emptyUntil = game.time + 600;
    // (anyone still in here: the clerk back to his post or down behind the counter for a bit;
    // customers get out)
    for (const c of r.customers) if (c.inStore && c.standing) c.ss = 'leave';
    if (r.clerk) {
      r.clerk.ss = 'post';
      r.clerk.shakenT = 20;
    }
    if (r.guard) r.guard.ss = 'post';
    if (r.lock) r.lock.off = true;
    const someone = [r.clerk, r.guard, ...r.customers].some((c) => c && c.standing) || rob.callers;
    // (calls still on their way for this one are folded into the report)
    this.pending = this.pending.filter((q) => q.r !== r || q.kind === 'dispatch');
    if (!rob.took && !rob.alarm && !rob.fired) {
      // (nothing taken and no harm done: a scare, but they still call it in)
      this.pending.push({ r, at: game.time + 4, kind: 'attempt', idd: rob.idd, how: rob.how });
      return;
    }
    // (the clerk on the phone to 911 once you're out the door; nobody able to: found later)
    this.pending.push({ r, at: game.time + (someone ? rand(8, 14) : 40), kind: 'robbery', idd: rob.idd, how: rob.how, take: rob.took || 0 });
  }

  // A report comes in: a 911 call (the robbery's still going: the cops head over), an attempt,
  // or the robbery itself once you're gone.
  report(q) {
    const game = this.game;
    const r = q.r;
    const { x, z } = r.store;
    if (q.kind === 'call') {
      if (r.rob) this.alarm(r, 'Robbery in progress, 911 call');
      return;
    }
    if (q.kind === 'dispatch') {
      // (now they're coming)
      game.crime('robberyAlarm', x, z, `at ${r.name}`);
      game.pursuit?.radio?.(`Dispatch: ${q.why} at ${r.name}, ${streetAt(x, z) || districtAt(x, z)}. Units respond.`, true);
      return;
    }
    if (q.kind === 'attempt') {
      game.crime('robberyAlarm', x, z, `at ${r.name}`);
      game.hud.news(`Attempted robbery at ${r.name} on ${streetAt(x, z)}`);
      return;
    }
    game.crime('robbery', x, z);
    if (q.idd) {
      // (they know who they're looking for)
      game.heat += 1.5;
      game.stars = Math.max(game.stars, game.starsFor(game.heat));
    }
    const how = q.how === 'fists' ? 'Strong-arm robbery' : 'Armed robbery';
    const what = q.take ? `, $${q.take.toLocaleString('en-US')} taken` : '';
    game.hud.news(`${how} at ${r.name} on ${streetAt(x, z)}${what}${q.idd ? ': police have the suspect on camera' : ': the suspect wore a mask'}`);
  }

  // ---- Something scared someone in here (peds.js scare: a shot, a fight) ----
  scared(r, p, fx, fz, gun) {
    const game = this.game;
    if (!p.standing) return false;
    if (p.state === 'brawl') {
      // (done fighting you: a customer gets out; the clerk's had enough and pays up; the guard
      // puts his hands up)
      p.state = 'store';
      if (p.storeRole === 'customer') p.ss = 'flee';
      else if (p.storeRole === 'guard') p.ss = 'hands';
      else if (r.rob && !r.rob.bagged) {
        Object.assign(r.rob, { phase: 'bag', phaseT: 0, chanced: true, tellAt: -1 });
        this.say(r, r.prof.name, pick(['Aight, aight! Take it!', 'Okay! You win, take it!']));
      }
      return true;
    }
    const pl = game.player;
    const youInside = this.rooms.inside === r;
    if (!r.rob) {
      // (you fired in here or swung on someone: that's a stick-up now)
      if (youInside && (gun || dist(fx, fz, pl.x, pl.z) < 3) && r.clerk?.standing) this.start(r, game.arsenal.current()?.melee ? 'fists' : 'gun');
      else return true; // (trouble out on the street: they stay put in here)
    }
    if (p.storeRole === 'customer') {
      if (p.ss === 'hero' || p.ss === 'flee' || p.ss === 'leave') return true;
      p.ss = gun && Math.random() < 0.4 ? 'flee' : 'drop';
      return true;
    }
    return true; // (the staff: robbery.js already has them)
  }

  // A camera shot out: blind from now on.
  camShot(r, cam) {
    cam.alive = false;
    cam.led.visible = false;
    cam.body.material = cam.body.material.clone();
    cam.body.material.color.setHex(0x3a3a3a);
    cam.body.rotation.x = 1.1;
    const [wx, wz] = this.rooms.world(r, cam.lx, cam.lz);
    this.game.effects?.impact(wx, r.oy + cam.ly, wz);
    if (r.rob && !r.cams.some((c) => c.alive) && !this.game.masked) {
      // (too late if it's already had a good look: it's on the tape)
      if (r.rob.t > 4) return;
      r.rob.idd = false;
    }
  }

  // The booth glass hit: a crack where the round landed; scare him enough and he gives in.
  glassShot(r, hx, hy) {
    const g = r.glass;
    g.cracks++;
    const crack = new THREE.Mesh(new THREE.CircleGeometry(0.09 + Math.random() * 0.06, 7), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    crack.position.set(hx, hy, g.z - 0.005);
    crack.rotation.y = Math.PI;
    r.root.add(crack);
    const rob = r.rob;
    if (rob && rob.phase === 'refuse' && Math.random() < 0.3) {
      rob.plan = 'comply';
      rob.need = 9;
      rob.phase = 'hands';
      rob.phaseT = 0;
      this.say(r, r.prof.name, pick(LINES.giveIn));
    }
  }

  // A hand goes under the counter (kind: 'alarm' or 'fight'); USE in time stops it.
  tell(r, kind) {
    const rob = r.rob;
    rob.phase = 'tell';
    rob.tell = kind;
    rob.phaseT = 0;
    rob.tellT = kind === 'fight' ? 0.85 : 1.4;
  }

  // ---- The people: what they're doing while there's a robbery. Returns their pose, or null
  // (not robbery business: storerooms.js does the usual) ----
  stepPerson(r, p, dt) {
    const rob = r.rob;
    const game = this.game;
    const R = this.rooms;
    const pl = game.player;
    if (p.storeRole === 'clerk') {
      if (p.shakenT > 0 && !rob) {
        // (just robbed: hands still shaking, ducked down behind the counter a while)
        p.shakenT -= dt;
        if (R.walk(r, p, r.clerkSpot.x, r.clerkSpot.z, 1.4, dt)) R.face(r, p, ...r.clerkSpot.face, dt, 3);
        return 'cower';
      }
      if (!rob) return null;
      return this.clerkStep(r, p, dt);
    }
    if (p.storeRole === 'guard') {
      if (!rob) return null;
      R.facePoint(p, pl.x, pl.z, dt, 8);
      if (p.ss === 'fight') {
        if (!p.storeWeapon || rob.how === 'fists') {
          p.startBrawl();
          return 'walk';
        }
        return this.shoot(r, p, dt);
      }
      return 'hands';
    }
    // (a customer)
    if (!rob || !p.ss || ['browse', 'look', 'pay', 'leave'].includes(p.ss)) return null;
    p.ssT = (p.ssT || 0) - dt;
    if (p.ssT > 0) {
      R.facePoint(p, pl.x, pl.z, dt, 6);
      return 'hands';
    }
    if (p.ss === 'hero') {
      p.ss = 'drop';
      p.startBrawl();
      this.say(r, 'Customer', pick(['Not today!', 'Nah, not in here!', 'Put that down!', 'Not on my block!']));
      return 'walk';
    }
    if (p.ss === 'flee') {
      const [ox, oz] = r.outside;
      if (R.walk(r, p, ox, oz, 4.2, dt)) {
        // (out the door, running; a few seconds later they've called it in)
        rob.callers = (rob.callers || 0) + 1;
        game.hud.toast('A customer got out the door: they\'ll be calling it in', '#9fc3ff');
        if (!rob.alarm) this.pending.push({ r, at: game.time + 6, kind: 'call' });
        R.release(r, p, true);
      }
      return 'walk';
    }
    if (p.ss === 'film') {
      R.phone(p);
      R.facePoint(p, pl.x, pl.z, dt, 6);
      if (!game.masked) rob.idd = true; // (a witness with your face on video)
      return 'film';
    }
    // drop
    return 'cower';
  }

  // The clerk, through the stick-up.
  clerkStep(r, p, dt) {
    const rob = r.rob;
    const game = this.game;
    const R = this.rooms;
    const pl = game.player;
    rob.phaseT += dt;
    const cov = this.covered(r, p);
    rob.uncovered = cov ? 0 : rob.uncovered + dt;
    const look = () => R.facePoint(p, pl.x, pl.z, dt, 6);
    switch (rob.phase) {
      case 'hands': {
        look();
        if (rob.phaseT < 0.9) return 'hands';
        rob.phaseT = 0;
        if (rob.plan === 'fight') this.tell(r, 'fight');
        else if (rob.plan === 'run') {
          rob.phase = 'run';
          this.say(r, r.prof.name, pick(LINES.run));
        } else if (rob.plan === 'refuse') {
          rob.phase = 'refuse';
          this.say(r, r.prof.name, pick(LINES.refuse));
          this.alarm(r, 'Silent alarm');
        } else {
          rob.phase = 'bag';
          if (rob.plan === 'stall') this.say(r, r.prof.name, pick(LINES.stall));
        }
        return 'hands';
      }
      case 'bag': {
        // (at the register, filling the bag: faster while you've got him covered)
        R.bag(p);
        R.face(r, p, ...(r.glass ? [0, -1] : r.clerkSpot.face), dt, 6);
        rob.bag += dt * (cov ? 1 : 0.35);
        if (rob.tellAt > 0 && rob.bag > rob.tellAt) {
          rob.tellAt = -1;
          this.tell(r, 'alarm');
          return 'reach';
        }
        // (you looked away too long: he takes his chance)
        if (rob.uncovered > 1.6 && !rob.chanced && !r.glass) {
          rob.chanced = true;
          const x = Math.random();
          if (x < 0.35 && !rob.alarm) {
            this.tell(r, 'alarm');
            return 'reach';
          }
          if (x < 0.5 && p.storeWeapon) {
            this.tell(r, 'fight');
            return 'reach';
          }
        }
        if (rob.bag >= rob.need) {
          rob.phase = 'give';
          rob.phaseT = 0;
          this.say(r, r.prof.name, pick(LINES.bagged));
        }
        return 'bag';
      }
      case 'tell': {
        // (a hand under the counter: stop him in time (USE), or it's the alarm or a gun)
        if (rob.phaseT < rob.tellT) return 'reach';
        if (rob.tell === 'alarm') {
          this.alarm(r, 'Silent alarm');
          rob.phase = 'bag';
          rob.need += 2;
          this.say(r, r.prof.name, pick(LINES.alarmed));
          return 'bag';
        }
        rob.phase = 'fight';
        rob.phaseT = 0;
        R.arm(p);
        this.say(r, r.prof.name, pick(LINES.fight));
        if (!p.storeWeapon || p.storeWeapon === 'bat') {
          // (a bat or his fists: he comes round the counter at you)
          p.startBrawl();
          rob.fired = true;
          return 'walk';
        }
        return 'draw';
      }
      case 'fight':
        look();
        rob.fired = true;
        return this.shoot(r, p, dt);
      case 'run': {
        // (into the back room, and the door locked behind him)
        const B = r.back;
        if (!r.lock) {
          rob.phase = 'refuse';
          return 'cower';
        }
        if (R.route(r, p, 'run', R.toBack(r, (B.x0 + B.x1) / 2 + 0.4, B.z0 + 1.8), 4.4, dt)) {
          r.lock.off = false;
          rob.phase = 'hidden';
          rob.phaseT = 0;
          this.pending.push({ r, at: game.time + 6, kind: 'call' });
        }
        return 'walk';
      }
      case 'hidden':
        return 'cower';
      case 'refuse':
        // (down behind the counter in his booth)
        return 'cower';
      case 'give': {
        // (holding the bag out to you, or pushing it through the tray)
        look();
        return 'give';
      }
      case 'done':
        // (the safe's open: he backs off from it, out of the door's way, hands up)
        if (rob.dial >= 8 && !R.walk(r, p, r.safe.x - 0.5, r.safe.z - 1.3, 1.1, dt)) return 'walk';
        look();
        return 'hands';
      case 'toSafe': {
        // (walking you back to the safe)
        const s = r.safe;
        if (R.route(r, p, 'safe', r.glass ? [[s.x, s.z]] : R.toBack(r, s.x, s.z), 1.6, dt)) {
          rob.phase = 'dial';
          rob.phaseT = 0;
          rob.dial = 0;
        }
        if (rob.uncovered > 2.5 && r.lock && R.local(r, p.x, p.z)[1] > r.back.z0 + 0.3 && Math.random() < dt * 0.5) {
          // (out of your sight in the back: he slams the door on you)
          rob.phase = 'run';
        }
        return 'walk';
      }
      case 'dial': {
        R.face(r, p, ...r.safe.face, dt, 6);
        const near = dist(pl.x, pl.z, p.x, p.z) < (rob.how === 'gun' ? 6 : 3);
        rob.dial += dt * (near ? 1 : 0.2);
        if (rob.dial >= 8) {
          const [lo, hi] = TAKE.safe[r.kind];
          const take = game.time < (r.safeUntil || 0) ? Math.round(rand(lo, hi) * 0.1 / 10) * 10 : Math.round(rand(lo, hi) / 10) * 10;
          r.safeUntil = game.time + 1800;
          r.safeOpenT = game.time + 60; // (the door swings open, and stays a while)
          game.cash += take;
          rob.took = (rob.took || 0) + take;
          rob.phase = 'done';
          game.hud.toast(`+$${take.toLocaleString('en-US')} from the safe`, '#7ee081');
          game.save?.();
        }
        return 'dial';
      }
      default:
        return 'hands';
    }
  }

  // Someone with a gun on you: aimed, firing every so often.
  shoot(r, p, dt) {
    const game = this.game;
    const g = STORE_GUNS[p.storeWeapon] || STORE_GUNS.pistol;
    this.rooms.arm(p);
    this.rooms.facePoint(p, game.player.x, game.player.z, dt, 10);
    p.fireT = (p.fireT ?? rand(0.3, 0.7)) - dt;
    if (p.fireT <= 0 && game.wastedT <= 0) {
      p.fireT = g.every * rand(0.85, 1.25);
      game.npcShoot(p, g.dmg, g.kind, 0.85);
      if (r.rob) r.rob.fired = true;
    }
    return 'aim';
  }

  // ---- USE and the prompt, inside ----
  interact(a) {
    const game = this.game;
    const R = this.rooms;
    const r = R.inside;
    if (!r) return false;
    const key = game.input.label('interact');
    const pressed = a.interactHeld && !game.interactWasHeld;
    const pl = game.player;
    const k = r.clerk;
    const rob = r.rob;
    const name = r.prof.name;
    const he = r.prof.female ? 'her' : 'him';
    const [lx, lz] = [r.lx, r.lz];
    const atCounter = dist(lx, lz, r.counter.x, r.counter.z) < 2.4;
    const nearReg = dist(lx, lz, r.register.x, r.register.z) < 1.6;
    if (!rob) {
      if (k?.standing && (atCounter || (k && dist(pl.x, pl.z, k.x, k.z) < 3))) {
        const light = game.time < r.emptyUntil ? ' (the register\'s light: they got hit not long ago)' : '';
        game.prompt = `Press ${key} to rob ${r.name}${light}`;
        if (pressed) this.start(r, game.arsenal.current()?.melee ? 'fists' : 'gun');
        return true;
      }
      // (the clerk's gone: the register's just sitting there)
      if (nearReg && !(k?.standing)) return this.emptyRegister(r, a, key);
      game.prompt = `Press ${key} to pull your bandana ${game.masked ? 'down' : 'up'}`;
      if (pressed) {
        this.setMask(!game.masked);
        if (game.masked && k?.standing) {
          this.say(r, name, pick(LINES.masked));
          r.wary = game.time;
        }
      }
      return true;
    }
    const clerkUp = k && k.standing && k.state === 'store';
    switch (rob.phase) {
      case 'tell':
        game.prompt = `Press ${key} to stop ${he}: ${he === 'her' ? 'she\'s' : 'he\'s'} reaching under the counter!`;
        if (pressed) {
          rob.stops++;
          rob.phase = 'bag';
          rob.tellAt = -1;
          rob.chanced = true;
          this.say(r, name, pick(LINES.stopped));
        }
        break;
      case 'hands':
      case 'bag':
        game.prompt = rob.phase === 'bag' ? `Keep ${he} covered · Press ${key} to tell ${he} to hurry up` : `Keep ${he} covered`;
        if (rob.phase === 'bag') game.progress = { value: Math.min(1, rob.bag / rob.need), label: `${name} is bagging the cash` };
        if (pressed && rob.phase === 'bag') {
          rob.bag += 1.6;
          this.say(r, name, pick(LINES.hurry));
          // (push too hard and he does something stupid)
          if (Math.random() < 0.18 && !r.glass) this.tell(r, k.storeWeapon && k.nerve > 0.45 && Math.random() < 0.5 ? 'fight' : 'alarm');
        }
        break;
      case 'give': {
        const reach = r.glass ? dist(lx, lz, r.counter.x, r.counter.z) < 1.8 : dist(pl.x, pl.z, k.x, k.z) < 2.8;
        game.prompt = reach ? `Press ${key} to grab the bag` : `${name} is holding the bag out: go get it`;
        if (pressed && reach) this.takeBag(r);
        break;
      }
      case 'done':
        if (clerkUp && !r.glass && r.safe && game.time > (r.safeUntil || 0) && !rob.safeTried) {
          game.prompt = `Press ${key} to make ${he} open the safe · or get out of there`;
          if (pressed) {
            rob.safeTried = true;
            rob.phase = 'toSafe';
            if (r.lock) r.lock.off = true;
            this.say(r, name, pick(LINES.safe));
          }
        } else game.prompt = 'Get out of there';
        break;
      case 'dial':
        game.prompt = `Keep ${he} covered while ${he === 'her' ? 'she' : 'he'} opens the safe`;
        game.progress = { value: Math.min(1, rob.dial / 8), label: 'Opening the safe' };
        break;
      case 'refuse':
        game.prompt = `${name} is behind bulletproof glass: shoot the glass to scare ${he}, or get out of there`;
        break;
      case 'hidden':
        if (nearReg && !rob.register) return this.emptyRegister(r, a, key);
        game.prompt = `${name} locked ${he === 'her' ? 'herself' : 'himself'} in the back: empty the register yourself, or go`;
        break;
      default:
        game.prompt = '';
    }
    // (he's down or fighting: help yourself to the register)
    if (!clerkUp && !rob.bagged && !rob.register && nearReg && rob.phase !== 'hidden') return this.emptyRegister(r, a, key);
    return true;
  }

  // Your hand out for the bag (from the clerk) or into the drawer (the register).
  grab(from, r = null) {
    const game = this.game;
    let x;
    let z;
    if (from) [x, z] = [from.x, from.z];
    else [x, z] = this.rooms.world(r, r.register.x, r.register.z);
    this.reachT = game.time;
    this.reachAt = [x, z];
  }

  // (every frame, after your own animation: the reach)
  poseYou() {
    const game = this.game;
    const k = (game.time - (this.reachT ?? -9)) / 0.55;
    if (k < 0 || k > 1) return;
    const pl = game.player;
    const c = pl.char;
    const w = Math.sin(k * Math.PI); // (out and back)
    c.group.updateMatrixWorld(true);
    const t = c.group.worldToLocal(new THREE.Vector3(this.reachAt[0], game.city.groundY(pl.x, pl.z) + 1.0, this.reachAt[1]));
    const L = Math.hypot(t.x, t.z) || 1;
    const tgt = new THREE.Vector3(-0.2, 1.1, 0.25).lerp(new THREE.Vector3((t.x / L) * 0.6, 1.05, (t.z / L) * 0.6), w);
    reachArm(c, 'L', tgt, new THREE.Vector3(1, -0.5, -0.3), null, null, 'group');
  }

  takeBag(r) {
    const game = this.game;
    const rob = r.rob;
    const [lo, hi] = TAKE.register[r.kind];
    const light = game.time < r.emptyUntil;
    const take = Math.round((light ? rand(30, 90) : rand(lo, hi)) / 10) * 10;
    game.cash += take;
    rob.took = (rob.took || 0) + take;
    rob.bagged = true;
    rob.phase = 'done';
    this.grab(r.clerk);
    this.lastHow = rob.how;
    if (r.clerk?.bagMesh) r.clerk.bagMesh.visible = false;
    game.hud.toast(`+$${take.toLocaleString('en-US')}  ${r.name}`, '#7ee081');
    game.save?.();
  }

  // Emptying the register yourself (hold USE): slower, and only what's in the drawer.
  emptyRegister(r, a, key) {
    const game = this.game;
    let rob = r.rob;
    if (rob?.register) {
      game.prompt = 'The register\'s empty';
      return true;
    }
    game.prompt = `Hold ${key} to empty the register`;
    if (!a.interactHeld) {
      this.holdT = 0;
      this.holdAt = null;
      return true;
    }
    if (!rob) {
      this.start(r, game.arsenal.current()?.melee ? 'fists' : 'gun');
      rob = r.rob;
      if (!rob) {
        // (nobody to stop you at all)
        r.rob = rob = { t: 0, how: 'gun', plan: 'none', phase: 'none', phaseT: 0, bag: 0, need: 0, uncovered: 0, alarm: false, idd: false, stops: 0 };
        this.seen(r);
      }
    }
    const now = game.time;
    this.holdT += Math.min(0.1, Math.max(0, now - (this.holdAt ?? now)));
    this.holdAt = now;
    game.progress = { value: this.holdT / 3.5, label: 'Emptying the register' };
    if (this.holdT >= 3.5) {
      this.holdT = 0;
      const [lo, hi] = TAKE.register[r.kind];
      const light = game.time < r.emptyUntil;
      const take = Math.round((light ? rand(30, 90) : rand(lo, hi) * 0.8) / 10) * 10;
      game.cash += take;
      rob.took = (rob.took || 0) + take;
      rob.register = take;
      this.lastHow = rob.how;
      r.drawerOpenT = game.time + 90;
      this.grab(null, r);
      game.hud.toast(`+$${take.toLocaleString('en-US')} from the register`, '#7ee081');
      game.save?.();
    }
    return true;
  }
}

