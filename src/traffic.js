import { CFG } from './config.js';
import { Vehicle } from './vehicle.js';
import { steerToward, throttleFor, StuckHelper } from './driving.js';
import { pick, rand, dist } from './util.js';

// An NPC driver that follows lanes and turns randomly at intersections.
export class TrafficDriver {
  constructor(car, from, to) {
    this.car = car;
    this.from = from;
    this.to = to;
    this.next = this.pickNext();
    this.cruise = rand(9, 13);
    this.stuck = new StuckHelper();
    this.active = true;
  }

  pickNext() {
    const opts = this.to.nb.filter((n) => n !== this.from);
    return opts.length ? pick(opts) : this.from;
  }

  update(dt, game) {
    const c = this.car;
    if (dist(c.x, c.z, this.to.x, this.to.z) < 8) {
      this.from = this.to;
      this.to = this.next;
      this.next = this.pickNext();
    }
    const L = dist(this.from.x, this.from.z, this.to.x, this.to.z) || 1;
    const ux = (this.to.x - this.from.x) / L;
    const uz = (this.to.z - this.from.z) / L;
    const off = CFG.LANE;
    const lx0 = this.from.x - uz * off;
    const lz0 = this.from.z + ux * off;
    const along = (c.x - lx0) * ux + (c.z - lz0) * uz;
    const ahead = Math.min(L, along + 10);
    let tx = lx0 + ux * ahead;
    let tz = lz0 + uz * ahead;
    const dn = dist(c.x, c.z, this.to.x, this.to.z);

    let desired = this.cruise;
    if (dn < 20 && this.next) {
      const nl = dist(this.to.x, this.to.z, this.next.x, this.next.z) || 1;
      const nux = (this.next.x - this.to.x) / nl;
      const nuz = (this.next.z - this.to.z) / nl;
      tx = this.to.x - nuz * off + nux * 6;
      tz = this.to.z + nux * off + nuz * 6;
      const straight = nux * ux + nuz * uz > 0.9;
      if (!straight) desired = Math.min(desired, 6.5);
    }

    // Slow down or stop for cars and people ahead.
    const [fx, fz] = c.forward();
    for (const o of game.vehicles) {
      if (o === c) continue;
      const ox = o.x - c.x;
      const oz = o.z - c.z;
      if (Math.abs(ox) > 15 || Math.abs(oz) > 15) continue;
      const fwd = ox * fx + oz * fz;
      const lat = Math.abs(ox * fz - oz * fx);
      if (fwd > 0 && fwd < 15 && lat < 2.6) desired = Math.min(desired, Math.max(0, (fwd - 6.5) * 1.3));
    }
    for (const w of game.walkers) {
      const ox = w.x - c.x;
      const oz = w.z - c.z;
      if (Math.abs(ox) > 10 || Math.abs(oz) > 10) continue;
      const fwd = ox * fx + oz * fz;
      const lat = Math.abs(ox * fz - oz * fx);
      if (fwd > 0 && fwd < 9 && lat < 1.8) desired = 0;
    }

    const ctrl = { throttle: throttleFor(c, desired), steer: steerToward(c, tx, tz), handbrake: desired === 0 };
    this.stuck.apply(dt, c, desired, ctrl);
    c.update(dt, ctrl, game.city.colliders);
  }
}

const TYPE_WEIGHTS = ['sedan', 'sedan', 'sedan', 'sedan', 'sports', 'van', 'van'];

export class TrafficManager {
  constructor(game) {
    this.game = game;
    this.drivers = [];
  }

  spawn(minDist) {
    const { city, player } = this.game;
    const [px, pz] = player.pos();
    for (let tries = 0; tries < 20; tries++) {
      const from = pick(city.nodes);
      if (dist(from.x, from.z, px, pz) < minDist) continue;
      const to = pick(from.nb);
      const L = dist(from.x, from.z, to.x, to.z);
      const ux = (to.x - from.x) / L;
      const uz = (to.z - from.z) / L;
      const x = from.x + ux * 14 - uz * CFG.LANE;
      const z = from.z + uz * 14 + ux * CFG.LANE;
      if (this.game.vehicles.some((v) => dist(v.x, v.z, x, z) < 7)) continue;
      const car = new Vehicle(this.game.scene, pick(TYPE_WEIGHTS), x, z, Math.atan2(ux, uz));
      car.speed = 6;
      const d = new TrafficDriver(car, from, to);
      car.driver = d;
      this.drivers.push(d);
      this.game.vehicles.push(car);
      return;
    }
  }

  init() {
    for (let i = 0; i < CFG.TRAFFIC_CARS; i++) this.spawn(30);
  }

  update(dt) {
    for (const d of this.drivers) if (d.active) d.update(dt, this.game);
    this.drivers = this.drivers.filter((d) => d.active && !d.car.removed);
    if (this.drivers.length < CFG.TRAFFIC_CARS) this.spawn(110);
  }
}
