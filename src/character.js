import * as THREE from 'three';

const matCache = new Map();
export function lam(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
}

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
  add(BODY, shirt, 0, 1.26, 0);
  // Arms: the shoulder (armL / armR), the elbow and the wrist, each a pivot of its own.
  // An elbow bends with a negative x (the forearm comes forward); a wrist the same way.
  const arm = (x) => {
    const sh = pivot(x, 1.56);
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
  add(HEAD, skin, 0, 1.8, 0);
  if (cap) {
    add(CAP, cap, 0, 2.0, 0);
    add(BRIM, cap, 0, 1.96, 0.22);
  }
  if (bandana) add(BAND, bandana, 0, 1.9, 0);

  return { group: g, legL, legR, kneeL, kneeR, armL, armR, elbowL, elbowR, wristL, wristR };
}

export function animateWalk(c, phase, amount) {
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

// Lay the character on its back (knocked down) or stand it back up.
export function setDown(c, down) {
  c.group.rotation.x = down ? -Math.PI / 2 : 0;
  if (down) c.kneeL.rotation.x = c.kneeR.rotation.x = 0;
  if (down) straightArms(c);
}
