import { CFG } from './config.js';
import { Vehicle } from './vehicle.js';
import { steerToward, throttleFor, StuckHelper } from './driving.js';
import { pick, rand, dist } from './util.js';

// An NPC driver that follows lanes and turns randomly at intersections.
let nextId = 1;
export class TrafficDriver {
  constructor(car, from, to) {
    this.id = nextId++;
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

  // Drive a set route (points along the streets) and stop at the end, e.g. a buyer pulling
  // up next to you. release() puts the car back into normal traffic.
  driveTo(route) {
    this.route = route;
    this.rk = 1;
  }

  release(game) {
    const c = this.car;
    this.route = null;
    this.stopAt = null;
    const n = game.city.nearestNode(c.x, c.z);
    const [fx, fz] = c.forward();
    const ahead = [...n.nb].sort((p, q) => ((q.x - n.x) * fx + (q.z - n.z) * fz) - ((p.x - n.x) * fx + (p.z - n.z) * fz))[0];
    const behind = (p) => (p.x - c.x) * fx + (p.z - c.z) * fz < 0;
    this.from = behind(n) ? n : ahead.nb.find((m) => m !== n && behind(m)) || n;
    this.to = behind(n) ? ahead : n;
    this.next = this.pickNext();
  }

  followRoute(dt, game) {
    const c = this.car;
    const pts = this.route;
    const off = CFG.LANE;
    const aim = (k) => {
      if (k === pts.length - 1) return pts[k]; // the stop itself (already at the curb)
      const [ax, az] = pts[k - 1];
      const [bx, bz] = pts[k];
      const L = dist(ax, az, bx, bz) || 1;
      return [bx - ((bz - az) / L) * off, bz + ((bx - ax) / L) * off];
    };
    while (this.rk < pts.length - 1 && dist(c.x, c.z, ...aim(this.rk)) < 7) this.rk++;
    const [tx, tz] = aim(this.rk);
    const [ex, ez] = pts[pts.length - 1];
    const dEnd = dist(c.x, c.z, ex, ez);
    let desired = this.rk < pts.length - 2 && dist(c.x, c.z, tx, tz) < 16 ? 6.5 : 11;
    if (this.rk >= pts.length - 2) desired = Math.min(desired, Math.max(0, (dEnd - 1.5) * 0.7));
    if (this.hurry) {
      // Backup on the way: flat out, braking only as hard as it takes to make the next turn,
      // then a hard stop right where it's going.
      const dTurn = this.rk < pts.length - 1 ? dist(c.x, c.z, tx, tz) : Infinity;
      desired = Math.min(c.type.max * 0.95, Math.sqrt(11 * 11 + 2 * 14 * Math.max(0, dTurn - 6)), Math.sqrt(2 * 16 * Math.max(0, dEnd - 2.5)));
      if (dEnd < 3) desired = 0;
    }
    desired = this.yieldTo(game, desired);
    const ctrl = { throttle: throttleFor(c, desired), steer: dEnd < 3 ? 0 : steerToward(c, tx, tz), handbrake: desired === 0 || (this.hurry && dEnd < 12 && Math.abs(c.speed) > desired + 2) };
    this.stuck.apply(dt, c, desired, ctrl);
    c.update(dt, ctrl, game.city.colliders);
  }

  // Stuck behind a stopped car (a parked car in the lane, a wreck, a jam): pass it, or turn back.
  unjam(dt, game, ux, uz, dn) {
    const c = this.car;
    const b = this.blockedBy;
    this.passCooldown = Math.max(0, (this.passCooldown || 0) - dt);
    if (this.passing) {
      this.passT -= dt;
      const p = this.passCar;
      // Something coming the other way (or stopped) in the lane we're borrowing: if we're
      // not alongside yet, give it up and tuck back in behind.
      const L0 = CFG.LANE;
      const pfwd = p && !p.removed ? (p.x - c.x) * ux + (p.z - c.z) * uz : -99;
      // Measured from our own lane's center line: the other lane is around -2 lanes over.
      const lx = this.from.x - uz * L0;
      const lz = this.from.z + ux * L0;
      const oncoming = game.vehicles.some((o) => {
        if (o === c || o === p || o.removed) return false;
        const fwd = (o.x - c.x) * ux + (o.z - c.z) * uz;
        const side = (o.x - lx) * -uz + (o.z - lz) * ux;
        return fwd > 0 && fwd < 26 && side < -L0 * 1.1 && side > -L0 * 3.2;
      });
      if (oncoming && pfwd > 2) {
        this.passing = false;
        this.passCar = null;
        this.jamT = 0;
        this.passCooldown = 4;
        return;
      }
      // Right on its bumper with no room to swing out: back up a few meters first.
      this.closeT = this.tooClose && Math.abs(c.speed) < 0.5 ? (this.closeT || 0) + dt : 0;
      if (this.closeT > 0.8) {
        this.closeT = 0;
        this.backT = 1.3;
        this.backKeepPass = true;
        return;
      }
      const behind = !p || p.removed || pfwd < -6;
      if (behind || this.passT <= 0 || dn < 14) {
        this.passing = false;
        this.passCar = null;
      }
      return;
    }
    if (b && Math.abs(c.speed) < 1.5 && Math.abs(b.speed) < 1) this.jamT = (this.jamT || 0) + dt;
    else this.jamT = 0;
    // Spot the stopped car early (while there's still room to pull out), or once stuck.
    const s = this.stoppedAhead;
    const early = s && s.fwd > 9;
    if ((early || this.jamT > 1.2) && dn > 30 && this.passCooldown <= 0) {
      const blocker = early ? s.v : b;
      // Other lane clear for the next 30 m? (oncoming traffic, or anything parked there)
      const L = CFG.LANE;
      const clear = !game.vehicles.some((o) => {
        if (o === c || o === blocker || o.removed) return false;
        const fwd = (o.x - c.x) * ux + (o.z - c.z) * uz;
        const side = (o.x - c.x) * -uz + (o.z - c.z) * ux; // + is our lane's side
        return fwd > -4 && fwd < 32 && side < -L * 0.4 && side > -L * 3.2;
      });
      if (clear) {
        this.passing = true;
        this.passCar = blocker;
        this.passT = 6;
        this.jamT = 0;
        return;
      }
    }
    if (this.jamT > 5) {
      // Can't get around it: turn back and take another way.
      [this.from, this.to] = [this.to, this.from];
      this.next = this.pickNext();
      this.jamT = 0;
    }
  }

  // Nose to nose with a car that's waiting on us: whoever's in the wrong lane (or, if
  // neither, one of them) backs off so the other can go.
  standoff(dt) {
    const c = this.car;
    const b = this.blockedBy;
    if (!b || Math.abs(c.speed) > 1 || Math.abs(b.speed) > 1) {
      this.faceT = 0;
      return;
    }
    const [fx, fz] = c.forward();
    const [bx, bz] = b.forward();
    if (fx * bx + fz * bz > -0.3) {
      this.faceT = 0;
      return; // not facing each other
    }
    this.faceT = (this.faceT || 0) + dt;
    if (this.faceT < 1.5) return;
    const other = b.driver && b.driver.id ? b.driver : null;
    const meWrong = !!this.passing;
    const himWrong = !!(other && other.passing);
    if (meWrong || (!himWrong && (!other || this.id < other.id))) {
      this.backT = 2;
      this.faceT = 0;
    }
  }

  // Slow down or stop for cars and people ahead. Remembers what made it stop (blockedBy).
  yieldTo(game, desired) {
    const c = this.car;
    const [fx, fz] = c.forward();
    this.blockedBy = null;
    this.stoppedAhead = null;
    this.tooClose = false;
    let worst = desired;
    for (const o of game.vehicles) {
      if (o === c) continue;
      const ox = o.x - c.x;
      const oz = o.z - c.z;
      if (Math.abs(ox) > 26 || Math.abs(oz) > 26) continue;
      const fwd = ox * fx + oz * fz;
      const lat = Math.abs(ox * fz - oz * fx);
      // A stopped car in our lane up ahead (so we can pull out early).
      if (fwd > 0 && fwd < 25 && lat < 2.6 && Math.abs(o.speed) < 1 && (!this.stoppedAhead || fwd < this.stoppedAhead.fwd)) this.stoppedAhead = { v: o, fwd };
      if (this.passing && o === this.passCar) {
        // Going around it: keep clear of its back end until we're out beside it.
        if (fwd > -5 && fwd < 15 && lat < 2.1) {
          worst = Math.min(worst, fwd > 7.5 ? 5 : fwd > 5.6 ? 1.2 : 0);
          if (fwd > 0 && fwd <= 5.6) this.tooClose = true;
        }
        continue;
      }
      if (Math.abs(ox) > 15 || Math.abs(oz) > 15) continue;
      if (fwd > 0 && fwd < 15 && lat < 2.6) {
        const v = Math.max(0, (fwd - 6.5) * 1.3);
        if (v < worst) {
          worst = v;
          this.blockedBy = o;
        }
      }
    }
    desired = worst;
    for (const w of game.walkers) {
      const ox = w.x - c.x;
      const oz = w.z - c.z;
      if (Math.abs(ox) > 10 || Math.abs(oz) > 10) continue;
      const fwd = ox * fx + oz * fz;
      const lat = Math.abs(ox * fz - oz * fx);
      if (fwd > 0 && fwd < 9 && lat < 1.8) desired = 0;
    }
    return desired;
  }

  update(dt, game) {
    const c = this.car;
    // Backing off out of a standoff.
    if (this.backT > 0) {
      this.backT -= dt;
      c.update(dt, { throttle: -0.7, steer: 0, handbrake: false }, game.city.colliders);
      if (this.backT <= 0 && !this.backKeepPass) {
        this.passing = false;
        this.passCar = null;
        this.jamT = 2; // and if it's still blocked, think about turning around
      }
      if (this.backT <= 0) this.backKeepPass = false;
      return;
    }
    // Stuck for good somewhere you can't see: tow it away (traffic respawns elsewhere).
    this.stillT = Math.abs(c.speed) < 0.4 && !this.stopAt ? (this.stillT || 0) + dt : 0;
    if (this.stillT > 12 && game.player.vehicle !== c) {
      const [px, pz] = game.player.pos();
      if (dist(c.x, c.z, px, pz) > 70) {
        c.dispose();
        this.active = false;
        return;
      }
    }
    if (this.route) return this.followRoute(dt, game);
    if (dist(c.x, c.z, this.to.x, this.to.z) < 8) {
      this.from = this.to;
      this.to = this.next;
      this.next = this.pickNext();
    }
    const L = dist(this.from.x, this.from.z, this.to.x, this.to.z) || 1;
    const ux = (this.to.x - this.from.x) / L;
    const uz = (this.to.z - this.from.z) / L;
    const dn0 = dist(c.x, c.z, this.to.x, this.to.z);
    // Jammed behind a stopped car: pass it in the other lane when that's clear, or turn
    // around and take another way if it stays stuck.
    this.unjam(dt, game, ux, uz, dn0);
    const off = this.passing ? -CFG.LANE : CFG.LANE;
    const lx0 = this.from.x - uz * off;
    const lz0 = this.from.z + ux * off;
    const along = (c.x - lx0) * ux + (c.z - lz0) * uz;
    const ahead = Math.min(L, along + (this.passing ? 7 : 10)); // pull out sharper when passing
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

    desired = this.yieldTo(game, desired);
    this.standoff(dt);

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
      const dd = dist(from.x, from.z, px, pz);
      if (dd < minDist || dd > Math.max(minDist + 60, 280)) continue; // around you, not across the city
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
    // Cars far away from you (and not on an errand) go; new ones turn up nearer.
    const [px, pz] = this.game.player.pos();
    for (const d of this.drivers) {
      const c = d.car;
      if (d.active && !d.route && !d.stopAt && c.driver === d && this.game.player.vehicle !== c && dist(c.x, c.z, px, pz) > 380) {
        c.dispose();
        d.active = false;
      }
    }
    this.drivers = this.drivers.filter((d) => d.active && !d.car.removed);
    if (this.drivers.length < CFG.TRAFFIC_CARS) this.spawn(110);
  }
}
