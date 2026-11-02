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
    lean: seat.lean || 0.12,
    green: M.green || null,
    roofHw: M.roofHw ?? W - 0.2,
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

// Back to standing straight, arms included (restPose leaves the arms' swing as it was, and a
// hand that's let go of something mustn't stay up where it was).
function rest(c) {
  restPose(c);
  for (const j of ['armL', 'armR', 'elbowL', 'elbowR', 'wristL', 'wristR']) c[j].rotation.set(0, 0, 0);
}
// Both hands on the wheel (the driver's seat), or in the lap.
function handsOnWheel(c, F, S, only = null) {
  if (S.wheelZ == null || S.sx < 0) return;
  for (const [hd, dx] of [['L', 0.17], ['R', -0.17]]) {
    if (only && hd !== only) continue;
    const [wx, wz] = F.w(S.seat[0] + dx, S.wheelZ - 0.06);
    handTo(c, hd, wx, F.y + S.belt + 0.04, wz, new THREE.Vector3(hd === 'L' ? 1 : -1, -1, 0));
  }
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

// ---- Walking up to a car ----
// A walk from where you are to a spot by the car (local [x, z]): around its corners if the
// straight line would cut through it, at a walking pace that picks up and slows to a stop, the
// stride matched to the ground covered (no sliding feet), turning smoothly as the path bends
// and squaring up to face at the end. Worked out once: { len, at(t) -> { x, z, yaw, phase,
// amt } }.
function walkTo(v, F, from, local, face) {
  const L = v.type.l / 2 + 0.55;
  const W = v.type.w / 2 + 0.5;
  // (in the car's frame: where you start, where you're going)
  const c = Math.cos(v.heading);
  const s = Math.sin(v.heading);
  const toLocal = (x, z) => {
    const dx = x - v.x;
    const dz = z - v.z;
    return [dx * c - dz * s, dx * s + dz * c];
  };
  const P0 = toLocal(...from);
  const P1 = local;
  const inside = (x, z) => Math.abs(x) < W - 0.05 && Math.abs(z) < L - 0.05;
  const crosses = (a, b) => {
    for (let k = 1; k < 20; k++) if (inside(a[0] + ((b[0] - a[0]) * k) / 20, a[1] + ((b[1] - a[1]) * k) / 20)) return true;
    return false;
  };
  let pts = [P0, P1];
  if (crosses(P0, P1)) {
    // Round the car: the corners, clockwise and the other way, whichever's shorter.
    const C = [[W, L], [W, -L], [-W, -L], [-W, L]];
    const near = (p) => C.reduce((bi, q, i) => (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(C[bi][0] - p[0], C[bi][1] - p[1]) ? i : bi), 0);
    const i0 = near(P0);
    const i1 = near(P1);
    let best = null;
    for (const dir of [1, -1]) {
      const way = [P0];
      for (let i = i0; ; i = (i + dir + 4) % 4) {
        way.push(C[i]);
        if (i === i1) break;
      }
      way.push(P1);
      // (skip a first corner you can cut past, and a last one)
      while (way.length > 2 && !crosses(way[0], way[2])) way.splice(1, 1);
      while (way.length > 2 && !crosses(way[way.length - 3], way[way.length - 1])) way.splice(way.length - 2, 1);
      const len = way.slice(1).reduce((t, q, k) => t + Math.hypot(q[0] - way[k][0], q[1] - way[k][1]), 0);
      if (!best || len < best.len) best = { way, len };
    }
    pts = best.way;
  }
  const world = pts.map((q) => F.w(...q));
  // Walk it: up to speed, along, down to a stop at the end (sampled every 1/60 s).
  const segs = [];
  let total = 0;
  for (let k = 0; k + 1 < world.length; k++) {
    const d = Math.hypot(world[k + 1][0] - world[k][0], world[k + 1][1] - world[k][1]);
    segs.push({ a: world[k], b: world[k + 1], d, s0: total });
    total += d;
  }
  const V = 2.1; // (m/s: a brisk walk)
  const ACC = 4.5;
  const S = [];
  let d = 0;
  let vel = 0;
  let yaw = total > 0.05 ? Math.atan2(world[1][0] - world[0][0], world[1][1] - world[0][1]) : face;
  let phase = 0;
  const posAt = (dd) => {
    const sg = segs.find((q) => dd <= q.s0 + q.d) || segs[segs.length - 1];
    if (!sg) return world[0];
    const k = sg.d > 0 ? Math.min(1, (dd - sg.s0) / sg.d) : 1;
    return [sg.a[0] + (sg.b[0] - sg.a[0]) * k, sg.a[1] + (sg.b[1] - sg.a[1]) * k];
  };
  const dt = 1 / 60;
  for (let i = 0; i < 1200; i++) {
    const left = total - d;
    const want = Math.min(V, Math.sqrt(Math.max(0, 2 * ACC * 0.8 * left)));
    vel = want > vel ? Math.min(want, vel + ACC * dt) : want;
    d = Math.min(total, d + vel * dt);
    const [x, z] = posAt(d);
    // (heading: along the path, a little ahead; squaring up to the car over the last stretch)
    const [ax, az] = posAt(Math.min(total, d + 0.6));
    const along = Math.hypot(ax - x, az - z) > 0.05 ? Math.atan2(ax - x, az - z) : yaw;
    const want2 = angLerp(along, face, 1 - Math.min(1, left / 0.7));
    yaw = angLerp(yaw, want2, Math.min(1, dt * 9));
    phase += (vel * dt) / 0.36; // (one stride ~ 2.3 m: two steps)
    S.push({ x, z, yaw, phase, amt: Math.min(1, vel / 1.6) });
    if (left < 0.005 && vel < 0.05 && Math.abs(Math.atan2(Math.sin(yaw - face), Math.cos(yaw - face))) < 0.05) break;
  }
  if (!S.length) S.push({ x: world[0][0], z: world[0][1], yaw: face, phase: 0, amt: 0 });
  const len = (S.length - 1) / 60;
  return {
    len,
    at(t) {
      const f = Math.max(0, Math.min(S.length - 1, t * 60));
      const i = Math.floor(f);
      const q = S[i];
      const r = S[Math.min(S.length - 1, i + 1)];
      const k = f - i;
      return { x: lerp(q.x, r.x, k), z: lerp(q.z, r.z, k), yaw: angLerp(q.yaw, r.yaw, k), phase: lerp(q.phase, r.phase, k), amt: lerp(q.amt, r.amt, k) };
    },
  };
}

// ---- Shared bits for in and out ----
// A point on the door, in the door's own frame (from its hinge: x out, y up, z back along it),
// out in the world as the door is now (open, shut, swinging).
const _d = new THREE.Vector3();
function doorPoint(v, side, lx, ly, lz) {
  const d = v.doors?.[side];
  if (!d) return null;
  d.pivot.rotation.y = d.angle;
  d.pivot.updateMatrixWorld(true);
  return d.pivot.localToWorld(_d.set(lx, ly, lz)).clone();
}
// Where a hand takes hold of the door frame, up by the roof: just inside the top of the opening,
// low enough that the hand (it points up past the wrist) stays under the roof; on a tall van, the
// grab handle on the pillar at shoulder height instead. [x, y, z] in the car's frame.
function frameGrip(S, z) {
  if (S.green) z = Math.min(z, S.green[1][0] - 0.12); // (back from the windshield pillar, under the flat of the roof)
  return [S.sx * (S.roofHw - 0.04), Math.min(ceiling(S, z) - 0.18, S.belt + 0.5), z];
}
// A hand on a world point: the wrist just off it (the hand hangs below the wrist).
function gripAt(c, side, p, up = 0.05) {
  handTo(c, side, p.x, p.y + up, p.z);
}
// The top of the head, in the car's frame ([x across, y up]).
const _h = new THREE.Vector3();
function crown(c, v) {
  c.group.updateMatrixWorld(true);
  c.neck.localToWorld(_h.set(0, 2.04 - 1.62, 0));
  v.group.updateMatrixWorld(true);
  v.group.worldToLocal(_h);
  return _h;
}
// How far the head's into the roof or the glass (its top corners against the cabin outline;
// below zero: clear by that much). Only while it's inside the car's sides.
const HEAD_PTS = [[0, 0.42, 0], [0, 0.4, 0.13], [0, 0.4, -0.12], [0.11, 0.4, 0], [-0.11, 0.4, 0], [0, 0.3, 0.15]];
function headOver(c, v, S) {
  c.group.updateMatrixWorld(true);
  v.group.updateMatrixWorld(true);
  let worst = -Infinity;
  for (const [x, y, z] of HEAD_PTS) {
    c.neck.localToWorld(_h.set(x, y, z));
    v.group.worldToLocal(_h);
    if (Math.abs(_h.x) > S.doorX - 0.04) continue;
    worst = Math.max(worst, _h.y - ceiling(S, _h.z));
  }
  return worst;
}
// The headliner's height at z along the car (the cabin outline: up the windshield, along the
// roof, down the back glass), less a little for the roof's own thickness.
function ceiling(S, z) {
  const G = S.green;
  if (!G) return S.roof - 0.08;
  const [[z0, y0], [z1, y1], [z2, y2], [z3, y3]] = G;
  let y;
  if (z >= z0 || z <= z3) y = Math.min(y0, y3);
  else if (z > z1) y = lerp(y1, y0, (z - z1) / (z0 - z1));
  else if (z >= z2) y = y1;
  else y = lerp(y2, y3, (z2 - z) / (z2 - z3));
  return y - 0.08;
}
// Keep the head inside the cabin: while it's within the car's sides and up into the roof, the
// windshield or the back glass, fix it: ducking in or out (dir +1) bend forward more; sitting
// (dir -1) slide down in the seat first (up to 14 cm: the real you is taller sitting than the
// driver drawn in the window), then lie back a little more. Returns the bend.
function underRoof(c, v, S, bend, dir) {
  let drop = 0;
  for (let i = 0; i < 18; i++) {
    if (headOver(c, v, S) < -0.03) break;
    if (dir < 0 && drop < 0.14) {
      drop += 0.02;
      c.group.position.y -= 0.02;
    } else {
      bend += dir * 0.06;
      bendSpine(c, bend, 0, 0);
    }
  }
  return bend;
}
// How to sit in this seat so the head's inside the cabin (the real you is taller sitting than
// the driver drawn in the window): worked out once, with the character already in the seat,
// trying a slide down in the seat, laying the back back, a slouch (the chest curled forward over
// a laid-back lower back) and the chin down, and taking the least of it that fits. Returns
// { drop, a (lie back), curl, neck }; apply it with seatFit().
function fitSeat(c, v, S) {
  const y0 = c.group.position.y;
  let best = null;
  for (let drop = 0; drop <= 0.351; drop += 0.035) {
    for (let a = S.lean; a <= 1.25; a += 0.07) {
      for (const curl of [0, 0.2, 0.4, 0.6, 0.8]) {
        for (const neck of [0.25, 0.5, 0.75, 1.0]) {
          const cost = a + drop * 4 + curl * 0.8 + neck * 0.3;
          if (best && cost >= best.cost) continue;
          c.group.position.y = y0 - drop;
          c.spine.rotation.x = -a * 0.9;
          c.chest.rotation.x = -a * 0.1 + curl;
          c.neck.rotation.x = neck;
          if (headOver(c, v, S) < -0.05) best = { drop, a, curl, neck, cost };
        }
      }
    }
  }
  c.group.position.y = y0;
  if (!best) console.warn('carscenes: no seat pose fits this cabin', v.typeName);
  return best || { drop: 0.35, a: 0.6, curl: 0.8, neck: 1.0 };
}
// The fitted seat pose at k (0..1), over whatever bend the scene's set.
function seatFit(c, fit, k) {
  if (!fit || k <= 0) return;
  const q = Math.min(1, k * 2); // (down in the seat and the chin in first, then lie back)
  c.group.position.y -= fit.drop * q;
  const r = Math.max(0, (k - 0.4) / 0.6); // (lie back once you're round to the wheel)
  c.spine.rotation.x += -fit.a * 0.9 * r;
  c.chest.rotation.x += -fit.a * 0.1 * r + fit.curl * q;
  c.neck.rotation.x = fit.neck * q + c.neck.rotation.x * (1 - q);
}

// ---- In ----
// from: [x, z] where the character starts (on foot). Like a person does it: walk up behind the
// door, take the handle and pull it open (the hand stays on the handle as it swings), step into
// the opening, turn your back to the seat, sit down into it with your head ducked out under the
// roof edge, swing your legs in and turn to the wheel, sit back, and pull the door shut by its
// inside pull. Done: sitting in the seat (the caller swaps you for the seated driver: vehicle.js).
// fromDuck: start from stepping into the opening (the door's open already: a carjacking).
export function enterCar(c, v, side = -1, { from = null, groundY = null, fromDuck = false, onDone = null, slide = false } = {}) {
  const F = carFrame(v);
  const S = doorSpot(v, side);
  const sx = S.sx;
  const none = S.none || !v.doors?.[side];
  // (A: behind the door, clear of its swing; B: in the opening)
  const A = none ? S.stand : [sx * (S.doorX + 0.5), S.hinge - S.len - 0.32];
  const B = [sx * (S.doorX + 0.28), S.hinge - S.len * 0.5];
  const [ax, az] = F.w(...A);
  const [bx, bz] = F.w(...B);
  const start = from || [ax, az];
  const gy = groundY ? groundY(ax, az) : F.y;
  const sc = c.group.scale.y || 1;
  const seatY = F.y + S.seat[1] - 0.04 - HIP * sc;
  const [seatX, seatZ] = F.w(S.seat[0], S.seat[2]);
  const faceCar = F.yaw(-sx, 0);
  const faceSit = F.yaw(sx, 0.35); // (back to the seat)
  const faceFwd = F.yaw(0, 1);
  const path = walkTo(v, F, start, A, faceCar);
  const W = path.len;
  const T = none
    ? { reach: W, open: W, let: W, step: W, sit: W + 0.35, swing: W + 0.85, close: W + 1.1, shut: W + 1.25, end: W + 1.45 }
    : { reach: W, open: W + 0.12, let: W + 0.52, step: W + 0.84, sit: W + 1.27, swing: W + 1.62, close: W + 1.52, shut: W + 1.78, end: W + 1.95 };
  // (in by the passenger's door: once it's shut, slide across into the driver's seat)
  T.fin = slide ? T.end + 0.75 : T.end;
  const [dsX, dsZ] = F.w(-S.seat[0], S.seat[2]);
  let fit = null;
  const hand = sx > 0 ? 'L' : 'R';
  const far = sx > 0 ? 'R' : 'L';
  const t0 = fromDuck ? T.let : 0;
  let opened = fromDuck || none;
  let closed = false;
  const sc0 = new Scene(T.fin - t0, (tt) => {
    const t = tt + t0;
    rest(c);
    let x;
    let z;
    let y = gy;
    let yaw;
    let bend = 0;
    let seatK = 0;
    let slideLean = 0;
    if (t < T.reach) {
      // (walking up behind the door: round the car if need be)
      const w = path.at(t);
      x = w.x;
      z = w.z;
      yaw = w.yaw;
      animateWalk(c, w.phase, 0.85 * w.amt);
    } else if (t < T.step) {
      // (pulling it open, then a step into the opening, turning the back to the seat)
      const k = ease(seg(t, T.let, T.step));
      x = lerp(ax, bx, k);
      z = lerp(az, bz, k);
      yaw = angLerp(faceCar, faceSit, ease(seg(t, T.let + 0.1, T.step)));
      if (k > 0 && k < 1) animateWalk(c, t * 9, 0.45);
      bend = 0.12 * seg(t, T.reach, T.open + 0.2) * (1 - k); // (leaning into the pull)
    } else if (t < T.sit) {
      // (sitting down into it: the hips back and down onto the seat, the head ducked out)
      const k = ease(seg(t, T.step, T.sit));
      x = lerp(bx, seatX, k);
      z = lerp(bz, seatZ, k);
      y = lerp(gy, seatY, ease(seg(t, T.step + 0.05, T.sit)));
      yaw = faceSit;
      bend = 0.75 * Math.sin(Math.min(1, k * 1.15) * Math.PI * 0.5);
      sitPose(c, k);
    } else {
      // (legs in, round to the wheel, sitting back)
      const k = ease(seg(t, T.sit, T.swing));
      x = seatX;
      z = seatZ;
      y = seatY;
      yaw = angLerp(faceSit, faceFwd, k);
      sitPose(c, 1);
      bend = lerp(0.75, 0, k);
      seatK = k;
      if (slide && t > T.end) {
        // (across the console: hips up a little, leaning the way you're going)
        const q = ease(seg(t, T.end, T.fin));
        x = lerp(seatX, dsX, q);
        z = lerp(seatZ, dsZ, q);
        y = seatY + Math.sin(q * Math.PI) * 0.06;
        slideLean = Math.sin(q * Math.PI) * 0.3 * -sx;
      }
    }
    place(c, x, y, z, yaw);
    bendSpine(c, bend, 0, slideLean);
    c.neck.rotation.set(Math.max(0, bend) * 0.3, 0, 0);
    if (seatK > 0) {
      if (!fit) {
        // (worked out once, sitting square in the seat)
        rest(c);
        place(c, seatX, seatY, seatZ, faceFwd);
        sitPose(c, 1);
        fit = fitSeat(c, v, S);
        rest(c);
        place(c, x, y, z, yaw);
        sitPose(c, 1);
        bendSpine(c, bend, 0, 0);
        c.neck.rotation.set(Math.max(0, bend) * 0.3, 0, 0);
      }
      seatFit(c, fit, seatK);
    }
    if (t >= T.step && seatK < 0.5) bend = underRoof(c, v, S, bend, 1);
    // (hands: the outside handle, riding it as it swings open; the far hand on the roof edge
    // as you sit; then the inside pull to bring it shut)
    if (!none && !fromDuck && t >= T.reach - 0.2 && t < T.let) {
      const p = doorPoint(v, side, sx * 0.03, S.belt - 0.12, -S.len + 0.22);
      if (p) gripAt(c, hand, p);
    }
    if (t >= T.step - 0.1 && t < T.sit + 0.1) {
      const [gx, gy2, gz] = frameGrip(S, S.hinge - S.len * 0.15);
      const [rx, rz] = F.w(gx, gz);
      handTo(c, far === 'L' ? 'L' : 'R', rx, F.y + gy2, rz);
    }
    if (!none && t >= T.close - 0.1 && t < T.shut + 0.05) {
      const p = doorPoint(v, side, -sx * 0.1, S.belt - 0.33, -S.len * 0.55);
      if (p) gripAt(c, hand, p, 0.04);
    }
    // (round to the wheel: hands on it, the near one once the door's pulled shut)
    if (seatK > 0.7) handsOnWheel(c, F, S, none || t >= T.shut + 0.05 ? null : far);
    if (!opened && t >= T.open) {
      opened = true;
      v.openDoor(side, 0);
    }
    if (!none && !closed && t >= T.shut) {
      closed = true;
      const d = v.doors?.[side];
      if (d) d.target = 0;
    }
    sc0.pos = [x, z];
    sc0.yaw = yaw;
    if (tt >= T.fin - t0 && onDone) onDone();
  });
  return sc0;
}

// ---- Out ----
// Starts sitting; the door opens (the inside handle), you turn your back to the middle of the
// car and swing your legs out, lean out with your head ducked under the roof edge, stand up in
// the opening and step away. The door swings shut on its own behind you. Done: standing outside.
export function exitCar(c, v, side = -1, { groundY = null, onDone = null } = {}) {
  const F = carFrame(v);
  const S = doorSpot(v, side);
  const sx = S.sx;
  const none = S.none || !v.doors?.[side];
  const sc = c.group.scale.y || 1;
  const seatY = F.y + S.seat[1] - 0.04 - HIP * sc;
  const [seatX, seatZ] = F.w(S.seat[0], S.seat[2]);
  const [bx, bz] = F.w(sx * (S.doorX + 0.3), S.hinge - S.len * 0.5);
  const [fx, fz] = F.w(sx * (S.doorX + 1.3), S.hinge - S.len * 0.8);
  const gy = groundY ? groundY(bx, bz) : F.y;
  const faceFwd = F.yaw(0, 1);
  const faceSit = F.yaw(sx, 0.35);
  const faceAway = F.yaw(sx, -0.3);
  let fit = null;
  const hand = sx > 0 ? 'L' : 'R';
  const T = { open: 0.12, swing: 0.55, up: 1.1, step: 1.55 };
  let opened = false;
  const s = new Scene(T.step, (t) => {
    rest(c);
    let x;
    let z;
    let y;
    let yaw;
    let bend;
    let seatK = 0;
    if (t < T.swing) {
      // (sitting: the door open, turning, the legs out)
      const k = ease(seg(t, 0.15, T.swing));
      x = seatX;
      z = seatZ;
      y = seatY;
      yaw = angLerp(faceFwd, faceSit, k);
      sitPose(c, 1);
      bend = lerp(0, 0.6, k);
      seatK = 1 - k;
    } else if (t < T.up) {
      // (leaning out, head ducked, and up onto your feet in the opening)
      const k = ease(seg(t, T.swing, T.up));
      x = lerp(seatX, bx, k);
      z = lerp(seatZ, bz, k);
      y = lerp(seatY, gy, ease(seg(t, T.swing + 0.05, T.up)));
      yaw = faceSit;
      sitPose(c, 1 - k);
      bend = 0.75 * Math.sin((1 - k) * Math.PI * 0.5 + 0.35) * (1 - k * 0.6);
    } else {
      // (a step or two away)
      const k = ease(seg(t, T.up, T.step));
      x = lerp(bx, fx, k);
      z = lerp(bz, fz, k);
      y = gy;
      yaw = angLerp(faceSit, faceAway, k);
      bend = 0;
      animateWalk(c, t * 10, 0.7 * (1 - seg(t, T.step - 0.15, T.step)));
    }
    place(c, x, y, z, yaw);
    if (!fit) {
      // (worked out once, sitting square in the seat)
      rest(c);
      place(c, seatX, seatY, seatZ, faceFwd);
      sitPose(c, 1);
      fit = fitSeat(c, v, S);
      rest(c);
      place(c, x, y, z, yaw);
      if (t < T.up) sitPose(c, t < T.swing ? 1 : 1 - ease(seg(t, T.swing, T.up)));
    }
    bendSpine(c, bend, 0, 0);
    c.neck.rotation.set(Math.max(0, bend) * 0.3, 0, 0);
    seatFit(c, fit, seatK);
    if (t < T.up && seatK < 0.5) bend = underRoof(c, v, S, bend, 1);
    // (hands on the wheel, the near one to the door; then on the door frame to push up and out)
    if (t < 0.3) handsOnWheel(c, F, S, none ? null : hand === 'L' ? 'R' : 'L');
    if (!none && t < T.swing) {
      const p = doorPoint(v, side, -sx * 0.1, S.belt - 0.33, -S.len * 0.55);
      if (p) gripAt(c, hand, p, 0.04);
    } else if (t < T.up + 0.05) {
      const [gx, gy2, gz] = frameGrip(S, S.hinge - S.len * 0.2);
      const [rx, rz] = F.w(gx, gz);
      handTo(c, hand, rx, F.y + gy2, rz);
      // (the other hand pushing off the seat's edge)
      if (t >= T.swing && t < T.up - 0.15) {
        const [ex, ez] = F.w(sx * (S.seat[0] + 0.22), S.seat[2] + 0.1);
        handTo(c, hand === 'L' ? 'R' : 'L', ex, F.y + S.seat[1] + 0.08, ez);
      }
    }
    if (!opened && t >= T.open) {
      opened = true;
      v.openDoor(side, 2.2); // (it swings shut on its own behind you)
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
  const path = walkTo(v, F, start, S.stand, faceCar);
  const walkLen = Math.max(0.15, path.len);
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
      rest(j);
      let x = sxw;
      let z = szw;
      let yaw = faceCar;
      if (t < T.yank) {
        const w = path.at(t);
        x = w.x;
        z = w.z;
        yaw = w.yaw;
        animateWalk(j, w.phase, 0.9 * w.amt);
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
