import * as THREE from 'three';

// Passing and catching a basketball, the same for everybody (you, him in a one-on-one, the
// people shooting around): a two-hand chest pass (from the chest the hands push out and turn
// down, thumbs to the floor, then come back), and the catch (hands up to the ball, palms out,
// as it gets there; then the elbows give, pulling it in to the chest).
//
// Whoever throws gets markPass(c, now); whoever it's going to gets markCatch(c, arrives at).
// passPose(c, now) poses the arms over whatever the rest of the pose did, while one's on.

const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));
const mix = (a, b, k) => a + (b - a) * k;

const PASS_T = 0.4; // (the push and the recovery)
const REACH_T = 0.45; // (hands up this long before it gets there)
const GIVE_T = 0.3; // (pulling it in)

export function markPass(c, now) {
  const u = c.group.userData;
  u.passAt = now;
  u.catchAt = null; // (thrown it: not catching anything)
}

export function markCatch(c, at) {
  c.group.userData.catchAt = at;
}

// Returns true if it posed the arms (a pass or a catch going on). busy: the arms are already
// in something that wins this frame (a shot, started right off the catch): then the catch just
// ends, and the arms are left alone (no snapping them down to the sides for a frame).
export function passPose(c, now, busy = false) {
  const u = c.group.userData;
  if (busy) {
    u.posed = false;
    if (u.catchAt != null && u.catchAt <= now) u.catchAt = null;
    return false;
  }
  // (both arms angled in from the shoulders and turned so the palms face each other: the hands
  // meet on the ball instead of sticking straight out)
  const set = (x, z, e, w) => {
    u.posed = true;
    c.armL.rotation.x = c.armR.rotation.x = x;
    c.armL.rotation.z = -z;
    c.armR.rotation.z = z;
    c.armL.rotation.y = c.armR.rotation.y = 0; // (no twist: it turned the elbow bends sideways)
    c.elbowL.rotation.x = c.elbowR.rotation.x = e;
    c.wristL.rotation.x = c.wristR.rotation.x = w;
  };
  if (u.passAt != null && now - u.passAt < PASS_T) {
    const t = (now - u.passAt) / PASS_T;
    const push = ease(clamp01(t / 0.35)); // (out)
    const back = ease(clamp01((t - 0.6) / 0.4)); // (and back)
    // (from the chest pocket, elbows in, to arms out straight, wrists turned through)
    set(mix(mix(-0.55, -1.3, push), -0.4, back), mix(mix(0.3, 0.26, push), 0.05, back), mix(mix(-1.05, -0.2, push), -0.35, back), mix(mix(-0.5, 0.55, push), 0, back));
    c.spine.rotation.x = 0.1 * push * (1 - back); // (stepping into it)
    c.chest.rotation.x = 0.08 * push * (1 - back);
    return true;
  }
  if (u.catchAt != null) {
    const left = u.catchAt - now;
    if (left > 0 && left <= REACH_T) {
      // (hands up and out to it, palms facing it)
      const k = ease(clamp01(1 - left / REACH_T));
      set(mix(-0.5, -0.95, k), mix(0.2, 0.3, k), mix(-0.7, -0.55, k), mix(0, -0.6, k));
      c.chest.rotation.x = 0.1 * k; // (leaning to it)
      return true;
    }
    if (left <= 0 && -left < GIVE_T) {
      // (caught: the give, elbows bending, the ball in to the chest)
      const k = ease(clamp01(-left / GIVE_T));
      set(mix(-0.95, -0.55, k), mix(0.3, 0.3, k), mix(-0.55, -1.05, k), mix(-0.6, -0.5, k));
      return true;
    }
    if (-left >= GIVE_T) u.catchAt = null;
  }
  if (u.posed && u.resetAt !== now) {
    // (done, and nothing ran passReset this frame: the arms straight back in at the sides; the
    // walk animation does the rest)
    u.posed = false;
    c.armL.rotation.z = c.armR.rotation.z = 0;
    c.armL.rotation.y = c.armR.rotation.y = 0;
    c.armL.rotation.x = c.armR.rotation.x = 0; // (and down: nothing else may set them this frame)
    c.elbowL.rotation.x = c.elbowR.rotation.x = -0.15;
    c.wristL.rotation.x = c.wristR.rotation.x = 0;
  }
  return false;
}

// Call before the rest of the frame's pose: if a pass or catch has just ended, the arms go back
// to the sides now, so whatever poses them next this frame (the dribble, holding it, a shot)
// takes over cleanly instead of being snapped down after it.
export function passReset(c, now) {
  const u = c.group.userData;
  u.resetAt = now;
  if (!u.posed) return;
  const passing = u.passAt != null && now - u.passAt < PASS_T;
  const catching = u.catchAt != null && u.catchAt - now <= REACH_T && now - u.catchAt < GIVE_T;
  if (passing || catching) return;
  u.posed = false;
  c.armL.rotation.z = c.armR.rotation.z = 0;
  c.armL.rotation.y = c.armR.rotation.y = 0;
  c.armL.rotation.x = c.armR.rotation.x = 0;
  c.elbowL.rotation.x = c.elbowR.rotation.x = -0.15;
  c.wristL.rotation.x = c.wristR.rotation.x = 0;
}

// ---- The ball in the hands (passes and catches really touch it) ----
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

// Where a ball held between both palms is (world), from how the arms were posed last frame:
// between the two hands, a touch in from the wrists.
// The ball on one palm (side 'R' / 'L'): the palm is the hand's front (-z), the ball a radius
// off it; and the ball between both palms.
export function palmBall(c, side, out) {
  c.group.updateMatrixWorld(true);
  const s = c.group.scale.y || 1;
  return (side === 'L' ? c.wristL : c.wristR).localToWorld(out.set(0, -0.08, -(0.07 + 0.12 / s)));
}
export function twoHandBall(c, out) {
  c.group.updateMatrixWorld(true);
  c.wristL.localToWorld(_a.set(0, -0.1, -0.03));
  c.wristR.localToWorld(_b.set(0, -0.1, -0.03));
  return out.copy(_a).add(_b).multiplyScalar(0.5);
}

export function handsAt(c, out) {
  c.group.updateMatrixWorld(true);
  c.wristL.localToWorld(_a.set(0, -0.13, 0));
  c.wristR.localToWorld(_b.set(0, -0.13, 0));
  return out.copy(_a).add(_b).multiplyScalar(0.5);
}

// Set a pass going from the passer's hands, steered into the catcher's (call right after the
// ball's launched; steerPass every frame of the flight).
export function passFrom(b, passer, catcher) {
  if (passer) {
    handsAt(passer, _a);
    // (the flight starts there: the arc's the same, just from the hands)
    const dy = _a.y - b.p0[1];
    b.p0 = [_a.x, _a.y, _a.z];
    b.x = _a.x;
    b.y = _a.y;
    b.z = _a.z;
    b.vy0 -= dy / Math.max(0.05, b.T); // (still lands where it was going)
  }
  b.catcher = catcher || null;
  b.p1y0 = b.p1[1];
  b.yAdj = 0;
}

// While a pass is in the air: once the catcher's hands are out for it, the end of the flight
// follows them (so it ends up in his hands, not at his chest).
export function steerPass(b) {
  const c = b.catcher;
  if (!c || b.mode !== 'flight') return;
  const left = b.T - b.t;
  if (left > 0.4) return;
  handsAt(c, _a);
  const k = Math.min(1, (0.4 - left) / 0.25);
  b.p1[0] += (_a.x - b.p1[0]) * k;
  b.p1[2] += (_a.z - b.p1[2]) * k;
  b.yAdj += (_a.y - b.p1y0 - b.yAdj) * k;
}

// Holding it in both hands at the chest (a check-up): elbows in, the hands on the sides of it.
export function holdPose(c) {
  c.armL.rotation.x = c.armR.rotation.x = -0.55;
  c.armL.rotation.z = -0.3;
  c.armR.rotation.z = 0.3;
  c.armL.rotation.y = c.armR.rotation.y = 0;
  c.elbowL.rotation.x = c.elbowR.rotation.x = -1.05;
  c.wristL.rotation.x = c.wristR.rotation.x = -0.5;
}

// Pulling a catch in (the ball rides in the hands meanwhile).
export function catching(c, now) {
  const at = c?.group.userData.catchAt;
  return at != null && now >= at && now - at < GIVE_T;
}
