import { CFG } from './config.js';
import { Vehicle } from './vehicle.js';
import { makeCharacter, animateWalk, setDown, SKIN_TONES } from './character.js';
import { pushCircle, segmentBlocked } from './collision.js';
import { steerToward, throttleFor, StuckHelper } from './driving.js';
import { dist, pick, rand, lerpAngle } from './util.js';
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
    // Swing the door open on the way out.
    if (this.game.lethal) c.openDoor(side);
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
    } else if (this.state === 'chase') {
      const d = dist(this.x, this.z, px, pz);
      const pv = game.player.vehicle;
      const giveUpRange = game.lethal ? 32 : 12;
      if (game.stars === 0 || this.unit.leaving || game.wastedT > 0 || (pv && Math.abs(pv.speed) > 6 && d > giveUpRange) || d > 50) {
        this.state = 'return';
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
      if (game.stars > 0 && !this.unit.leaving && game.wastedT <= 0 && dist(this.x, this.z, px, pz) < 30 && (!game.player.vehicle || game.lethal)) {
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
    // Gun up in a gunfight.
    if (game.lethal && this.state === 'chase') {
      this.char.armR.rotation.x = -1.45;
      this.char.armL.rotation.x = -1.2;
    }
    this.place();
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
      const seesPlayer = d < 45 && !segmentBlocked(c.x, c.z, px, pz, game.city.los);
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

  // Wanted level cleared: units drive off and despawn.
  standDown() {
    for (const u of this.units) u.leaving = true;
  }

  clearAll() {
    for (const u of this.units) u.dispose();
    this.units = [];
  }

  update(dt) {
    const game = this.game;
    const want = CFG.UNITS_PER_STAR[game.stars];
    const active = this.units.filter((u) => !u.leaving && !u.carLost && !u.allDead);
    // Dispatch: a short delay after the first call, then one unit every few seconds.
    if (want === 0) this.spawnT = 3;
    this.spawnT -= dt;
    if (active.length < want && this.spawnT <= 0 && game.wastedT <= 0) {
      if (this.spawnUnit()) this.spawnT = 4;
    }
    for (const u of this.units) u.update(dt);

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
