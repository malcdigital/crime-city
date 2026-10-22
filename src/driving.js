import { clamp, wrapAngle } from './util.js';

// Steering value (-1..1, positive = right) that turns the car toward a point.
export function steerToward(car, tx, tz) {
  const desired = Math.atan2(tx - car.x, tz - car.z);
  const diff = wrapAngle(desired - car.heading);
  return clamp(-diff * 2.2, -1, 1);
}

// Throttle (-1..1) to reach a desired forward speed.
export function throttleFor(car, desired) {
  if (desired <= 0.2) return car.speed > 0.6 ? -1 : 0;
  const ds = desired - car.speed;
  if (ds > 0.5) return Math.min(1, ds * 0.5);
  if (ds < -1.5) return -0.6;
  return 0;
}

// Detects a car stuck against something and backs it up for a moment.
export class StuckHelper {
  constructor() {
    this.stuckT = 0;
    this.reverseT = 0;
  }

  apply(dt, car, wanted, ctrl) {
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      ctrl.throttle = -1;
      ctrl.steer = -ctrl.steer;
      return ctrl;
    }
    if (wanted > 2 && Math.abs(car.speed) < 0.6) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > 2.2) {
      this.stuckT = 0;
      this.reverseT = 1.4;
    }
    return ctrl;
  }
}
