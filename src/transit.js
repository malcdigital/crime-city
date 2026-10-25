import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CFG } from './config.js';
import { Vehicle } from './vehicle.js';
import { TrafficDriver, laneOff } from './traffic.js';
import { nodePath } from './gps.js';
import { lam } from './character.js';
import { signTexture } from './shops.js';
import { dist, rand, randInt } from './util.js';
import { inHole } from './fwyplan.js';

// City buses. Two routes loop along the main roads through the middle of the city; each has
// a bus shelter every couple of hundred meters (on the right-hand curb). Buses run all day, stop at each shelter for a few
// seconds, and people wait at the stops, get on and get off. Traffic passes a stopped bus
// like any other stopped car.
// Each route: the junctions it goes through, in order (clockwise, so stops are on the right).
const ROUTES = [
  { name: '1', via: [[300, 490], [900, 490], [900, 900], [300, 900]], color: 0x1f7a4d },
  { name: '2', via: [[640, 690], [1180, 690], [1180, 900], [640, 900]], color: 0x2a5aa8 },
];
const BUSES_PER_ROUTE = 2;
const DWELL = 6; // seconds at each stop

export class Transit {
  constructor(game) {
    this.game = game;
    this.routes = [];
    this.stops = [];
    this.buses = [];
    this.t = 0;
    const city = game.city;
    for (const r of ROUTES) {
      const via = r.via.map(([x, z]) => city.nearestNode(x, z, (n) => n.street));
      let loop = [];
      for (let k = 0; k < via.length; k++) {
        const path = nodePath(via[k], via[(k + 1) % via.length]);
        if (!path) continue;
        loop.push(...path.slice(0, -1));
      }
      // (no node twice: cut out any little detours)
      const seen = new Map();
      for (let k = 0; k < loop.length; k++) {
        if (seen.has(loop[k])) {
          loop.splice(seen.get(loop[k]), k - seen.get(loop[k]));
          k = -1;
          seen.clear();
          continue;
        }
        seen.set(loop[k], k);
      }
      loop = loop.filter(Boolean);
      const route = { ...r, loop, stops: new Map() };
      // A stop about every 220 m, partway down a long enough street.
      let since = 150;
      loop.forEach((from, k) => {
        const to = loop[(k + 1) % loop.length];
        const L = dist(from.x, from.z, to.x, to.z);
        since += L;
        if (since < 220 || L < 40) return;
        const e = from.edgeTo?.get(to);
        if (!e) return;
        const ux = (to.x - from.x) / L;
        const uz = (to.z - from.z) / L;
        const px = -uz;
        const pz = ux; // toward the right-hand curb
        const mx = (from.x + to.x) / 2;
        const mz = (from.z + to.z) / 2;
        const off = e.w / 2 + 3.2; // from the middle of the road to the middle of the shelter
        const sx = mx + px * off;
        const sz = mz + pz * off;
        const blk = city.blockAt(sx, sz);
        if (!blk || (blk.type !== 'normal' && blk.type !== 'park') || inHole(sx, sz, 3)) return;
        const lane = laneOff(from, to);
        since = 0;
        const stop = {
          route, from, to, ux, uz, px, pz, w: e.w,
          x: mx + px * lane, z: mz + pz * lane, // where the bus stops
          sx, sz, // the shelter
          wx: mx + px * (e.w / 2 + 1.6), wz: mz + pz * (e.w / 2 + 1.6), // where people wait (curbside)
          waiting: [],
        };
        route.stops.set(from, stop);
        this.stops.push(stop);
      });
      this.routes.push(route);
    }
    this.buildShelters();
    for (const route of this.routes) {
      for (let k = 0; k < BUSES_PER_ROUTE; k++) this.spawnBus(route, Math.floor((k * route.loop.length) / BUSES_PER_ROUTE));
    }
  }

  // Shelters: a roof, a glass back wall, a bench and a bus-stop sign. All of them share a few
  // merged meshes (a handful of draw calls for the whole city).
  buildShelters() {
    const frame = [];
    const glass = [];
    const sign = [];
    const add = (list, geo, x, y, z, yaw) => {
      const g = geo.clone();
      g.rotateY(yaw);
      g.translate(x, y, z);
      list.push(g);
    };
    for (const s of this.stops) {
      const yaw = Math.atan2(s.px, s.pz); // local +z points away from the road
      const at = (lx, lz) => [s.sx + s.px * lz + s.pz * lx, s.sz + s.pz * lz - s.px * lx];
      const W = 4.2;
      const D = 1.5;
      const [rx, rz] = at(0, 0);
      add(frame, new THREE.BoxGeometry(W + 0.3, 0.12, D + 0.3), rx, 0.2 + 2.55, rz, yaw);
      for (const lx of [-W / 2, W / 2]) {
        for (const lz of [-D / 2 + 0.1, D / 2 - 0.05]) {
          const [x, z] = at(lx, lz);
          add(frame, new THREE.BoxGeometry(0.1, 2.5, 0.1), x, 0.2 + 1.25, z, yaw);
        }
      }
      const [bx, bz] = at(0, D / 2 - 0.05);
      add(glass, new THREE.BoxGeometry(W, 2.1, 0.05), bx, 0.2 + 1.35, bz, yaw);
      const [cx, cz] = at(0, D / 2 - 0.4);
      add(frame, new THREE.BoxGeometry(W * 0.75, 0.08, 0.45), cx, 0.2 + 0.48, cz, yaw);
      // Sign pole at the curb, just past the front of the shelter.
      const [qx, qz] = at(W / 2 + 0.6, 0.5 - 3.2);
      add(frame, new THREE.CylinderGeometry(0.05, 0.05, 2.8, 6), qx, 0.2 + 1.4, qz, 0);
      add(sign, new THREE.BoxGeometry(0.6, 0.6, 0.04), qx, 0.2 + 2.5, qz, yaw + Math.PI / 2);
      const [ax, az] = at(-W / 2, -D / 2);
      const [ex, ez] = at(W / 2, D / 2);
      this.game.city.colliders.push({ minX: Math.min(ax, ex), maxX: Math.max(ax, ex), minZ: Math.min(az, ez), maxZ: Math.max(az, ez), h: 2.7 });
    }
    const scene = this.game.scene;
    if (frame.length) {
      const m = new THREE.Mesh(mergeGeometries(frame), lam(0x3a4048));
      m.castShadow = true;
      scene.add(m);
    }
    if (glass.length) scene.add(new THREE.Mesh(mergeGeometries(glass), new THREE.MeshLambertMaterial({ color: 0x9fc6de, transparent: true, opacity: 0.35 })));
    if (sign.length) {
      const tex = signTexture('BUS', '#1f5fbf');
      scene.add(new THREE.Mesh(mergeGeometries(sign), new THREE.MeshBasicMaterial({ map: tex })));
    }
  }

  spawnBus(route, k) {
    const game = this.game;
    const from = route.loop[k % route.loop.length];
    const to = route.loop[(k + 1) % route.loop.length];
    const L = dist(from.x, from.z, to.x, to.z);
    const ux = (to.x - from.x) / L;
    const uz = (to.z - from.z) / L;
    const off = laneOff(from, to);
    const x = from.x + ux * Math.min(16, L / 2) - uz * off;
    const z = from.z + uz * Math.min(16, L / 2) + ux * off;
    if (game.vehicles.some((v) => !v.removed && dist(v.x, v.z, x, z) < 12)) return null;
    const car = new Vehicle(game.scene, 'bus', x, z, Math.atan2(ux, uz), route.color);
    const d = new TrafficDriver(car, from, to);
    d.bus = route;
    d.loop = route.loop;
    d.next = d.pickNext();
    d.cruise = rand(8.5, 10);
    d.onSegment = (drv) => this.planStop(drv);
    car.driver = d;
    car.speed = 4;
    game.traffic.drivers.push(d);
    game.vehicles.push(car);
    this.buses.push({ route, d, car, k });
    this.planStop(d);
    return d;
  }

  // Entering a street with a stop on it: pull up there.
  planStop(d) {
    const stop = d.bus.stops.get(d.from);
    if (!stop || stop.to !== d.to) return;
    d.halt = { from: d.from, to: d.to, x: stop.x, z: stop.z, wait: DWELL, onStop: () => this.atStop(d, stop) };
  }

  // The bus is at the stop: whoever's waiting gets on, and somebody might get off.
  atStop(d, stop) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    if (dist(stop.x, stop.z, px, pz) > 140) {
      for (const p of stop.waiting) if (!p.removed) p.dispose();
      stop.waiting = [];
      return;
    }
    const c = d.car;
    const [fx, fz] = c.forward();
    // Front door, curb side.
    const doorX = c.x + fx * (c.halfLen - 1.2) + stop.px * 1.7;
    const doorZ = c.z + fz * (c.halfLen - 1.2) + stop.pz * 1.7;
    for (const p of stop.waiting) {
      if (p.removed || p.state !== 'shop') continue;
      p.state = 'leave';
      p.door = [doorX, doorZ];
      p.leaveSpeed = 1.6;
      p.onArrive = () => {};
    }
    stop.waiting = [];
    c.openDoor(1, DWELL - 1);
    const off = Math.random() < 0.6 ? randInt(1, 2) : 0;
    for (let k = 0; k < off; k++) {
      const p = game.peds.addAt(doorX + stop.px * 0.6 + fx * k * 0.8, doorZ + stop.pz * 0.6 + fz * k * 0.8);
      p.resumeWalking();
    }
  }

  update(dt) {
    const game = this.game;
    this.t += dt;
    // Buses that got wrecked, stolen or towed: a new one comes along later, out of sight.
    this.buses = this.buses.filter((b) => b.car.driver === b.d && !b.car.removed && !b.car.wrecked && b.d.active);
    this.respawnT = (this.respawnT || 0) - dt;
    const [px, pz] = game.player.pos();
    if (this.respawnT <= 0) {
      this.respawnT = 20;
      for (const route of this.routes) {
        if (this.buses.filter((b) => b.route === route).length >= BUSES_PER_ROUTE) continue;
        const k = route.loop.findIndex((n) => dist(n.x, n.z, px, pz) > 220);
        if (k >= 0) this.spawnBus(route, k + randInt(0, 3));
      }
    }
    if (this.t < 2) return;
    this.t = 0;
    // People waiting at stops near you (more of them when the streets are busy).
    for (const s of this.stops) {
      s.waiting = s.waiting.filter((p) => !p.removed && p.state === 'shop');
      const d = dist(s.sx, s.sz, px, pz);
      if (d > 130) continue;
      const want = Math.min(3, Math.round((game.rhythm ? game.rhythm.weight(s.sx, s.sz, 'p') : 1) * 2));
      if (s.waiting.length >= want || d < 30) continue;
      const k = s.waiting.length;
      const x = s.wx + s.pz * (k - 1) * 1.1;
      const z = s.wz - s.px * (k - 1) * 1.1;
      const p = game.peds.addAt(x, z);
      p.state = 'shop';
      p.waitStop = s;
      p.shopHeading = Math.atan2(-s.px, -s.pz); // facing the road
      p.heading = p.shopHeading;
      s.waiting.push(p);
    }
  }

  // Bus stops for the map and radar.
  shelters() {
    return this.stops;
  }
}
