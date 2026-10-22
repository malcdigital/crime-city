import { CFG } from './config.js';
import { Vehicle } from './vehicle.js';
import { makeCharacter, animateWalk, setDown, SKIN_TONES } from './character.js';
import { pushCircle, segmentBlocked } from './collision.js';
import { steerToward, throttleFor, StuckHelper } from './driving.js';
import { dist, pick, rand, lerpAngle } from './util.js';

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
    this.state = 'inCar'; // inCar | chase | return | down
    this.t = 0;
    this.phase = 0;
    this.isCop = true;
  }

  get standing() {
    return this.state === 'chase' || this.state === 'return';
  }

  dismount(side) {
    const c = this.unit.car;
    const [fx, fz] = c.forward();
    this.x = c.x - fz * side * 1.8;
    this.z = c.z + fx * side * 1.8;
    this.state = 'chase';
    this.char.group.visible = true;
  }

  knockDown(fromX, fromZ, fling = 0) {
    if (this.state === 'inCar' || this.state === 'down') return;
    this.state = 'down';
    this.t = rand(3.5, 5);
    if (fling) {
      const d = dist(this.x, this.z, fromX, fromZ) || 1;
      this.x += ((this.x - fromX) / d) * fling;
      this.z += ((this.z - fromZ) / d) * fling;
    }
    setDown(this.char, true);
  }

  update(dt) {
    if (this.state === 'inCar') return;
    const game = this.game;
    const [px, pz] = game.player.pos();
    let tx = this.x;
    let tz = this.z;
    let speed = 0;

    if (this.state === 'down') {
      this.t -= dt;
      if (this.t <= 0) {
        setDown(this.char, false);
        this.state = 'chase';
      }
    } else if (this.state === 'chase') {
      const d = dist(this.x, this.z, px, pz);
      const pv = game.player.vehicle;
      if (game.stars === 0 || this.unit.leaving || (pv && Math.abs(pv.speed) > 6 && d > 12) || d > 45) {
        this.state = 'return';
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
      const stolen = c.driver !== this.unit;
      tx = c.x;
      tz = c.z;
      speed = stolen ? 0 : CFG.OFFICER_SPEED;
      if (!stolen && dist(this.x, this.z, c.x, c.z) < 2.6) {
        this.state = 'inCar';
        this.char.group.visible = false;
        return;
      }
      if (game.stars > 0 && !this.unit.leaving && !game.player.vehicle && dist(this.x, this.z, px, pz) < 30) this.state = 'chase';
    }

    if (speed > 0) {
      const d = dist(this.x, this.z, tx, tz);
      if (d > 0.1) {
        const ux = (tx - this.x) / d;
        const uz = (tz - this.z) / d;
        this.heading = lerpAngle(this.heading, Math.atan2(ux, uz), Math.min(1, dt * 10));
        this.x += ux * speed * dt;
        this.z += uz * speed * dt;
      }
      const r = pushCircle(this.x, this.z, 0.4, game.city.colliders);
      this.x = r.x;
      this.z = r.z;
    }
    this.phase += dt * speed * 3.2;
    animateWalk(this.char, this.phase, Math.min(1, speed / 2));
    const y = game.city.groundY(this.x, this.z);
    this.char.group.position.set(this.x, this.state === 'down' ? y + 0.2 : y, this.z);
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

  get mounted() {
    return this.officers.every((o) => o.state === 'inCar');
  }

  update(dt) {
    const game = this.game;
    const c = this.car;
    if (c.driver !== this) {
      // The player stole this car. Officers on foot keep chasing; the unit is done driving.
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
    if (this.leaving) {
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
        if (!game.player.vehicle && d < 14) {
          desired = 0;
          if (Math.abs(c.speed) < 4) {
            this.officers.forEach((o, k) => o.dismount(k === 0 ? -1 : 1));
          }
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

  // Follow the road grid toward (or away from) the player.
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

  spawnUnit() {
    const { city } = this.game;
    const [px, pz] = this.game.lastKnown || this.game.player.pos();
    const candidates = city.nodes.filter((n) => {
      const d = dist(n.x, n.z, px, pz);
      return d > 90 && d < 170;
    });
    if (!candidates.length) return;
    const n = pick(candidates);
    const toward = n.nb.slice().sort((a, b) => dist(a.x, a.z, px, pz) - dist(b.x, b.z, px, pz))[0];
    const heading = Math.atan2(toward.x - n.x, toward.z - n.z);
    if (this.game.vehicles.some((v) => dist(v.x, v.z, n.x, n.z) < 6)) return;
    const u = new PoliceUnit(this.game, n.x, n.z, heading);
    u.from = n;
    u.to = toward;
    this.units.push(u);
    this.game.vehicles.push(u.car);
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
    const active = this.units.filter((u) => !u.leaving && u.car.driver === u);
    this.spawnT -= dt;
    if (active.length < want && this.spawnT <= 0) {
      this.spawnUnit();
      this.spawnT = 2.5;
    }
    for (const u of this.units) u.update(dt);

    const [px, pz] = game.player.pos();
    for (const u of this.units) {
      const d = dist(u.car.x, u.car.z, px, pz);
      const stolen = u.car.driver !== u;
      const officersHome = u.officers.every((o) => o.state === 'inCar');
      if (u.leaving && officersHome && (d > 90 || u.leaveT > 30)) u.dispose();
      else if (!u.leaving && !stolen && officersHome && d > 230) u.dispose();
      else if (stolen && game.stars === 0 && u.officers.every((o) => dist(o.x, o.z, px, pz) > 60 || o.state === 'inCar')) {
        for (const o of u.officers) o.dispose();
        u.removed = true;
      }
    }
    this.units = this.units.filter((u) => !u.removed);
  }
}
