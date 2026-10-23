import * as THREE from 'three';
import { CFG, CRIMES, GANG_NAME } from './config.js';
import { buildCity, districtAt, streetAt } from './city.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Vehicle, resolveCarCollisions } from './vehicle.js';
import { TrafficManager } from './traffic.js';
import { PedManager } from './peds.js';
import { PoliceManager } from './police.js';
import { GangManager, CrewManager, MAX_CREW } from './gang.js';
import { Hud } from './hud.js';
import { Effects } from './effects.js';
import { Sfx } from './audio.js';
import { AirCam, ClipPlayer } from './aircam.js';
import { TurfManager, GANGS } from './turf.js';
import { Arsenal, WEAPONS, raycast, rayBox } from './weapons.js';
import { lam } from './character.js';
import { segmentBlocked } from './collision.js';
import { MapView } from './mapview.js';
import { Shops } from './shops.js';
import { Drugs } from './drugs.js';
import { gpsRoute, GpsLine } from './gps.js';
import { clamp, dist, lerp, lerpAngle, rand, randInt, wrapAngle } from './util.js';

const SAVE_KEY = 'crimecity.v1';
const tmpV = new THREE.Vector3();

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
    this.mapView = new MapView(this);
    this.gpsLine = new GpsLine(THREE, this.scene);
    this.aircam = new AirCam(this);
    this.clipPlayer = new ClipPlayer();
    this.effects = new Effects(this.scene);
    this.sfx = new Sfx();
    this.arsenal = new Arsenal();

    const sp = this.city.spawn;
    this.player = new Player(this, sp.x, sp.z);
    this.vehicles = [];
    this.walkers = [];
    this.pickups = [];
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
    this.lethalFlag = false;
    this.health = 100;
    this.lastHurt = -99;
    this.lastShot = -99;
    this.lastGunfireCrime = -99;
    this.newsTimes = {};
    this.time = 0;
    this.camYaw = Math.PI;
    this.camPitch = 0.25;
    this.camIdle = 0;
    this.bustPressure = 0;
    this.bustedT = 0;
    this.wastedT = 0;
    this.robbing = null;
    this.lockTarget = null;
    this.lockScreen = null;
    this.showCrosshair = false;
    this.district = 'Downtown';
    this.prompt = '';
    this.progress = null;
    this.saveT = 0;
    this.started = false;
    this.paused = false;

    // Created after the player and city exist.
    this.gang = new GangManager(this);
    this.crew = new CrewManager(this);
    this.turfWars = new TurfManager(this);
    this.armor = 0;
    this.shops = new Shops(this);
    this.drugs = new Drugs(this);

    addEventListener('resize', () => this.resize());
    this.resize();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  get lethal() {
    return this.lethalFlag || this.stars >= 3;
  }

  start() {
    if (this.started) return;
    this.started = true;
    document.getElementById('intro').classList.add('hidden');
    this.hud.show();
    this.hud.clock = () => this.clockText();
    if (CFG.START_IN_CAR && !this.player.vehicle) {
      this.testCar = this.vehicles[0];
      this.player.enter(this.testCar);
    }
    // Own a safehouse? You wake up there.
    const home = this.shops.respawnPoint();
    if (home && !this.player.vehicle) {
      this.player.x = home.x;
      this.player.z = home.z + 3;
      this.player.sync?.();
    }
    this.hud.news('Welcome to Crime City. Stay out of trouble.', 'info');
    this.sfx.unlock();
    if (this.input.mode !== 'pad') this.input.lock();
  }

  // In-game clock: one real second is one game minute, starting at 9:00 PM.
  clockText() {
    const m = (21 * 60 + Math.floor(this.time)) % 1440;
    const h = Math.floor(m / 60);
    return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }

  setPaused(p) {
    this.paused = p;
    this.hud.pause(p, this);
    if (p) this.input.unlock();
    else if (this.input.mode !== 'pad') this.input.lock();
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
      this.shops?.save();
    } catch {
      // Ignore storage errors.
    }
  }

  characters() {
    return [...this.peds.peds, ...this.police.officers().filter((o) => o.visibleOnStreet), ...this.gang.members, ...this.crew.visible(), ...this.turfWars.soldiers];
  }

  // You and your crew, as targets for enemies.
  playerFaction() {
    const [px, pz] = this.player.pos();
    const list = this.wastedT > 0 ? [] : [{ x: px, z: pz, ref: 'player' }];
    for (const m of this.crew.following) if (m.standing) list.push({ x: m.x, z: m.z, ref: m });
    return list;
  }

  // Who your crew shoots at: the rival gang when they're at war with you, and police in a gunfight.
  crewEnemies() {
    const list = [];
    if (this.gang.angry) for (const r of this.gang.members) if (r.standing) list.push({ x: r.x, z: r.z, ref: r });
    if (this.lethal) for (const o of this.police.officers()) if (o.standing) list.push({ x: o.x, z: o.z, ref: o });
    // Other gangs' soldiers fighting Green Street, or coming after you.
    for (const s of this.turfWars.soldiers) {
      if (!s.standing || s.gangId === 'crew') continue;
      const w = s.war && s.war.state === 'active' ? s.war : null;
      if (s.aggroUntil > this.time || (w && (w.attacker === 'crew' || w.defender === 'crew'))) list.push({ x: s.x, z: s.z, ref: s });
    }
    return list;
  }

  // Are police in a gunfight near this spot?
  copsNear(x, z) {
    if (!this.lethal) return false;
    return this.police.officers().some((o) => o.standing && dist(o.x, o.z, x, z) < 60)
      || this.police.units.some((u) => !u.leaving && dist(u.car.x, u.car.z, x, z) < 60);
  }

  // A civilian finished a 911 call about trouble at `threat`.
  civilianCall(ped, threat) {
    if (this.stars === 0) return;
    const [px, pz] = this.player.pos();
    // They can only report where you are if you're still around the scene.
    if (dist(px, pz, threat[0], threat[1]) > 70) return;
    this.lastKnown = [px, pz];
    this.lastSeen = Math.max(this.lastSeen, this.time - 2);
    this.unseenT = 0;
    if (this.time - (this.lastCallNews ?? -99) > 60) {
      this.lastCallNews = this.time;
      this.hud.news(`911 caller reports the suspect near ${streetAt(px, pz)}`);
    }
  }

  // Nearest target in range, preferring ones in line of sight.
  pickTarget(self, list, range) {
    let best = null;
    let bestScore = Infinity;
    for (const t of list) {
      const d = dist(self.x, self.z, t.x, t.z);
      if (d > range) continue;
      const score = d + (segmentBlocked(self.x, self.z, t.x, t.z, this.city.los) ? 40 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
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
    this.unseenT = 0;
    this.cred += c.cred;
    const where = `${streetAt(x, z)}, ${districtAt(x, z)}`;
    // One story per incident: only the first crime makes the news.
    if (type !== 'robbery') this.storyEvent(null, x, z, `${c.label}${extra ? ` ${extra}` : ''} on ${where}`, false);
    if (this.stars > before && before === 0) this.hud.news(`Police dispatched from Central Precinct to ${districtAt(x, z)}`);
  }

  arrestPressure(dt) {
    this.bustPressure += dt * 2;
  }

  clearWanted() {
    this.stars = 0;
    this.heat = 0;
    this.lethalFlag = false;
    this.bustPressure = 0;
  }

  bust() {
    const [bx, bz] = this.player.pos();
    this.endStory(`Suspect arrested on ${streetAt(bx, bz)}`, bx, bz, 'info', true);
    const fine = Math.min(this.cash, 200 * this.stars + Math.floor(this.cash * 0.1));
    this.cash -= fine;
    this.cred = Math.max(0, this.cred - 10);
    this.hud.busted(true, `Fined $${fine.toLocaleString('en-US')} · -10 street cred`);
    this.bustedT = 3;
    this.drugs.onBusted();
    this.clearWanted();
    this.robbing = null;
    this.save();
  }

  afterBust() {
    this.hud.busted(false);
    this.respawnAt(this.shops.respawnPoint() || this.city.station);
  }

  wasted() {
    if (this.wastedT > 0 || this.bustedT > 0) return;
    const [x, z] = this.player.pos();
    if (this.stars > 0) this.endStory(`Suspect killed in shootout with police on ${streetAt(x, z)}`, x, z, 'crime', true);
    else if (!this.endStory(`Suspect shot dead on ${streetAt(x, z)}`, x, z)) this.hud.news(`Shooting victim rushed to Harbor General from ${districtAt(x, z)}`, 'info');
    this.health = 0;
    this.armor = 0;
    this.drugs.onWasted();
    const bill = Math.min(this.cash, 500);
    this.cash -= bill;
    this.hud.wasted(true, `Hospital bill $${bill.toLocaleString('en-US')}`);
    this.wastedT = 4;
    if (this.player.vehicle) this.player.exit();
    this.player.setDown(true);
    this.clearWanted();
    this.lockTarget = null;
    this.save();
  }

  afterWasted() {
    this.hud.wasted(false);
    this.player.setDown(false);
    this.health = 100;
    this.gang.calm();
    this.respawnAt(this.shops.respawnPoint() || this.city.hospital);
  }

  respawnAt(place) {
    if (this.player.vehicle) this.player.exit();
    this.player.stopRolling();
    this.crew.sendHome();
    this.police.clearAll();
    this.vehicles = this.vehicles.filter((v) => !v.removed);
    this.player.x = place.x;
    this.player.z = place.z + 3;
    this.player.heading = Math.PI;
    this.camYaw = Math.PI;
    this.player.sync();
  }

  updateWanted(dt) {
    if (this.stars === 0) {
      this.searching = false;
      this.lethalFlag = false;
      return;
    }
    const [px, pz] = this.player.pos();
    let seen = false;
    for (const u of this.police.units) {
      if (u.leaving) continue;
      if (!u.carLost && !u.allDead && u.mounted && this.spots(u.car, 1.4, 60, false)) seen = true;
      for (const o of u.officers) {
        if (o.standing && this.spots(o, 1.7, 38, true)) seen = true;
      }
    }
    // The helicopter's crew.
    const heli = this.police.heli;
    if (heli && heli.sees) seen = true;
    this.seenNow = seen;
    if (seen) {
      this.lastSeen = this.time;
      this.lastKnown = [px, pz];
      this.unseenT = 0;
    } else {
      // The escape clock only runs once police have reached the area they're searching.
      const [kx, kz] = this.lastKnown || [px, pz];
      const near = (heli && heli.state === 'pursuit' && dist(heli.x, heli.z, kx, kz) < 150) || this.police.units.some((u) =>
        dist(u.car.x, u.car.z, kx, kz) < 150 || u.officers.some((o) => o.standing && dist(o.x, o.z, kx, kz) < 150));
      if (near) this.unseenT = (this.unseenT || 0) + dt;
    }
    this.searching = this.time - this.lastSeen > 1.5;
    // Escaping: get out of the search area and stay unseen, or stay hidden for a long time
    // while they search.
    const since = this.unseenT || 0;
    const [kx, kz] = this.lastKnown || [px, pz];
    const outside = dist(px, pz, kx, kz) > this.searchRadius;
    if ((outside && since > 5 + this.stars * 1.5) || since > 30 + this.stars * 8) {
      const bonus = 10 * this.stars;
      this.cred += bonus;
      this.endStory(`Suspect escaped police in ${districtAt(px, pz)}`, px, pz, 'good', true);
      this.hud.toast(`ESCAPED  +${bonus} cred`);
      this.clearWanted();
      this.police.standDown();
    }

    // Busted while stuck in a car with police right next to you (not in a gunfight).
    const v = this.player.vehicle;
    if (v && Math.abs(v.speed) < 1.5 && !this.lethal) {
      const close = this.police.units.some((u) => !u.carLost && dist(u.car.x, u.car.z, v.x, v.z) < 5.5);
      if (close) this.bustPressure += dt;
    }
    this.bustPressure = Math.max(0, this.bustPressure - dt * 0.8);
    if (this.bustPressure > 2.2) this.bust();
  }

  // ---- Combat ----

  // Something the player hit or killed.
  onPlayerHit(c, killed) {
    if (c.isCrew) return; // friendly fire
    if (c.isSoldier) c.onPlayerAttack();
    if (killed) {
      const st = streetAt(c.x, c.z);
      if (c.isCop) this.storyEvent('cops', c.x, c.z, `Officer shot dead on ${st}`);
      else if (c.isGang) this.storyEvent('gang', c.x, c.z, `${GANG_NAME} member gunned down on ${st}`);
      else if (c.isSoldier) this.storyEvent('gang', c.x, c.z, `${GANGS[c.gangId].name} member gunned down on ${st}`);
      if (c.isGang || c.isSoldier) this.turfWars.onPlayerKill(c);
      else if (!c.isCop) this.storyEvent('civ', c.x, c.z, `Bystander killed on ${st}`);
    }
    if (c.isCop) {
      this.lethalFlag = true;
      this.crime(killed ? 'copKilled' : 'assaultCop', c.x, c.z);
    } else if (c.isSoldier) {
      if (killed) {
        if (!this.turfWars.gangBusiness(c.x, c.z, c.gangId)) this.crime('gangKill', c.x, c.z);
        this.dropAmmo(c.x, c.z, c.weapon ? c.weapon.id : 'smg', c.weapon ? c.weapon.ammo * 2 : 30);
      }
    } else if (c.isGang) {
      this.gang.anger();
      if (killed) {
        if (!this.turfWars.gangBusiness(c.x, c.z, 'kings')) this.crime('gangKill', c.x, c.z);
        this.dropAmmo(c.x, c.z, c.weapon ? c.weapon.id : 'smg', c.weapon ? c.weapon.ammo * 2 : 30);
      }
    } else if (killed) {
      this.crime('murder', c.x, c.z);
      if (this.police.units.length) this.lethalFlag = true;
    } else this.crime('assault', c.x, c.z);
    if (killed && c.isCop) this.dropAmmo(c.x, c.z, 'pistol', 12);
  }

  muzzlePoint() {
    const p = this.player;
    const m = p.muzzle(this.arsenal.current().id);
    if (m) return [m.x, m.y, m.z];
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    return [p.x + fx * 0.9 - fz * 0.37, this.city.groundY(p.x, p.z) + 1.5, p.z + fz * 0.9 + fx * 0.37];
  }

  // Where a locked-on shot goes: torso by default, head after a flick up on the right stick.
  lockAimPoint(t) {
    const y = this.city.groundY(t.x, t.z) + (t.standing ? (this.lockHead ? 1.8 : 1.3) : 0.3);
    return [t.x, y, t.z];
  }

  tryFire(a) {
    const w = this.arsenal.current();
    if (w.melee || this.arsenal.reloadT > 0 || this.arsenal.cool > 0) return;
    const want = w.auto ? a.fire : a.firePressed;
    if (!want) return;
    const am = this.arsenal.ammo[w.id];
    if (am.mag <= 0) {
      if (!this.arsenal.startReload()) {
        this.sfx.empty();
        this.arsenal.cool = 0.3;
        if (am.reserve <= 0) this.hud.toast('Out of ammo. Switch weapons or find ammo.', '#ff8080');
      }
      return;
    }
    if (!CFG.INFINITE_AMMO) am.mag--;
    this.arsenal.cool = w.rate;
    this.lastShot = this.time;

    const [mx, my, mz] = this.muzzlePoint();
    const aiming = a.aim;
    const spread = (aiming ? w.aimSpread : w.spread) + this.player.speed * 0.004;
    let ox, oy, oz, dx, dy, dz;
    if (this.lockTarget && this.lockTarget.alive) {
      const [tx, ty, tz] = this.lockAimPoint(this.lockTarget);
      [ox, oy, oz] = [mx, my, mz];
      dx = tx - mx;
      dy = ty - my;
      dz = tz - mz;
    } else {
      this.camera.getWorldDirection(tmpV);
      [dx, dy, dz] = [tmpV.x, tmpV.y, tmpV.z];
      // Start the ray level with the player so nothing behind them gets hit.
      const cp = this.camera.position;
      const t0 = (this.player.x - cp.x) * dx + (my - cp.y) * dy + (this.player.z - cp.z) * dz;
      ox = cp.x + dx * Math.max(0, t0 - 0.2);
      oy = cp.y + dy * Math.max(0, t0 - 0.2);
      oz = cp.z + dz * Math.max(0, t0 - 0.2);
    }
    const l = Math.hypot(dx, dy, dz) || 1;
    const bx = dx / l, by = dy / l, bz = dz / l;
    this.effects.muzzle(mx, my, mz);
    this.sfx.shot(w.sound, 1);
    // Shotguns fire a spread of pellets; everything else one bullet.
    let anyKill = false;
    let anyHit = false;
    for (let k = 0; k < (w.pellets || 1); k++) {
      dx = bx + (Math.random() - 0.5) * spread * 2;
      dy = by + (Math.random() - 0.5) * spread * 2;
      dz = bz + (Math.random() - 0.5) * spread * 2;
      const l2 = Math.hypot(dx, dy, dz);
      dx /= l2;
      dy /= l2;
      dz /= l2;
      const hit = raycast(this, ox, oy, oz, dx, dy, dz, w.range, this.player.vehicle);
      if (k < 4) this.effects.tracer(mx, my, mz, hit.x, hit.y, hit.z);
      if (hit.type === 'char') {
        const c = hit.target;
        if (!c.alive) continue;
        const killed = c.takeHit(w.dmg * (hit.head ? 2 : 1), this.player.x, this.player.z);
        this.effects.hitPuff(hit.x, hit.y, hit.z);
        anyHit = true;
        anyKill = anyKill || killed;
        this.onPlayerHit(c, killed);
      } else if (hit.type === 'car') {
        const car = hit.target;
        car.damage(w.dmg * 0.5, true);
        // Hit near a wheel: pop that tire.
        car.wheels.forEach((wh, i) => {
          const [wx, wy, wz] = car.wheelPos(i);
          if (Math.hypot(hit.x - wx, hit.y - wy, hit.z - wz) < 0.55) car.popTire(i);
        });
        this.effects.impact(hit.x, hit.y, hit.z);
      } else if (hit.type === 'heli') {
        const down = hit.target.takeHit(w.dmg);
        this.effects.impact(hit.x, hit.y, hit.z);
        anyHit = true;
        anyKill = anyKill || down;
      } else if (hit.type !== 'none') {
        this.effects.impact(hit.x, hit.y, hit.z);
      }
    }
    if (anyHit) this.hud.hitmarker(anyKill);

    // Gunfire draws attention.
    const [px, pz] = this.player.pos();
    this.scareNearby(px, pz, 45, true);
    this.heardShot(px, pz);
    if (dist(px, pz, this.city.gangHome.x, this.city.gangHome.z) < 30) this.gang.anger();
    else if (this.gang.angry && this.gang.members.some((r) => r.alive && dist(r.x, r.z, px, pz) < 50)) this.gang.anger();
    const witnesses = this.peds.peds.some((p) => p.standing && dist(p.x, p.z, px, pz) < 30)
      || this.police.officers().some((o) => o.standing && dist(o.x, o.z, px, pz) < 45)
      || this.police.units.some((u) => dist(u.car.x, u.car.z, px, pz) < 45);
    if (witnesses && this.time - this.lastGunfireCrime > 5 && !this.turfWars.gangBusiness(px, pz)) {
      this.lastGunfireCrime = this.time;
      this.storyEvent(null, px, pz, `Armed shooter on the loose on ${streetAt(px, pz)}`);
      this.crime('gunfire', px, pz);
    }
  }

  // An NPC (cop or gang member) shoots at the player.
  // An NPC shoots at a target: 'player' or another character.
  npcShootAt(shooter, ref, dmg, kind, acc = 1) {
    // Any shooting involving the rival gang keeps them at war.
    if (shooter.isGang || ref?.isGang) this.gang.anger();
    if (ref === 'player') return this.npcShoot(shooter, dmg, kind, acc);
    if (!ref || !ref.alive) return;
    dmg *= 2; // NPCs don't regenerate like you do, so fights between them need to resolve faster
    const d = dist(shooter.x, shooter.z, ref.x, ref.z);
    const h = shooter.heading;
    const y0 = this.city.groundY(shooter.x, shooter.z) + (shooter.crouched ? 1.0 : 1.5);
    const m = [shooter.x + Math.sin(h) * 0.9 - Math.cos(h) * 0.37, y0, shooter.z + Math.cos(h) * 0.9 + Math.sin(h) * 0.37];
    let p = clamp(0.62 - d * 0.013, 0.1, 0.62) * acc;
    if (ref.crouched) p *= 0.3;
    const hit = Math.random() < p;
    const miss = hit ? 0 : 1.4;
    const ty = this.city.groundY(ref.x, ref.z) + (ref.crouched ? 0.8 : 1.3) + (Math.random() - 0.5) * miss;
    const tx = ref.x + (Math.random() - 0.5) * miss * 2;
    const tz = ref.z + (Math.random() - 0.5) * miss * 2;
    this.effects.muzzle(m[0], m[1], m[2]);
    this.effects.tracer(m[0], m[1], m[2], tx, ty, tz, 0xffd28a);
    const [px, pz] = this.player.pos();
    this.sfx.shotAt(kind, dist(shooter.x, shooter.z, px, pz));
    this.scareNearby(shooter.x, shooter.z, 40, true);
    if (!hit) {
      this.effects.impact(tx, ty, tz);
      return;
    }
    this.effects.hitPuff(tx, ty, tz);
    const killed = ref.takeHit(dmg, shooter.x, shooter.z);
    if (killed && shooter.isCop && ref.isGang) this.newsIncident(`${GANG_NAME} member killed by police on ${streetAt(ref.x, ref.z)}`, ref.x, ref.z);
    if (killed && shooter.isCrew) {
      if (ref.isGang) {
        this.cred += 10;
        this.dropAmmo(ref.x, ref.z, ref.weapon ? ref.weapon.id : 'smg', ref.weapon ? ref.weapon.ammo * 2 : 30);
      } else if (ref.isCop) this.crime('copKilled', ref.x, ref.z);
    }
  }

  npcShoot(shooter, dmg, kind, acc = 1) {
    if (this.wastedT > 0 || this.bustedT > 0) return;
    const [px, pz] = this.player.pos();
    const d = dist(shooter.x, shooter.z, px, pz);
    const h = shooter.heading;
    const y0 = shooter.muzzleY ?? this.city.groundY(shooter.x, shooter.z) + 1.45;
    // Gun is in the right hand: forward and to the shooter's right.
    const m = [shooter.x + Math.sin(h) * 0.9 - Math.cos(h) * 0.37, y0 + 0.05, shooter.z + Math.cos(h) * 0.9 + Math.sin(h) * 0.37];
    const pv = this.player.vehicle;
    let p = clamp(0.62 - d * 0.013, 0.1, 0.62) * acc;
    if (!pv && this.player.speed > 5) p *= 0.6;
    if (!pv && this.aimingNow) p *= 0.85;
    if (!pv && this.player.lowProfile) p *= 0.7; // smaller target
    // On foot behind cover: the shot hits whatever is in the way.
    if (!pv) {
      const [cx, cy, cz] = this.playerTargetPoint();
      const block = this.coverBetween(m[0], m[1], m[2], cx + (Math.random() - 0.5) * 0.4, cy + (Math.random() - 0.5) * 0.4, cz + (Math.random() - 0.5) * 0.4);
      if (block) {
        this.effects.muzzle(m[0], m[1], m[2]);
        this.effects.tracer(m[0], m[1], m[2], block.x, block.y, block.z, 0xffd28a);
        this.effects.impact(block.x, block.y, block.z);
        if (block.type === 'car' && block.target) block.target.damage(dmg * 0.3, false);
        this.sfx.shotAt(kind, d);
        return;
      }
    }
    const hit = Math.random() < p;
    const ty = this.city.groundY(px, pz) + (pv ? 1.0 : this.player.lowProfile ? 0.85 : 1.3);
    const miss = hit ? 0 : 1.6;
    const tx = px + (Math.random() - 0.5) * miss * 2;
    const tz = pz + (Math.random() - 0.5) * miss * 2;
    const tyy = ty + (Math.random() - 0.5) * miss;
    this.effects.muzzle(m[0], m[1], m[2]);
    this.effects.tracer(m[0], m[1], m[2], tx, tyy, tz, 0xffd28a);
    this.sfx.shotAt(kind, d);
    if (hit) this.hurtPlayer(dmg);
    else this.effects.impact(tx, tyy, tz);
  }

  // Where on the player an NPC aims (chest, lower when crouched).
  playerTargetPoint() {
    const [px, pz] = this.player.pos();
    const y = this.city.groundY(px, pz) + (this.player.vehicle ? 1.0 : this.player.lowProfile ? 0.85 : 1.3);
    return [px, y, pz];
  }

  // First solid thing (wall, crate, car) on the line from a to b, or null if it's clear.
  coverBetween(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.5) return null;
    const hit = raycast(this, ax, ay, az, dx / len, dy / len, dz / len, len - 0.3, this.player.vehicle, true);
    return hit.type === 'world' || hit.type === 'car' ? hit : null;
  }

  // Can this police officer (or a cruiser's crew) see you?
  // Walls always block. Crouching behind low cover (crates, cars) hides you from a distance,
  // and a cop on foot only spots you within his field of view.
  canSeePlayer(viewer, eyeY, range, useFov) {
    const [px, pz] = this.player.pos();
    const d = dist(viewer.x, viewer.z, px, pz);
    if (d > range) return false;
    if (segmentBlocked(viewer.x, viewer.z, px, pz, this.city.los)) return false;
    if (useFov && d > 8 && viewer.heading !== undefined) {
      const ang = Math.abs(wrapAngle(Math.atan2(px - viewer.x, pz - viewer.z) - viewer.heading));
      if (ang > 1.9) return false; // looking the other way
    }
    if (!this.player.vehicle && this.player.lowProfile && d > 5) {
      const [tx, ty, tz] = this.playerTargetPoint();
      const ey = this.city.groundY(viewer.x, viewer.z) + eyeY;
      if (this.coverBetween(viewer.x, ey, viewer.z, tx, ty + 0.25, tz)) return false;
    }
    return true;
  }

  // A cop who watched you duck behind cover knows you're still there. You only shake him by
  // sneaking a few meters away along the cover, or putting a wall between you.
  spots(viewer, eyeY, range, useFov) {
    const [px, pz] = this.player.pos();
    if (this.canSeePlayer(viewer, eyeY, range, useFov)) {
      viewer.sawAt = [px, pz];
      viewer.sawT = this.time;
      return true;
    }
    if (!viewer.sawAt || this.time - viewer.sawT > 45 || this.player.vehicle) return false;
    if (dist(px, pz, viewer.sawAt[0], viewer.sawAt[1]) > 3.5) return false;
    if (dist(viewer.x, viewer.z, px, pz) > range * 1.2) return false;
    return !segmentBlocked(viewer.x, viewer.z, px, pz, this.city.los);
  }

  // Police nearby hear gunfire and know roughly where it came from.
  heardShot(x, z) {
    if (this.stars === 0) return;
    const near = this.police.units.some((u) => !u.leaving && (dist(u.car.x, u.car.z, x, z) < 80
      || u.officers.some((o) => o.standing && dist(o.x, o.z, x, z) < 80)));
    if (!near) return;
    this.lastKnown = [x, z];
    this.lastSeen = Math.max(this.lastSeen, this.time - 3);
    this.unseenT = 0;
  }

  get searchRadius() {
    return 35 + this.stars * 8;
  }

  // An officer shoots at a car's tires (front tires first).
  shootTire(shooter, v) {
    const order = [...v.wheels.keys()].filter((i) => !v.wheels[i].userData.flat)
      .sort((a, b) => (v.wheels[b].userData.front ? 1 : 0) - (v.wheels[a].userData.front ? 1 : 0));
    if (!order.length) return;
    const i = Math.random() < 0.75 ? order[0] : order[Math.floor(Math.random() * order.length)];
    const [wx, wy, wz] = v.wheelPos(i);
    const d = dist(shooter.x, shooter.z, wx, wz);
    const h = shooter.heading;
    const y0 = this.city.groundY(shooter.x, shooter.z) + 1.45;
    const m = [shooter.x + Math.sin(h) * 0.9 - Math.cos(h) * 0.37, y0, shooter.z + Math.cos(h) * 0.9 + Math.sin(h) * 0.37];
    // Harder to hit far away or at speed.
    const p = clamp(0.55 - d * 0.008, 0.15, 0.5) * (1 - Math.min(0.5, Math.abs(v.speed) / 60));
    const hit = Math.random() < p;
    const miss = hit ? 0 : 1.2;
    const tx = wx + (Math.random() - 0.5) * miss * 2;
    const tz = wz + (Math.random() - 0.5) * miss * 2;
    this.effects.muzzle(m[0], m[1], m[2]);
    this.effects.tracer(m[0], m[1], m[2], tx, wy, tz, 0xffd28a);
    const [px, pz] = this.player.pos();
    this.sfx.shotAt('pistol', dist(shooter.x, shooter.z, px, pz));
    this.scareNearby(shooter.x, shooter.z, 40, true);
    this.effects.impact(tx, wy, tz);
    if (hit && v.popTire(i)) {
      this.effects.smoke(wx, 0.5, wz);
      if (v.driver === 'player') this.hud.toast(v.flatCount >= 2 ? 'Tires shot out!' : 'Tire shot out!', '#ff8080');
    }
  }

  hurtPlayer(dmg) {
    if (this.wastedT > 0 || this.bustedT > 0) return;
    const v = this.player.vehicle;
    if (v) {
      v.damage(dmg * 0.7, false);
      dmg *= 0.35;
    }
    // Body armor soaks up 70% of each hit until it's worn through.
    if (this.armor > 0) {
      const soak = Math.min(this.armor, dmg * 0.7);
      this.armor -= soak;
      dmg -= soak;
    }
    this.health -= dmg;
    this.lastHurt = this.time;
    this.hud.hurt();
    if (this.health <= 0) this.wasted();
  }

  explode(v) {
    const { x, z } = v;
    v.burnOut();
    this.effects.explosion(x, z);
    const [px, pz] = this.player.pos();
    this.sfx.explosionAt(dist(x, z, px, pz));
    if (v.driver && v.driver !== 'player' && v.driver.active !== undefined) v.driver.active = false;
    this.crew.carDestroyed(v);
    if (this.player.vehicle === v) {
      this.player.exit();
      this.hurtPlayer(95);
    } else if (!this.player.vehicle) {
      const d = dist(x, z, this.player.x, this.player.z);
      if (d < 7) this.hurtPlayer(90 * (1 - d / 7));
    }
    for (const c of this.characters()) {
      if (!c.alive) continue;
      const d = dist(x, z, c.x, c.z);
      if (d < 4.5) {
        const killed = c.takeHit(999, x, z);
        if (v.byPlayer && !v.playerUsed && killed) this.onPlayerHit(c, true);
      } else if (d < 8) c.knockDown(x, z, 2);
    }
    for (const o of this.vehicles) {
      if (o === v || o.removed) continue;
      const d = dist(x, z, o.x, o.z);
      if (d < 8) o.damage(70 * (1 - d / 8), v.byPlayer);
    }
    this.scareNearby(x, z, 50, true);
    // Only blowing up someone else's car is a crime (and news); your own wreck isn't.
    const yours = v.playerUsed || v === this.player.vehicle;
    if (v.byPlayer && !yours) this.crime('explosion', x, z);
    if (v.isHeliWreck) this.newsIncident(`Police helicopter shot down over ${streetAt(x, z)}`, x, z);
  }

  updateVehicleDamage(dt) {
    for (const v of this.vehicles) {
      if (v.removed || v.exploded) continue;
      if (v.health < 40 && Math.random() < dt * 8) this.effects.smoke(v.x, 1.4, v.z, v.health < 15);
      // Driving on a rim throws sparks.
      if (v.flatCount && Math.abs(v.speed) > 6) {
        v.wheels.forEach((wh, i) => {
          if (wh.userData.flat && Math.random() < dt * 12) {
            const [wx, , wz] = v.wheelPos(i);
            this.effects.sprite(wx, 0.1, wz, { color: 0xffc070, size: 0.12, life: 0.2, additive: true, vx: (Math.random() - 0.5) * 4, vy: 1.5, vz: (Math.random() - 0.5) * 4 });
          }
        });
      }
      if (v.wrecked) {
        // NPC occupants bail out of a burning car.
        const d = v.driver;
        if (d && d !== 'player') {
          if (d.officers) {
            for (const o of d.officers) o.dismount(1);
          } else {
            d.active = false;
            v.driver = null;
            const [fx, fz] = v.forward();
            this.peds.addAt(v.x + fz * 2.2, v.z - fx * 2.2).scare(v.x, v.z);
          }
        }
        if (Math.random() < dt * 25) this.effects.fire(v.x, 1.3, v.z);
        v.burnT -= dt;
        if (v.burnT <= 0) this.explode(v);
      }
    }
  }

  dropAmmo(x, z, weapon, amount) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.4), lam(weapon === 'smg' ? 0x4b5320 : 0x5d4037));
    mesh.position.set(x, 0.6, z);
    this.scene.add(mesh);
    this.pickups.push({ x, z, weapon, amount, mesh, t: 60 });
  }

  // Cash on a body: a spinning wad of bills next to it. Walk (or drive) over it to grab it.
  dropCash(x, z, amount) {
    const g = new THREE.Group();
    const wad = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.24), lam(0x2e8b3a));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.25), lam(0xf2e9b8));
    g.add(wad, band);
    g.position.set(x, 0.5, z);
    this.scene.add(g);
    this.pickups.push({ x, z, cash: amount, mesh: g, t: 90 });
  }

  // Bodies drop what they were carrying. Civilians often have a little; gang members
  // usually have a lot more. (Your crew and cops: nothing.)
  checkBodies() {
    const [px, pz] = this.player.pos();
    for (const c of this.characters()) {
      if (c.alive || c.cashChecked) continue;
      c.cashChecked = true;
      if (c.isCop || c.isCrew || dist(c.x, c.z, px, pz) > 160) continue;
      const r = Math.random();
      let amount = 0;
      if (c.isGang || c.isSoldier) {
        if (Math.random() < 0.9) amount = Math.round(40 + 260 * Math.pow(r, 1.5));
      } else if (Math.random() < 0.65) amount = Math.round(5 + 55 * r * r);
      if (amount > 0) this.dropCash(c.x + rand(-0.6, 0.6), c.z + rand(-0.6, 0.6), amount);
    }
  }

  // Bodies sink away after a little while (wherever you are).
  clearBodies(dt) {
    for (const c of this.characters()) {
      if (c.alive || c.bodyGone) continue;
      c.deadT = (c.deadT || 0) + dt;
      if (c.deadT < 25) continue;
      c.char.group.position.y -= (c.deadT - 25) * 0.35; // sink into the ground over 3 s
      if (c.deadT > 28) {
        c.bodyGone = true;
        if (c.isCop) c.char.group.visible = false; // stays on the unit's roster, just gone from view
        else c.dispose();
      }
    }
  }

  updatePickups(dt) {
    this.checkBodies();
    this.clearBodies(dt);
    for (const p of this.pickups) {
      p.t -= dt;
      p.mesh.rotation.y += dt * 2;
      p.mesh.position.y = this.city.groundY(p.x, p.z) + (p.cash ? 0.3 : 0.55) + Math.sin(this.time * 3) * 0.1;
      if (p.cash) {
        const v = this.player.vehicle;
        const [px, pz] = this.player.pos();
        // On foot only: you have to get out and pick it up.
        const grab = !v && dist(p.x, p.z, px, pz) < 1.4;
        if (grab) {
          this.cash += p.cash;
          this.hud.toast(`+$${p.cash}`);
          this.sfx.cash?.();
          this.save();
          p.t = 0;
        }
      } else if (!this.player.vehicle && dist(p.x, p.z, this.player.x, this.player.z) < 1.4) {
        this.arsenal.ammo[p.weapon].reserve += p.amount;
        const name = WEAPONS.find((w) => w.id === p.weapon).name;
        this.hud.toast(`+${p.amount} ${name} ammo`);
        p.t = 0;
      }
      if (p.t <= 0) this.scene.remove(p.mesh);
    }
    this.pickups = this.pickups.filter((p) => p.t > 0);
  }

  // Screen offset of a character's chest from the crosshair, as a fraction of screen height.
  crosshairOffset(c) {
    tmpV.set(c.x, this.city.groundY(c.x, c.z) + 1.3, c.z).project(this.camera);
    if (tmpV.z > 1) return Infinity;
    const sx = (tmpV.x * innerWidth) / 2;
    const sy = (tmpV.y * innerHeight) / 2;
    return Math.hypot(sx, sy) / innerHeight;
  }

  updateAimAssist(dt, a) {
    const p = this.player;
    const valid = (c) =>
      c.alive && c.standing && !c.isCrew && dist(c.x, c.z, p.x, p.z) < 40 && !segmentBlocked(p.x, p.z, c.x, c.z, this.city.los);
    this.lockIgnoreT = (this.lockIgnoreT || 0) - dt;

    // Pushing the stick away far enough breaks the lock.
    let t = this.lockTarget;
    if (t && (!valid(t) || this.crosshairOffset(t) > 0.25)) {
      this.lockIgnore = t;
      this.lockIgnoreT = 0.5;
      t = this.lockTarget = null;
    }
    if (!t) {
      let best = null;
      let bestOff = Infinity;
      for (const c of this.characters()) {
        if (!valid(c)) continue;
        if (c === this.lockIgnore && this.lockIgnoreT > 0) continue;
        const off = this.crosshairOffset(c);
        const grab = c.isGang || c.isCop || c.shopkeeper ? 0.07 : 0.04; // bystanders are harder to lock
        if (off < grab && off < bestOff) {
          bestOff = off;
          best = c;
        }
      }
      t = this.lockTarget = best;
      this.lockHead = false;
    }
    if (t) {
      // Flick the right stick to one side: snap to the next opp or civilian that way on screen.
      // Keep holding it there (with nobody that way) to break the lock and aim freely.
      const fullX = Math.abs(a.lookX) > dt * 2.3;
      if (!fullX) this.flickUsed = false;
      if (fullX && !this.flickHeld && !this.flickUsed) {
        const next = this.nextTarget(t, a.lookX < 0 ? 1 : -1, valid);
        if (next) {
          this.lockTarget = next;
          this.lockHead = false;
          this.flickUsed = true; // let go of the stick before the next flick
          this.breakT = 0;
          this.flickHeld = fullX;
          a.lookX = a.lookY = 0;
          return;
        }
      }
      this.flickHeld = fullX;
      this.breakT = fullX && !this.flickUsed ? (this.breakT || 0) + dt : 0;
      if (this.breakT > 0.15) {
        this.lockIgnore = t;
        this.lockIgnoreT = 0.6;
        this.lockTarget = null;
        this.breakT = 0;
        return;
      }
      // Flick up for the head, down for the torso.
      if (a.lookY < -dt * 0.6) this.lockHead = true;
      else if (a.lookY > dt * 0.6) this.lockHead = false;
      a.lookX *= 0.35;
      a.lookY = 0;
      // Turn the camera so the crosshair lands on the aim point (using last frame's view).
      tmpV.set(...this.lockAimPoint(t)).project(this.camera);
      if (tmpV.z < 1) {
        const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
        const ex = Math.atan(tmpV.x * tanV * this.camera.aspect);
        const ey = Math.atan(tmpV.y * tanV);
        const k = Math.min(1, dt * 14);
        this.camYaw -= ex * k;
        this.camPitch = clamp(this.camPitch - ey * k, -0.3, 1.0);
      }
    }
  }

  // The closest target to the right (dir 1) or left (dir -1) of the current one on screen.
  nextTarget(cur, dir, valid) {
    const asp = this.camera.aspect;
    tmpV.set(cur.x, this.city.groundY(cur.x, cur.z) + 1.3, cur.z).project(this.camera);
    const x0 = tmpV.x * asp;
    const y0 = tmpV.y;
    let best = null;
    let bestS = Infinity;
    for (const c of this.characters()) {
      if (c === cur || !valid(c)) continue;
      tmpV.set(c.x, this.city.groundY(c.x, c.z) + 1.3, c.z).project(this.camera);
      if (tmpV.z > 1 || Math.abs(tmpV.x) > 0.95 || Math.abs(tmpV.y) > 0.95) continue; // must be in view
      const dx = (tmpV.x * asp - x0) * dir;
      if (dx < 0.02) continue;
      const s = dx + Math.abs(tmpV.y - y0) * 1.5 - (c.isGang || c.isSoldier || c.isCop ? 0.1 : 0); // opps first when close
      if (s < bestS) {
        bestS = s;
        best = c;
      }
    }
    return best;
  }

  // ---- Player actions ----

  nearestVehicle(maxD) {
    let best = null;
    let bd = maxD;
    for (const v of this.vehicles) {
      if (v.exploded) continue;
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
    if (v.gangCar) this.turfWars.carStolen(v);
    if (d && d !== 'player') {
      if (d.riders) {
        d.dismount(); // a gang crew on its way to a fight: they jump out (and they're angry)
      } else if (d.officers) {
        for (const o of d.officers) o.dismount(-1);
        this.crime('stealCopCar', v.x, v.z);
      } else {
        d.active = false;
        const [fx, fz] = v.forward();
        const ped = this.peds.addAt(v.x + fz * 2.8, v.z - fx * 2.8); // thrown out the driver door
        ped.scare(this.player.x, this.player.z);
        this.crime('carjack', v.x, v.z);
      }
    } else if ((v.typeName === 'police' || v.typeName === 'swat') && !v.exploded) {
      this.crime('stealCopCar', v.x, v.z);
    }
    v.siren = false;
    this.lockTarget = null;
    this.player.enter(v);
  }

  punch() {
    const p = this.player;
    if (p.punchT > 0) return;
    p.punchT = 0.3;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    for (const t of this.characters()) {
      if (!t.standing || t.isCrew) continue;
      const dx = t.x - p.x;
      const dz = t.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.7 || (dx * fx + dz * fz) / (d || 1) < 0.4) continue;
      t.knockDown(p.x, p.z, 0.6);
      if (t.isCop) this.crime('assaultCop', t.x, t.z);
      else if (t.isGang) this.gang.anger();
      else {
        this.crime('assault', t.x, t.z);
        this.scareNearby(t.x, t.z, 14);
      }
      return;
    }
  }

  // gun: shots or explosions, which make people dive, duck and hide instead of just running.
  scareNearby(x, z, r, gun = false) {
    if (gun) this.lastLoudT = this.time;
    for (const ped of this.peds.peds) if (dist(ped.x, ped.z, x, z) < r) ped.scare(x, z, gun);
  }

  // A news story with helicopter footage of what just happened.
  // --- News stories ---
  // A shootout or rampage is one story: the first thing that happens makes the news, the rest
  // is just counted, and when it's over (escaped, arrested, killed, or things go quiet) one
  // wrap-up story gives the toll.
  storyEvent(kind, x, z, headline, clip = true) {
    let st = this.story;
    if (!st) {
      st = this.story = { cops: 0, gang: 0, civ: 0, street: streetAt(x, z), x, z, lastT: this.time };
      if (clip) this.newsIncident(headline, x, z);
      else this.hud.news(headline);
    }
    st.lastT = this.time;
    if (kind) st[kind]++;
  }

  storyToll(st) {
    const n = (k, one, many) => (st[k] ? `${st[k]} ${st[k] === 1 ? one : many}` : null);
    const parts = [n('cops', 'officer', 'officers'), n('gang', 'gang member', 'gang members'), n('civ', 'bystander', 'bystanders')].filter(Boolean);
    if (!parts.length) return '';
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
    return `${list} dead`;
  }

  // Close the current story with a headline (plus the toll). Returns true if it posted one.
  endStory(headline, x, z, kind = 'crime', always = false) {
    const st = this.story;
    this.story = null;
    const toll = st ? this.storyToll(st) : '';
    if (!st && !always) return false;
    if (!headline) {
      if (!toll || st.cops + st.gang + st.civ < 2) return false; // one body was already the story
      this.hud.news(`Violence on ${st.street} leaves ${toll}`);
      return true;
    }
    this.newsIncident(toll ? `${headline} after a rampage that left ${toll}` : headline, x, z, kind);
    return true;
  }

  newsIncident(headline, x, z, kind = 'crime') {
    const clip = this.aircam.incident(headline, x, z);
    const item = this.hud.news(headline, kind);
    if (clip && item) this.hud.attachClip(item, clip, () => this.clipPlayer.play(clip));
  }

  // Inventory strip. Tap L1 / Tab to swap between your two weapons; hold it to show the
  // strip (weapons, ammo, cash, drugs). The game keeps running.
  updateStrip(dt, a) {
    const S = this.stripState || (this.stripState = { holdT: 0, open: false });
    if (a.stripHeld && this.wastedT <= 0 && this.bustedT <= 0) {
      S.holdT += dt;
      if (!S.open && S.holdT > 0.2) S.open = true;
    } else if (S.holdT > 0) {
      if (!S.open) this.arsenal.swap();
      S.open = false;
      S.holdT = 0;
    }
    this.hud.inventoryStrip(this, S);
  }

  // Tire smoke and skid marks from burnouts and drifts.
  tireFx(v, dt) {
    const burn = v.burnout;
    const slide = v.drift > 2.5 || (v.grip < 0.6 && Math.abs(v.speed) > 8);
    if (!burn && !slide) return;
    this.tireFxT = (this.tireFxT || 0) - dt;
    const rear = v.wheels.map((w, i) => i).filter((i) => !v.wheels[i].userData.front);
    for (const i of rear) {
      const [wx, , wz] = v.wheelPos(i);
      if (slide || Math.random() < 0.3) this.effects.skid(wx, wz, v.heading);
    }
    if (this.tireFxT > 0) return;
    this.tireFxT = burn ? 0.05 : 0.08;
    for (const i of rear) {
      const [wx, , wz] = v.wheelPos(i);
      this.effects.tireSmoke(wx, wz, burn ? 1 : Math.min(1, v.drift / 8));
    }
  }

  // Cars hitting people.
  checkRunOver() {
    for (const v of this.vehicles) {
      if (Math.abs(v.speed) < 4) continue;
      for (const t of this.characters()) {
        if (!t.standing) continue;
        if (Math.abs(t.x - v.x) > 4 || Math.abs(t.z - v.z) > 4) continue;
        let hit = false;
        for (const [cx, cz] of v.circles()) if (dist(cx, cz, t.x, t.z) < v.radius + 0.35) hit = true;
        if (!hit) continue;
        // Only your driving kills outright; computer-driven cars knock people over.
        const fast = Math.abs(v.speed) > 9 && v.driver === 'player'; // ~20 mph and up is deadly
        const killed = fast ? t.takeHit(999, v.x, v.z) : false;
        if (!killed) t.knockDown(v.x, v.z, 2);
        v.speed *= 0.85;
        if (v.driver === 'player') {
          if (t.isCop) this.crime(killed ? 'copKilled' : 'runOverCop', t.x, t.z);
          else if (t.isGang || t.isCrew || t.isSoldier) this.onPlayerHit(t, killed);
          else this.crime(killed ? 'murder' : 'hitAndRun', t.x, t.z);
          this.scareNearby(t.x, t.z, 16);
        }
      }
    }
  }

  handleInteractions(dt, a) {
    const p = this.player;
    const input = this.input;
    this.prompt = '';
    this.progress = null;
    const city = this.city;
    // A drug deal or a pickup in progress has the buttons right now.
    if (this.drugs.prompt || this.drugs.progress) {
      this.prompt = this.drugs.prompt;
      this.progress = this.drugs.progress;
      return;
    }

    if (p.busy) return; // tumbling / getting up
    if (p.vehicle) {
      const v = p.vehicle;
      // Getting out: stopped -> step out; 30 mph or less -> brake hard to a stop first;
      // faster -> bail out and tumble.
      if (a.enter && !p.exitStop) {
        const mph = Math.abs(v.speed) * 2.237;
        if (mph < 2) {
          p.exit();
          return;
        }
        if (mph <= 30) p.exitStop = true;
        else {
          p.bail();
          return;
        }
      }
      if (p.exitStop) {
        this.prompt = 'Stopping…';
        return;
      }
      if (v.wrecked) {
        this.prompt = `Your car is on fire! Press ${input.label('enter')} to get out`;
        return;
      }
      if (this.shops.interact(a, dt)) return;
      const chop = city.chop;
      if (dist(v.x, v.z, chop.x, chop.z) < chop.r) {
        if (this.stars > 0) this.prompt = 'Lose the cops before the chop shop will take this car';
        else {
          const price = Math.round((v.type.value * (v.health / 100) * 0.6 + v.type.value * 0.4) / 10) * 10;
          this.prompt = `Press ${input.label('interact')} to sell this ${v.type.label.toLowerCase()} for $${price}`;
          if (a.interactHeld && !this.interactWasHeld && Math.abs(v.speed) < 4) {
            p.exit();
            v.dispose();
            this.cash += price;
            const cred = v.typeName === 'police' || v.typeName === 'swat' ? 25 : 6;
            this.cred += cred;
            this.hud.toast(`+$${price}  +${cred} cred`);
            this.save();
          }
        }
      }
      return;
    }

    if (a.enter) {
      const v = this.nearestVehicle(3.8);
      if (v) {
        this.enterVehicle(v);
        return;
      }
    }

    // Weapons.
    if (a.slot === 0 || a.slot === 1) this.arsenal.selectSlot(a.slot);
    if (a.nextWeapon || a.prevWeapon) this.arsenal.swap();
    if (a.reload) this.arsenal.startReload();
    const w = this.arsenal.current();
    p.showWeapon(w.id);
    if (a.melee || (w.melee && a.firePressed)) this.punch();
    else this.tryFire(a);

    // Store robberies.
    const store = city.stores.find((s) => dist(s.x, s.z, p.x, p.z) < s.r);
    if (store) {
      if (store.cooldown > 0) this.prompt = `${store.name} was robbed recently. Come back later.`;
      else if (a.interactHeld) {
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
        this.prompt = `Hold ${input.label('interact')} to rob ${store.name}`;
      }
    } else if (this.shops.interact(a, dt)) {
      this.robbing = null;
    } else if (this.crewInteraction(a)) {
      this.robbing = null;
    } else if (this.turfWars.interact(a, dt)) {
      this.robbing = null;
    } else {
      this.robbing = null;
      const v = this.nearestVehicle(3.8);
      if (v) {
        const occupied = v.driver && v.driver !== 'player';
        this.prompt = occupied
          ? `Press ${input.label('enter')} to carjack this ${v.type.label.toLowerCase()}`
          : `Press ${input.label('enter')} to get in`;
      }
    }
  }

  // Recruit homies at the hangout, or send your crew home there. Returns true if it showed a prompt.
  crewInteraction(a) {
    const p = this.player;
    const press = a.interactHeld && !this.interactWasHeld;
    const key = this.input.label('interact');
    const crew = this.crew;
    const near = crew.members.find((m) => !m.recruited && m.standing && dist(m.x, m.z, p.x, p.z) < 2.6);
    if (near) {
      const n = crew.following.length;
      if (n >= MAX_CREW) this.prompt = `Your crew is full (${n}/${MAX_CREW})`;
      else {
        this.prompt = `Press ${key} to recruit ${near.name} · ${near.heartLabel} (crew ${n}/${MAX_CREW})`;
        if (press) crew.recruit(near);
      }
      return true;
    }
    const atHome = dist(p.x, p.z, crew.home.x, crew.home.z) < 14;
    const mine = atHome && crew.following.find((m) => m.standing && dist(m.x, m.z, p.x, p.z) < 2.6);
    if (mine) {
      this.prompt = `Press ${key} to send ${mine.name} home`;
      if (press) crew.dismiss(mine);
      return true;
    }
    return false;
  }

  // ---- Camera ----

  updateCamera(dt, a) {
    this.camYaw += a.lookX;
    this.camPitch = clamp(this.camPitch + a.lookY, this.player.vehicle ? -0.5 : -1.3, 1.0);
    if (a.looking) this.camIdle = 0;
    else this.camIdle += dt;

    const v = this.player.vehicle;
    const down = this.wastedT > 0;
    let tx, tz, ty, distBack, height, shoulder = 0, fov = 65;
    if (v) {
      // Swing behind the car when the camera stick/mouse is idle.
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
      ty = this.player.lowProfile ? 1.15 : 1.7;
      distBack = down ? 7 : 5.5;
      height = 1.2;
      // In cover: a wider view so you can see around you.
      if (this.player.cover) {
        fov = 82;
        distBack = 4.8;
      }
      if (this.aimingNow) {
        distBack = 3.6;
        height = 0.45;
        shoulder = 0.45;
        fov = 56;
      }
      // Camera over the shoulder of the gun hand (left when peeking left out of cover).
      if (this.player.gunHand === 'L') shoulder = -Math.max(shoulder, 0.35);
      else if (this.player.cover && !this.aimingNow) shoulder = 0.35;
    }
    // Looking up: instead of sinking into the ground, the camera tucks in close behind your
    // head so you can still aim steeply upward (e.g. at the helicopter).
    if (this.camPitch < 0) {
      const room = ty + height - 0.5;
      distBack = Math.min(distBack, room / Math.max(0.01, -Math.sin(this.camPitch)));
      distBack = Math.max(distBack, 1.2);
    }
    const cp = Math.cos(this.camPitch);
    const rx = -Math.cos(this.camYaw), rz = Math.sin(this.camYaw);
    let cx = tx - Math.sin(this.camYaw) * distBack * cp + rx * shoulder;
    let cz = tz - Math.cos(this.camYaw) * distBack * cp + rz * shoulder;
    let cy = ty + height + Math.sin(this.camPitch) * distBack;
    // Don't let the camera go inside buildings (e.g. when you're in cover against a wall):
    // pull it in to just in front of the wall.
    const ox = tx + rx * shoulder * 0.5, oy = ty + 0.6, oz = tz + rz * shoulder * 0.5;
    const ddx = cx - ox, ddy = cy - oy, ddz = cz - oz;
    const len = Math.hypot(ddx, ddy, ddz) || 1;
    let free = len;
    for (const b of this.city.los) {
      if (Math.abs((b.minX + b.maxX) / 2 - ox) > 60 || Math.abs((b.minZ + b.maxZ) / 2 - oz) > 60) continue;
      const t = rayBox(ox, oy, oz, ddx / len, ddy / len, ddz / len, b.minX - 0.25, 0, b.minZ - 0.25, b.maxX + 0.25, b.h || 30, b.maxZ + 0.25);
      if (t !== null && t < free) free = t;
    }
    const want = Math.max(0.8, free - 0.1);
    this.camFree = want < (this.camFree ?? len) ? want : lerp(this.camFree ?? len, want, Math.min(1, dt * 4));
    if (this.camFree < len) {
      const k = this.camFree / len;
      cx = ox + ddx * k;
      cy = oy + ddy * k;
      cz = oz + ddz * k;
    }
    const shake = v ? v.crash * 0.01 : 0;
    this.camera.position.set(cx + rand(-shake, shake), Math.max(0.6, cy), cz + rand(-shake, shake));
    this.camera.lookAt(tx + rx * shoulder, ty + 0.6, tz + rz * shoulder);
    if (Math.abs(this.camera.fov - fov) > 0.1) {
      this.camera.fov = lerp(this.camera.fov, fov, Math.min(1, dt * 10));
      this.camera.updateProjectionMatrix();
    }

    // Keep the sun's shadow box around the player.
    this.sun.position.set(tx + 60, 120, tz + 40);
    this.sun.target.position.set(tx, 0, tz);
  }

  // ---- Main loop ----

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.input.poll();
    const a = this.input.actions(dt);
    if (!this.started) {
      document.getElementById('pad-note').textContent = this.input.padConnected
        ? 'Controller connected. Press ✕ to play.'
        : this.input.padBlocked
          ? 'This page blocks controllers. Run the game locally (npm run dev) to use a PS5 controller.'
          : 'Plug in or pair a PS5 controller and press any button, then ✕ to play.';
      if (a.start) this.start();
    } else if (this.shops.menu) {
      // Shop menu: the game is paused underneath.
      this.shops.updateMenu(a);
    } else if (this.mapView.open) {
      // Full map: the game is paused underneath.
      if (a.map || a.closeClip || a.pause) this.mapView.hide();
      else this.mapView.update(dt, a);
    } else if (a.map && !this.paused) {
      this.mapView.show();
    } else if (a.pause) {
      this.setPaused(!this.paused);
    } else if (!this.paused) {
      this.update(dt, a);
    }
    this.renderer.render(this.scene, this.camera);
    this.interactWasHeld = a.interactHeld;
    this.input.endFrame();
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt, a) {
    this.time += dt;
    // A story with no police after it goes quiet after a while.
    if (this.story && this.stars === 0 && this.time - this.story.lastT > 45) this.endStory(null);
    const wp = this.mapView.waypoint;
    if (wp && dist(...this.player.pos(), ...wp) < 14) {
      this.mapView.waypoint = null;
      this.hud.toast('Waypoint reached');
    }
    // GPS route to the waypoint, refreshed as you move.
    this.gpsT = (this.gpsT || 0) - dt;
    const w = this.mapView.waypoint;
    if (!w) this.gps = null;
    else if (this.gpsT <= 0 || !this.gps || this.gpsFor !== w) {
      this.gpsT = 0.3;
      this.gpsFor = w;
      this.gps = gpsRoute(this.city, ...this.player.pos(), ...w);
    }
    this.gpsLine.update(dt, this.gps, w);
    if (a.phone) {
      this.hud.togglePhone();
      if (this.hud.phoneOpen && this.input.locked) this.input.unlock(); // so you can tap stories
    }
    // Phone open (D-pad →): D-pad ↑ / ↓ step through stories, ✕ / Enter plays a video.
    // ○ / Esc closes a video.
    if (this.hud.phoneOpen) {
      // Scroll stories: mouse wheel or right stick too.
      if (a.wheelDelta) this.hud.scrollPhone(a.wheelDelta * 60);
      if (Math.abs(a.rsY) > 0.2) {
        this.hud.scrollPhone(a.rsY * dt * 600);
        a.lookX = a.lookY = 0;
        a.looking = false;
      }
      if (a.dpadDown || a.dpadUp) this.hud.moveClipSelection(a.dpadDown ? 1 : -1);
      a.nextWeapon = a.prevWeapon = false;
      a.interactHeld = a.interactKey; // D-pad ↑ is for the phone right now
      // □ / R: contacts (plugs: set up a pickup, pay what you owe).
      if (a.reload) {
        a.reload = false;
        this.hud.togglePhone();
        this.shops.openCustom('Contacts', () => this.drugs.contacts());
      }
      if (a.playClip) {
        const clip = this.hud.selectedClip();
        if (clip) this.clipPlayer.play(clip);
        a.sprint = false;
      }
    }
    if (this.clipPlayer.open && a.closeClip) this.clipPlayer.close();
    if (a.spawnCar && CFG.CAR_SPAWN_KEY) this.spawnTestCar();
    this.effects.update(dt);
    this.aircam.update(dt);
    this.clipPlayer.update(dt);

    if (this.bustedT > 0 || this.wastedT > 0) {
      if (this.bustedT > 0) {
        this.bustedT -= dt;
        if (this.bustedT <= 0) this.afterBust();
      } else {
        this.wastedT -= dt;
        if (this.wastedT <= 0) this.afterWasted();
      }
      this.aimingNow = false;
      if (this.stripState) this.stripState.open = false;
      this.hud.inventoryStrip(this, { open: false });
      this.showCrosshair = false;
      this.lockScreen = null;
      this.updateCamera(dt, a);
      this.hud.update(this, dt);
      return;
    }

    // Who traffic should stop for.
    this.walkers.length = 0;
    if (!this.player.vehicle) this.walkers.push(this.player);
    for (const p of this.peds.peds) if (p.standing) this.walkers.push(p);

    const p = this.player;
    this.drugs.update(dt, a);
    this.updateStrip(dt, a);
    this.arsenal.update(dt);
    const gun = !this.arsenal.current().melee;
    this.aimingNow = !p.vehicle && !p.busy && gun && a.aim;
    // Crouch: toggle with C / L3; sprinting stands you up; aiming pops you up out of cover.
    // One button (C / L3): next to a wall, crate or car it puts you in cover (and you stay
    // there until you press it again or push away); out in the open it toggles crouch.
    if (a.crouch && !p.vehicle) {
      if (p.cover) {
        p.leaveCover();
        p.crouched = false;
      } else if (!p.tryCover(this.camYaw, a)) p.crouched = !p.crouched;
    }
    if (a.sprint && Math.hypot(a.moveX, a.moveY) > 0.3) p.crouched = false;
    p.lowProfile = !p.vehicle && (p.crouched || !!(p.cover && p.cover.low)) && !this.aimingNow;

    // Controller aim assist: aim freely with the right stick; the reticle sticks
    // to a target when the crosshair passes close to it.
    if (this.input.mode === 'pad' && this.aimingNow) this.updateAimAssist(dt, a);
    else this.lockTarget = null;

    if (p.vehicle) {
      const v = p.vehicle;
      if (p.exitStop) {
        // Braking hard to a stop so you can get out.
        const stopped = Math.abs(v.speed) < 0.8;
        // About 1 g of braking: hard but believable.
        v.update(dt, { throttle: stopped ? 0 : -Math.sign(v.speed) * (9.8 / v.type.brake), steer: a.steer * 0.3, handbrake: false }, this.city.colliders);
        if (stopped || Math.abs(v.speed) < 0.8) {
          v.speed = 0;
          v.lat = 0;
          p.exitStop = false;
          p.exit();
        }
      } else v.update(dt, { throttle: a.throttle, steer: a.steer, handbrake: a.handbrake, burnout: a.gas && a.brakeHeld, gas: a.gas, brake: a.brakeHeld }, this.city.colliders);
      if (p.vehicle) this.tireFx(v, dt);
    } else if (p.busy) {
      p.updateRolling(dt);
    } else {
      const combat = gun && (this.aimingNow || this.time - this.lastShot < 0.8 || a.fire);
      let faceYaw = combat ? this.camYaw : null;
      if (combat && this.lockTarget) faceYaw = Math.atan2(this.lockTarget.x - p.x, this.lockTarget.z - p.z);
      p.updateOnFoot(dt, a, this.camYaw, faceYaw);
    }

    this.traffic.update(dt);
    this.police.update(dt);
    this.gang.update(dt);
    this.crew.update(dt);
    this.turfWars.update(dt);
    this.shops.update(dt);
    for (const v of this.vehicles) {
      if (v.driver === null && !v.removed) {
        // A car you bailed out of keeps rolling until it slows down on its own.
        v.update(dt, { throttle: 0, steer: 0, handbrake: !v.runaway }, this.city.colliders);
        if (v.runaway && Math.abs(v.speed) < 0.5) {
          v.runaway = false;
          this.crew.carStopped(v);
        }
      }
    }
    resolveCarCollisions(this.vehicles.filter((v) => !v.removed));
    for (const v of this.vehicles) {
      v.groundY = this.city.groundY(v.x, v.z);
      v.sync(dt);
    }
    this.peds.update(dt);
    this.checkRunOver();
    this.handleInteractions(dt, a);
    this.updateVehicleDamage(dt);
    this.updatePickups(dt);
    this.vehicles = this.vehicles.filter((v) => !v.removed);
    this.cleanupVehicles();

    for (const s of this.city.stores) {
      if (s.cooldown > 0) {
        s.cooldown -= dt;
        if (s.cooldown <= 0) s.signMesh.material.color.setHex(0xffffff);
      }
    }

    // Health slowly comes back when you stay out of trouble.
    if (this.time - this.lastHurt > 6) this.health = Math.min(100, this.health + dt * 6);

    this.updateWanted(dt);
    const [px, pz] = p.pos();
    this.district = districtAt(px, pz);
    this.turf = this.turfWars.turfAt(px, pz);
    this.updateCamera(dt, a);

    this.showCrosshair = !p.vehicle && gun && (this.aimingNow || this.input.mode === 'kb');
    this.lockScreen = null;
    if (this.lockTarget) {
      const t = this.lockTarget;
      tmpV.set(...this.lockAimPoint(t)).project(this.camera);
      if (tmpV.z < 1) this.lockScreen = [((tmpV.x + 1) / 2) * innerWidth, ((1 - tmpV.y) / 2) * innerHeight];
    }
    this.updateCarMarker(dt);
    this.hud.update(this, dt);

    this.saveT += dt;
    if (this.saveT > 5) {
      this.saveT = 0;
      this.save();
    }
  }

  // Testing: R3 / V gives you one test car. If yours is still around, it points you to it instead.
  spawnTestCar() {
    const p = this.player;
    const [x, z] = p.pos();
    const old = this.testCar;
    if (old && !old.removed && !old.exploded && !old.wrecked) {
      if (p.vehicle === old) {
        this.hud.toast("You're already in your test car");
        return;
      }
      const d = dist(old.x, old.z, x, z);
      if (d < 200) {
        this.carPingT = 6;
        this.hud.toast(`Your test car is ${Math.round(d)} m away`);
        return;
      }
      if (old.driver === null) old.dispose();
    }
    const h = p.vehicle ? p.vehicle.heading : p.heading;
    const side = p.vehicle ? 3.5 : 3;
    const car = new Vehicle(this.scene, 'sports', x - Math.cos(h) * side, z + Math.sin(h) * side, h);
    this.vehicles.push(car);
    this.testCar = car;
    if (p.vehicle) p.exit();
    p.x = car.x;
    p.z = car.z;
    p.enter(car);
    this.hud.toast('Test car delivered');
  }

  // Screen marker pointing at your test car after you ask for it.
  updateCarMarker(dt) {
    this.carMarker = null;
    this.carPingT = Math.max(0, (this.carPingT || 0) - dt);
    const c = this.testCar;
    if (!this.carPingT || !c || c.removed || c.exploded || this.player.vehicle === c) return;
    tmpV.set(c.x, 2.6, c.z).project(this.camera);
    const behind = tmpV.z > 1;
    let sx = tmpV.x;
    let sy = tmpV.y;
    if (behind) {
      sx = -sx;
      sy = -1;
    }
    const edge = behind || Math.abs(sx) > 0.92 || Math.abs(sy) > 0.88;
    sx = clamp(sx, -0.92, 0.92);
    sy = clamp(sy, -0.88, 0.88);
    const [px, pz] = this.player.pos();
    this.carMarker = {
      x: ((sx + 1) / 2) * innerWidth,
      y: ((1 - sy) / 2) * innerHeight,
      edge,
      d: Math.round(dist(px, pz, c.x, c.z)),
    };
  }

  // Remove abandoned and burnt-out cars far from the player so the city doesn't fill up.
  cleanupVehicles() {
    const [px, pz] = this.player.pos();
    const abandoned = this.vehicles.filter((v) => v.driver === null && !v.gangCar);
    const far = abandoned.find((v) => dist(v.x, v.z, px, pz) > 150 && (v.exploded || abandoned.length > 10));
    if (far) far.dispose();
  }
}

const game = new Game();
window.__game = game;
game.__raycast = raycast; // handy for debugging shots from the console
document.getElementById('play').addEventListener('click', () => game.start());
document.getElementById('resume').addEventListener('click', () => game.setPaused(false));
document.getElementById('game').addEventListener('click', () => {
  game.sfx.unlock();
  if (game.started && !game.paused && !game.input.locked) game.input.lock();
});
addEventListener('keydown', () => game.sfx.unlock(), { once: false });
