import * as THREE from 'three';

const matCache = new Map();
export function lam(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
}

const SPINE_Y = 0.9; // (the spine pivot: hip height)
const THIGH = new THREE.BoxGeometry(0.22, 0.46, 0.26);
const SHIN = new THREE.BoxGeometry(0.2, 0.44, 0.24);
const BODY = new THREE.BoxGeometry(0.56, 0.42, 0.32); // (the chest: shoulders to mid-back)
const BELLY = new THREE.BoxGeometry(0.54, 0.36, 0.31); // (the lower back and belly)
const CHEST_Y = 1.22; // (the mid-back pivot)
const NECK_Y = 1.62;
const ARM = new THREE.BoxGeometry(0.16, 0.34, 0.18); // (the upper arm)
const FOREARM = new THREE.BoxGeometry(0.15, 0.3, 0.17);
const DELT = new THREE.BoxGeometry(0.2, 0.18, 0.22); // (the shoulder cap)
const HAND = new THREE.BoxGeometry(0.14, 0.14, 0.14);
const HEAD = new THREE.BoxGeometry(0.32, 0.34, 0.32);
const CAP = new THREE.BoxGeometry(0.36, 0.1, 0.36);
const BRIM = new THREE.BoxGeometry(0.34, 0.04, 0.16);
const BAND = new THREE.BoxGeometry(0.34, 0.08, 0.34);
// A woman's build: narrower shoulders and waist, a bust, hair.
const BODY_F = new THREE.BoxGeometry(0.5, 0.42, 0.3);
const BELLY_F = new THREE.BoxGeometry(0.44, 0.36, 0.28);
const BUST = new THREE.BoxGeometry(0.38, 0.13, 0.07);
const DELT_F = new THREE.BoxGeometry(0.17, 0.16, 0.2);
const ARM_F = new THREE.BoxGeometry(0.14, 0.34, 0.16);
const FOREARM_F = new THREE.BoxGeometry(0.13, 0.3, 0.15);
const HIPS_F = new THREE.BoxGeometry(0.5, 0.16, 0.31); // (a little wider at the hips than the waist)
const HAIR_TOP = new THREE.BoxGeometry(0.36, 0.11, 0.36);
const HAIR_BANGS = new THREE.BoxGeometry(0.34, 0.07, 0.05);
const THIGH_F = new THREE.BoxGeometry(0.2, 0.46, 0.24);
const SHIN_F = new THREE.BoxGeometry(0.17, 0.44, 0.21);
const HAIR_LONG = new THREE.BoxGeometry(0.34, 0.44, 0.08);
const HAIR_TAIL = new THREE.BoxGeometry(0.1, 0.32, 0.1);
const HAIR_BUN = new THREE.BoxGeometry(0.15, 0.14, 0.14);
const HAIR_SIDE = new THREE.BoxGeometry(0.05, 0.34, 0.24);
export const HAIR_COLORS = [0x120c0a, 0x1c120d, 0x2b1a12, 0x3b2416, 0x5a3a22, 0x8a5a33, 0xc9a35a, 0x7a2e16];
export const HAIR_STYLES = ['long', 'pony', 'bun'];

// Heights. The model is 1.97 m tall at scale 1; people are scaled to their own height. Real
// adult men (US, CDC NHANES 2015-2018, age 20+): average 175.4 cm (5'9"), standard deviation
// about 7.6 cm, so about two in three are 5'6"-6'0", one in six over 6'0", one in fifty over
// 6'3", and one in six under 5'6".
export const MODEL_H = 1.97;
// Real adult women (the same survey): average 161.3 cm (5'3.5"), standard deviation about
// 7.1 cm, so about two in three are 5'1"-5'6", one in six over 5'6", one in fifty over 5'9".
export function randomHeight(female = false) {
  const u = Math.max(1e-9, Math.random());
  const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); // (a normal draw)
  return female ? Math.max(1.45, Math.min(1.88, 1.613 + 0.071 * n)) : Math.max(1.55, Math.min(2.03, 1.754 + 0.076 * n));
}
// A person to fill the street: a woman about half the time (share), with a height to match.
// Names that are women's (the crew, the dice game, shop owners...): their bodies match.
export const WOMEN_NAMES = new Set(['Kiki', 'Tasha', 'Nae', 'Bree', 'Shay', 'Peaches', 'Lady', 'Nay Nay', 'Keke', 'Dee Dee', 'Rosa', 'Ms. Lee', 'Abuela Rosa', 'Mrs. Chen', 'Precious', 'Jada']);
export function makePerson(look = {}, share = 0.5) {
  const female = look.female ?? Math.random() < share;
  return setHeight(makeCharacter({ ...look, female }), randomHeight(female));
}
export function setHeight(c, m) {
  c.group.scale.setScalar(m / MODEL_H);
  c.group.userData.height = m;
  return c;
}

export const SKIN_TONES = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0x5c3a1e, 0xffdbac];

// A simple blocky person. Faces +z. Returns pivot groups so limbs can animate.
export function makeCharacter({ shirt = 0x3366aa, pants = 0x222222, skin = 0xc68642, cap = null, bandana = null, female = false, hair = null, hairStyle = null } = {}) {
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
    add(female ? THIGH_F : THIGH, pants, 0, -0.22, 0, hip);
    const knee = new THREE.Group();
    knee.position.set(0, -0.44, 0);
    hip.add(knee);
    add(female ? SHIN_F : SHIN, pants, 0, -0.21, 0, knee);
    return [hip, knee];
  };
  const [legL, kneeL] = leg(0.13);
  const [legR, kneeR] = leg(-0.13);
  // The spine, in three: the lower back (a pivot at the hips), the chest (a pivot mid-back,
  // carrying the shoulders) and the neck (the head). Each can bend and turn, so the upper body
  // curls, arches and twists. Their rotations are zeroed every frame (restPose, via
  // animateWalk), so nothing bends unless a pose says so.
  const spine = new THREE.Group();
  spine.position.set(0, SPINE_Y, 0);
  g.add(spine);
  const chest = new THREE.Group();
  chest.position.set(0, CHEST_Y - SPINE_Y, 0);
  spine.add(chest);
  const neck = new THREE.Group();
  neck.position.set(0, NECK_Y - CHEST_Y, 0);
  chest.add(neck);
  add(female ? BELLY_F : BELLY, shirt, 0, 1.08 - SPINE_Y, 0, spine);
  add(female ? BODY_F : BODY, shirt, 0, 1.41 - CHEST_Y, 0, chest);
  if (female) {
    add(BUST, shirt, 0, 1.4 - CHEST_Y, 0.17, chest);
    add(HIPS_F, pants, 0, 0.94 - SPINE_Y, 0, spine);
  }
  // Arms: the shoulder (armL / armR), the elbow and the wrist, each a pivot of its own.
  // An elbow bends with a negative x (the forearm comes forward); a wrist the same way.
  const arm = (x) => {
    const sh = new THREE.Group();
    sh.position.set(x, 1.56 - CHEST_Y, 0);
    chest.add(sh);
    add(female ? DELT_F : DELT, shirt, 0, -0.04, 0, sh);
    add(female ? ARM_F : ARM, shirt, 0, -0.16, 0, sh);
    const el = new THREE.Group();
    el.position.set(0, -0.32, 0);
    sh.add(el);
    add(female ? FOREARM_F : FOREARM, shirt, 0, -0.14, 0, el);
    const wr = new THREE.Group();
    wr.position.set(0, -0.28, 0);
    el.add(wr);
    add(HAND, skin, 0, -0.06, 0, wr);
    return [sh, el, wr];
  };
  const SH = female ? 0.33 : 0.37; // (the shoulders: narrower on a woman)
  const [armL, elbowL, wristL] = arm(SH);
  const [armR, elbowR, wristR] = arm(-SH);
  const hd = (geo, color, x, y, z) => add(geo, color, x, y - NECK_Y, z, neck);
  hd(HEAD, skin, 0, 1.8, 0);
  if (cap) {
    hd(CAP, cap, 0, 2.0, 0);
    hd(BRIM, cap, 0, 1.96, 0.22);
  }
  if (bandana) hd(BAND, bandana, 0, 1.9, 0);
  if (female) {
    // Hair: on top (under a cap if there's one), and down the back long, in a ponytail or a bun.
    const hc = hair ?? HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)];
    const st = hairStyle ?? HAIR_STYLES[Math.floor(Math.random() * HAIR_STYLES.length)];
    if (!cap) {
      hd(HAIR_TOP, hc, 0, 2.0, -0.01);
      hd(HAIR_BANGS, hc, 0, 1.93, 0.16); // (a fringe over the forehead)
    }
    if (st === 'long') {
      hd(HAIR_LONG, hc, 0, 1.76, -0.17);
      hd(HAIR_SIDE, hc, 0.175, 1.8, -0.04);
      hd(HAIR_SIDE, hc, -0.175, 1.8, -0.04);
    } else if (st === 'pony') {
      hd(HAIR_BUN, hc, 0, 1.92, -0.18);
      hd(HAIR_TAIL, hc, 0, 1.72, -0.22);
    } else hd(HAIR_BUN, hc, 0, 2.0, -0.12);
  }

  return { group: g, female, spine, chest, neck, legL, legR, kneeL, kneeR, armL, armR, elbowL, elbowR, wristL, wristR };
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
  c.group.userData.guardUp = false;
  c.spine?.rotation.set(0, 0, 0);
  c.chest?.rotation.set(0, 0, 0);
  c.neck?.rotation.set(0, 0, 0);
  for (const l of [c.legL, c.legR]) {
    l.rotation.y = 0;
    l.rotation.z = 0;
  }
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
// How the chest is turned (the lower back's bend and the chest's on top of it).
export function upperQuat(c, out) {
  return out.copy(c.spine.quaternion).multiply(c.chest.quaternion);
}

// Bend the back: x forward (+) / back (-), y a turn (+ to the left), z a side bend; spread over
// the lower back and the chest (more of a turn in the chest, as a body does).
export function bendSpine(c, x = 0, y = 0, z = 0) {
  c.spine.rotation.set(x * 0.55, y * 0.4, z * 0.5);
  c.chest.rotation.set(x * 0.45, y * 0.6, z * 0.5);
}

export function reachArm(c, side, target, pole, aim = null, up = null, frame = 'body') {
  const L = side === 'L';
  const sh = L ? c.armL : c.armR;
  const el = L ? c.elbowL : c.elbowR;
  const wr = L ? c.wristL : c.wristR;
  // (into the chest's own frame: the shoulders hang off it)
  upperQuat(c, _qs).invert();
  _P.copy(pole);
  if (frame === 'group') {
    c.spine.updateMatrix();
    c.chest.updateMatrix();
    _m.multiplyMatrices(c.spine.matrix, c.chest.matrix).invert();
    _T.copy(target).applyMatrix4(_m);
    _P.applyQuaternion(_qs);
  } else {
    _T.copy(target);
    _T.y -= CHEST_Y;
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
  // (still, the feet open out to shoulder width, knees over them)
  const splay = 0.45 * (1 - Math.min(1, amount * 2.5));
  c.legL.rotation.z = splay;
  c.legR.rotation.z = -splay;
  const bob = Math.abs(Math.sin(phase)) * amount;
  bendSpine(c, 0.42 + bob * 0.05 - splay * 0.15, -s * 0.15); // (the shoulders turning against the step)
  c.neck.rotation.set(-0.3, s * 0.08, 0); // (head up, eyes ahead)
  // (arms bent, hands low in front, swinging a little against the legs)
  c.armL.rotation.set(-0.35 + s * 0.3, 0, -0.12 - splay * 0.2);
  c.armR.rotation.set(-0.35 - s * 0.3, 0, 0.12 + splay * 0.2);
  c.elbowL.rotation.set(-1.25 - Math.max(0, -s) * 0.2, 0, 0);
  c.elbowR.rotation.set(-1.25 - Math.max(0, s) * 0.2, 0, 0);
  c.wristL.rotation.set(0, 0, 0);
  c.wristR.rotation.set(0, 0, 0);
  const sc = c.group.scale.y;
  void dl;
  void dr;
  return -lowestPoint(c) + bob * 0.03 * sc; // (measured: the soles on the floor, splayed or not)
}

// How far the lowest visible part of the body is below the character's base, as posed right now
// (world meters; negative: something's under the floor). For poses that lie or sit on the floor:
// returning -lowestPoint(c) as the height puts the body exactly on it.
const _box = new THREE.Box3();
const _bb = new THREE.Box3();
export function lowestPoint(c) {
  c.group.updateMatrixWorld(true);
  _box.makeEmpty();
  c.group.traverseVisible((m) => {
    if (!m.isMesh || !m.geometry) return;
    if ((m.parent === c.wristL || m.parent === c.wristR) && m.geometry !== HAND) return; // (a gun in the hand: not the body)
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    _bb.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
    _box.union(_bb);
  });
  return _box.isEmpty() ? 0 : _box.min.y - c.group.position.y;
}

// Where a wrist is right now, in the character's own frame (to blend a hand from wherever it
// is to a new spot).
const _wm = new THREE.Matrix4();
export function wristPos(c, side, out) {
  const w = side === 'L' ? c.wristL : c.wristR;
  w.updateWorldMatrix(true, false);
  _wm.copy(c.group.matrixWorld).invert().multiply(w.matrixWorld);
  return out.setFromMatrixPosition(_wm);
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
// (the drop comes back in world meters: scaled by the person's size). The foot is the bottom of
// the shin box, so a tilted shin stands on its front or back edge: that corner's what touches.
const SHIN_L = 0.43; // (knee to the sole)
const SHIN_D = 0.12; // (half the shin's depth: how far its edge is off the middle)
const LEG_H = L1 + SHIN_L;
export function bendLeg(hipP, kneeP, hip, knee) {
  hipP.rotation.x = -hip;
  kneeP.rotation.x = knee;
  const sh = knee - hip;
  return (hipP.parent?.scale.y ?? 1) * (LEG_H - (L1 * Math.cos(hip) + SHIN_L * Math.cos(sh) + SHIN_D * Math.abs(Math.sin(sh))));
}
// Legs splayed out sideways by z: they reach less far down (and stand on the shin's side edge),
// so the hips come down that bit more. d: the drop from bendLeg. Returns the new drop.
export function splayDrop(c, d, z) {
  const s = c.group.scale.y || 1;
  const L = LEG_H * s;
  return L - ((L - d) * Math.cos(z) - 0.1 * s * Math.abs(Math.sin(z)));
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
    if (m.isMesh && (m.geometry === BODY || m.geometry === BELLY || m.geometry === BODY_F || m.geometry === BELLY_F || m.geometry === BUST || m.geometry === DELT_F || m.geometry === ARM_F || m.geometry === FOREARM_F || m.geometry === ARM || m.geometry === FOREARM || m.geometry === DELT)) m.material = lam(color);
  });
}

// Lay the character down (knocked down, shot) or stand it back up. The fall plays out over
// about a second (fallPose, every frame from stepFalls): on its back by default, face down if
// the hit came from behind (face: 'front'), then it stays in the pose it landed in.
const FALLING = new Map();
export function setDown(c, down, face = 'back') {
  if (!down) {
    FALLING.delete(c);
    c.group.rotation.x = 0;
    return;
  }
  const target = face === 'front' ? Math.PI / 2 : -Math.PI / 2;
  const F = FALLING.get(c);
  if (F && F.target === target) return;
  if (!F && Math.abs(c.group.rotation.x - target) < 0.01) return;
  c.group.rotation.x = target * 0.002; // (down already, so whoever places it lifts it off the ground)
  FALLING.set(c, { t0: performance.now() / 1000, target, face });
}

const sq = (k) => k * k;
const ease = (k) => k * k * (3 - 2 * k);
const seg = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const mixv = (a, b, k) => a + (b - a) * k;
const setArm = (sh, el, x, out, e, left) => {
  sh.rotation.set(x, 0, left ? out : -out);
  el.rotation.set(e, 0, 0);
};

// A fall, t seconds in: the joints posed, and { rot: the body's tip (rotation.x), y: the
// height against lying flat (whoever places a downed body lifts it 0.2 m) }.
//   back (shot from the front): the hit jolts the chest back and the head with it, arms flung
//   up; the knees buckle and the body sags; then it tips over backwards, picking up speed, the
//   legs coming out from under it; it lands flat with a little bounce, arms out to the sides,
//   one knee up, the head rolled to the side.
//   front (shot from behind): the back arches and the arms fly back; a stumbling step forward,
//   folding at the waist; the knees go and it pitches forward, the arms coming out to catch it;
//   it lands face down, the head turned to one side, one knee out, the hands up by the head.
export function fallPose(c, t, face = 'back') {
  restPose(c);
  for (const w of [c.wristL, c.wristR]) w.rotation.set(0, 0, 0);
  const hit = ease(seg(t, 0, 0.12)) * (1 - ease(seg(t, 0.15, 0.45)));
  const land = ease(seg(t, 0.95, 1.2));
  const bounce = Math.sin(seg(t, 0.92, 1.25) * Math.PI) * (1 - seg(t, 0.92, 1.25));
  if (face === 'front') {
    const step = ease(seg(t, 0.12, 0.4)) * (1 - ease(seg(t, 0.45, 0.8)));
    const fold = ease(seg(t, 0.35, 0.7));
    const tip = sq(seg(t, 0.4, 0.95));
    bendSpine(c, -0.45 * hit + 0.4 * step + 0.25 * fold * (1 - tip), 0, 0.1 * land);
    c.neck.rotation.set(-0.5 * hit + 0.2 * step - 0.25 * land + 0.1 * bounce, 1.1 * land, 0);
    // (legs: the stumble, the knees going, then out behind it, one knee drawn up and out)
    const dl = bendLeg(c.legL, c.kneeL, mixv(0.7 * step + 0.45 * fold, 0.55, land), mixv(0.45 * step + 1.1 * fold * (1 - tip * 0.6), 1.15, land));
    const dr = bendLeg(c.legR, c.kneeR, mixv(-0.15 * step + 0.45 * fold, 0.05, land), mixv(0.25 * step + 1.1 * fold * (1 - tip * 0.7), 0.2, land));
    c.legL.rotation.z = 0.45 * land;
    // (arms: flung back, then out in front to catch it, ending bent up by the head)
    const catchK = ease(seg(t, 0.4, 0.9));
    setArm(c.armL, c.elbowL, mixv(mixv(0.7 * hit - 0.9 * step, -2.4, catchK), -2.25, land), mixv(0.6 * hit, 0.35, catchK), mixv(-0.3, -0.6, catchK) - 0.6 * land, true);
    setArm(c.armR, c.elbowR, mixv(mixv(0.7 * hit - 0.7 * step, -2.2, catchK), -1.3, land), mixv(0.6 * hit, 0.3, catchK) + 0.3 * land, mixv(-0.3, -0.6, catchK) - 0.3 * land, false);
    const drop = -Math.min(dl, dr) * (1 - tip);
    return { rot: (Math.PI / 2) * tip, y: (drop - 0.2) * (1 - tip) + 0.03 * bounce };
  }
  const sag = ease(seg(t, 0.12, 0.5));
  const tip = sq(seg(t, 0.42, 0.95));
  bendSpine(c, -0.4 * hit + 0.3 * sag * (1 - tip) - 0.05 * land, 0.15 * hit, 0);
  c.neck.rotation.set(-0.6 * hit + 0.3 * sag * (1 - tip) - 0.35 * tip + 0.25 * bounce + 0.2 * land, 0.9 * land, 0);
  // (legs: buckling, coming out from under it, one knee up)
  const dl = bendLeg(c.legL, c.kneeL, mixv(1.0 * sag * (1 - tip * 0.5), 0.6, land), mixv(1.8 * sag * (1 - tip * 0.4), 1.1, land));
  const dr = bendLeg(c.legR, c.kneeR, mixv(0.9 * sag * (1 - tip * 0.8), 0.1, land), mixv(1.6 * sag * (1 - tip * 0.8), 0.2, land));
  c.legR.rotation.z = -0.15 * land;
  // (arms: flung up with the hit, dropping as it sags, out wide on the ground)
  const fly = Math.max(hit, 0.6 * tip * (1 - land));
  setArm(c.armL, c.elbowL, -1.6 * fly - 0.3 * land, 0.3 * fly + 1.25 * land + 0.08 * bounce, -0.4 * fly - 0.5 * land, true);
  setArm(c.armR, c.elbowR, -1.3 * fly - 0.5 * land, 0.3 * fly + 1.0 * land + 0.08 * bounce, -0.3 * fly - 0.8 * land, false);
  const drop = -Math.min(dl, dr) * (1 - tip);
  return { rot: (-Math.PI / 2) * tip, y: (drop - 0.2) * (1 - tip) + 0.03 * bounce };
}

// Every frame (after everyone's placed): the falls under way, and the bodies already down held
// in the pose they landed in.
export function stepFalls() {
  const now = performance.now() / 1000;
  for (const [c, F] of FALLING) {
    if (!c.group.parent) {
      FALLING.delete(c);
      continue;
    }
    const f = fallPose(c, Math.min(1.3, now - F.t0), F.face);
    c.group.rotation.x = f.rot;
    // (undo last frame's height if nobody's placed it since, then this frame's)
    if (F.setY != null && Math.abs(c.group.position.y - F.setY) < 1e-6) c.group.position.y -= F.adj;
    F.adj = f.y - 0.2 * (1 - c.group.scale.y) * Math.abs(f.rot) / (Math.PI / 2); // (a smaller body lies lower)
    c.group.position.y += F.adj;
    F.setY = c.group.position.y;
  }
}
