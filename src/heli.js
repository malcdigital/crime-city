import * as THREE from 'three';
import { lam } from './character.js';
import { rayBox } from './weapons.js';
import { clamp, dist, lerp, lerpAngle, rand } from './util.js';

const ALT = 34; // cruising height above the street
const ORBIT = 15; // circles this far from the target

// Police helicopter. Takes off from the precinct roof, circles you, and lights you up with a
// searchlight. Once it loses you, the beam sweeps the area where you were last seen, and it
// can't see through buildings. At 5 stars a gunner in the door opens fire. It can be shot down.
export class Helicopter {
  constructor(game, roof) {
    this.game = game;
    this.x = roof.x;
    this.z = roof.z;
    this.y = roof.y + 1.2;
    this.roofY = roof.y;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.heading = Math.PI;
    this.state = 'takeoff'; // takeoff | pursuit | leave | down
    this.health = 450;
    this.orbitA = Math.random() * Math.PI * 2;
    this.t = 0;
    this.fireT = 2;
    this.sees = false;
    this.removed = false;
    this.destroyed = false;
    this.isHeli = true;
    this.aim = [this.x, this.z];
    this.build();
  }

  build() {
    const g = new THREE.Group();
    const add = (w, h, l, color, x, y, z, parent = g) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), lam(color));
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    add(2.2, 1.7, 4.0, 0x1c2a44, 0, 0, 0); // cabin
    add(2.24, 0.32, 3.2, 0xf2f2f2, 0, -0.25, -0.1); // white band
    add(1.8, 1.0, 1.2, 0x1d2630, 0, 0.2, 2.1); // windshield
    add(0.35, 0.35, 4.2, 0x1c2a44, 0, 0.35, -3.9); // tail boom
    add(0.1, 1.2, 0.8, 0x1c2a44, 0, 0.85, -5.8); // tail fin
    for (const sx of [-1, 1]) {
      add(0.1, 0.1, 3.6, 0x222222, sx * 0.95, -1.2, 0); // skids
      add(0.08, 0.4, 0.08, 0x222222, sx * 0.95, -1.0, 0.9);
      add(0.08, 0.4, 0.08, 0x222222, sx * 0.95, -1.0, -0.9);
    }
    this.rotor = new THREE.Group();
    this.rotor.position.set(0, 1.05, 0);
    add(10, 0.05, 0.32, 0x111111, 0, 0, 0, this.rotor);
    add(0.32, 0.05, 10, 0x111111, 0, 0, 0, this.rotor);
    add(0.3, 0.25, 0.3, 0x333333, 0, -0.1, 0, this.rotor);
    g.add(this.rotor);
    this.tailRotor = new THREE.Group();
    this.tailRotor.position.set(0.22, 0.85, -5.8);
    add(0.05, 1.6, 0.16, 0x111111, 0, 0, 0, this.tailRotor);
    g.add(this.tailRotor);
    // Flashing lights under the nose.
    this.lightR = new THREE.MeshBasicMaterial({ color: 0x550000 });
    this.lightB = new THREE.MeshBasicMaterial({ color: 0x000055 });
    const lr = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.3), this.lightR);
    lr.position.set(-0.6, -0.9, 1.4);
    const lb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.3), this.lightB);
    lb.position.set(0.6, -0.9, 1.4);
    g.add(lr, lb);
    g.rotation.order = 'YXZ';
    this.group = g;

    // Searchlight: a faint cone and a bright spot on the ground.
    const coneGeo = new THREE.ConeGeometry(1, 1, 20, 1, true);
    coneGeo.translate(0, -0.5, 0);
    this.beam = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
      color: 0xfff3c0, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    const spotGeo = new THREE.CircleGeometry(5, 28);
    spotGeo.rotateX(-Math.PI / 2);
    this.spot = new THREE.Mesh(spotGeo, new THREE.MeshBasicMaterial({
      color: 0xfff3c0, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const s = this.game.scene;
    s.add(g, this.beam, this.spot);
  }

  leave() {
    if (this.state !== 'down') this.state = 'leave';
  }

  // Shot by the player. Returns true if this brought it down.
  takeHit(dmg) {
    if (this.state === 'down' || this.removed) return false;
    this.health -= dmg;
    if (this.health > 0) return false;
    const game = this.game;
    this.state = 'down';
    this.destroyed = true;
    this.vy = -2;
    game.crime('copKilled', this.x, this.z);
    return true;
  }

  // Is there a clear line from the helicopter down to the ground at (x, z)?
  clearView(x, z) {
    const game = this.game;
    const ty = game.city.groundY(x, z) + 1;
    const dx = x - this.x, dy = ty - (this.y - 2), dz = z - this.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    for (const b of game.city.los) {
      if (Math.abs((b.minX + b.maxX) / 2 - (this.x + x) / 2) > 80 || Math.abs((b.minZ + b.maxZ) / 2 - (this.z + z) / 2) > 80) continue;
      const t = rayBox(this.x, this.y - 2, this.z, dx / len, dy / len, dz / len, b.minX, 0, b.minZ, b.maxX, b.h || 30, b.maxZ);
      if (t !== null && t < len - 1) return false;
    }
    return true;
  }

  // Can the crew see you? Not through buildings; and unless they already know where you
  // are, only when the searchlight lands on you.
  canSee() {
    const game = this.game;
    const [px, pz] = game.player.pos();
    const d2 = dist(this.x, this.z, px, pz);
    if (d2 > 110) return false;
    const known = game.time - game.lastSeen < 3;
    const inBeam = dist(this.aim[0], this.aim[1], px, pz) < 7;
    if (!inBeam && !(known && d2 < 70)) return false;
    const ty = game.city.groundY(px, pz) + (game.player.lowProfile ? 0.9 : 1.6);
    const dx = px - this.x, dy = ty - (this.y - 1), dz = pz - this.z;
    const len = Math.hypot(dx, dy, dz);
    for (const b of game.city.los) {
      if (Math.abs((b.minX + b.maxX) / 2 - (this.x + px) / 2) > 80 || Math.abs((b.minZ + b.maxZ) / 2 - (this.z + pz) / 2) > 80) continue;
      const t = rayBox(this.x, this.y - 1, this.z, dx / len, dy / len, dz / len, b.minX, 0, b.minZ, b.maxX, b.h || 30, b.maxZ);
      if (t !== null && t < len - 0.5) return false;
    }
    return true;
  }

  update(dt) {
    const game = this.game;
    this.t += dt;
    this.rotor.rotation.y += dt * 28;
    this.tailRotor.rotation.x += dt * 40;
    const on = Math.floor(this.t * 5) % 2 === 0;
    this.lightR.color.setHex(on ? 0xff2020 : 0x550000);
    this.lightB.color.setHex(on ? 0x000055 : 0x2050ff);
    const [px, pz] = game.player.pos();

    if (this.state === 'down') {
      // Spinning out of the sky, trailing smoke.
      this.vy -= 14 * dt;
      this.heading += dt * 5;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.z += this.vz * dt;
      this.vx *= 0.99;
      this.vz *= 0.99;
      game.effects.smoke(this.x, this.y, this.z, true);
      game.effects.fire(this.x, this.y, this.z);
      this.beam.visible = this.spot.visible = false;
      if (this.y <= game.city.groundY(this.x, this.z) + 1) {
        game.explode({ x: this.x, z: this.z, burnOut() {}, byPlayer: true, driver: null, isHeliWreck: true });
        this.dispose();
        return;
      }
      this.place();
      return;
    }

    // Where to fly: around you if they know where you are, otherwise around where you were last seen.
    const known = game.time - game.lastSeen < 3;
    const [kx, kz] = known ? [px, pz] : game.lastKnown || [px, pz];
    let gx, gz, gy;
    if (this.state === 'takeoff') {
      gx = this.x;
      gz = this.z;
      gy = this.roofY + 14;
      if (this.y > this.roofY + 10) this.state = 'pursuit';
    } else if (this.state === 'leave') {
      const d = dist(this.x, this.z, px, pz) || 1;
      gx = this.x + ((this.x - px) / d) * 60;
      gz = this.z + ((this.z - pz) / d) * 60;
      gy = 70;
      if (d > 260) {
        this.dispose();
        return;
      }
    } else {
      // Circle the target; if a building blocks the view, keep moving round to a clear angle.
      this.losT = (this.losT || 0) - dt;
      if (this.losT <= 0) {
        this.losT = 0.4;
        this.blockedView = !this.clearView(kx, kz);
      }
      this.orbitA += dt * (this.blockedView ? 1.1 : 0.3);
      gx = kx + Math.cos(this.orbitA) * ORBIT;
      gz = kz + Math.sin(this.orbitA) * ORBIT;
      gy = ALT;
    }
    // Stay well above the rooftops around it and around the target, so it (and its
    // camera) can see down into the streets instead of into the side of a tower.
    let roofs = 0;
    for (const b of game.city.los) {
      const cx = Math.max(b.minX, Math.min(this.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(this.z, b.maxZ));
      const tx2 = Math.max(b.minX, Math.min(kx, b.maxX));
      const tz2 = Math.max(b.minZ, Math.min(kz, b.maxZ));
      if (dist(cx, cz, this.x, this.z) < 45 || dist(tx2, tz2, kx, kz) < 35) roofs = Math.max(roofs, b.h || 30);
    }
    gy = Math.max(gy, roofs + 14);
    const max = this.state === 'takeoff' ? 6 : 32;
    let dvx = (gx - this.x) * 0.8;
    let dvz = (gz - this.z) * 0.8;
    // Too low to clear the buildings ahead: climb first, then move across.
    if (this.y < gy - 6) {
      dvx *= 0.25;
      dvz *= 0.25;
    }
    const sp = Math.hypot(dvx, dvz);
    if (sp > max) {
      dvx *= max / sp;
      dvz *= max / sp;
    }
    const dvy = clamp((gy - this.y) * 1.2, -8, 10);
    const k = Math.min(1, dt * 1.4);
    this.vx = lerp(this.vx, dvx, k);
    this.vz = lerp(this.vz, dvz, k);
    this.vy = lerp(this.vy, dvy, Math.min(1, dt * 2));
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
    const speed = Math.hypot(this.vx, this.vz);
    const faceYaw = speed > 6 ? Math.atan2(this.vx, this.vz) : Math.atan2(px - this.x, pz - this.z);
    this.heading = lerpAngle(this.heading, faceYaw, Math.min(1, dt * 1.5));
    this.group.rotation.x = clamp(speed * 0.008, 0, 0.25); // nose down when moving fast

    // Searchlight: locked on you when seen, otherwise sweeping the search area.
    this.sees = this.state === 'pursuit' && this.canSee();
    let ax, az;
    if (this.sees) [ax, az] = [px, pz];
    else {
      const r = 4 + 12 * Math.abs(Math.sin(this.t * 0.31));
      ax = kx + Math.cos(this.t * 0.9) * r;
      az = kz + Math.sin(this.t * 1.3) * r;
    }
    const ka = Math.min(1, dt * (this.sees ? 8 : 2.5));
    this.aim = [lerp(this.aim[0], ax, ka), lerp(this.aim[1], az, ka)];

    // Door gunner at 5 stars.
    if (this.sees && game.stars >= 5 && this.state === 'pursuit') {
      this.fireT -= dt;
      if (this.fireT <= 0) {
        this.fireT = rand(0.25, 0.5);
        if (Math.random() < 0.15) this.fireT = rand(1.5, 2.5); // pause between bursts
        const h = Math.atan2(px - this.x, pz - this.z);
        game.npcShoot({ x: this.x, z: this.z, heading: h, muzzleY: this.y - 1.2, crouched: false }, 7, 'smg', 0.7);
      }
    }
    if (this.health < 180) game.effects.smoke(this.x, this.y + 0.5, this.z - 1, true);
    this.place();
  }

  place() {
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.heading;
    // Beam from the belly to the spot on the ground.
    const gy = this.game.city.groundY(this.aim[0], this.aim[1]);
    const from = new THREE.Vector3(this.x, this.y - 1, this.z);
    const dir = new THREE.Vector3(this.aim[0], gy, this.aim[1]).sub(from);
    const len = dir.length();
    this.beam.position.copy(from);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
    this.beam.scale.set(5, len, 5);
    this.beam.visible = this.state !== 'takeoff';
    this.spot.position.set(this.aim[0], gy + 0.06, this.aim[1]);
    this.spot.visible = this.beam.visible;
  }

  dispose() {
    const s = this.game.scene;
    s.remove(this.group, this.beam, this.spot);
    this.removed = true;
  }
}
