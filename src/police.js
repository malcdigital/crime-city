import { CFG } from './config.js';
import { Vehicle } from './vehicle.js';
import { makeCharacter, animateWalk, setDown, SKIN_TONES } from './character.js';
import { pushCircle, segmentBlocked } from './collision.js';
import { steerToward, throttleFor, StuckHelper } from './driving.js';
import { dist, pick, rand, lerpAngle } from './util.js';
import { navStep } from './nav.js';

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
        // Gunfight: target you or your crew, hold a firing distance and shoot on a clear line.
        const tgt = game.pickTarget(this, game.playerFaction(), 50) || { x: px, z: pz, ref: 'player' };
        const td = dist(this.x, this.z, tgt.x, tgt.z);
        const los = td < 45 && !segmentBlocked(this.x, this.z, tgt.x, tgt.z, game.city.los);
        if (!los || td > 16) {
          tx = tgt.x;
          tz = tgt.z;
          speed = CFG.OFFICER_SPEED;
        } else if (td < 7) {
          tx = this.x * 2 - tgt.x;
          tz = this.z * 2 - tgt.z;
          speed = 2.5;
        }
        face = Math.atan2(tgt.x - this.x, tgt.z - this.z);
        if (los) {
          this.fireT -= dt;
          if (this.fireT <= 0) {
            this.fireT = rand(0.8, 1.4);
            game.npcShootAt(this, tgt.ref, 8, 'pistol');
          }
        }
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
    // Gun arm raised in a gunfight.
    if (game.lethal && this.state === 'chase') this.char.armR.rotation.x = -1.45;
    this.place();
  }

  place() {
    const y = this.game.city.groundY(this.x, this.z);
    this.char.group.position.set(this.x, this.standing ? y : y + 0.2, this.z);
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
