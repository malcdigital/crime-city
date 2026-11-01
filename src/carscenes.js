import * as THREE from 'three';
import { animateWalk, bendLeg, bendSpine, reachArm, restPose, fallPose } from './character.js';

// Getting in and out of cars, and pulling someone out of theirs: scenes played on the characters
// themselves (you, a cop, anyone), fitted live to the car's own model (carmodels.js: where its
// door hangs and how wide it is, where the seat is, how high the beltline), so they fit a sports
// car, a sedan, a van, a box truck. A scene takes the character over (its root and joints) until
// it's done; update(dt) returns true then. pos: where the character is now (for the camera, and
// for anyone who shoots at it).
//
//   enterCar(c, car, side)   walk to the door, open it, turn and duck in, sit, pull it shut
//   exitCar(c, car, side)    open it, swing the legs out, rise out, step away; it shuts behind
//   jackCar(j, victim, car)  yank the door open, reach in and drag the driver out onto the street,
//                            then get in (victim: a character made for him, seated at first)
// side: -1 the driver's door (the car's left, +x), +1 the passenger's.

const ease = (k) => k * k * (3 - 2 * k);
const seg = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const lerp = (a, b, k) => a + (b - a) * k;
const angLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const HIP = 0.9; // (hip height on the rig, at scale 1)

// The car's frame: local x (its left) and z (forward) to the world, and the way a local
// direction faces in the world.
export function carFrame(v) {
  const h = v.heading;
  const c = Math.cos(h);
  const s = Math.sin(h);
  return {
    v,
    w: (lx, lz) => [v.x + lx * c + lz * s, v.z - lx * s + lz * c],
    yaw: (dx, dz) => Math.atan2(dx * c + dz * s, -dx * s + dz * c),
    y: v.group.position.y,
  };
}

// Where a car's door is and where its seat is, on a side (sx = +1 the left, -1 the right).
export function doorSpot(v, side = -1) {
  const M = v.model;
  const sx = -side;
  const L = v.type.l / 2;
  const W = v.type.w / 2;
  const D = M.door || { hinge: L - 0.7, len: 1.0, x: W, none: true }; // (a bus: its front doors, no swinging door)
  const seat = M.seat;
  return {
    sx,
    none: !!D.none,
    // (standing at the opening: just outside it, a little behind the middle of the door)
    stand: [sx * (D.x + 0.6), D.hinge - D.len * 0.62],
    // (the door handle, on the outside of the closed door)
    handle: [sx * (D.x + 0.05), M.belt - 0.12, D.hinge - D.len + 0.22],
    seat: [sx * seat.x, seat.y, seat.z],
    floor: seat.floor ?? seat.y - 0.2,
    belt: M.belt,
    roof: M.roof,
    wheelZ: seat.wheelZ,
    hinge: D.hinge,
    len: D.len,
    doorX: D.x,
  };
}

// The pose sitting: thighs out along the seat, shins down to the floor, the back against the seat.
function sitPose(c, k = 1) {
  bendLeg(c.legL, c.kneeL, 1.45 * k, 1.25 * k);
  bendLeg(c.legR, c.kneeR, 1.45 * k, 1.3 * k);
  c.legL.rotation.z = 0.06 * k;
  c.legR.rotation.z = -0.06 * k;
}

// A hand to a world point (the character's group must be in place).
const _v = new THREE.Vector3();
function handTo(c, side, wx, wy, wz, pole = new THREE.Vector3(side === 'L' ? 1 : -1, -0.6, -0.3)) {
  c.group.updateMatrixWorld(true);
  const local = c.group.worldToLocal(_v.set(wx, wy, wz));
  reachArm(c, side, local, pole, null, null, 'group');
}

// The common runner: a length, a time, a step(t) that poses; update(dt) -> done.
class Scene {
  constructor(len, step) {
    this.len = len;
    this.t = 0;
    this.step = step;
    this.pos = [0, 0];
    this.yaw = 0;
  }

  update(dt) {
    this.t = Math.min(this.len, this.t + dt);
    this.step(this.t);
    return this.t >= this.len;
  }
}

// Place a character: world x, z (y from the ground or given), facing yaw.
function place(c, x, y, z, yaw) {
  c.group.position.set(x, y, z);
  c.group.rotation.set(0, yaw, 0);
}

// ---- In ----
// from: [x, z] where the character starts (on foot). The door opens on the way; done, the
// character is sitting in the seat (the caller swaps it for the seated driver: vehicle.js).
export function enterCar(c, v, side = -1, { from = null, groundY = null, fromDuck = false, onDone = null } = {}) {
  const F = carFrame(v);
  const S = doorSpot(v, side);
  const [sxw, szw] = F.w(...S.stand);
  const start = from || [sxw, szw];
  const gy = groundY ? groundY(sxw, szw) : F.y;
  const sc = c.group.scale.y || 1;
  const seatY = F.y + S.seat[1] + 0.06 - HIP * sc;
  const [seatX, seatZ] = F.w(S.seat[0], S.seat[2]);
  const faceCar = F.yaw(-S.sx, 0);
  const faceFwd = F.yaw(0, 1);
  const walk0 = Math.atan2(sxw - start[0], szw - start[1]);
  const walkLen = Math.min(0.5, Math.hypot(sxw - start[0], szw - start[1]) / 4 + 0.1);
  const T = { reach: walkLen, open: walkLen + 0.12, duck: walkLen + 0.3, sit: walkLen + 0.95, close: walkLen + 1.1, end: walkLen + 1.45 };
  const t0 = fromDuck ? T.duck - 0.05 : 0; // (from the duck in: the door's open already)
  let opened0 = fromDuck;
  let opened = opened0;
  let closed = false;
  const sc0 = new Scene(T.end - t0, (tt) => {
    const t = tt + t0;
    restPose(c);
    let x;
    let z;
    let y;
    let yaw;
    if (t < T.reach) {
      // (walking up to the door)
      const k = ease(seg(t, 0, T.reach));
      x = lerp(start[0], sxw, k);
      z = lerp(start[1], szw, k);
      y = gy;
      yaw = angLerp(walk0, faceCar, seg(t, T.reach * 0.6, T.reach));
      animateWalk(c, t * 11, 0.8 * (1 - seg(t, T.reach * 0.7, T.reach)));
    } else {
      // (turning, ducking in, sitting down)
      const k = ease(seg(t, T.duck, T.sit));
      x = lerp(sxw, seatX, k);
      z = lerp(szw, seatZ, k);
      y = lerp(gy, seatY, ease(seg(t, T.duck + 0.1, T.sit)));
      yaw = angLerp(faceCar, faceFwd, ease(seg(t, T.duck, T.sit - 0.1)));
      sitPose(c, ease(seg(t, T.duck + 0.05, T.sit)));
      // (ducking under the roof on the way in, upright in the seat)
      const duck = Math.sin(seg(t, T.duck, T.sit + 0.05) * Math.PI) * 0.55;
      bendSpine(c, duck, 0, 0);
      c.neck.rotation.set(duck * 0.5, 0, 0);
    }
    place(c, x, y, z, yaw);
    // (the near hand: to the handle to open it; then, sitting, out to pull the door shut)
    const hand = S.sx > 0 ? 'L' : 'R';
    if (!S.none && t >= T.reach - 0.12 && t < T.duck + 0.15) {
      const [hx, hz] = F.w(S.handle[0], S.handle[2]);
      handTo(c, hand, hx, F.y + S.handle[1], hz);
    }
    if (!S.none && t >= T.sit - 0.1) {
      const k = seg(t, T.sit - 0.1, T.close);
      const [hx, hz] = F.w(S.sx * (S.doorX - 0.05), S.hinge - S.len * 0.55);
      if (k < 1) handTo(c, hand, hx, F.y + S.belt - 0.1, hz);
    }
    if (!opened && t >= T.open) {
      opened = true;
      v.openDoor(side, 0);
    }
    if (!closed && t >= T.close) {
      closed = true;
      const d = v.doors?.[side];
      if (d) d.target = 0;
    }
    sc0.pos = [x, z];
    sc0.yaw = yaw;
    if (tt >= T.end - t0 && onDone) onDone();
  });
  return sc0;
}

// ---- Out ----
// Starts sitting; done, the character stands outside the door, facing away from the car.
export function exitCar(c, v, side = -1, { groundY = null, onDone = null } = {}) {
  const F = carFrame(v);
  const S = doorSpot(v, side);
  const sc = c.group.scale.y || 1;
  const seatY = F.y + S.seat[1] + 0.06 - HIP * sc;
  const [seatX, seatZ] = F.w(S.seat[0], S.seat[2]);
  const [ox, oz] = F.w(S.sx * (S.doorX + 0.75), S.hinge - S.len * 0.55);
  const [fx, fz] = F.w(S.sx * (S.doorX + 1.35), S.hinge - S.len * 0.75);
  const gy = groundY ? groundY(ox, oz) : F.y;
  const faceFwd = F.yaw(0, 1);
  const faceOut = F.yaw(S.sx, 0);
  const faceAway = F.yaw(S.sx, -0.4);
  const T = { open: 0.08, swing: 0.25, up: 0.85, step: 1.25 };
  let opened = false;
  const s = new Scene(T.step, (t) => {
    restPose(c);
    let x;
    let z;
    let y;
    let yaw;
    if (t < T.up) {
      // (the legs out first, then up and out under the roof)
      const k = ease(seg(t, T.swing, T.up));
      x = lerp(seatX, ox, k);
      z = lerp(seatZ, oz, k);
      y = lerp(seatY, gy, ease(seg(t, T.swing + 0.15, T.up)));
      yaw = angLerp(faceFwd, faceOut, ease(seg(t, 0.1, T.swing + 0.25)));
      sitPose(c, 1 - ease(seg(t, T.swing + 0.1, T.up)));
      const duck = Math.sin(seg(t, T.swing, T.up + 0.05) * Math.PI) * 0.55;
      bendSpine(c, duck, 0, 0);
      c.neck.rotation.set(duck * 0.5, 0, 0);
    } else {
      // (a step or two away from the car)
      const k = ease(seg(t, T.up, T.step));
      x = lerp(ox, fx, k);
      z = lerp(oz, fz, k);
      y = gy;
      yaw = angLerp(faceOut, faceAway, k);
      animateWalk(c, t * 10, 0.7 * (1 - seg(t, T.step - 0.15, T.step)));
    }
    place(c, x, y, z, yaw);
    if (!opened && t >= T.open) {
      opened = true;
      v.openDoor(side, 1.6); // (it swings shut on its own behind you)
    }
    s.pos = [x, z];
    s.yaw = yaw;
    if (t >= T.step && onDone) onDone();
  });
  return s;
}

// ---- Carjack ----
// j: the one taking the car (on foot at from); victim: a character made for the driver (sitting
// in the seat to begin with). The victim is dragged out and thrown down beside the car, then j
// gets in. onPulled(x, z, yaw): the victim's on the ground (the caller turns him into a real
// person on the street).
export function jackCar(j, victim, v, side = -1, { from = null, groundY = null, onPulled = null, onDone = null } = {}) {
  const F = carFrame(v);
  const S = doorSpot(v, side);
  const [sxw, szw] = F.w(...S.stand);
  const start = from || [sxw, szw];
  const gy = groundY ? groundY(sxw, szw) : F.y;
  const vsc = victim.group.scale.y || 1;
  const seatY = F.y + S.seat[1] + 0.06 - HIP * vsc;
  const [seatX, seatZ] = F.w(S.seat[0], S.seat[2]);
  const [outX, outZ] = F.w(S.sx * (S.doorX + 1.2), S.hinge - S.len * 0.9);
  const [downX, downZ] = F.w(S.sx * (S.doorX + 2.2), S.hinge - S.len * 1.2);
  const vgy = groundY ? groundY(downX, downZ) : F.y;
  const faceCar = F.yaw(-S.sx, 0);
  const faceFwd = F.yaw(0, 1);
  const walk0 = Math.atan2(sxw - start[0], szw - start[1]);
  const walkLen = Math.min(0.45, Math.hypot(sxw - start[0], szw - start[1]) / 4.5 + 0.1);
  const T = { yank: walkLen, grab: walkLen + 0.3, pull: walkLen + 0.65, out: walkLen + 1.15, fall: walkLen + 1.2, down: walkLen + 2.3, enter: walkLen + 1.45 };
  // (then the way in: the enter scene from its duck on, from where j's standing)
  let enter = null;
  let pulled = false;
  let opened = false;
  const s = new Scene(T.enter + 1.2, (t) => {
    // The victim: in the seat, hands up, dragged out by the collar, thrown down. (Once he's
    // down, onPulled hands him over to the street: he's a ped from then on.)
    if (!pulled) restPose(victim);
    if (pulled) {
      // (his now)
    } else if (t < T.out) {
      const k = ease(seg(t, T.pull, T.out));
      const x = lerp(seatX, outX, k);
      const z = lerp(seatZ, outZ, k);
      const y = lerp(seatY, gy, ease(seg(t, T.pull + 0.1, T.out)));
      const yaw = angLerp(faceFwd, faceCar + Math.PI, ease(seg(t, T.grab, T.out)));
      place(victim, x, y, z, yaw);
      sitPose(victim, 1 - ease(seg(t, T.pull + 0.1, T.out)));
      // (hands up when the door flies open; grabbing at the arms pulling him)
      const up = ease(seg(t, T.yank, T.grab));
      victim.armL.rotation.set(-2.2 * up, 0, 0.5 * up);
      victim.armR.rotation.set(-2.0 * up, 0, -0.5 * up);
      victim.elbowL.rotation.set(-1.4 * up, 0, 0);
      victim.elbowR.rotation.set(-1.3 * up, 0, 0);
      bendSpine(victim, Math.sin(seg(t, T.pull, T.out) * Math.PI) * 0.5, 0, 0);
    } else {
      // (stumbling out and going down hard, face first)
      const k = ease(seg(t, T.out, T.fall + 0.5));
      const x = lerp(outX, downX, k);
      const z = lerp(outZ, downZ, k);
      const P = fallPose(victim, seg(t, T.out - 0.1, T.down) * 1.3, 'front');
      victim.group.position.set(x, vgy + 0.2 + P.y, z);
      victim.group.rotation.set(0, faceCar + Math.PI, 0);
      victim.group.rotation.order = 'YXZ';
      victim.group.rotation.x = P.rot;
      if (!pulled && t >= T.down) {
        pulled = true;
        onPulled?.(x, z, faceCar + Math.PI);
      }
    }
    // The jacker.
    if (t < T.enter) {
      restPose(j);
      let x = sxw;
      let z = szw;
      let yaw = faceCar;
      if (t < T.yank) {
        const k = ease(seg(t, 0, T.yank));
        x = lerp(start[0], sxw, k);
        z = lerp(start[1], szw, k);
        yaw = angLerp(walk0, faceCar, seg(t, T.yank * 0.5, T.yank));
        animateWalk(j, t * 12, 0.9);
      } else {
        // (leaning in, then hauling back and to the side)
        const haul = ease(seg(t, T.pull, T.out));
        const back = Math.sin(seg(t, T.pull, T.out + 0.2) * Math.PI);
        const [bx, bz] = F.w(S.sx * (S.doorX + 0.6 + 0.45 * back), S.hinge - S.len * 0.62 - 0.3 * haul);
        x = bx;
        z = bz;
        yaw = angLerp(faceCar, faceCar + 0.9 * S.sx, haul);
        bendSpine(j, 0.5 * ease(seg(t, T.yank, T.grab)) * (1 - haul) - 0.2 * back, 0.4 * haul, 0);
        bendLeg(j.legL, j.kneeL, 0.4 * back, 0.6 * back);
        bendLeg(j.legR, j.kneeR, -0.2 * back, 0.3 * back);
      }
      place(j, x, gy, z, yaw);
      // (hands: the handle, then the collar, both hands, hauling)
      if (t >= T.yank - 0.1 && t < T.grab) {
        const [hx, hz] = F.w(S.handle[0], S.handle[2]);
        handTo(j, S.sx > 0 ? 'L' : 'R', hx, F.y + S.handle[1], hz);
      } else if (t >= T.grab && t < T.out + 0.1) {
        victim.group.updateMatrixWorld(true);
        victim.chest.getWorldPosition(_c);
        handTo(j, 'L', _c.x + 0.08, _c.y + 0.15, _c.z);
        handTo(j, 'R', _c.x - 0.08, _c.y + 0.15, _c.z);
      }
      if (!opened && t >= T.yank) {
        opened = true;
        v.openDoor(side, 0);
        const d = v.doors?.[side];
        if (d) d.angle = d.target * 0.6; // (yanked: it flies open)
      }
      s.pos = [x, z];
      s.yaw = yaw;
    } else {
      // In, the rest of the way: the enter scene from where the duck starts.
      enter ||= enterCar(j, v, side, { from: [sxw, szw], groundY, fromDuck: true });
      enter.update(Math.max(0, t - T.enter - enter.t));
      s.pos = enter.pos;
      s.yaw = enter.yaw;
    }
    if (t >= s.len && onDone) onDone();
  });
  return s;
}
const _c = new THREE.Vector3();
