import * as THREE from 'three';

const matCache = new Map();
export function lam(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
}

const SPINE_Y = 0.9; // (the spine pivot: hip height)
const THIGH = new THREE.BoxGeometry(0.22, 0.46, 0.26);
const SHIN = new THREE.BoxGeometry(0.2, 0.44, 0.24);
const BODY = new THREE.BoxGeometry(0.56, 0.72, 0.32);
const ARM = new THREE.BoxGeometry(0.16, 0.34, 0.18); // (the upper arm)
const FOREARM = new THREE.BoxGeometry(0.15, 0.3, 0.17);
const DELT = new THREE.BoxGeometry(0.2, 0.18, 0.22); // (the shoulder cap)
const HAND = new THREE.BoxGeometry(0.14, 0.14, 0.14);
const HEAD = new THREE.BoxGeometry(0.32, 0.34, 0.32);
const CAP = new THREE.BoxGeometry(0.36, 0.1, 0.36);
const BRIM = new THREE.BoxGeometry(0.34, 0.04, 0.16);
const BAND = new THREE.BoxGeometry(0.34, 0.08, 0.34);

export const SKIN_TONES = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0x5c3a1e, 0xffdbac];

// A simple blocky person. Faces +z. Returns pivot groups so limbs can animate.
export function makeCharacter({ shirt = 0x3366aa, pants = 0x222222, skin = 0xc68642, cap = null, bandana = null } = {}) {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const add = (geo, color, x, y, z, parent = g) => {
    const m = new THREE.Mesh(geo, lam(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const pivot = (x, y) => {
    const p = new THREE.Group();
    p.position.set(x, y, 0);
    g.add(p);
    return p;
  };

  // The character faces +z, so its right side is local -x.
  // Legs: hip pivot (thigh) with a knee pivot (shin) so they can bend.
  const leg = (x) => {
    const hip = pivot(x, 0.9);
    add(THIGH, pants, 0, -0.22, 0, hip);
    const knee = new THREE.Group();
    knee.position.set(0, -0.44, 0);
    hip.add(knee);
    add(SHIN, pants, 0, -0.21, 0, knee);
    return [hip, knee];
  };
  const [legL, kneeL] = leg(0.13);
  const [legR, kneeR] = leg(-0.13);
  // The spine: everything above the hips (the body, the head, the arms) hangs off a pivot at
  // hip height, so the upper body can lean (a crouch, a fighting stance, a flinch). Its rotation
  // is zeroed every frame (animateWalk), so nothing leans unless a pose says so.
  const spine = new THREE.Group();
  spine.position.set(0, SPINE_Y, 0);
  g.add(spine);
  const up = (geo, color, x, y, z) => add(geo, color, x, y - SPINE_Y, z, spine);
  up(BODY, shirt, 0, 1.26, 0);
  // Arms: the shoulder (armL / armR), the elbow and the wrist, each a pivot of its own.
  // An elbow bends with a negative x (the forearm comes forward); a wrist the same way.
  const arm = (x) => {
    const sh = new THREE.Group();
    sh.position.set(x, 1.56 - SPINE_Y, 0);
    spine.add(sh);
    add(DELT, shirt, 0, -0.04, 0, sh);
    add(ARM, shirt, 0, -0.16, 0, sh);
    const el = new THREE.Group();
    el.position.set(0, -0.32, 0);
    sh.add(el);
    add(FOREARM, shirt, 0, -0.14, 0, el);
    const wr = new THREE.Group();
    wr.position.set(0, -0.28, 0);
    el.add(wr);
    add(HAND, skin, 0, -0.06, 0, wr);
    return [sh, el, wr];
  };
  const [armL, elbowL, wristL] = arm(0.37);
  const [armR, elbowR, wristR] = arm(-0.37);
  up(HEAD, skin, 0, 1.8, 0);
  if (cap) {
    up(CAP, cap, 0, 2.0, 0);
    up(BRIM, cap, 0, 1.96, 0.22);
  }
  if (bandana) up(BAND, bandana, 0, 1.9, 0);

  return { group: g, spine, legL, legR, kneeL, kneeR, armL, armR, elbowL, elbowR, wristL, wristR };
}

export function animateWalk(c, phase, amount) {
  restPose(c);
  const s = Math.sin(phase) * amount;
  c.legL.rotation.x = s * 0.8;
  c.legR.rotation.x = -s * 0.8;
  // The knee bends as the leg swings through.
  c.kneeL.rotation.x = Math.max(0, s) * 1.1 * amount;
  c.kneeR.rotation.x = Math.max(0, -s) * 1.1 * amount;
  c.armL.rotation.x = -s * 0.6;
  c.armR.rotation.x = s * 0.6;
  // (elbows: a little give standing, bent near square at a run, more on the forward swing)
  const e = 0.2 + 0.9 * amount;
  c.elbowL.rotation.x = -e - Math.max(0, s) * 0.5;
  c.elbowR.rotation.x = -e - Math.max(0, -s) * 0.5;
  c.wristL.rotation.x = c.wristR.rotation.x = 0;
}

// Back to neutral: the spine upright, every arm joint's twist and swing out (reachArm turns
// them every way), ready for the frame's poses.
const ARM_JOINTS = ['armL', 'armR', 'elbowL', 'elbowR', 'wristL', 'wristR'];
export function restPose(c) {
  c.spine?.rotation.set(0, 0, 0);
  for (const j of ARM_JOINTS) {
    c[j].rotation.y = 0;
    c[j].rotation.z = 0;
  }
}

// Put a hand somewhere: the shoulder and elbow worked out (two-bone IK) so the wrist lands on
// `target`, the elbow bending out toward `pole`. With `aim` and `up` the wrist turns too, so the
// hand (and a gun in it) points along `aim` with its top toward `up`.
//   frame 'body' (default): the coordinates lean with the spine (a fist at the chin stays at the
//   chin); 'group': the character's own frame, upright whatever the spine does (a gun on target).
const UPPER = 0.32;
const FORE = 0.28;
const _T = new THREE.Vector3();
const _P = new THREE.Vector3();
const _A = new THREE.Vector3();
const _U = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _u = new THREE.Vector3();
const _f = new THREE.Vector3();
const _w = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
export function reachArm(c, side, target, pole, aim = null, up = null, frame = 'body') {
  const L = side === 'L';
  const sh = L ? c.armL : c.armR;
  const el = L ? c.elbowL : c.elbowR;
  const wr = L ? c.wristL : c.wristR;
  const sp = c.spine;
  // (into the spine's own frame)
  _qs.copy(sp.quaternion).invert();
  _T.copy(target);
  _T.y -= SPINE_Y;
  _P.copy(pole);
  if (frame === 'group') {
    _T.applyQuaternion(_qs);
    _P.applyQuaternion(_qs);
  }
  _d.subVectors(_T, sh.position);
  const dist = _d.length() || 1e-4;
  _d.divideScalar(dist);
  const D = Math.min(UPPER + FORE - 0.002, Math.max(0.08, dist));
  const x0 = (UPPER * UPPER - FORE * FORE + D * D) / (2 * D);
  const r = Math.sqrt(Math.max(0, UPPER * UPPER - x0 * x0));
  _P.addScaledVector(_d, -_P.dot(_d));
  if (_P.lengthSq() < 1e-8) _P.set(0, -1, 0).addScaledVector(_d, _d.y);
  _P.normalize();
  _e.copy(sh.position).addScaledVector(_d, x0).addScaledVector(_P, r); // (the elbow)
  _u.subVectors(_e, sh.position).normalize();
  _f.copy(sh.position).addScaledVector(_d, D).sub(_e).normalize();
  _w.copy(_f).addScaledVector(_u, -_f.dot(_u));
  if (_w.lengthSq() < 1e-8) _w.copy(_P).negate();
  _w.normalize();
  _y.copy(_u).negate();
  _x.crossVectors(_y, _w);
  _m.makeBasis(_x, _y, _w);
  sh.quaternion.setFromRotationMatrix(_m);
  el.rotation.set(-Math.acos(Math.max(-1, Math.min(1, _u.dot(_f)))), 0, 0);
  if (!aim) {
    wr.rotation.set(0, 0, 0);
    return;
  }
  _A.copy(aim);
  _U.copy(up || _x.set(0, 1, 0));
  if (frame === 'group') {
    _A.applyQuaternion(_qs);
    _U.applyQuaternion(_qs);
  }
  _A.normalize();
  _U.addScaledVector(_A, -_U.dot(_A)).normalize();
  _y.copy(_A).negate();
  _x.crossVectors(_y, _U);
  _m.makeBasis(_x, _y, _U);
  _q.setFromRotationMatrix(_m);
  _q2.copy(sh.quaternion).multiply(el.quaternion).invert();
  wr.quaternion.copy(_q2.multiply(_q));
}

// Crouched and on the move (sneaking): knees well bent, the upper body leaning in over them,
// a long low step with the swing knee lifting, the arms bent and carried in front. phase: the
// stride; amount 0 (still) to 1. Returns how far the hips come down.
export function crouchWalk(c, phase, amount = 1) {
  const s = Math.sin(phase) * amount;
  const lift = Math.cos(phase) * amount;
  const dl = bendLeg(c.legL, c.kneeL, 0.85 + s * 0.5, 1.42 + Math.max(0, lift) * 0.45 - Math.max(0, -s) * 0.25);
  const dr = bendLeg(c.legR, c.kneeR, 0.85 - s * 0.5, 1.42 + Math.max(0, -lift) * 0.45 - Math.max(0, s) * 0.25);
  const bob = Math.abs(Math.sin(phase)) * amount;
  c.spine.rotation.x = 0.42 + bob * 0.05;
  c.spine.rotation.y = -s * 0.12; // (the shoulders turning against the step)
  // (arms bent, hands low in front, swinging a little against the legs)
  c.armL.rotation.set(-0.35 + s * 0.3, 0, -0.12);
  c.armR.rotation.set(-0.35 - s * 0.3, 0, 0.12);
  c.elbowL.rotation.set(-1.25 - Math.max(0, -s) * 0.2, 0, 0);
  c.elbowR.rotation.set(-1.25 - Math.max(0, s) * 0.2, 0, 0);
  c.wristL.rotation.set(0, 0, 0);
  c.wristR.rotation.set(0, 0, 0);
  return -Math.min(dl, dr) + bob * 0.03;
}

// Straight arms (for aiming a gun down them, say). Pass 'R' or 'L' for one.
export function straightArms(c, side = '') {
  if (side !== 'L') c.elbowR.rotation.x = c.wristR.rotation.x = 0;
  if (side !== 'R') c.elbowL.rotation.x = c.wristL.rotation.x = 0;
}

const L1 = 0.44;
const L2 = 0.44;
// Bend at the hips and knees: thigh forward by `hip` rad, shin back by `knee` rad.
// Returns how far to lower the body so the feet stay on the ground.
export function bendLeg(hipP, kneeP, hip, knee) {
  hipP.rotation.x = -hip;
  kneeP.rotation.x = knee;
  return L1 + L2 - (L1 * Math.cos(hip) + L2 * Math.cos(knee - hip));
}

// Crouch: both knees bent (depth 0 = standing, 1 = full crouch). `shuffle` adds a small step.
export function crouchPose(c, depth = 1, shuffle = 0) {
  const h = 1.25 * depth;
  const k = 2.1 * depth;
  const dl = bendLeg(c.legL, c.kneeL, h + shuffle * 0.25, k + shuffle * 0.2);
  const dr = bendLeg(c.legR, c.kneeR, h - shuffle * 0.25, k - shuffle * 0.2);
  return -Math.min(dl, dr);
}

// A different shirt (a team jersey, say).
export function setShirt(c, color) {
  c.group.traverse((m) => {
    if (m.isMesh && (m.geometry === BODY || m.geometry === ARM || m.geometry === FOREARM || m.geometry === DELT)) m.material = lam(color);
  });
}

// Lay the character down (knocked down, shot) or stand it back up. The fall plays out over
// ~0.45 s (stepFalls, every frame): on its back by default, face down if the hit came from
// behind (face: 'front').
const FALLING = new Map();
export function setDown(c, down, face = 'back') {
  if (!down) {
    FALLING.delete(c);
    c.group.rotation.x = 0;
    return;
  }
  const target = face === 'front' ? Math.PI / 2 : -Math.PI / 2;
  if (Math.abs(c.group.rotation.x - target) < 0.01) return;
  c.group.rotation.x = target * 0.002; // (down already, so whoever places it lifts it off the ground)
  c.kneeL.rotation.x = c.kneeR.rotation.x = 0;
  straightArms(c);
  FALLING.set(c, { t0: performance.now() / 1000, target });
}

// The falls in progress: tipping over, quicker as it goes, the arms coming up; the lift that
// "down" adds (lying on the ground) eased in so it doesn't pop.
export function stepFalls() {
  const now = performance.now() / 1000;
  for (const [c, F] of FALLING) {
    const k = Math.min(1, (now - F.t0) / 0.45);
    c.group.rotation.x = F.target * k * k;
    // (undo last frame's drop if nobody's placed it since, then this frame's)
    if (F.setY != null && Math.abs(c.group.position.y - F.setY) < 1e-6) c.group.position.y += F.adj;
    F.adj = 0.2 * (1 - k);
    c.group.position.y -= F.adj;
    F.setY = c.group.position.y;
    const arms = Math.sin(k * Math.PI) * 0.9;
    c.armL.rotation.x = c.armR.rotation.x = -arms;
    if (k >= 1) FALLING.delete(c);
  }
}
