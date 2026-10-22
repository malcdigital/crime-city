import * as THREE from 'three';
import { CFG } from './config.js';
import { Vehicle } from './vehicle.js';
import { makeCharacter, animateWalk, setDown, SKIN_TONES } from './character.js';
import { pushCircle, segmentBlocked } from './collision.js';
import { steerToward, throttleFor, StuckHelper } from './driving.js';
import { dist, pick, rand, lerpAngle } from './util.js';
import { streetAt } from './city.js';
import { navStep } from './nav.js';
import { findCover } from './gang.js';

// A police officer on foot. Rides hidden inside the unit's car until it dismounts.
export class Officer {
  constructor(game, unit) {
    this.game = game;
    this.unit = unit;
    this.char = makeCharacter({ shirt: 0x1f3a6e, pants: 0x14213d, skin: pick(SKIN_TONES), cap: 0x14213d });
    this.char.group.visible = false;
    game.scene.add(this.char.group);
    this.x = unit.car.x;
    this.z = unit.car.z;
    this.heading = 0;
    this.state = 'inCar'; // inCar | chase | return | down | dead
    this.t = 0;
    this.phase = 0;
    this.health = 100;
    this.fireT = rand(0.5, 1.2);
    this.isCop = true;
    // Most cops fight from cover; a few push forward and flank.
    this.flanker = Math.random() < 0.15;
    this.crouched = false;
    this.spot = null;
    this.peeking = false;
    this.coverT = 0;
    this.peekShots = 0;
    this.recheckT = 0;
    this.blindT = 0;
    this.advanceT = 0;
  }

  get standing() {
    return this.state === 'chase' || this.state === 'return';
  }

  get alive() {
    return this.state !== 'dead';
  }

  get visibleOnStreet() {
    return this.state !== 'inCar';
  }

  dismount(side) {
    if (this.state !== 'inCar') return;
    const c = this.unit.car;
    const [fx, fz] = c.forward();
    this.x = c.x - fz * side * 1.8;
    this.z = c.z + fx * side * 1.8;
    this.state = 'chase';
    this.char.group.visible = true;
    // Swing the door open on the way out (it stays open in a gunfight).
    c.openDoor(side, this.game.lethal ? 0 : 1.2);
  }

  knockDown(fromX, fromZ, fling = 0) {
    if (!this.standing) return;
    this.state = 'down';
    this.t = rand(3.5, 5);
    if (fling) {
      const d = dist(this.x, this.z, fromX, fromZ) || 1;
      this.x += ((this.x - fromX) / d) * fling;
      this.z += ((this.z - fromZ) / d) * fling;
    }
    setDown(this.char, true);
  }

  takeHit(dmg) {
    if (this.state === 'dead' || this.state === 'inCar') return false;
    this.health -= dmg;
    if (this.health <= 0) {
      this.state = 'dead';
      this.crouched = false;
      setDown(this.char, true);
      return true;
    }
    return false;
  }

  update(dt) {
    if (this.state === 'inCar' || this.state === 'dead') {
      if (this.state === 'dead') this.place();
      return;
    }
    const game = this.game;
    const [px, pz] = game.player.pos();
    let tx = this.x;
    let tz = this.z;
    let speed = 0;
    let face = null;

    if (this.state !== 'chase') this.crouched = false;
    if (this.state === 'down') {
      this.t -= dt;
      if (this.t <= 0) {
        setDown(this.char, false);
        this.state = 'chase';
      }
    } else if (this.state === 'chase' && this.unit.roadblock && game.stars > 0 && !this.unit.leaving && game.wastedT <= 0) {
      // Manning a roadblock.
      const d = dist(this.x, this.z, px, pz);
      const pv = game.player.vehicle;
      if (game.lethal && d < 55) {
        const r = this.combat(dt, px, pz);
        tx = r.tx;
        tz = r.tz;
        speed = r.speed;
        face = r.face;
      } else if (d < (pv ? 6 : 30)) {
        // You stopped at (or got out by) the roadblock: they come for you.
        tx = px;
        tz = pz;
        speed = CFG.OFFICER_SPEED;
        if (d < (pv ? 2.8 : 1.4) && (!pv || Math.abs(pv.speed) < 2)) {
          speed = 0;
          game.arrestPressure(dt);
        }
      } else {
        // Wait behind the cruiser, watching the road.
        this.recheckT -= dt;
        if (this.recheckT <= 0 || !this.spot) {
          this.recheckT = 1;
          this.spot = this.carCover(this.unit.car, { x: px, z: pz });
        }
        if (this.spot && dist(this.x, this.z, this.spot.x, this.spot.z) > 0.6) {
          tx = this.spot.x;
          tz = this.spot.z;
          speed = 3.5;
        }
        face = Math.atan2(px - this.x, pz - this.z);
        // You're driving at the roadblock: stand up and shoot out your tires.
        this.aimingTires = false;
        if (pv && d < 55 && Math.abs(pv.speed) > 2 && pv.flatCount < 4 && !segmentBlocked(this.x, this.z, px, pz, game.city.los)) {
          this.aimingTires = true;
          this.fireT -= dt;
          if (this.fireT <= 0) {
            this.fireT = rand(0.45, 0.9);
            game.shootTire(this, pv);
          }
        }
      }
    } else if (this.state === 'chase') {
      const d = dist(this.x, this.z, px, pz);
      const pv = game.player.vehicle;
      const giveUpRange = game.lethal ? 32 : 12;
      // Does the force know where you are right now (someone has eyes on you)?
      const since = game.time - game.lastSeen;
      const knows = since < 2.5;
      if (knows) this.searchGoal = null;
      if (game.stars === 0 || this.unit.leaving || game.wastedT > 0) {
        this.state = 'return';
      } else if (knows && ((pv && Math.abs(pv.speed) > 6 && d > giveUpRange) || d > 50)) {
        this.state = 'return';
      } else if (!knows) {
        // Lost sight of you: comb the area instead of standing around.
        if (since > 25 + game.stars * 5 || pv) this.state = 'return';
        else {
          const r = this.search(dt);
          tx = r.tx;
          tz = r.tz;
          speed = r.speed;
          face = r.face;
        }
      } else if (game.lethal) {
        const r = this.combat(dt, px, pz);
        tx = r.tx;
        tz = r.tz;
        speed = r.speed;
        face = r.face;
      } else {
        tx = px;
        tz = pz;
        speed = CFG.OFFICER_SPEED + game.stars * 0.15;
        // Arrest when close: on foot, or pull the player out of a stopped car.
        const reach = pv ? 2.8 : 1.4;
        if (d < reach && (!pv || Math.abs(pv.speed) < 2)) {
          speed = 0;
          game.arrestPressure(dt);
        }
      }
    } else if (this.state === 'return') {
      const c = this.unit.car;
      const carGone = this.unit.carLost;
      tx = c.x;
      tz = c.z;
      speed = carGone ? 0 : CFG.OFFICER_SPEED;
      if (!carGone && dist(this.x, this.z, c.x, c.z) < 2.6) {
        this.state = 'inCar';
        this.char.group.visible = false;
        return;
      }
      if (game.stars > 0 && !this.unit.leaving && game.wastedT <= 0 && game.time - game.lastSeen < 2.5 && dist(this.x, this.z, px, pz) < 30 && (!game.player.vehicle || game.lethal)) {
        this.state = 'chase';
      }
    }

    if (speed > 0) {
      const h = navStep(this, tx, tz, speed, dt, game, 0.4);
      if (face === null && h !== null) face = h;
    }
    if (face !== null) this.heading = lerpAngle(this.heading, face, Math.min(1, dt * 10));
    this.phase += dt * speed * 3.2;
    animateWalk(this.char, this.phase, Math.min(1, speed / 2));
    if (this.crouched) {
      // Kneeling behind the car.
      this.char.legL.rotation.x = -1.4;
      this.char.legR.rotation.x = -0.2;
    }
    // Gun up in a gunfight, or when shooting at tires.
    if ((game.lethal || this.aimingTires) && this.state === 'chase') {
      this.char.armR.rotation.x = -1.45;
      this.char.armL.rotation.x = -1.2;
    }
    this.place();
  }

  // Searching on foot: check the places you could be hiding (behind crates, parked cars,
  // around corners), nearest to where you were last seen first. Officers split up the spots.
  search(dt) {
    const game = this.game;
    const pol = game.police;
    const out = { tx: this.x, tz: this.z, speed: 0, face: null };
    const [px, pz] = game.player.pos();
    // Footsteps: running nearby gives you away (crouch-walking doesn't).
    const p = game.player;
    if (!p.vehicle && !p.crouched && p.speed > 4 && dist(this.x, this.z, px, pz) < 16) {
      game.lastKnown = [px, pz];
      this.searchGoal = { x: px, z: pz, look: 0 };
      pol.searched = [];
    }
    this.searchLook = (this.searchLook || 0) - dt;
    if (this.searchLook > 0) {
      // Checking a spot: sweep the eyes around.
      out.face = this.heading + dt * 2.2;
      return out;
    }
    if (!this.searchGoal) this.searchGoal = pol.pickSearchSpot(this);
    const g = this.searchGoal;
    if (!g) return out;
    out.tx = g.x;
    out.tz = g.z;
    out.speed = 3.8;
    this.searchFail = (this.searchFail || 0) + dt;
    if (dist(this.x, this.z, g.x, g.z) < 1.2 || this.searchFail > 9 || this.navFails >= 3) {
      pol.searched.push({ x: g.x, z: g.z, t: game.time });
      this.searchGoal = null;
      this.searchFail = 0;
      this.navFails = 0;
      this.searchLook = rand(0.8, 1.6);
    }
    return out;
  }

  // Where to take cover behind our own cruiser, given where the shooter is.
  carCover(c, tgt) {
    const [fx, fz] = c.forward();
    const rx = -fz;
    const rz = fx;
    const d = dist(c.x, c.z, tgt.x, tgt.z) || 1;
    const ux = (tgt.x - c.x) / d;
    const uz = (tgt.z - c.z) / d;
    const along = ux * fx + uz * fz;
    const lat = ux * rx + uz * rz;
    const k = this.unit.officers.indexOf(this);
    let spot;
    if (along > 0.5) {
      // Shooter ahead: crouch behind your open door, lean out past it to fire.
      const side = k === 0 ? -1 : 1;
      c.openDoor(side);
      const x = c.x + rx * side * 1.75 - fx * 0.7;
      const z = c.z + rz * side * 1.75 - fz * 0.7;
      spot = { x, z, peekX: x + rx * side * 0.7, peekZ: z + rz * side * 0.7, kind: 'door' };
    } else if (along < -0.5) {
      // Shooter behind: use the engine block at the front.
      const o = k === 0 ? -0.7 : 0.7;
      const x = c.x + fx * 3.1 + rx * o;
      const z = c.z + fz * 3.1 + rz * o;
      spot = { x, z, peekX: x, peekZ: z, kind: 'hood' };
    } else {
      // Shooter off to the side: get down on the far side of the car.
      const away = lat > 0 ? -1 : 1;
      const o = k === 0 ? 1.0 : -1.0;
      const x = c.x + rx * away * 2.2 + fx * o;
      const z = c.z + rz * away * 2.2 + fz * o;
      spot = { x, z, peekX: x, peekZ: z, kind: 'body' };
    }
    // Don't pick a spot inside a wall.
    const r = pushCircle(spot.x, spot.z, 0.45, this.game.city.colliders);
    if (Math.hypot(r.x - spot.x, r.z - spot.z) > 0.2) return null;
    return spot;
  }

  // One frame of a gunfight. Returns where to move and which way to face.
  combat(dt, px, pz) {
    const game = this.game;
    const tgt = game.pickTarget(this, game.playerFaction(), 55) || { x: px, z: pz, ref: 'player' };
    const td = dist(this.x, this.z, tgt.x, tgt.z);
    const los = td < 45 && !segmentBlocked(this.x, this.z, tgt.x, tgt.z, game.city.los);
    const face = Math.atan2(tgt.x - this.x, tgt.z - this.z);
    const out = { tx: this.x, tz: this.z, speed: 0, face };
    let canShoot = false;
    let rate = [0.8, 1.4];
    this.crouched = false;

    // Pick (or refresh) a cover spot about once a second.
    this.recheckT -= dt;
    this.advanceT -= dt;
    if (this.recheckT <= 0) {
      this.recheckT = 0.8;
      const c = this.unit.car;
      const carUsable = !this.unit.carLost && !c.exploded && !c.wrecked && Math.abs(c.speed) < 1.5
        && dist(this.x, this.z, c.x, c.z) < 18 && dist(c.x, c.z, tgt.x, tgt.z) < 45;
      let spot = carUsable ? this.carCover(c, tgt) : null;
      if (!spot) {
        const cover = findCover(game, this, tgt);
        spot = cover ? { x: cover.x, z: cover.z, peekX: cover.peekX, peekZ: cover.peekZ, kind: 'other' } : null;
      }
      if (!spot || !this.spot || dist(spot.x, spot.z, this.spot.x, this.spot.z) > 0.8) this.peeking = false;
      this.spot = spot;
    }

    if (this.flanker || !this.spot || this.advanceT > 0) {
      // Push in: close to firing range in the open.
      if (!los || td > 16) {
        out.tx = tgt.x;
        out.tz = tgt.z;
        out.speed = CFG.OFFICER_SPEED;
        out.face = null;
      } else if (td < 7) {
        out.tx = this.x * 2 - tgt.x;
        out.tz = this.z * 2 - tgt.z;
        out.speed = 2.5;
      }
      canShoot = los;
    } else {
      const s = this.spot;
      const atSpot = dist(this.x, this.z, s.x, s.z) < 1.1 || (this.peeking && dist(this.x, this.z, s.peekX, s.peekZ) < 1.1);
      if (!atSpot && !this.peeking) {
        // Run to cover.
        out.tx = s.x;
        out.tz = s.z;
        out.speed = CFG.OFFICER_SPEED;
        out.face = null;
      } else if (!this.peeking) {
        // Down behind cover.
        this.crouched = true;
        this.coverT -= dt;
        if (dist(this.x, this.z, s.x, s.z) > 0.4) {
          out.tx = s.x;
          out.tz = s.z;
          out.speed = 1.5;
        }
        if (this.coverT <= 0) {
          this.peeking = true;
          this.peekShots = 2 + Math.floor(Math.random() * 2);
          this.coverT = 2.5;
        }
      } else {
        // Pop up (or lean out past the door) and fire a few rounds.
        this.coverT -= dt;
        if (dist(this.x, this.z, s.peekX, s.peekZ) > 0.4) {
          out.tx = s.peekX;
          out.tz = s.peekZ;
          out.speed = 2;
        } else canShoot = los;
        rate = [0.45, 0.75];
        if (this.peekShots <= 0 || this.coverT <= 0) {
          this.peeking = false;
          this.coverT = rand(1.0, 2.0);
        }
      }
      // Can't see anyone from here for a while: move up.
      this.blindT = los ? 0 : this.blindT + dt;
      if (this.blindT > 4) {
        this.blindT = 0;
        this.advanceT = 3;
      }
    }

    if (canShoot) {
      this.fireT -= dt;
      if (this.fireT <= 0) {
        this.fireT = rand(rate[0], rate[1]);
        this.peekShots--;
        game.npcShootAt(this, tgt.ref, 8, 'pistol');
      }
    }
    return out;
  }

  place() {
    const y = this.game.city.groundY(this.x, this.z);
    this.char.group.position.set(this.x, !this.standing ? y + 0.2 : this.crouched ? y - 0.45 : y, this.z);
    this.char.group.rotation.y = this.heading;
  }

  dispose() {
    this.game.scene.remove(this.char.group);
  }
}

// A police cruiser with two officers.
export class PoliceUnit {
  constructor(game, x, z, heading) {
    this.game = game;
    this.car = new Vehicle(game.scene, 'police', x, z, heading);
    this.car.driver = this;
    this.car.siren = true;
    this.officers = [new Officer(game, this), new Officer(game, this)];
    this.to = null;
    this.from = null;
    this.stuck = new StuckHelper();
    this.leaving = false;
    this.leaveT = 0;
    this.removed = false;
  }

  // The car was stolen or destroyed: officers continue on foot.
  get carLost() {
    return this.car.driver !== this || this.car.wrecked || this.car.removed;
  }

  get mounted() {
    return this.officers.every((o) => o.state === 'inCar' || o.state === 'dead');
  }

  get allDead() {
    return this.officers.every((o) => o.state === 'dead');
  }

  update(dt) {
    const game = this.game;
    const c = this.car;
    if (this.carLost || this.allDead) {
      if (c.driver === this) {
        c.driver = null;
        c.siren = false;
      }
      for (const o of this.officers) {
        if (o.state === 'inCar') o.dismount(1);
        o.update(dt);
      }
      return;
    }
    for (const o of this.officers) o.update(dt);
    const [px, pz] = game.player.pos();
    const d = dist(c.x, c.z, px, pz);

    if (!this.mounted) {
      c.update(dt, { throttle: throttleFor(c, 0), steer: 0, handbrake: true }, game.city.colliders);
      return;
    }
    c.closeDoors();

    let tx, tz, desired;
    const maxS = c.type.max * (0.6 + game.stars * 0.08);
    if (this.leaving || game.wastedT > 0) {
      this.leaveT += dt;
      c.siren = false;
      this.navigate(px, pz, true);
      tx = this.to.x;
      tz = this.to.z;
      desired = 12;
    } else {
      c.siren = true;
      const seesPlayer = d < 45 && game.spots(c, 1.4, 60, false);
      if (seesPlayer) {
        const [vx, vz] = game.player.velocity();
        tx = px + vx * 0.6;
        tz = pz + vz * 0.6;
        desired = Math.min(maxS, 6 + d * 0.9);
        const stopRange = game.lethal ? 22 : 14;
        if ((!game.player.vehicle || game.lethal) && d < stopRange) {
          desired = 0;
          if (Math.abs(c.speed) < 4) this.officers.forEach((o, k) => o.dismount(k === 0 ? -1 : 1));
        }
        this.to = null;
      } else {
        // Out of sight: search around where the player was last seen.
        const [kx, kz] = game.lastKnown || [px, pz];
        this.navigate(kx, kz, false);
        tx = this.to.x;
        tz = this.to.z;
        desired = maxS * 0.85;
        if (dist(c.x, c.z, tx, tz) < 22) desired = Math.min(desired, 12);
        // Close to where you vanished on foot: pull over and search on foot.
        const since = game.time - game.lastSeen;
        this.searchCd = (this.searchCd || 0) - dt;
        if (!game.player.vehicle && since > 1.5 && since < 20 + game.stars * 5 && this.searchCd <= 0 && dist(c.x, c.z, kx, kz) < 32) {
          this.stopping = true;
          this.searchCd = 20;
        }
        if (this.stopping) {
          desired = 0;
          if (Math.abs(c.speed) < 3) {
            this.officers.forEach((o, k) => o.dismount(k === 0 ? -1 : 1));
            this.stopping = false;
          }
        }
      }
    }
    // Don't plow into cars ahead (especially other cruisers parked at the scene) or officers on foot.
    const [fx, fz] = c.forward();
    for (const o of game.vehicles) {
      if (o === c || o.removed) continue;
      const ox = o.x - c.x;
      const oz = o.z - c.z;
      if (Math.abs(ox) > 18 || Math.abs(oz) > 18) continue;
      const fwd = ox * fx + oz * fz;
      const lat = Math.abs(ox * fz - oz * fx);
      if (fwd > 0 && fwd < 18 && lat < 3) desired = Math.min(desired, Math.max(0, (fwd - 7) * 1.2));
    }
    for (const o of game.police.officers()) {
      if (!o.standing) continue;
      const ox = o.x - c.x;
      const oz = o.z - c.z;
      const fwd = ox * fx + oz * fz;
      if (fwd > 0 && fwd < 12 && Math.abs(ox * fz - oz * fx) < 2) desired = 0;
    }
    // Held up behind another car near a gunfight: bail out and go in on foot.
    const heldUp = desired < 1 && !this.leaving && game.lethal && d < 55;
    this.heldT = heldUp ? (this.heldT || 0) + dt : 0;
    if (this.heldT > 1.5 && Math.abs(c.speed) < 3) {
      this.officers.forEach((o, k) => o.dismount(k === 0 ? -1 : 1));
      this.heldT = 0;
    }
    const ctrl = { throttle: throttleFor(c, desired), steer: steerToward(c, tx, tz), handbrake: desired === 0 };
    this.stuck.apply(dt, c, desired, ctrl);
    c.update(dt, ctrl, game.city.colliders);
  }

  // Follow the road grid toward (or away from) a point.
  navigate(px, pz, away) {
    const city = this.game.city;
    const c = this.car;
    if (!this.to) {
      this.to = city.nearestNode(c.x, c.z);
      this.from = null;
    }
    if (dist(c.x, c.z, this.to.x, this.to.z) < 10) {
      const options = this.to.nb.filter((n) => n !== this.from);
      const score = (n) => dist(n.x, n.z, px, pz) * (away ? -1 : 1) + Math.random() * 15;
      options.sort((a, b) => score(a) - score(b));
      this.from = this.to;
      this.to = options[0] || this.from;
    }
  }

  dispose() {
    for (const o of this.officers) o.dispose();
    if (this.car.driver === this) this.car.dispose();
    this.removed = true;
  }
}

export class PoliceManager {
  constructor(game) {
    this.game = game;
    this.units = [];
    this.spawnT = 0;
    this.searched = []; // spots already checked: {x, z, t}
    this.spikes = [];
  }

  // Places worth checking for a hidden suspect near (kx, kz).
  searchSpots(kx, kz, r) {
    const game = this.game;
    const out = [{ x: kx, z: kz, r: 0 }];
    for (const b of game.city.crates) {
      if (dist(b.x, b.z, kx, kz) < r) out.push({ x: b.x, z: b.z, r: Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 });
    }
    for (const v of game.vehicles) {
      if (v.removed || v.exploded || v.siren || Math.abs(v.speed) > 1) continue;
      if (dist(v.x, v.z, kx, kz) < r) out.push({ x: v.x, z: v.z, r: 2.4 });
    }
    for (const b of game.city.los) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = (sx < 0 ? b.minX : b.maxX) + sx * 1.6;
        const z = (sz < 0 ? b.minZ : b.maxZ) + sz * 1.6;
        if (dist(x, z, kx, kz) < r) out.push({ x, z, r: 0 });
      }
    }
    return out;
  }

  // The best unchecked spot for this officer: close to him, close to where you were last seen,
  // and not one a partner is already heading to. Cops also follow their instincts a bit.
  pickSearchSpot(o) {
    const game = this.game;
    const [kx, kz] = game.lastKnown || [o.x, o.z];
    const [px, pz] = game.player.pos();
    this.searched = this.searched.filter((s) => game.time - s.t < 40);
    const taken = this.officers().filter((q) => q !== o && q.searchGoal).map((q) => q.searchGoal);
    let best = null;
    let bestScore = Infinity;
    for (const s of this.searchSpots(kx, kz, game.searchRadius)) {
      // Stand on the far side of the object, where someone would be hiding from us.
      let x = s.x;
      let z = s.z;
      if (s.r > 0) {
        const d = dist(o.x, o.z, s.x, s.z) || 1;
        x += ((s.x - o.x) / d) * (s.r + 1.2);
        z += ((s.z - o.z) / d) * (s.r + 1.2);
      }
      const fix = pushCircle(x, z, 0.45, game.city.colliders);
      x = fix.x;
      z = fix.z;
      if (this.searched.some((q) => dist(q.x, q.z, x, z) < 3.5)) continue;
      if (taken.some((q) => dist(q.x, q.z, x, z) < 3.5)) continue;
      const score = dist(o.x, o.z, x, z) * 0.6 + dist(x, z, kx, kz) + dist(x, z, px, pz) * 0.35 + Math.random() * 4;
      if (score < bestScore) {
        bestScore = score;
        best = { x, z };
      }
    }
    if (best) return best;
    // Checked everything: widen the sweep at random.
    const a = Math.random() * Math.PI * 2;
    const rr = game.searchRadius * rand(0.4, 1);
    return { x: kx + Math.cos(a) * rr, z: kz + Math.sin(a) * rr };
  }

  // A spike strip across the road (5 stars). Pops any tire that rolls over it.
  laySpikes(cx, cz, lx, lz) {
    const len = 12;
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.5), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    base.position.y = 0.04;
    g.add(base);
    const spikeGeo = new THREE.ConeGeometry(0.06, 0.18, 4);
    const spikeMat = new THREE.MeshLambertMaterial({ color: 0xb8b8b8 });
    const spikes = new THREE.InstancedMesh(spikeGeo, spikeMat, 48);
    const m = new THREE.Object3D();
    for (let k = 0; k < 48; k++) {
      m.position.set(-len / 2 + 0.15 + (k >> 1) * (len - 0.3) / 23, 0.15, k & 1 ? 0.12 : -0.12);
      m.updateMatrix();
      spikes.setMatrixAt(k, m.matrix);
    }
    g.add(spikes);
    g.position.set(cx, 0, cz);
    g.rotation.y = lx ? 0 : Math.PI / 2; // long side across the road
    this.game.scene.add(g);
    const hx = lx ? len / 2 : 0.35;
    const hz = lx ? 0.35 : len / 2;
    const strip = { x: cx, z: cz, minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz, mesh: g, t: 90 };
    this.spikes.push(strip);
    return strip;
  }

  updateSpikes(dt) {
    const game = this.game;
    const blocking = this.units.some((u) => u.roadblock);
    for (const s of this.spikes) {
      s.t -= dt;
      if (s.t <= 0 || (!blocking && s.t < 85)) {
        game.scene.remove(s.mesh);
        s.gone = true;
        continue;
      }
      for (const v of game.vehicles) {
        if (v.removed || v.siren || Math.abs(v.speed) < 1 || dist(v.x, v.z, s.x, s.z) > 10) continue;
        let popped = 0;
        v.wheels.forEach((w, i) => {
          const [wx, , wz] = v.wheelPos(i);
          if (wx > s.minX - 0.2 && wx < s.maxX + 0.2 && wz > s.minZ - 0.2 && wz < s.maxZ + 0.2 && v.popTire(i)) popped++;
        });
        if (popped) {
          game.effects.smoke(v.x, 0.5, v.z);
          if (v.driver === 'player') game.hud.toast('Spike strip!', '#ff8080');
        }
      }
    }
    this.spikes = this.spikes.filter((s) => !s.gone);
  }

  officers() {
    return this.units.flatMap((u) => u.officers);
  }

  // New units roll out of the police station yard, so response time depends on how far away you are.
  spawnUnit() {
    const { city } = this.game;
    const st = city.station;
    const spots = [[st.x - 6, st.z], [st.x + 6, st.z], [st.x, st.z + 5]];
    const spot = spots.find(([x, z]) => !this.game.vehicles.some((v) => !v.removed && dist(v.x, v.z, x, z) < 5));
    if (!spot) return false;
    const u = new PoliceUnit(this.game, spot[0], spot[1], st.heading);
    this.units.push(u);
    this.game.vehicles.push(u.car);
    return true;
  }

  // Park two cruisers across the road ahead of where you're driving.
  trySpawnRoadblock() {
    const game = this.game;
    const v = game.player.vehicle;
    if (!v) return false;
    const [fx, fz] = v.forward();
    const sgn = v.speed >= 0 ? 1 : -1;
    let best = null;
    let bestScore = Infinity;
    for (const n of game.city.nodes) {
      const dx = n.x - v.x;
      const dz = n.z - v.z;
      const d = Math.hypot(dx, dz);
      if (d < 110 || d > 220) continue;
      const cos = ((dx * fx + dz * fz) * sgn) / d;
      if (cos < 0.9) continue;
      const score = Math.abs(d - 150) - cos * 20;
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    if (!best) return false;
    // Block the road you'll arrive on, just before the intersection.
    const dx = best.x - v.x;
    const dz = best.z - v.z;
    const alongX = Math.abs(dx) > Math.abs(dz);
    const ax = alongX ? Math.sign(dx) : 0;
    const az = alongX ? 0 : Math.sign(dz);
    if (!best.nb.some((m) => Math.sign(m.x - best.x) === -ax && Math.sign(m.z - best.z) === -az)) return false;
    const cx = best.x - ax * 14;
    const cz = best.z - az * 14;
    if (game.vehicles.some((o) => !o.removed && dist(o.x, o.z, cx, cz) < 7)) return false;
    // Cars point across the road, side by side.
    const lx = alongX ? 0 : 1;
    const lz = alongX ? 1 : 0;
    const heading = alongX ? 0 : Math.PI / 2;
    for (const off of [-2.5, 2.5]) {
      const u = new PoliceUnit(game, cx + lx * off, cz + lz * off, heading + (off > 0 ? Math.PI : 0));
      u.roadblock = true;
      u.car.heavy = true;
      u.car.speed = 0;
      this.units.push(u);
      game.vehicles.push(u.car);
      // Officers get out on the side away from you.
      const [cfx, cfz] = u.car.forward();
      const side = -cfz * ax + cfx * az > 0 ? 1 : -1;
      for (const o of u.officers) o.dismount(side);
    }
    // At 5 stars, a spike strip goes down across the road in front of the block.
    if (game.stars >= 5) {
      this.laySpikes(cx - ax * 12, cz - az * 12, lx, lz);
      game.hud.news(`Police lay spike strips on ${streetAt(cx, cz)}`);
    } else game.hud.news(`Police roadblock on ${streetAt(cx, cz)}`);
    return true;
  }

  // Wanted level cleared: units drive off and despawn.
  standDown() {
    for (const u of this.units) u.leaving = true;
  }

  clearAll() {
    for (const u of this.units) u.dispose();
    this.units = [];
    for (const s of this.spikes) this.game.scene.remove(s.mesh);
    this.spikes = [];
    this.searched = [];
  }

  update(dt) {
    const game = this.game;
    const want = CFG.UNITS_PER_STAR[game.stars];
    const active = this.units.filter((u) => !u.leaving && !u.carLost && !u.allDead && !u.roadblock);
    // Roadblocks when you're fleeing by car at 2+ stars.
    this.blockT = (this.blockT ?? 8) - dt;
    const pv = game.player.vehicle;
    const blocks = this.units.filter((u) => u.roadblock).length / 2;
    if (game.stars >= 2 && pv && Math.abs(pv.speed) > 6 && this.blockT <= 0 && blocks < (game.stars >= 4 ? 2 : 1) && game.wastedT <= 0) {
      this.blockT = this.trySpawnRoadblock() ? 20 : 3;
    }
    // Once you're well past (or clear of the law), the roadblock packs up and joins the chase.
    for (const u of this.units) {
      if (!u.roadblock) continue;
      const [ppx, ppz] = game.player.pos();
      if (game.stars === 0 || dist(u.car.x, u.car.z, ppx, ppz) > 170) {
        u.roadblock = false;
        u.car.heavy = false;
      }
    }
    // Dispatch: a short delay after the first call, then one unit every few seconds.
    if (want === 0) this.spawnT = 3;
    this.spawnT -= dt;
    if (active.length < want && this.spawnT <= 0 && game.wastedT <= 0) {
      if (this.spawnUnit()) this.spawnT = 4;
    }
    for (const u of this.units) u.update(dt);
    this.updateSpikes(dt);
    // Fresh sighting: the old search grid no longer means anything.
    if (game.time - game.lastSeen < 0.5) this.searched = [];

    const [px, pz] = game.player.pos();
    for (const u of this.units) {
      const d = dist(u.car.x, u.car.z, px, pz);
      const officersHome = u.officers.every((o) => o.state === 'inCar');
      const onFoot = u.carLost || u.allDead;
      if (onFoot) {
        const allFar = u.officers.every((o) => dist(o.x, o.z, px, pz) > 70 || o.state === 'dead' || o.state === 'inCar');
        if ((game.stars === 0 && allFar) || (u.allDead && allFar)) {
          for (const o of u.officers) o.dispose();
          u.removed = true;
        }
      } else if (u.leaving && officersHome && (d > 90 || u.leaveT > 30)) u.dispose();
    }
    this.units = this.units.filter((u) => !u.removed);
  }
}
