import * as THREE from 'three';

const matCache = new Map();
export function lam(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
}

const LEG = new THREE.BoxGeometry(0.22, 0.86, 0.26);
const BODY = new THREE.BoxGeometry(0.56, 0.72, 0.32);
const ARM = new THREE.BoxGeometry(0.16, 0.62, 0.18);
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

  const legL = pivot(-0.13, 0.9);
  add(LEG, pants, 0, -0.43, 0, legL);
  const legR = pivot(0.13, 0.9);
  add(LEG, pants, 0, -0.43, 0, legR);
  add(BODY, shirt, 0, 1.26, 0);
  const armL = pivot(-0.37, 1.56);
  add(ARM, shirt, 0, -0.3, 0, armL);
  add(HAND, skin, 0, -0.66, 0, armL);
  const armR = pivot(0.37, 1.56);
  add(ARM, shirt, 0, -0.3, 0, armR);
  add(HAND, skin, 0, -0.66, 0, armR);
  add(HEAD, skin, 0, 1.8, 0);
  if (cap) {
    add(CAP, cap, 0, 2.0, 0);
    add(BRIM, cap, 0, 1.96, 0.22);
  }
  if (bandana) add(BAND, bandana, 0, 1.9, 0);

  return { group: g, legL, legR, armL, armR };
}

export function animateWalk(c, phase, amount) {
  const s = Math.sin(phase) * amount;
  c.legL.rotation.x = s * 0.8;
  c.legR.rotation.x = -s * 0.8;
  c.armL.rotation.x = -s * 0.6;
  c.armR.rotation.x = s * 0.6;
}

// Lay the character on its back (knocked down) or stand it back up.
export function setDown(c, down) {
  c.group.rotation.x = down ? -Math.PI / 2 : 0;
}
