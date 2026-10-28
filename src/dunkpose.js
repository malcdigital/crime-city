import { bendLeg, bendSpine } from './character.js';

// Dunks, the same for everybody (you and him): the whole body, by phase.
//
//   rise  (k 0..1, off the floor to the rim): the ball gathered at the chest, the free knee
//         driving up off a one-foot takeoff (both knees tucking on a two-hand), leaning in;
//         the arms by style, finishing with the throw-down right at the top:
//           two      both hands bring it back behind the head, then slam it down
//           one      gathered, then up on one hand, a snap down through the rim
//           windmill the ball hand swings down, back, over the top and down through the rim
//           tomahawk the ball hand winds way back behind the head, then whips forward
//           reach    (an alley-oop) both hands up to meet it, then a two-hand slam
//   hang  (k 0..1, if he hangs on the rim): both hands on the rim, legs dangling, swinging
//   drop  (k 0..1, back to the floor): arms come down, knees bend to soak up the landing
//
// Arms: rotation.x 0 hangs straight down, -PI/2 out in front, -PI straight up, past that
// behind the head; an elbow's negative x folds the forearm toward the arm's front. Outward
// rotation.z is + for the left arm, - for the right. hand: 1 right-handed, -1 left.
// Returns { y } (a landing crouch lowers the body) and { two } (the ball between both hands).

const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));
const mix = (a, b, k) => a + (b - a) * k;
const seg = (k, a, b) => ease(clamp01((k - a) / (b - a)));

export function dunkPose(c, style, ph, k, hand = 1) {
  const R = hand >= 0;
  const M = R ? { a: c.armR, e: c.elbowR, w: c.wristR, out: -1 } : { a: c.armL, e: c.elbowL, w: c.wristL, out: 1 };
  const O = R ? { a: c.armL, e: c.elbowL, w: c.wristL, out: 1 } : { a: c.armR, e: c.elbowR, w: c.wristR, out: -1 };
  const set = (A, x, e, w = 0, z = 0) => {
    A.a.rotation.x = x;
    A.e.rotation.x = e;
    A.w.rotation.x = w;
    A.a.rotation.z = z * A.out;
  };
  const twoFoot = style === 'two' || style === 'reach';
  // (the takeoff leg is the one opposite the ball hand; the other knee drives)
  const legs = (free, push) => {
    const [fl, fk] = free;
    const [pl, pk] = push;
    const LF = R ? [c.legR, c.kneeR] : [c.legL, c.kneeL];
    const LP = R ? [c.legL, c.kneeL] : [c.legR, c.kneeR];
    const d1 = bendLeg(LF[0], LF[1], fl, fk);
    const d2 = bendLeg(LP[0], LP[1], pl, pk);
    return Math.min(d1, d2);
  };
  let two = false;
  let y = 0;
  if (ph === 'rise') {
    // Legs: off the floor, the free knee up (both tucked on a two-footer), stretching out at the top.
    const up = seg(k, 0, 0.45);
    const top = seg(k, 0.7, 1);
    if (twoFoot) legs([mix(0.2, 0.75, up) - top * 0.35, mix(0.3, 1.3, up) - top * 0.6], [mix(0.2, 0.7, up) - top * 0.35, mix(0.3, 1.2, up) - top * 0.55]);
    else legs([mix(0.3, 1.35, up) - top * 0.4, mix(0.4, 1.7, up) - top * 0.6], [mix(0.1, -0.15, up), mix(0.2, 0.25, up)]);
    // Leaning in on the way up, then over the rim for the throw-down.
    c.group.rotation.x = mix(0.22, 0.08, seg(k, 0, 0.6)) + top * 0.22;
    const g = seg(k, 0, 0.3); // (the gather: both hands, ball at the chest)
    if (style === 'two' || style === 'reach') {
      // Both hands: up (and back behind the head on a two-hand), then slammed down.
      const back = seg(k, 0.2, 0.78);
      const slam = seg(k, 0.82, 1);
      const sx = style === 'reach' ? mix(-1.3, -2.95, back) : mix(-1.3, -3.35, back);
      const ex = style === 'reach' ? mix(-0.5, -0.15, back) : mix(-0.5, -1.15, back);
      set(M, mix(sx, -2.25, slam), mix(ex, -0.15, slam), slam * 0.7, 0.12);
      set(O, mix(sx, -2.25, slam), mix(ex, -0.15, slam), slam * 0.7, 0.12);
      two = true;
      // (arched back with the ball behind the head, then curling down into the throw-down)
      bendSpine(c, -0.22 * back * (1 - slam) + 0.4 * slam);
      c.neck.rotation.set(-0.3 * (1 - slam) + 0.15 * slam, 0, 0);
    } else if (style === 'one') {
      const lift = seg(k, 0.25, 0.8);
      const snap = seg(k, 0.84, 1);
      set(M, mix(mix(-1.3, -3.15, lift), -2.3, snap), mix(mix(-0.5, -0.35, lift), -0.05, snap), snap * 0.9, 0.05);
      set(O, mix(-1.3, -1.0, lift), mix(-0.5, -0.9, lift), 0, mix(0.1, 0.55, lift)); // (the off arm out for balance)
      two = g < 1 && k < 0.3;
      bendSpine(c, -0.12 * lift * (1 - snap) + 0.32 * snap, 0, (R ? 1 : -1) * -0.12 * lift);
      c.neck.rotation.set(-0.28 * (1 - snap), 0, 0);
    } else if (style === 'windmill') {
      // The ball hand goes all the way round: down, back, over the top, down through the rim.
      const r = seg(k, 0.18, 1);
      set(M, -1.3 + 5.35 * r, mix(-0.5, -0.1, seg(k, 0.15, 0.3)), r > 0.9 ? (r - 0.9) * 8 : 0, 0.08);
      set(O, mix(-1.3, -0.7, seg(k, 0.15, 0.4)), -0.5, 0, mix(0.1, 0.7, seg(k, 0.15, 0.4)));
      two = k < 0.18;
      bendSpine(c, 0.08 + 0.3 * seg(k, 0.85, 1), (R ? 1 : -1) * 0.35 * Math.sin(r * Math.PI), 0); // (the shoulders winding round with the arm)
      c.neck.rotation.set(-0.25, 0, 0);
    } else {
      // Tomahawk: wound way back behind the head (elbow folded), then whipped forward.
      const wind = seg(k, 0.15, 0.72);
      const whip = seg(k, 0.78, 1);
      set(M, mix(mix(-1.3, -3.6, wind), -2.05, whip), mix(mix(-0.5, -1.75, wind), -0.05, whip), whip * 1.0, 0.1);
      set(O, mix(-1.3, -1.9, wind), mix(-0.5, -0.4, wind), 0, mix(0.1, 0.35, wind));
      two = k < 0.15;
      c.group.rotation.x -= wind * (1 - whip) * 0.06;
      bendSpine(c, -0.4 * wind * (1 - whip) + 0.45 * whip, (R ? 1 : -1) * 0.15 * wind * (1 - whip)); // (arched back loading it, then whipped through)
      c.neck.rotation.set(-0.3 * (1 - whip), 0, 0);
    }
  } else if (ph === 'hang') {
    // On the rim: both hands up on it, the legs dangling, swinging under it.
    const sw = Math.sin(k * Math.PI * 2) * 0.12;
    set(M, -2.95, -0.15, 0.2, 0.15);
    set(O, -2.95, -0.15, 0.2, 0.15);
    legs([0.35 + sw, 0.55], [0.25 + sw, 0.45]);
    c.group.rotation.x = 0.1 - sw * 0.8;
    bendSpine(c, 0.08 + sw * 0.5);
    c.neck.rotation.set(-0.2, 0, 0);
  } else {
    // Down: the arms come down, then the knees take the landing.
    const a = seg(k, 0, 0.6);
    set(M, mix(-2.6, -0.7, a), mix(-0.15, -0.7, a), 0, 0.2);
    set(O, mix(-2.6, -0.7, a), mix(-0.15, -0.7, a), 0, 0.2);
    const land = seg(k, 0.6, 1) * (1 - seg(k, 0.92, 1) * 0.3);
    const d = legs([mix(0.35, 1.0, land), mix(0.5, 1.7, land)], [mix(0.25, 1.0, land), mix(0.45, 1.7, land)]);
    y = -Math.max(0, d); // (shorter legs: the hips come down, the feet stay on the floor)
    c.group.rotation.x = mix(0.1, 0.12, land);
    bendSpine(c, 0.3 * land);
  }
  return { y, two };
}

// Which phase a dunk is in, t seconds after takeoff (hang 0: no hanging on the rim).
export function dunkPhase(t, rise, hang, drop) {
  if (t < rise) return { ph: 'rise', k: Math.max(0, t / rise) };
  t -= rise;
  if (hang > 0 && t < hang) return { ph: 'hang', k: t / hang };
  t -= hang;
  return { ph: 'drop', k: Math.min(1, t / drop) };
}

// Where the ball is during a dunk: between his hands, or in the ball hand (as posed last frame).
export function dunkBall(b, c, two, hand, v1, v2) {
  c.group.updateMatrixWorld(true);
  if (two) {
    c.wristL.localToWorld(v1.set(0, -0.14, 0));
    c.wristR.localToWorld(v2.set(0, -0.14, 0));
    v1.add(v2).multiplyScalar(0.5);
  } else (hand >= 0 ? c.wristR : c.wristL).localToWorld(v1.set(0, -0.16, 0));
  b.x = v1.x;
  b.y = v1.y;
  b.z = v1.z;
}
