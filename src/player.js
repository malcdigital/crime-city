import { CFG } from './config.js';
import { makeCharacter, animateWalk } from './character.js';
import { pushCircle } from './collision.js';
import { lerp, lerpAngle } from './util.js';

export class Player {
  constructor(game, x, z) {
    this.game = game;
    this.char = makeCharacter({ shirt: 0x1e7d32, pants: 0x1b1b1b, skin: 0x8d5524, bandana: 0x1e7d32 });
    game.scene.add(this.char.group);
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

  updateOnFoot(dt, input, camYaw) {
    const game = this.game;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = -fz, rz = fx;
    let mx = 0, mz = 0;
    if (input.down('KeyW') || input.down('ArrowUp')) { mx += fx; mz += fz; }
    if (input.down('KeyS') || input.down('ArrowDown')) { mx -= fx; mz -= fz; }
    if (input.down('KeyD')) { mx += rx; mz += rz; }
    if (input.down('KeyA')) { mx -= rx; mz -= rz; }
    const len = Math.hypot(mx, mz);
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const target = len > 0 ? (sprint ? CFG.SPRINT_SPEED : CFG.WALK_SPEED) : 0;
    if (len > 0) {
      this.moveX = mx / len;
      this.moveZ = mz / len;
      this.heading = lerpAngle(this.heading, Math.atan2(this.moveX, this.moveZ), Math.min(1, dt * 12));
    }
    this.speed = lerp(this.speed, target, Math.min(1, dt * 10));
    const ox = this.x, oz = this.z;
    this.x += this.moveX * this.speed * dt;
    this.z += this.moveZ * this.speed * dt;

    let r = pushCircle(this.x, this.z, 0.4, game.city.colliders);
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
    }
    this.sync();
  }

  sync() {
    const y = this.game.city.groundY(this.x, this.z);
    this.char.group.position.set(this.x, y, this.z);
    this.char.group.rotation.y = this.heading;
  }

  enter(vehicle) {
    this.vehicle = vehicle;
    vehicle.driver = 'player';
    this.char.group.visible = false;
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
  }
}
