import * as THREE from 'three';
import { CFG, CRIMES } from './config.js';
import { buildCity, districtAt, streetAt } from './city.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Vehicle, resolveCarCollisions } from './vehicle.js';
import { TrafficManager } from './traffic.js';
import { PedManager } from './peds.js';
import { PoliceManager } from './police.js';
import { Hud } from './hud.js';
import { segmentBlocked } from './collision.js';
import { clamp, dist, lerp, lerpAngle, rand, randInt } from './util.js';

const SAVE_KEY = 'crimecity.v1';

class Game {
  constructor() {
    const canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    const sky = new THREE.Color(0x9fc3e0);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 140, 430);
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 900);

    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a4a40, 1.1));
    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -90;
    sc.right = sc.top = 90;
    sc.near = 10;
    sc.far = 320;
    this.scene.add(this.sun, this.sun.target);

    this.city = buildCity(this.scene);
    this.input = new Input(canvas);
    this.hud = new Hud(this.city);

    const sp = this.city.spawn;
    this.player = new Player(this, sp.x, sp.z);
    this.vehicles = [];
    this.walkers = [];
    this.traffic = new TrafficManager(this);
    this.peds = new PedManager(this);
    this.police = new PoliceManager(this);

    // Parked cars at the curb near the start point.
    this.vehicles.push(new Vehicle(this.scene, 'sports', sp.x + 8, sp.curbZ, Math.PI / 2));
    this.vehicles.push(new Vehicle(this.scene, 'sedan', sp.x - 8, sp.curbZ, Math.PI / 2));

    this.traffic.init();
    this.peds.init();

    this.cash = 0;
    this.cred = 0;
    this.load();
    this.heat = 0;
    this.stars = 0;
    this.lastSeen = 0;
    this.lastKnown = null;
    this.searching = false;
    this.time = 0;
    this.camYaw = Math.PI;
    this.camPitch = 0.25;
    this.camIdle = 0;
    this.bustPressure = 0;
    this.bustedT = 0;
    this.robbing = null;
    this.district = 'Downtown';
    this.prompt = '';
    this.progress = null;
    this.saveT = 0;
    this.started = false;

    addEventListener('resize', () => this.resize());
    this.resize();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  start() {
    this.started = true;
    this.hud.show();
    this.hud.news('Welcome to Crime City. Stay out of trouble.', 'info');
    this.input.lock();
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      this.cash = s.cash || 0;
      this.cred = s.cred || 0;
    } catch {
      // Storage unavailable: start fresh.
    }
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ cash: this.cash, cred: this.cred }));
    } catch {
      // Ignore storage errors.
    }
  }

  // ---- Wanted level ----

  starsFor(heat) {
    let s = 0;
    for (const t of CFG.STAR_HEAT) if (heat >= t) s++;
    return s;
  }

  crime(type, x, z, extra = '') {
    const c = CRIMES[type];
    this.heat += c.heat;
    if (c.min && this.starsFor(this.heat) < c.min) this.heat = CFG.STAR_HEAT[c.min - 1];
    const before = this.stars;
    this.stars = Math.min(5, Math.max(this.stars, this.starsFor(this.heat)));
    this.lastSeen = this.time;
    this.lastKnown = [x, z];
    this.cred += c.cred;
    const where = `${streetAt(x, z)}, ${districtAt(x, z)}`;
    if (type !== 'robbery') this.hud.news(`${c.label}${extra ? ` ${extra}` : ''} on ${where}`);
    if (this.stars > before && before === 0) this.hud.news(`Police respond to ${districtAt(x, z)}`);
  }

  arrestPressure(dt) {
    this.bustPressure += dt * 2;
  }

  bust() {
    const fine = Math.min(this.cash, 200 * this.stars + Math.floor(this.cash * 0.1));
    const [x, z] = this.player.pos();
    this.cash -= fine;
    this.cred = Math.max(0, this.cred - 10);
    this.hud.news(`Gang member arrested in ${districtAt(x, z)}. Fined $${fine}.`, 'info');
    this.hud.busted(true, `Fined $${fine.toLocaleString('en-US')} · -10 street cred`);
    this.bustedT = 3;
    this.heat = 0;
    this.stars = 0;
    this.robbing = null;
    this.bustPressure = 0;
    this.save();
  }

  afterBust() {
    this.hud.busted(false);
    if (this.player.vehicle) this.player.exit();
    this.police.clearAll();
    this.vehicles = this.vehicles.filter((v) => !v.removed);
    const st = this.city.station;
    this.player.x = st.x;
    this.player.z = st.z + 3;
    this.player.heading = Math.PI;
    this.camYaw = Math.PI;
    this.player.sync();
  }

  updateWanted(dt) {
    if (this.stars === 0) {
      this.searching = false;
      return;
    }
    const [px, pz] = this.player.pos();
    let seen = false;
    for (const u of this.police.units) {
      if (u.leaving) continue;
      if (u.car.driver === u && u.mounted) {
        const d = dist(u.car.x, u.car.z, px, pz);
        if (d < 60 && !segmentBlocked(u.car.x, u.car.z, px, pz, this.city.los)) seen = true;
      }
      for (const o of u.officers) {
        if (o.state === 'inCar' || o.state === 'down') continue;
        const d = dist(o.x, o.z, px, pz);
        if (d < 35 && !segmentBlocked(o.x, o.z, px, pz, this.city.los)) seen = true;
      }
    }
    if (seen) {
      this.lastSeen = this.time;
      this.lastKnown = [px, pz];
    }
    this.searching = this.time - this.lastSeen > 1.5;
    const evadeTime = 8 + this.stars * 3;
    if (this.time - this.lastSeen > evadeTime) {
      const bonus = 10 * this.stars;
      this.cred += bonus;
      this.hud.news(`Suspect escaped police in ${districtAt(px, pz)}`, 'good');
      this.hud.toast(`ESCAPED  +${bonus} cred`);
      this.stars = 0;
      this.heat = 0;
      this.police.standDown();
    }

    // Busted while stuck in a car with police right next to you.
    const v = this.player.vehicle;
    if (v && Math.abs(v.speed) < 1.5) {
      const close = this.police.units.some((u) => u.car !== v && dist(u.car.x, u.car.z, v.x, v.z) < 5.5);
      if (close) this.bustPressure += dt;
    }
    this.bustPressure = Math.max(0, this.bustPressure - dt * 0.8);
    if (this.bustPressure > 2.2) this.bust();
  }

  // ---- Player actions ----

  nearestVehicle(maxD) {
    let best = null;
    let bd = maxD;
    for (const v of this.vehicles) {
      const d = dist(v.x, v.z, this.player.x, this.player.z);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  enterVehicle(v) {
    const d = v.driver;
    if (d && d !== 'player') {
      if (d.car) {
        // Pull the driver out.
        if (d.officers) {
          for (const o of d.officers) if (o.state === 'inCar') o.dismount(-1);
          this.crime('stealCopCar', v.x, v.z);
        } else {
          d.active = false;
          const [fx, fz] = v.forward();
          const ped = this.peds.addAt(v.x - fz * 2.2, v.z + fx * 2.2);
          ped.scare(this.player.x, this.player.z);
          this.crime('carjack', v.x, v.z);
        }
      }
    } else if (v.typeName === 'police') {
      this.crime('stealCopCar', v.x, v.z);
    }
    v.siren = false;
    this.player.enter(v);
  }

  punch() {
    const p = this.player;
    if (p.punchT > 0) return;
    p.punchT = 0.3;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    const targets = [...this.peds.peds, ...this.police.officers()];
    for (const t of targets) {
      if (!t.standing) continue;
      const dx = t.x - p.x;
      const dz = t.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.7 || (dx * fx + dz * fz) / (d || 1) < 0.4) continue;
      t.knockDown(p.x, p.z, 0.6);
      if (t.isCop) this.crime('assaultCop', t.x, t.z);
      else {
        this.crime('assault', t.x, t.z);
        this.scareNearby(t.x, t.z, 14);
      }
      return;
    }
  }

  scareNearby(x, z, r) {
    for (const ped of this.peds.peds) if (dist(ped.x, ped.z, x, z) < r) ped.scare(x, z);
  }

  // Cars hitting people.
  checkRunOver() {
    for (const v of this.vehicles) {
      if (Math.abs(v.speed) < 4) continue;
      const people = [...this.peds.peds, ...this.police.officers()];
      for (const t of people) {
        if (!t.standing) continue;
        if (Math.abs(t.x - v.x) > 4 || Math.abs(t.z - v.z) > 4) continue;
        let hit = false;
        for (const [cx, cz] of v.circles()) if (dist(cx, cz, t.x, t.z) < v.radius + 0.35) hit = true;
        if (!hit) continue;
        t.knockDown(v.x, v.z, 2);
        v.speed *= 0.85;
        if (v.driver === 'player') {
          if (t.isCop) this.crime('runOverCop', t.x, t.z);
          else this.crime('hitAndRun', t.x, t.z);
          this.scareNearby(t.x, t.z, 16);
        }
      }
    }
  }

  handleInteractions(dt) {
    const input = this.input;
    const p = this.player;
    this.prompt = '';
    this.progress = null;
    const city = this.city;

    if (p.vehicle) {
      const v = p.vehicle;
      if (input.hit('KeyF') && Math.abs(v.speed) < 8) {
        p.exit();
        return;
      }
      const chop = city.chop;
      if (dist(v.x, v.z, chop.x, chop.z) < chop.r) {
        if (this.stars > 0) this.prompt = 'Lose the cops before the chop shop will take this car';
        else {
          const price = Math.round((v.type.value * (v.crash > 0 ? 0.8 : 1)) / 10) * 10;
          this.prompt = `Press E to sell this ${v.type.label.toLowerCase()} for $${price}`;
          if (input.hit('KeyE') && Math.abs(v.speed) < 4) {
            p.exit();
            v.dispose();
            this.cash += price;
            const cred = v.typeName === 'police' ? 25 : 6;
            this.cred += cred;
            this.hud.toast(`+$${price}  +${cred} cred`);
            this.save();
          }
        }
      }
      return;
    }

    if (input.hit('KeyF')) {
      const v = this.nearestVehicle(3.8);
      if (v) {
        this.enterVehicle(v);
        return;
      }
    }
    if (input.clicked || input.hit('KeyJ')) this.punch();

    // Store robberies.
    const store = city.stores.find((s) => dist(s.x, s.z, p.x, p.z) < s.r);
    if (store) {
      if (store.cooldown > 0) this.prompt = `${store.name} was robbed recently. Come back later.`;
      else if (input.down('KeyE')) {
        if (this.robbing !== store) {
          this.robbing = store;
          store.robT = 0;
          this.crime('robberyAlarm', store.x, store.z, `at ${store.name}`);
        }
        store.robT += dt;
        this.progress = { value: store.robT / 4, label: `Emptying the register at ${store.name}` };
        if (store.robT >= 4) {
          const take = randInt(4, 12) * 100;
          this.cash += take;
          this.crime('robbery', store.x, store.z);
          this.hud.news(`${store.name} robbed. Suspect took $${take}.`);
          this.hud.toast(`+$${take}  +${CRIMES.robbery.cred} cred`);
          store.cooldown = 150;
          store.signMesh.material.color.setHex(0x555555);
          this.robbing = null;
          this.save();
        }
      } else {
        this.robbing = null;
        this.prompt = `Hold E to rob ${store.name}`;
      }
    } else {
      this.robbing = null;
      const v = this.nearestVehicle(3.8);
      if (v) {
        const occupied = v.driver && v.driver !== 'player';
        this.prompt = occupied ? `Press F to carjack this ${v.type.label.toLowerCase()}` : `Press F to get in`;
      }
    }
  }

  // ---- Camera ----

  updateCamera(dt) {
    const input = this.input;
    const sens = 0.0025;
    let turn = -input.mdx * sens;
    if (input.down('ArrowLeft')) turn += dt * 2.2;
    if (input.down('ArrowRight')) turn -= dt * 2.2;
    this.camYaw += turn;
    this.camPitch = clamp(this.camPitch + input.mdy * sens, -0.15, 1.0);
    if (Math.abs(input.mdx) + Math.abs(input.mdy) > 0 || turn !== 0) this.camIdle = 0;
    else this.camIdle += dt;

    const v = this.player.vehicle;
    let tx, tz, ty, distBack, height;
    if (v) {
      // Swing behind the car when the mouse is idle.
      if (this.camIdle > 1 && Math.abs(v.speed) > 2) {
        const behind = v.speed >= 0 ? v.heading : v.heading + Math.PI;
        this.camYaw = lerpAngle(this.camYaw, behind, Math.min(1, dt * 2.5));
      }
      tx = v.x;
      tz = v.z;
      ty = 1.6;
      distBack = 9.5 + Math.abs(v.speed) * 0.08;
      height = 2.2;
    } else {
      tx = this.player.x;
      tz = this.player.z;
      ty = 1.7;
      distBack = 5.5;
      height = 1.2;
    }
    const cp = Math.cos(this.camPitch);
    let cx = tx - Math.sin(this.camYaw) * distBack * cp;
    let cz = tz - Math.cos(this.camYaw) * distBack * cp;
    const cy = ty + height + Math.sin(this.camPitch) * distBack;
    const shake = v ? v.crash * 0.01 : 0;
    this.camera.position.set(cx + rand(-shake, shake), Math.max(0.6, cy), cz + rand(-shake, shake));
    this.camera.lookAt(tx, ty + 0.6, tz);

    // Keep the sun's shadow box around the player.
    this.sun.position.set(tx + 60, 120, tz + 40);
    this.sun.target.position.set(tx, 0, tz);
  }

  // ---- Main loop ----

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.started) this.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt) {
    this.time += dt;
    const input = this.input;
    if (input.hit('KeyM')) this.hud.toggleNews();

    if (this.bustedT > 0) {
      this.bustedT -= dt;
      if (this.bustedT <= 0) this.afterBust();
      this.updateCamera(dt);
      this.hud.update(this, dt);
      return;
    }

    // Who traffic should stop for.
    this.walkers.length = 0;
    if (!this.player.vehicle) this.walkers.push(this.player);
    for (const p of this.peds.peds) if (p.standing) this.walkers.push(p);

    const p = this.player;
    if (p.vehicle) {
      const ctrl = {
        throttle: (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0),
        steer: (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0),
        handbrake: input.down('Space'),
      };
      p.vehicle.update(dt, ctrl, this.city.colliders);
    } else {
      p.updateOnFoot(dt, input, this.camYaw);
    }

    this.traffic.update(dt);
    this.police.update(dt);
    for (const v of this.vehicles) {
      if (v.driver === null && !v.removed) v.update(dt, { throttle: 0, steer: 0, handbrake: true }, this.city.colliders);
    }
    resolveCarCollisions(this.vehicles.filter((v) => !v.removed));
    for (const v of this.vehicles) v.sync(dt);
    this.peds.update(dt);
    this.checkRunOver();
    this.handleInteractions(dt);
    this.vehicles = this.vehicles.filter((v) => !v.removed);
    this.cleanupVehicles();

    for (const s of this.city.stores) {
      if (s.cooldown > 0) {
        s.cooldown -= dt;
        if (s.cooldown <= 0) s.signMesh.material.color.setHex(0xffffff);
      }
    }

    this.updateWanted(dt);
    const [px, pz] = p.pos();
    this.district = districtAt(px, pz);
    this.updateCamera(dt);
    this.hud.update(this, dt);

    this.saveT += dt;
    if (this.saveT > 5) {
      this.saveT = 0;
      this.save();
    }
  }

  // Remove abandoned cars far from the player so the city doesn't fill up.
  cleanupVehicles() {
    const [px, pz] = this.player.pos();
    const abandoned = this.vehicles.filter((v) => v.driver === null);
    if (abandoned.length > 10) {
      const far = abandoned.find((v) => dist(v.x, v.z, px, pz) > 150);
      if (far) far.dispose();
    }
  }
}

const game = new Game();
window.__game = game;
document.getElementById('play').addEventListener('click', () => {
  document.getElementById('intro').classList.add('hidden');
  game.start();
});
document.getElementById('game').addEventListener('click', () => {
  if (game.started && !game.input.locked) game.input.lock();
});
