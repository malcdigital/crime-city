import { CFG } from './config.js';
import { Vehicle } from './vehicle.js';
import { steerToward, throttleFor, StuckHelper } from './driving.js';
import { pick, rand, dist } from './util.js';
import { districtAt } from './districts.js';

// How far right of the road's middle to drive from node a to node b: the lane for that
// road (freeway lanes and ramps are their own center lines: 0; so are ramp connectors).
export function laneOff(a, b) {
  if (!a || !b || a.high || b.high) return 0;
  const e = a.edgeTo?.get(b);
  if (!e) return CFG.LANE;
  if (e.street?.stub !== undefined) return 0;
  return e.lane;
}

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
    // A bus follows its route.
    if (this.loop) {
      const k = this.loop.indexOf(this.to);
      return this.loop[(k + 1) % this.loop.length];
    }
    // Any way but back (and no U-turns where a ramp joins the highway).
    const ix = this.to.x - this.from.x;
    const iz = this.to.z - this.from.z;
    const il = Math.hypot(ix, iz) || 1;
    const opts = this.to.nb.filter((n) => n !== this.from && ((n.x - this.to.x) * ix + (n.z - this.to.z) * iz) / il > -0.5 * dist(n.x, n.z, this.to.x, this.to.z));
    if (opts.length) return pick(opts);
    const any = this.to.nb.filter((n) => n !== this.from);
    return any.length ? pick(any) : this.from;
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
    const off = this.routeLane ?? CFG.LANE;
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

  // Traffic lights and stop signs at the intersection ahead (streets.js). Red: stop at the line.
  // Yellow: stop if there's room, otherwise go through. Stop sign: come to a full stop at the
  // line, then go in the order cars arrived, once the intersection is clear.
  obey(game, desired, ux, uz, dn, dt) {
    const out = this.obeyRules(game, desired, ux, uz, dn, dt);
    this.atLine = out < desired;
    return out;
  }

  obeyRules(game, desired, ux, uz, dn, dt) {
    const S = game.streets;
    if (!S || this.hurry || this.passing) return desired;
    const n = this.to;
    const ctl = S.control.get(n);
    if (!ctl || ctl.type === 'none' || dn > 45) return desired;
    if (!S.mustStop(n, this.from)) return desired; // the main road: through
    const c = this.car;
    const toLine = dn - S.stopDist(n, this.from) - Math.max(0, c.halfLen - 2.2); // long vehicles stop by the front bumper
    const v = Math.abs(c.speed);
    const stopSpeed = Math.sqrt(2 * 4.5 * Math.max(0, toLine - 0.6));
    const axis = S.axisOf(n, ux, uz);
    if (ctl.type === 'signal') {
      if (toLine < 0) return desired; // already past the line
      const ph = S.phase(n, axis);
      if (ph === 'green') return desired;
      if (ph === 'yellow' && toLine < (v * v) / (2 * 6) + 1) return desired; // too close to stop
      return Math.min(desired, stopSpeed < 0.6 ? 0 : stopSpeed);
    }
    // All-way stop.
    if (this.servedNode === n) return desired;
    if (toLine < -1) {
      this.servedNode = n; // (came on past the line, e.g. just spawned)
      return desired;
    }
    const q = (S.queue ||= new Map());
    if (!q.has(n)) q.set(n, []);
    const line = q.get(n);
    if (v < 0.5 && toLine < 3) {
      if (!line.includes(this)) line.push(this);
      this.stopWait = (this.stopWait || 0) + dt;
      // First in line (or waited a while), and nobody in the middle of the intersection.
      for (let i = line.length - 1; i >= 0; i--) if (!line[i].active || line[i].car.removed || line[i].to !== n) line.splice(i, 1);
      const first = line[0] === this || this.stopWait > 4;
      const r = Math.max(6, ...ctl.arms.map((a) => a.stopAt - 3));
      const clear = !game.vehicles.some((o) => o !== c && !o.removed && !o.high && Math.hypot(o.x - n.x, o.z - n.z) < r);
      if (this.stopWait > 0.9 && first && clear) {
        this.servedNode = n;
        this.stopWait = 0;
        line.splice(line.indexOf(this), 1);
        return desired;
      }
      return 0;
    }
    return Math.min(desired, stopSpeed < 0.6 ? 0 : stopSpeed);
  }

  // A planned stop partway down this street: a bus at its stop, or a delivery truck
  // double-parked with its hazards on. halt = { from, to, x, z, wait, hazard }.
  haltAt(dt, desired, ux, uz) {
    const h = this.halt;
    if (!h) return desired;
    const c = this.car;
    if (h.from !== this.from || h.to !== this.to || this.passing) {
      this.halt = null;
      c.hazard = false;
      return desired;
    }
    const s = (h.x - c.x) * ux + (h.z - c.z) * uz;
    if (s < -4) {
      this.halt = null;
      c.hazard = false;
      return desired;
    }
    if (s > 1) return Math.min(desired, Math.sqrt(2 * 2.2 * Math.max(0, s - 0.8)));
    if (Math.abs(c.speed) < 0.6) {
      h.wait -= dt;
      c.hazard = !!h.hazard;
      if (h.onStop && !h.stopped) {
        h.stopped = true;
        h.onStop();
      }
    }
    if (h.wait <= 0) {
      this.halt = null;
      c.hazard = false;
      return desired;
    }
    return 0;
  }

  // Stuck behind a stopped car (a parked car in the lane, a wreck, a jam): pass it, or turn back.
  unjam(dt, game, ux, uz, dn) {
    // No passing or turning round on the freeway or its ramps (one way: on the freeway you
    // change lanes instead): just wait.
    if ((this.from.high || this.to.high) && !this.passing) return;
    const c = this.car;
    const b = this.blockedBy;
    this.passCooldown = Math.max(0, (this.passCooldown || 0) - dt);
    if (this.passing) {
      this.passT -= dt;
      const p = this.passCar;
      // Something coming the other way (or stopped) in the lane we're borrowing: if we're
      // not alongside yet, give it up and tuck back in behind.
      const L0 = laneOff(this.from, this.to) || CFG.LANE;
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
      const L = laneOff(this.from, this.to) || CFG.LANE;
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
      if (!!o.high !== !!c.high) continue; // one on the highway, one underneath
      // Cars parked at the curb are beside the lane, not in it.
      if (o.parkSpot && lat > 1.7) continue;
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
      if (!!w.high !== !!c.high) continue;
      const ox = w.x - c.x;
      const oz = w.z - c.z;
      if (Math.abs(ox) > 10 || Math.abs(oz) > 10) continue;
      const fwd = ox * fx + oz * fz;
      const lat = Math.abs(ox * fz - oz * fx);
      // (Someone on the sidewalk, e.g. waiting at the curb to cross, isn't in the way.)
      if (fwd > 0 && fwd < 9 && lat < 1.8 && !game.city.blockAt(w.x, w.z)) desired = 0;
    }
    return desired;
  }

  update(dt, game) {
    const c = this.car;
    // Told to wait here (a hailed taxi, a bus at the curb): brake and stay put.
    if (this.hold && this.holdUntil && game.time > this.holdUntil) {
      this.hold = false;
      this.holdUntil = 0;
      this.stopAt = null;
    }
    if (this.hold) {
      c.update(dt, { throttle: throttleFor(c, 0), steer: 0, handbrake: true }, game.city.colliders);
      return;
    }
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
    // (Waiting at a red light or a stop sign isn't being stuck.)
    this.stillT = Math.abs(c.speed) < 0.4 && !this.stopAt && !this.halt && !this.atLine ? (this.stillT || 0) + dt : 0;
    if (this.stillT > 30 && game.player.vehicle !== c) {
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
      if (this.onSegment) this.onSegment(this);
    }
    const L = dist(this.from.x, this.from.z, this.to.x, this.to.z) || 1;
    const ux = (this.to.x - this.from.x) / L;
    const uz = (this.to.z - this.from.z) / L;
    const dn0 = dist(c.x, c.z, this.to.x, this.to.z);
    // Jammed behind a stopped car: pass it in the other lane when that's clear, or turn
    // around and take another way if it stays stuck.
    this.unjam(dt, game, ux, uz, dn0);
    // One-way ramps: drive down the middle.
    const oneWay = this.from.ramp || this.to.ramp;
    const lane = laneOff(this.from, this.to);
    const off = this.passing ? -lane : lane;
    const lx0 = this.from.x - uz * off;
    const lz0 = this.from.z + ux * off;
    const along = (c.x - lx0) * ux + (c.z - lz0) * uz;
    const ahead = Math.min(L, along + (oneWay ? 4 : this.passing ? 7 : 10)); // pull out sharper when passing; tight on ramps
    let tx = lx0 + ux * ahead;
    let tz = lz0 + uz * ahead;
    const dn = dist(c.x, c.z, this.to.x, this.to.z);

    let desired = this.cruise;
    if (this.from.high && this.to.high && !oneWay) desired = this.cruise * 2.4; // freeway speed (about 55-65 mph)
    if (oneWay) {
      // Ramps: as quick as the curve ahead allows (about 4.5 m/s² sideways), up to freeway speed.
      desired = this.cruise * 2.1;
      const bend = (a, b, c) => {
        if (!a || !b || !c) return Infinity;
        const l1 = dist(a.x, a.z, b.x, b.z) || 1;
        const l2 = dist(b.x, b.z, c.x, c.z) || 1;
        const cs = ((b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z)) / (l1 * l2);
        const th = Math.acos(Math.max(-1, Math.min(1, cs)));
        return th < 0.01 ? Infinity : ((l1 + l2) / 2) / th;
      };
      const R = Math.min(bend(this.from, this.to, this.next), bend(this.to, this.next, this.next?.nb?.[0]));
      desired = Math.min(desired, Math.sqrt(4.5 * R));
    }
    if (dn < (oneWay ? 6 : 20) && this.next) {
      const nl = dist(this.to.x, this.to.z, this.next.x, this.next.z) || 1;
      const nux = (this.next.x - this.to.x) / nl;
      const nuz = (this.next.z - this.to.z) / nl;
      const look = oneWay ? 3 : 6;
      const noff = this.passing ? -laneOff(this.to, this.next) : laneOff(this.to, this.next);
      tx = this.to.x - nuz * noff + nux * look;
      tz = this.to.z + nux * noff + nuz * look;
      const straight = nux * ux + nuz * uz > 0.9;
      if (!straight) desired = Math.min(desired, oneWay ? 8.5 : 6.5);
    }

    desired = this.haltAt(dt, desired, ux, uz);
    desired = this.obey(game, desired, ux, uz, dn, dt);
    desired = this.yieldTo(game, desired);
    this.standoff(dt);

    const ctrl = { throttle: throttleFor(c, desired), steer: steerToward(c, tx, tz), handbrake: desired === 0 };
    this.stuck.apply(dt, c, desired, ctrl);
    c.update(dt, ctrl, game.city.colliders);
  }
}

// What's on the road depends on where and when: taxis Downtown and on the Strip, box trucks
// at the Docks and in working hours, sports cars in the Heights and on the Strip at night.
const BUSY = ['Downtown', 'Financial District', 'Government District', 'Midtown', 'The Strip'];
export function pickCarType(x, z, h) {
  const d = districtAt(x, z);
  const work = h >= 7 && h < 19;
  const w = { sedan: 4, sports: 0.8, van: 1.2, taxi: 0.5, delivery: work ? 0.6 : 0.1 };
  if (BUSY.includes(d)) w.taxi = 1.8;
  if (d === 'The Strip' && !work) {
    w.taxi = 2.6;
    w.sports = 1.8;
  }
  if (d === 'Financial District' && work) w.delivery = 1.1;
  if (d === 'The Docks') {
    w.delivery = work ? 2.6 : 0.4;
    w.van = 2;
    w.taxi = 0.15;
  }
  if (d === 'The Heights') {
    w.sports = 1.8;
    w.taxi = 0.4;
  }
  if (d === 'The Projects') {
    w.taxi = 0.3;
    w.sports = 0.5;
  }
  let r = Math.random() * Object.values(w).reduce((a, b) => a + b, 0);
  for (const [k, v] of Object.entries(w)) {
    r -= v;
    if (r <= 0) return k;
  }
  return 'sedan';
}

// Delivery trucks sometimes double-park partway down a block to drop off (hazards on).
function deliveryStops(d) {
  if (d.car.typeName !== 'delivery' || Math.random() > 0.3) return;
  const L = dist(d.from.x, d.from.z, d.to.x, d.to.z) || 1;
  const ux = (d.to.x - d.from.x) / L;
  const uz = (d.to.z - d.from.z) / L;
  const k = L * rand(0.4, 0.62);
  const off = laneOff(d.from, d.to);
  if (!off) return;
  d.halt = { from: d.from, to: d.to, x: d.from.x + ux * k - uz * off, z: d.from.z + uz * k + ux * off, wait: rand(9, 16), hazard: true };
}

export class TrafficManager {
  constructor(game) {
    this.game = game;
    this.drivers = [];
  }

  spawn(minDist) {
    const { city, player } = this.game;
    const [px, pz] = player.pos();
    const rhythm = this.game.rhythm;
    // About one new car in four goes on the highway (when there's highway near you).
    const hw = this.game.highway;
    if (hw && Math.random() < 0.25) {
      const near = hw.nodes.filter((n) => {
        const dd = dist(n.x, n.z, px, pz);
        return !n.ramp && dd > minDist && dd < Math.max(minDist + 60, 280) && n.nb.some((m) => m.high && !m.ramp);
      });
      if (near.length) {
        const from = pick(near);
        const to = from.nb.find((m) => m.high && !m.ramp && m.laneRef === from.laneRef) || pick(from.nb.filter((m) => m.high));
        const L = dist(from.x, from.z, to.x, to.z) || 1;
        const ux = (to.x - from.x) / L;
        const uz = (to.z - from.z) / L;
        const x = from.x + ux * Math.min(10, L / 2);
        const z = from.z + uz * Math.min(10, L / 2);
        if (!this.game.vehicles.some((v) => v.high && dist(v.x, v.z, x, z) < 9)) {
          const car = new Vehicle(this.game.scene, pickCarType(x, z, rhythm ? rhythm.hour() : 12), x, z, Math.atan2(ux, uz));
          car.high = true;
          car.y = from.hy ?? 7.5;
          car.speed = 14;
          const d = new TrafficDriver(car, from, to);
          car.driver = d;
          this.drivers.push(d);
          this.game.vehicles.push(car);
          return;
        }
      }
    }
    for (let tries = 0; tries < 30; tries++) {
      const from = pick(city.nodes);
      const dd = dist(from.x, from.z, px, pz);
      if (dd < minDist || dd > Math.max(minDist + 60, 280)) continue; // around you, not across the city
      if (rhythm && !rhythm.accept(from.x, from.z, 't')) continue; // busier streets get more cars
      const opts = from.nb.filter((m) => m.street && !m.rampEnd);
      if (!opts.length) continue;
      const to = pick(opts);
      const e = from.edgeTo?.get(to);
      if (!e || e.cls === 'pier') continue;
      const L = dist(from.x, from.z, to.x, to.z);
      if (L < 20) continue;
      const ux = (to.x - from.x) / L;
      const uz = (to.z - from.z) / L;
      const off = laneOff(from, to);
      const x = from.x + ux * 14 - uz * off;
      const z = from.z + uz * 14 + ux * off;
      if (this.game.vehicles.some((v) => dist(v.x, v.z, x, z) < 7)) continue;
      const car = new Vehicle(this.game.scene, pickCarType(x, z, this.game.rhythm ? this.game.rhythm.hour() : 12), x, z, Math.atan2(ux, uz));
      car.speed = 6;
      const d = new TrafficDriver(car, from, to);
      car.driver = d;
      if (car.typeName === 'delivery') {
        d.onSegment = deliveryStops;
        d.cruise = rand(8, 11);
      }
      this.drivers.push(d);
      this.game.vehicles.push(car);
      return;
    }
  }

  init() {
    const n = this.game.rhythm ? this.game.rhythm.traffic : CFG.TRAFFIC_CARS;
    for (let i = 0; i < n; i++) this.spawn(30);
  }

  // Ordinary traffic (not buses, backup, buyers pulling up, etc.).
  regular(d) {
    return !d.bus && !d.route && !d.stopAt && !d.hurry && d.car.driver === d;
  }

  update(dt) {
    for (const d of this.drivers) if (d.active) d.update(dt, this.game);
    // Cars far away from you (and not on an errand) go; new ones turn up nearer.
    const [px, pz] = this.game.player.pos();
    for (const d of this.drivers) {
      const c = d.car;
      if (d.active && !d.bus && !d.route && !d.stopAt && c.driver === d && this.game.player.vehicle !== c && dist(c.x, c.z, px, pz) > 380) {
        c.dispose();
        d.active = false;
      }
    }
    this.drivers = this.drivers.filter((d) => d.active && !d.car.removed);
    // How many cars are out depends on the time of day and the part of town (rhythm.js).
    const want = this.game.rhythm ? this.game.rhythm.traffic : CFG.TRAFFIC_CARS;
    const regular = this.drivers.filter((d) => this.regular(d));
    if (regular.length < want) this.spawn(110);
    else if (regular.length > want + 2) {
      // Thin out: one car at a time, somewhere out in the fog.
      const far = regular.find((d) => this.game.player.vehicle !== d.car && dist(d.car.x, d.car.z, px, pz) > 170);
      if (far) {
        far.car.dispose();
        far.active = false;
      }
    }
  }
}
