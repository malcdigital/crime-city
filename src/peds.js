import { CFG } from './config.js';
import { closestOnBox } from './geom.js';
import { makeCharacter, animateWalk, setDown, crouchPose, SKIN_TONES } from './character.js';
import { pushCircle } from './collision.js';
import { pick, rand, dist, lerpAngle } from './util.js';
import { navStep, escapePoint } from './nav.js';
import { sameSide, sideBlock, curbPoint, walkNeighbors } from './sidewalk.js';
import { findCover } from './gang.js';

const SHIRTS = [0xe74c3c, 0x3498db, 0xf1c40f, 0x9b59b6, 0xecf0f1, 0x1abc9c, 0xe67e22, 0x34495e, 0xff7eb6, 0x95a5a6];
const PANTS = [0x2c3e50, 0x1b1b1b, 0x5d4037, 0x34495e, 0x7f8c8d, 0x1f3a5f];

export class Ped {
  constructor(game, block, corner) {
    this.game = game;
    this.char = makeCharacter({ shirt: pick(SHIRTS), pants: pick(PANTS), skin: pick(SKIN_TONES) });
    game.scene.add(this.char.group);
    this.dir = Math.random() < 0.5 ? 1 : -1;
    // Where on the sidewalks: heading for walk point `pt` (see sidewalk.js), from `prev`.
    const W = game.city.walk;
    const ids = W.blockPts.get(block);
    this.pt = ids ? W.pts[ids[corner % ids.length]] : W.pts[0];
    this.prev = null;
    this.cross = null;
    this.block = this.pt.b;
    this.x = this.pt.x;
    this.z = this.pt.z;
    this.heading = 0;
    this.speed = 0;
    this.walkSpeed = rand(1.2, 1.7);
    this.phase = Math.random() * 6;
    this.state = 'walk';
    this.t = 0;
    this.threat = null;
    this.removed = false;
    this.health = 100;
    this.sidewalk = true; // stays on the sidewalks, crossing only at crosswalks (see nav.js)
  }

  get standing() {
    return this.state !== 'down' && this.state !== 'dead';
  }

  // Low to the ground (smaller target): ducking, hiding or lying flat after a dive.
  get crouched() {
    return this.state === 'cower' || (this.state === 'hide' && this.hidden) || (this.state === 'dive' && this.t < this.diveLen - 0.35);
  }

  get alive() {
    return this.state !== 'dead';
  }

  // Returns true if this hit killed them.
  takeHit(dmg, fromX, fromZ) {
    if (this.state === 'dead') return false;
    this.health -= dmg;
    if (this.health <= 0) {
      this.state = 'dead';
      this.t = 40;
      setDown(this.char, true);
      return true;
    }
    if (this.state !== 'down') this.scare(fromX, fromZ);
    return false;
  }

  knockDown(fromX, fromZ, fling = 0) {
    if (this.state === 'down' || this.state === 'dead') return;
    this.state = 'down';
    this.t = rand(5, 7);
    this.threat = [fromX, fromZ];
    if (fling) {
      const d = dist(this.x, this.z, fromX, fromZ) || 1;
      this.x += ((this.x - fromX) / d) * fling;
      this.z += ((this.z - fromZ) / d) * fling;
    }
    setDown(this.char, true);
  }

  scare(fromX, fromZ, gun = false) {
    if (this.state === 'down' || this.state === 'dead' || this.state === 'sting') return;
    // A shop owner being shaken down stays at his store: he ducks, then stands back up.
    if (this.shopkeeper) {
      this.state = 'cower';
      this.calmT = rand(3, 5);
      this.threat = [fromX, fromZ];
      return;
    }
    // Already taking cover from gunfire: stay put while the shooting goes on.
    if (this.state === 'dive' || this.state === 'cower' || this.state === 'hide') {
      this.calmT = rand(5, 8);
      this.threat = [fromX, fromZ];
      return;
    }
    if (gun && this.reactToGunfire(fromX, fromZ)) return;
    // Pick a street corner to run to, away from the danger (re-pick if the danger moved a lot).
    const moved = !this.threat || dist(this.threat[0], this.threat[1], fromX, fromZ) > 12;
    if (this.state !== 'flee' || moved || !this.fleeGoal) this.fleeGoal = escapePoint(this.game, this, fromX, fromZ);
    this.state = 'flee';
    this.t = rand(5, 8);
    this.threat = [fromX, fromZ];
  }

  // Shots fired nearby: everyone reacts. Some hit the deck, some duck where they stand,
  // some run for cover and hide, the rest just run.
  reactToGunfire(fromX, fromZ) {
    if (this.state === 'flee' && Math.random() < 0.6) return false; // already running: keep going
    const d = dist(this.x, this.z, fromX, fromZ);
    this.threat = [fromX, fromZ];
    this.calmT = rand(5, 8);
    this.char.armR.rotation.x = 0;
    const r = Math.random();
    if (d < 20 && r < 0.3) {
      // Dive away from the shots and lie flat.
      this.state = 'dive';
      this.diveLen = rand(2.2, 3.5);
      this.t = this.diveLen;
      const a = Math.atan2(this.x - fromX, this.z - fromZ) + rand(-0.9, 0.9);
      this.heading = a;
      return true;
    }
    if (r < 0.5) {
      // Duck and cover right where they are.
      this.state = 'cower';
      this.heading = Math.atan2(this.x - fromX, this.z - fromZ);
      return true;
    }
    if (r < 0.78) {
      const spot = findCover(this.game, this, { x: fromX, z: fromZ });
      if (spot) {
        this.state = 'hide';
        this.hideSpot = [spot.x, spot.z];
        this.hidden = false;
        this.navFails = 0;
        this.t = 10; // give up getting there after a while
        return true;
      }
    }
    return false; // run
  }

  // Shooting has died down: get up and get out of there.
  recover() {
    setDown(this.char, false);
    this.char.group.rotation.x = 0;
    this.hidden = false;
    if (this.shopkeeper) {
      this.state = 'shop';
      return;
    }
    const [fx, fz] = this.threat;
    this.state = 'walk';
    this.scare(fx, fz);
  }

  resumeWalking() {
    // Head for the nearest sidewalk point (preferring one on the block you're on).
    const W = this.game.city.walk;
    const here = this.game.city.blockAt(this.x, this.z);
    let best = null;
    let bd = Infinity;
    for (const p of W.pts) {
      const d = dist(p.x, p.z, this.x, this.z) - (p.b === here ? 20 : 0);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    this.pt = best;
    this.prev = null;
    this.cross = null;
    this.block = best.b;
    this.state = 'walk';
  }

  update(dt) {
    const game = this.game;
    let tx = this.x;
    let tz = this.z;
    let speed = 0;

    if (this.state === 'dead') {
      this.t -= dt;
      if (this.t <= 0) this.dispose();
    } else if (this.state === 'down') {
      this.t -= dt;
      if (this.t <= 0) {
        setDown(this.char, false);
        this.scare(...this.threat);
      }
    } else if (this.state === 'flee') {
      this.t -= dt;
      const dThreat = dist(this.x, this.z, ...this.threat);
      [tx, tz] = this.fleeGoal;
      // Sprint while close, ease into a jog once well clear.
      speed = this.loot ? 6.6 : dThreat > 40 ? 3 : 4.3; // a thief with your stuff sprints
      // Reached the corner but still scared: keep going to the next one.
      if (dist(this.x, this.z, tx, tz) < 2 || this.navFails >= 2) {
        this.navFails = 0;
        this.fleeGoal = escapePoint(game, this, ...this.threat);
      }
      if (this.t <= 0) {
        if (dThreat < 35) this.t = 1.5; // still too close: keep going
        else this.afterFlee();
      }
    } else if (this.state === 'dive') {
      // Lunge, then lie flat with hands over the head.
      this.t -= dt;
      const lunge = this.diveLen - this.t;
      if (lunge < 0.35) {
        speed = 0;
        const r = pushCircle(this.x + Math.sin(this.heading) * 6 * dt, this.z + Math.cos(this.heading) * 6 * dt, 0.35, game.city.colliders);
        this.x = r.x;
        this.z = r.z;
      }
      this.calmT -= dt;
      if (this.t <= 0 && this.calmT <= 0) this.recover();
      else if (this.t <= 0) this.t = 0.01;
    } else if (this.state === 'cower') {
      this.calmT -= dt;
      if (this.calmT <= 0) this.recover();
    } else if (this.state === 'hide') {
      [tx, tz] = this.hideSpot;
      this.t -= dt;
      if (!this.hidden) {
        speed = 4.3;
        if (dist(this.x, this.z, tx, tz) < 0.9) this.hidden = true;
        else if (this.t <= 0 || this.navFails >= 3) {
          this.state = 'cower';
        }
      } else {
        this.heading = lerpAngle(this.heading, Math.atan2(this.threat[0] - this.x, this.threat[1] - this.z), Math.min(1, dt * 4));
        this.calmT -= dt;
        if (this.calmT <= 0) this.recover();
      }
    } else if (this.state === 'buyer') {
      // Coming up to buy from you (to your window if you're in a car).
      // On foot: walk up to you. In a car: come around to the driver's window, not through it.
      let [px, pz] = game.player.pos();
      const pv = game.player.vehicle;
      if (pv) {
        // At a window: whichever side is closer (the curb side if they came along the sidewalk).
        const [fx, fz] = pv.forward();
        const o = pv.radius + 0.75;
        const w1 = [pv.x + fz * o, pv.z - fx * o];
        const w2 = [pv.x - fz * o, pv.z + fx * o];
        [px, pz] = dist(this.x, this.z, ...w1) <= dist(this.x, this.z, ...w2) ? w1 : w2;
      }
      const stopAt = pv ? 0.5 : 1.5;
      const d = dist(this.x, this.z, px, pz);
      // You're across the street: they come to the curb on their side and wave you down
      // (they cross once you say so).
      this.flagging = false;
      if (!this.jaywalk && !sameSide(game.city, this.x, this.z, px, pz)) {
        const [b] = sideBlock(game.city, this.x, this.z);
        const [cx, cz] = curbPoint(b, px, pz);
        if (dist(this.x, this.z, cx, cz) > 0.8) {
          [tx, tz] = [cx, cz];
          speed = this.walkSpeed * (d > 12 ? 2.2 : 1.3);
        } else {
          this.flagging = true;
          const [lx, lz] = game.player.pos();
          this.heading = lerpAngle(this.heading, Math.atan2(lx - this.x, lz - this.z), Math.min(1, dt * 6));
        }
      } else if (d > stopAt) {
        [tx, tz] = [px, pz];
        speed = this.walkSpeed * (d > 12 ? 2.2 : 1.3); // hurry over, then walk up
      } else {
        const [lx, lz] = game.player.pos(); // face you (or your car)
        this.heading = lerpAngle(this.heading, Math.atan2(lx - this.x, lz - this.z), Math.min(1, dt * 6));
      }
    } else if (this.state === 'hoops') {
      // Shooting hoops at the court (hoops.js runs the game).
      const o = this.hoop.drive(this, dt);
      if (o.speed > 0) {
        [tx, tz] = [o.tx, o.tz];
        speed = o.speed;
      }
    } else if (this.state === 'shop') {
      // Standing out front of the store, watching you.
      const [px, pz] = game.player.pos();
      const look = dist(this.x, this.z, px, pz) < 12 ? Math.atan2(px - this.x, pz - this.z) : this.shopHeading;
      this.heading = lerpAngle(this.heading, look, Math.min(1, dt * 4));
    } else if (this.state === 'call') {
      // On the phone to 911, watching the scene.
      this.t -= dt;
      this.heading = lerpAngle(this.heading, Math.atan2(this.threat[0] - this.x, this.threat[1] - this.z), Math.min(1, dt * 5));
      if (this.t <= 0) {
        game.civilianCall(this, this.threat);
        this.char.armR.rotation.x = 0;
        this.resumeWalking();
        this.hurryT = 12;
      }
    } else if (this.state === 'leave') {
      // Leaving: back to their car, back the way they came, or into a building.
      [tx, tz] = this.door;
      speed = this.leaveSpeed || 2.4;
      if (this.leaveAway && dist(this.x, this.z, ...game.player.pos()) > 45) {
        this.dispose(); // well out of sight
        return;
      }
      if (dist(this.x, this.z, tx, tz) < 0.9 || this.navFails >= 3) {
        const [px, pz] = game.player.pos();
        if (this.onArrive) {
          this.onArrive();
          this.dispose();
          return;
        }
        if (this.leaveAway && dist(this.x, this.z, px, pz) < 30) {
          // Still in view: keep going, around the next corner.
          this.door = escapePoint(game, this, px, pz);
          this.navFails = 0;
        } else {
          this.dispose();
          return;
        }
      }
    } else if (this.state === 'sting') {
      // An undercover cop: badge out, gun on you.
      const [px, pz] = game.player.pos();
      this.heading = lerpAngle(this.heading, Math.atan2(px - this.x, pz - this.z), Math.min(1, dt * 8));
      this.fireT = (this.fireT ?? 8) - dt; // holds you at gunpoint...
      if (game.lastShot >= (game.holdFireFrom || 0) && this.fireT > 0.4) this.fireT = 0.4; // ...until you shoot
      const d = dist(this.x, this.z, px, pz);
      if (this.fireT <= 0 && d < 30 && game.wastedT <= 0 && game.bustedT <= 0) {
        this.fireT = rand(0.9, 1.5);
        game.npcShoot({ x: this.x, z: this.z, heading: this.heading, muzzleY: game.city.groundY(this.x, this.z) + 1.35, crouched: false }, 8, 'pistol', 0.6);
      }
      if (d > 40 || game.stars === 0) this.afterFlee();
    } else {
      [tx, tz] = [this.pt.x, this.pt.z];
      this.hurryT = Math.max(0, (this.hurryT || 0) - dt);
      speed = this.walkSpeed * (this.hurryT > 0 ? 1.6 : 1);
      // About to cross at a traffic light: wait on the curb for the walk signal.
      const S = game.streets;
      const onCurb = game.city.blockAt(this.x, this.z);
      if (S && onCurb && this.cross && onCurb !== this.pt.b && dist(this.x, this.z, tx, tz) < 40) {
        if (!S.canWalk(this.cross.n, this.cross.axis)) {
          speed = 0;
          this.heading = lerpAngle(this.heading, Math.atan2(tx - this.x, tz - this.z), Math.min(1, dt * 4));
        }
      }
      if (S && !onCurb && speed > 0) speed *= 1.35; // hurry across the street
      if (dist(this.x, this.z, tx, tz) < 0.6) this.arrive();
    }

    if (speed > 0) {
      const h = navStep(this, tx, tz, speed, dt, game, 0.35);
      if (h !== null) this.heading = lerpAngle(this.heading, h, Math.min(1, dt * 8));
    }
    this.speed = speed;
    this.phase += dt * speed * 4;
    animateWalk(this.char, this.phase, Math.min(1, speed / 1.5));
    if (this.state === 'call') this.char.armR.rotation.x = -2.5; // phone to the ear
    if (this.flagging && this.state === 'buyer') this.char.armR.rotation.x = -2.6 + Math.sin(game.time * 9) * 0.45; // waving you down
    if (this.state === 'sting') {
      // Gun out in the right hand, badge held up in the left.
      this.char.armR.rotation.x = -1.5;
      this.char.armL.rotation.x = -2.2;
    }
    const y = game.city.groundY(this.x, this.z);
    let yOff = this.standing ? 0 : 0.2;
    const c = this.char;
    c.group.rotation.x = this.standing ? 0 : c.group.rotation.x;
    if (this.state === 'dive') {
      // Tip forward onto the stomach over the lunge, arms over the head.
      const k = Math.min(1, (this.diveLen - this.t) / 0.35);
      c.group.rotation.x = k * Math.PI / 2;
      yOff = 0.2 * k;
      c.armL.rotation.x = c.armR.rotation.x = -2.9 * k;
      c.legL.rotation.x = c.legR.rotation.x = 0;
      c.kneeL.rotation.x = c.kneeR.rotation.x = 0;
    } else if (this.state === 'cower' || (this.state === 'hide' && this.hidden)) {
      // Crouched down, hands over the head.
      yOff = crouchPose(c, 1);
      c.armL.rotation.x = -2.7;
      c.armR.rotation.x = -2.7;
    }
    if (this.state === 'hoops') yOff = this.hoop.pose(this);
    c.group.position.set(this.x, y + yOff, this.z);
    this.char.group.rotation.y = this.heading;
  }

  // What a civilian does once they've run far enough.
  afterFlee() {
    // A thief (or a buyer who's done) gets off the street.
    if (this.loot || this.served) {
      const door = this.nearestDoor();
      if (door) {
        this.door = door;
        this.state = 'leave';
        this.navFails = 0;
        return;
      }
    }
    const r = Math.random();
    if (r < 0.35) {
      this.state = 'call';
      this.t = rand(4, 6);
      return;
    }
    if (r < 0.65) {
      const door = this.nearestDoor();
      if (door) {
        this.door = door;
        this.state = 'leave';
        this.navFails = 0;
        return;
      }
    }
    this.resumeWalking();
    this.hurryT = 15;
  }

  // A spot against the nearest building wall to walk into.
  nearestDoor() {
    let best = null;
    let bestD = 30;
    for (const b of this.game.city.los) {
      if (b.maxX < this.x - 30 || b.minX > this.x + 30 || b.maxZ < this.z - 30 || b.minZ > this.z + 30) continue;
      const c = closestOnBox(b, this.x, this.z);
      const d = dist(this.x, this.z, c.x, c.z);
      if (d < bestD && d > 0.01) {
        bestD = d;
        best = [c.x + c.nx * 0.6, c.z + c.nz * 0.6];
      }
    }
    return best;
  }

  // At a sidewalk point: on round the block, or (sometimes) across the street.
  arrive() {
    const W = this.game.city.walk;
    const opts = walkNeighbors(W, this.pt).filter((o) => o.p !== this.prev);
    const along = opts.filter((o) => !o.cross);
    const across = opts.filter((o) => o.cross);
    let go = null;
    if (across.length && (Math.random() < 0.25 || !along.length)) go = pick(across);
    else if (along.length) {
      // Keep going the same way round the block.
      const ids = W.blockPts.get(this.pt.b);
      const k = ids.indexOf(this.pt.id);
      const nextId = ids[(k + this.dir + ids.length) % ids.length];
      go = along.find((o) => o.p.id === nextId) || pick(along);
    } else if (opts.length) go = pick(opts);
    else go = walkNeighbors(W, this.pt)[0];
    if (!go) return;
    this.prev = this.pt;
    this.pt = go.p;
    this.cross = go.cross;
    this.block = go.p.b;
  }

  dispose() {
    this.game.scene.remove(this.char.group);
    this.removed = true;
  }
}

export class PedManager {
  constructor(game) {
    this.game = game;
    this.peds = [];
  }

  spawn(minDist) {
    const [px, pz] = this.game.player.pos();
    const rhythm = this.game.rhythm;
    const W = this.game.city.walk;
    for (let tries = 0; tries < 16; tries++) {
      const b = pick(this.game.city.blocks);
      if (!W.blockPts.has(b)) continue;
      const d = dist(b.cx, b.cz, px, pz);
      if (d < minDist || d > Math.max(minDist + 60, 230)) continue; // around you, not across the city
      if (rhythm && !rhythm.accept(b.cx, b.cz, 'p')) continue; // busier blocks get more people
      this.peds.push(new Ped(this.game, b, Math.floor(Math.random() * 20)));
      return;
    }
  }

  init() {
    for (let i = 0; i < this.want(); i++) this.spawn(20);
  }

  // How many people are out near you (time of day and district: see rhythm.js).
  want() {
    return this.game.rhythm ? this.game.rhythm.peds : CFG.PEDS;
  }

  // Add a ped at a spot (e.g. a driver pulled out of a car).
  addAt(x, z) {
    const W = this.game.city.walk;
    const p = new Ped(this.game, W.pts[0].b, 0);
    p.x = x;
    p.z = z;
    p.resumeWalking();
    this.peds.push(p);
    return p;
  }

  update(dt) {
    for (const p of this.peds) p.update(dt);
    // Keep the population steady: drop extras far from the player, refill when low.
    const [px, pz] = this.game.player.pos();
    const want = this.want();
    if (this.peds.length > want) {
      const far = this.peds.find((p) => dist(p.x, p.z, px, pz) > (this.peds.length > want + 10 ? 75 : 120) && p.standing && !p.shopkeeper && p.state !== 'buyer' && !p.loot && !p.keep);
      if (far) far.dispose();
    }
    // Way off across the city: gone (they're replaced around you).
    {
      const far = this.peds.find((p) => dist(p.x, p.z, px, pz) > 300 && !p.shopkeeper && !p.loot && !p.isPlug && !p.keep);
      if (far) far.dispose();
    }
    this.peds = this.peds.filter((p) => !p.removed);
    if (this.peds.length < want) this.spawn(80);
  }
}
