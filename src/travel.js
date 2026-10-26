import { CFG } from './config.js';
import { Vehicle } from './vehicle.js';
import { TrafficDriver, laneOff } from './traffic.js';
import { streetAt, districtAt } from './city.js';
import { DISTRICTS, districtCenter } from './districts.js';
import { closestOnSeg } from './geom.js';
import { dist } from './util.js';

// Getting around by taxi and bus (fast travel).
// - Taxi: walk up to a taxi on the street and hail it (USE / E). Pick your map waypoint or a
//   place from the list. $20 to get in plus $1 per block (bank first, then cash).
// - Bus: at any bus stop, take the bus to any other stop (either route), from a list or by
//   picking it on the map. $5 flat, no wait.
// - Nobody gives you a ride while you're wanted.
// The trip is a quick cinematic cut: you get in, the screen fades, and you're dropped off at
// the curb. The clock moves on by however long the drive would have taken.
const BLOCK = 80; // a "block" of taxi fare, in meters of driving
const trip = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az) * 1.3; // about how far by road
const TAXI_BASE = 20;
const TAXI_PER_BLOCK = 1;
const BUS_FARE = 5;
const TAXI_SPEED = 12; // m/s, for how much time passes
const BUS_SPEED = 8;
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const REFUSE = ['nah, not wit all them cops on you', 'you hot right now. find another ride', 'i aint tryna get pulled over. get out my face'];

export class Travel {
  constructor(game) {
    this.game = game;
    this.ride = null; // the cut scene in progress
    this.hailed = null;
    this.el = document.createElement('div');
    this.el.id = 'ride';
    this.el.className = 'hidden';
    this.el.innerHTML = '<div class="rb top"></div><div class="rb bottom"></div><div class="rfade"></div><div class="rcard"><div class="rk"></div><div class="rt"></div><div class="rs"></div></div>';
    document.body.appendChild(this.el);
  }

  get active() {
    return !!this.ride;
  }

  // ---- Prompts on foot: hail a taxi, or take the bus at a stop ----
  interact(a) {
    const game = this.game;
    const p = game.player;
    if (p.vehicle || this.ride || game.wastedT > 0 || game.bustedT > 0) return false;
    const press = a.interactHeld && !game.interactWasHeld;
    const key = game.input.label('interact');
    // A bus stop.
    const stop = game.transit?.stops.find((s) => dist(p.x, p.z, s.wx, s.wz) < 4.5 || dist(p.x, p.z, s.sx, s.sz) < 3.5);
    if (stop) {
      game.prompt = `Press ${key} to take the bus (${money(BUS_FARE)}, any stop)`;
      if (press) {
        if (this.refuse('bus')) return true;
        this.busMenu(stop);
      }
      return true;
    }
    // A taxi going by (or stopped) close to you.
    const taxi = game.vehicles.find((v) => v.typeName === 'taxi' && !v.removed && !v.wrecked && v.driver && v.driver !== 'player' && v.driver.car === v && !v.parkSpot
      && dist(p.x, p.z, v.x, v.z) < 11);
    if (taxi) {
      game.prompt = `Press ${key} to hail the taxi`;
      if (press) {
        if (this.refuse('taxi')) return true;
        this.hail(taxi);
      }
      return true;
    }
    return false;
  }

  refuse(kind) {
    const game = this.game;
    if (game.stars === 0) return false;
    game.hud.toast(kind === 'bus' ? 'The bus driver shuts the door on you' : `Taxi: "${REFUSE[Math.floor(Math.random() * REFUSE.length)]}"`, '#ff8080');
    return true;
  }

  // ---- Taxi ----
  hail(car) {
    const game = this.game;
    const d = car.driver;
    // It pulls over and waits while you pick where to go.
    d.stopAt = [car.x, car.z];
    d.hold = true;
    this.hailed = car;
    const [px, pz] = game.player.pos();
    const fare = (x, z) => TAXI_BASE + TAXI_PER_BLOCK * Math.max(1, Math.round(trip(px, pz, x, z) / BLOCK));
    const place = (label, x, z, detail) => {
      const f = fare(x, z);
      const close = dist(x, z, px, pz) < 60;
      return {
        label, price: f, detail: detail || `${streetAt(x, z)}, ${districtAt(x, z)} · about ${this.minutes(x, z, TAXI_SPEED)} min`,
        can: close ? "You're already here" : true,
        buy: () => {
          game.shops.close();
          this.start('taxi', x, z, f, label, car);
        },
      };
    };
    const list = () => {
      const out = [];
      const wp = game.mapView.waypoint;
      if (wp) out.push(place('Map waypoint', wp[0], wp[1]));
      const home = game.shops.respawnPoint?.();
      if (home) out.push(place('Home', home.x, home.z));
      const c = game.city;
      out.push(place('Green Street hangout', c.crewHome.x, c.crewHome.z));
      const s = game.shops;
      out.push(place(s.gun.name, s.gun.x, s.gun.z));
      out.push(place(s.garage.name, s.garage.x, s.garage.z));
      const bank = [...(game.bank?.banks || [])].sort((p1, p2) => dist(p1.x, p1.z, px, pz) - dist(p2.x, p2.z, px, pz))[0];
      if (bank) out.push(place(`${bank.name} (nearest bank)`, bank.x, bank.z));
      if (c.chop) out.push(place('Chop shop', c.chop.x, c.chop.z));
      if (c.hospital) out.push(place('Harbor General Hospital', c.hospital.x, c.hospital.z));
      for (const name of DISTRICTS) {
        const [x, z] = districtCenter(name);
        out.push(place(name, x, z));
      }
      return out;
    };
    game.shops.openCustom('Taxi · where to?', list);
    game.shops.onClose = () => {
      // Changed your mind: the taxi goes on its way.
      if (!this.ride && this.hailed === car) {
        d.stopAt = null;
        d.hold = false;
        this.hailed = null;
      }
    };
  }

  // ---- Bus ----
  busMenu(from) {
    const game = this.game;
    const wp = game.mapView.waypoint;
    const stops = game.transit.stops.filter((s) => s !== from);
    if (wp) stops.sort((a, b) => dist(a.sx, a.sz, wp[0], wp[1]) - dist(b.sx, b.sz, wp[0], wp[1]));
    const go = (s) => this.start('bus', s.wx, s.wz, BUS_FARE, this.stopName(s), null, s, from);
    const list = () => [{
      label: 'Pick a stop on the map', price: 0, priceText: 'Map ›',
      detail: 'Open the map and tap the stop you want',
      can: true,
      buy: () => {
        game.shops.close();
        game.mapView.pickStop({
          from,
          stops,
          info: (s) => `${this.stopName(s)} · Route ${s.route.name} · ${money(BUS_FARE)} · about ${this.minutes(s.sx, s.sz, BUS_SPEED)} min`,
          onPick: (s) => {
            if (!game.bank.pay(BUS_FARE)) {
              game.hud.toast(`You need ${money(BUS_FARE)} for the bus`, '#ff8080');
              return;
            }
            game.sfx.cash?.();
            go(s);
          },
        });
      },
    }, ...stops.map((s, k) => ({
      label: `${wp && k === 0 ? '★ ' : ''}Route ${s.route.name} · ${this.stopName(s)}`,
      price: BUS_FARE,
      detail: `${wp && k === 0 ? 'Closest stop to your waypoint · ' : ''}about ${this.minutes(s.sx, s.sz, BUS_SPEED)} min`,
      can: true,
      buy: () => {
        game.shops.close();
        go(s);
      },
    }))];
    game.shops.openCustom('Bus · pick a stop', list);
  }

  stopName(s) {
    return `${streetAt(s.sx, s.sz)}, ${districtAt(s.sx, s.sz)}`;
  }

  // Game minutes the trip takes (the clock runs 30x: a second of driving is half a minute).
  minutes(x, z, speed) {
    const [px, pz] = this.game.player.pos();
    return Math.max(1, Math.round((trip(px, pz, x, z) / speed) * 0.5));
  }

  // ---- The ride (a quick cut scene) ----
  // Paid already by the menu (bank, then cash). x, z: where you want to go.
  start(kind, x, z, fare, label, car = null, stop = null, fromStop = null) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    const speed = kind === 'taxi' ? TAXI_SPEED : BUS_SPEED;
    const secs = trip(px, pz, x, z) / speed;
    // Where the ride starts: the hailed taxi, or a bus pulling up at the stop.
    if (kind === 'bus') car = this.spawnAt('bus', fromStop.x, fromStop.z, Math.atan2(fromStop.ux, fromStop.uz), fromStop.route.color, fromStop.from, fromStop.to);
    this.ride = { kind, x, z, fare, label, t: 0, car, stop, secs, swapped: false, out: false, from: [px, pz] };
    game.hud.toast(`${kind === 'taxi' ? 'Taxi' : 'Bus'}: -${money(fare)}`, '#9fc3ff');
    this.el.querySelector('.rk').textContent = kind === 'taxi' ? 'TAXI' : `BUS · ROUTE ${stop.route.name}`;
    this.el.querySelector('.rt').textContent = label;
    this.el.querySelector('.rs').textContent = `${streetAt(x, z)} · ${districtAt(x, z)} · ${Math.max(1, Math.round(secs * 0.5))} min · ${money(fare)}`;
    this.el.classList.remove('hidden');
    requestAnimationFrame(() => this.el.classList.add('on'));
    document.getElementById('hud').classList.add('cine');
    if (game.input.locked) game.input.unlock();
  }

  // A taxi or bus parked at a curb spot, ready to pull away (holds still for `hold` seconds).
  spawnAt(type, x, z, heading, color, from, to) {
    const game = this.game;
    for (const v of game.vehicles) if (!v.removed && v !== game.player.vehicle && dist(v.x, v.z, x, z) < 6 && v.driver && v.driver !== 'player' && v.driver.car === v && !v.driver.officers) v.dispose();
    const car = new Vehicle(game.scene, type, x, z, heading, color);
    const d = new TrafficDriver(car, from, to);
    d.stopAt = [x, z];
    d.hold = true;
    car.driver = d;
    game.traffic.drivers.push(d);
    game.vehicles.push(car);
    return car;
  }

  // Where to drop you: the closest curb to the spot, with the car in the lane beside it.
  dropPoint(x, z) {
    const city = this.game.city;
    // The nearest ordinary street (not a ramp connector, pier or freeway).
    let hit = city.edgeAt(x, z);
    if (!hit || hit.e.street?.stub !== undefined || hit.e.cls === 'pier') {
      const n = city.nearestNode(x, z, (q) => q.street && !q.rampEnd);
      const e = n.edges.find((ed) => ed.cls !== 'pier' && ed.street?.stub === undefined) || n.edges[0];
      const c = closestOnSeg(x, z, e.a.x, e.a.z, e.b.x, e.b.z);
      hit = { e, x: c.x, z: c.z, t: c.t };
    }
    const e = hit.e;
    const L = Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z) || 1;
    let ux = (e.b.x - e.a.x) / L;
    let uz = (e.b.z - e.a.z) / L;
    // Which curb: the side the spot is on. Keep clear of the junctions.
    const t = L > 30 ? Math.max(14, Math.min(L - 14, hit.t * L)) : L / 2;
    const cx = e.a.x + ux * t;
    const cz = e.a.z + uz * t;
    const right = (x - cx) * -uz + (z - cz) * ux > 0;
    let from = e.a;
    let to = e.b;
    if (!right) {
      [from, to] = [e.b, e.a];
      ux = -ux;
      uz = -uz;
    }
    const rx = -uz;
    const rz = ux;
    const lane = laneOff(from, to);
    return { px: cx + rx * (e.w / 2 + 1.2), pz: cz + rz * (e.w / 2 + 1.2), cx: cx + rx * lane, cz: cz + rz * lane, heading: Math.atan2(ux, uz), from, to };
  }

  update(dt) {
    const r = this.ride;
    if (!r) return;
    const game = this.game;
    r.t += dt;
    const p = game.player;
    // 0.35 s: in you get.
    if (r.t > 0.35 && !r.inside) {
      r.inside = true;
      p.char.group.visible = false;
      if (r.car && r.kind === 'taxi') r.car.openDoor?.(1, 0.6);
    }
    // 0.7 s: it pulls away.
    if (r.t > 0.7 && !r.leaving && r.car && !r.car.removed) {
      r.leaving = true;
      const d = r.car.driver;
      if (d && d.car === r.car) {
        d.stopAt = null;
        d.hold = false;
      }
    }
    // Fade to black, then the drop-off.
    this.el.classList.toggle('dark', r.t > 1.2 && r.t < 2.3);
    if (r.t > 1.65 && !r.swapped) {
      r.swapped = true;
      this.arrive(r);
    }
    if (r.t > 2.7 && !r.out) {
      r.out = true;
      p.char.group.visible = true;
      if (r.car2 && !r.car2.removed) {
        r.car2.openDoor?.(1, 0.6);
        const d = r.car2.driver;
        if (d && d.car === r.car2) d.holdUntil = game.time + 0.8; // and off it goes
      }
    }
    if (r.t > 3.5) this.end();
  }

  arrive(r) {
    const game = this.game;
    const p = game.player;
    const drop = r.kind === 'bus' ? null : this.dropPoint(r.x, r.z);
    let px;
    let pz;
    if (r.kind === 'bus') {
      const s = r.stop;
      px = s.wx;
      pz = s.wz;
      r.car2 = this.spawnAt('bus', s.x, s.z, Math.atan2(s.ux, s.uz), s.route.color, s.from, s.to);
      r.cam = [s.x, s.z, Math.atan2(s.ux, s.uz), s.px, s.pz];
    } else {
      px = drop.px;
      pz = drop.pz;
      if (drop.from && drop.to) r.car2 = this.spawnAt('taxi', drop.cx, drop.cz, drop.heading, undefined, drop.from, drop.to);
      const nx = (drop.px - drop.cx);
      const nz = (drop.pz - drop.cz);
      const l = Math.hypot(nx, nz) || 1;
      r.cam = [drop.cx, drop.cz, drop.heading, nx / l, nz / l];
    }
    // You, and anyone following you.
    p.x = px;
    p.z = pz;
    p.sync?.();
    let k = 0;
    for (const m of game.crew?.following || []) {
      k++;
      m.x = px + (k % 2 ? 1.2 : -1.2) * Math.ceil(k / 2);
      m.z = pz + 0.8;
    }
    // The clock moves on.
    game.time += r.secs;
    game.parking?.refresh(true);
    game.camYaw = r.cam[2] + Math.PI;
  }

  end() {
    const game = this.game;
    this.ride = null;
    this.hailed = null;
    game.player.char.group.visible = true;
    this.el.classList.remove('on', 'dark');
    document.getElementById('hud').classList.remove('cine');
    setTimeout(() => {
      if (!this.ride) this.el.classList.add('hidden');
    }, 400);
    game.save();
  }

  // The camera during the ride: a wide shot of the car pulling away, then of the drop-off.
  camera() {
    const r = this.ride;
    if (!r) return false;
    const cam = this.game.camera;
    let x;
    let z;
    let h;
    let nx = 0;
    let nz = 0;
    if (!r.swapped) {
      const c = r.car && !r.car.removed ? r.car : null;
      x = c ? c.x : r.from[0];
      z = c ? c.z : r.from[1];
      h = c ? c.heading : 0;
      nx = -Math.cos(h);
      nz = Math.sin(h); // the car's right side
    } else {
      [x, z, h, nx, nz] = r.cam;
      const c = r.car2 && !r.car2.removed ? r.car2 : null;
      if (c) {
        x = c.x;
        z = c.z;
      }
    }
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    // Out to the curb side and a little ahead, looking back at the car.
    const k = r.swapped ? Math.min(1, (r.t - 1.65) / 1.8) : Math.min(1, r.t / 1.2);
    cam.position.set(x + nx * (9 + 3 * k) + fx * (6 - 4 * k), 4 + 3 * k, z + nz * (9 + 3 * k) + fz * (6 - 4 * k));
    cam.lookAt(x, 1, z);
    return true;
  }
}
