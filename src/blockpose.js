import { bendLeg, bendSpine } from './character.js';

// Jumping on defense, the same for everybody (you and him): a block, or going up for a rebound.
// The height comes from the jump itself (streetball.js); this poses the body over it.
//
//   block    up two-footed, knees tucking; the hand on the ball's side goes straight up, wrist
//            cocked, then swats down at the top (harder, with a wrist snap, when it's a real
//            block: markSwat); the other arm out for balance; leaning in at the shooter.
//   rebound  both hands up high and together, then pulling it down to the chest.
//   Both: a quick load off the floor and a landing that soaks it up in the knees.
//
// markJump(c, now, T, kind, side): T the jump's length, side 1 the ball's to his right.
// jumpPose(c, now): poses it while one's on; returns how far the hips come down at the takeoff
// and the landing (shorter legs, the feet on the floor), or null when there's none on.

const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));
const mix = (a, b, k) => a + (b - a) * k;
const seg = (k, a, b) => ease(clamp01((k - a) / (b - a)));

export function markJump(c, now, T, kind, side) {
  const u = c.group.userData;
  u.jAt = now;
  u.jT = T;
  u.jKind = kind;
  u.jSide = side >= 0 ? 1 : -1;
  u.swatAt = null;
}

export function markSwat(c, now) {
  if (!c) return;
  c.group.userData.swatAt = now;
}

export function jumpPose(c, now) {
  const u = c.group.userData;
  if (u.jAt == null) return null;
  const k = (now - u.jAt) / u.jT;
  if (k < 0 || k > 1.15) {
    u.jAt = null;
    return null;
  }
  const R = u.jSide > 0;
  const A = R ? { a: c.armR, e: c.elbowR, w: c.wristR, out: -1 } : { a: c.armL, e: c.elbowL, w: c.wristL, out: 1 };
  const B = R ? { a: c.armL, e: c.elbowL, w: c.wristL, out: 1 } : { a: c.armR, e: c.elbowR, w: c.wristR, out: -1 };
  const set = (H, x, e, w, z) => {
    H.a.rotation.x = x;
    H.e.rotation.x = e;
    H.w.rotation.x = w;
    H.a.rotation.z = z * H.out;
  };
  // Legs: loaded at the takeoff, tucked in the air, soaking up the landing.
  const off = 1 - seg(k, 0, 0.14); // (the load straightening out)
  const land = seg(k, 0.8, 0.95) * (1 - seg(k, 1.0, 1.15));
  const air = seg(k, 0.12, 0.4) * (1 - seg(k, 0.65, 0.85));
  const block = u.jKind === 'block';
  const tuckH = block ? 0.5 : 0.35;
  const tuckK = block ? 0.85 : 0.6;
  const hip = Math.max(off * 0.8, air * tuckH, land * 0.95);
  const knee = Math.max(off * 1.35, air * tuckK, land * 1.55);
  const d1 = bendLeg(c.legL, c.kneeL, hip, knee);
  const d2 = bendLeg(c.legR, c.kneeR, hip * (block ? 0.85 : 1), knee * (block ? 0.9 : 1));
  const ground = Math.max(off, land); // (on the floor: the bent legs bring the hips down)
  if (block) {
    // The block hand: from down at the takeoff straight up (wrist cocked), swatting at the top.
    const up = seg(k, 0.05, 0.38);
    const swipe = seg(k, 0.42, 0.6) * (1 - seg(k, 0.75, 1.0));
    const st = u.swatAt != null ? now - u.swatAt : -1;
    const swat = st >= 0 && st < 0.35 ? Math.sin(Math.min(1, st / 0.18) * Math.PI * 0.5) * (1 - seg(st, 0.2, 0.35)) : 0;
    const down = seg(k, 0.8, 1.05);
    const sx = mix(mix(-0.5, -3.05, up), -2.6, swipe * 0.6);
    set(A, mix(mix(sx, -2.15, swat), -0.9, down), mix(-0.4, -0.08, up), mix(mix(-0.4, 0.6, swipe), 1.1, swat), mix(0.05, -0.08, up));
    set(B, mix(mix(-0.4, -2.2, up), -0.8, down), -0.45, 0, mix(0.15, 0.55, up));
    c.group.rotation.x = 0.06 * up * (1 - down) + 0.05 * swat;
    // (stretched tall and reaching, then snapping down over the swat)
    bendSpine(c, -0.14 * up * (1 - down) + 0.3 * swat, 0, (R ? -1 : 1) * 0.12 * up * (1 - down));
    c.neck.rotation.set(-0.35 * up * (1 - down), 0, 0);
  } else {
    // Both hands up high and together, then the ball pulled down to the chest.
    const up = seg(k, 0.05, 0.4);
    const pull = seg(k, 0.58, 0.85);
    const x = mix(mix(-0.6, -3.0, up), -1.25, pull);
    const e = mix(mix(-0.4, -0.15, up), -1.35, pull);
    set(A, x, e, mix(0, -0.3, up), mix(0.1, -0.12, up));
    set(B, x, e, mix(0, -0.3, up), mix(0.1, -0.12, up));
    c.group.rotation.x = 0.03 * pull;
    // (stretched up for it, then curling over it as it comes down to the chest)
    bendSpine(c, -0.1 * up * (1 - pull) + 0.3 * pull);
    c.neck.rotation.set(mix(-0.4 * up, 0.15, pull), 0, 0);
  }
  return -Math.max(0, Math.min(d1, d2)) * ground;
}
