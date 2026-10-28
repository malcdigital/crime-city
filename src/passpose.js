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

// Returns true if it posed the arms (a pass or a catch going on).
export function passPose(c, now) {
  const u = c.group.userData;
  const set = (x, z, e, w) => {
    u.posed = true;
    c.armL.rotation.x = c.armR.rotation.x = x;
    c.armL.rotation.z = -z;
    c.armR.rotation.z = z;
    c.elbowL.rotation.x = c.elbowR.rotation.x = e;
    c.wristL.rotation.x = c.wristR.rotation.x = w;
  };
  if (u.passAt != null && now - u.passAt < PASS_T) {
    const t = (now - u.passAt) / PASS_T;
    const push = ease(clamp01(t / 0.35)); // (out)
    const back = ease(clamp01((t - 0.6) / 0.4)); // (and back)
    // (from the chest pocket, elbows in, to arms out straight, wrists turned through)
    set(mix(mix(-1.05, -1.5, push), -0.6, back), mix(mix(0.38, 0.12, push), 0.05, back), mix(mix(-1.35, -0.05, push), -0.4, back), mix(mix(-0.2, 0.7, push), 0, back));
    return true;
  }
  if (u.catchAt != null) {
    const left = u.catchAt - now;
    if (left > 0 && left <= REACH_T) {
      // (hands up and out to it, palms facing it)
      const k = ease(clamp01(1 - left / REACH_T));
      set(mix(-0.7, -1.35, k), mix(0.15, 0.3, k), mix(-0.6, -0.45, k), mix(0, -0.45, k));
      return true;
    }
    if (left <= 0 && -left < GIVE_T) {
      // (caught: the give, elbows bending, the ball in to the chest)
      const k = ease(clamp01(-left / GIVE_T));
      set(mix(-1.35, -1.1, k), mix(0.3, 0.38, k), mix(-0.45, -1.3, k), mix(-0.45, -0.1, k));
      return true;
    }
    if (-left >= GIVE_T) u.catchAt = null;
  }
  if (u.posed) {
    // (done: the arms straight back in at the sides; the walk animation does the rest)
    u.posed = false;
    c.armL.rotation.z = c.armR.rotation.z = 0;
  }
  return false;
}
