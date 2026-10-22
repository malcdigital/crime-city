import * as THREE from 'three';
import { CFG } from './config.js';
import { makeCharacter, animateWalk, setDown, lam } from './character.js';
import { pushCircle } from './collision.js';
import { lerp, lerpAngle } from './util.js';

export class Player {
  constructor(game, x, z) {
    this.game = game;
    this.char = makeCharacter({ shirt: 0x1e7d32, pants: 0x1b1b1b, skin: 0x8d5524, bandana: 0x1e7d32 });
    game.scene.add(this.char.group);
    // Guns held in the right hand.
    this.guns = {
      pistol: new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.32), lam(0x1a1a1a)),
      smg: new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.6), lam(0x2a2a2a)),
    };
    for (const g of Object.values(this.guns)) {
      g.position.set(0, -0.64, 0);
      g.rotation.x = Math.PI / 2;
      g.visible = false;
      this.char.armR.add(g);
    }
    this.x = x;
    this.z = z;
    this.heading = Math.PI;
    this.speed = 0;
    this.moveX = 0;
    this.moveZ = 1;
    this.vx = 0;
    this.vz = 0;
    this.phase = 0;
    this.punchT = 0;
    this.vehicle = null;
  }

  pos() {
    return this.vehicle ? [this.vehicle.x, this.vehicle.z] : [this.x, this.z];
  }

  velocity() {
    if (this.vehicle) {
      const [fx, fz] = this.vehicle.forward();
      return [fx * this.vehicle.speed, fz * this.vehicle.speed];
    }
    return [this.vx, this.vz];
  }

  // World position of the end of the barrel of the gun in the player's hand.
  muzzle(id) {
    const g = this.guns[id];
    if (!g) return null;
    this.char.group.updateMatrixWorld(true);
    const len = g.geometry.parameters.depth;
    return g.localToWorld(new THREE.Vector3(0, 0, len / 2 + 0.02));
  }

  showWeapon(id) {
    for (const [k, g] of Object.entries(this.guns)) g.visible = k === id;
  }

  // a: actions from Input. faceYaw: set when aiming or shooting, so the player faces the crosshair.
  updateOnFoot(dt, a, camYaw, faceYaw) {
    const game = this.game;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = -fz, rz = fx;
    let mx = fx * a.moveY + rx * a.moveX;
    let mz = fz * a.moveY + rz * a.moveX;
    const len = Math.hypot(mx, mz);
    const combat = faceYaw !== null;
    let target = 0;
    if (len > 0.05) {
      mx /= len;
      mz /= len;
      this.moveX = mx;
      this.moveZ = mz;
      const base = combat ? CFG.WALK_SPEED * 0.8 : a.sprint ? CFG.SPRINT_SPEED : CFG.WALK_SPEED;
      target = base * Math.min(1, len);
    }
    if (combat) this.heading = lerpAngle(this.heading, faceYaw, Math.min(1, dt * 20));
    else if (len > 0.05) this.heading = lerpAngle(this.heading, Math.atan2(mx, mz), Math.min(1, dt * 12));
    this.speed = lerp(this.speed, target, Math.min(1, dt * 10));
    const ox = this.x, oz = this.z;
    this.x += this.moveX * this.speed * dt;
    this.z += this.moveZ * this.speed * dt;

    const r = pushCircle(this.x, this.z, 0.4, game.city.colliders);
    this.x = r.x;
    this.z = r.z;
    // Don't walk through cars.
    for (const v of game.vehicles) {
      if (Math.abs(v.x - this.x) > 5 || Math.abs(v.z - this.z) > 5) continue;
      for (const [cx, cz] of v.circles()) {
        const dx = this.x - cx, dz = this.z - cz;
        const d = Math.hypot(dx, dz);
        const min = v.radius + 0.4;
        if (d < min && d > 1e-6) {
          this.x = cx + (dx / d) * min;
          this.z = cz + (dz / d) * min;
        }
      }
    }
    this.vx = (this.x - ox) / Math.max(dt, 1e-4);
    this.vz = (this.z - oz) / Math.max(dt, 1e-4);

    this.phase += dt * this.speed * 2.6;
    animateWalk(this.char, this.phase, Math.min(1, this.speed / 2));
    if (this.punchT > 0) {
      this.punchT -= dt;
      this.char.armR.rotation.x = -1.6 * Math.sin((this.punchT / 0.3) * Math.PI);
    } else if (combat && game.arsenal.current().id !== 'fists') {
      this.char.armR.rotation.x = -1.5;
      this.char.armL.rotation.x = -1.2;
    }
    this.sync();
  }

  setDown(down) {
    setDown(this.char, down);
    this.sync();
  }

  sync() {
    const y = this.game.city.groundY(this.x, this.z);
    const down = this.char.group.rotation.x !== 0;
    this.char.group.position.set(this.x, down ? y + 0.2 : y, this.z);
    this.char.group.rotation.y = this.heading;
  }

  enter(vehicle) {
    this.vehicle = vehicle;
    vehicle.driver = 'player';
    this.char.group.visible = false;
    this.game.crew?.playerEntered(vehicle);
  }

  exit() {
    const v = this.vehicle;
    if (!v) return;
    const [fx, fz] = v.forward();
    // Get out on the driver's (left) side.
    this.x = v.x + fz * 1.9;
    this.z = v.z - fx * 1.9;
    this.heading = v.heading;
    v.driver = null;
    this.vehicle = null;
    this.speed = 0;
    this.char.group.visible = true;
    const r = pushCircle(this.x, this.z, 0.4, this.game.city.colliders);
    this.x = r.x;
    this.z = r.z;
    this.sync();
    this.game.crew?.playerExited();
  }
}
