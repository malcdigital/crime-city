import * as THREE from 'three';

// Guns to look at: on a gun shop's wall and in its cases (interiors.js), and turning in the shop's
// carousel (shoppreview.js). Built from a few dozen boxes and cylinders each, true to size in
// meters, laid along +x (the muzzle at +x, the top up). mat(color) gives the material (the
// shops pass their own, which glow a little inside).
// Also: a box of rounds (ammo), a vest (armor).

const METAL = 0x1d1e21;
const POLY = 0x26272a;
const WOOD = 0x6b4423;
const WOOD2 = 0x5a3a1e;
const STEEL = 0x8d939a;
const CHROME = 0xbfc4ca;

const lamCache = new Map();
const lambert = (c) => {
  if (!lamCache.has(c)) lamCache.set(c, new THREE.MeshLambertMaterial({ color: c }));
  return lamCache.get(c);
};

export function gunModel(id, mat = lambert) {
  const g = new THREE.Group();
  const box = (w, h, d, x, y, z, c, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
    m.position.set(x, y, z);
    m.rotation.z = rz;
    g.add(m);
    return m;
  };
  // (a cylinder along x)
  const tube = (r, len, x, y, z, c, seg = 10) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat(c));
    m.rotation.z = Math.PI / 2;
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  // (a trigger guard: a half ring under the frame)
  const guard = (x, y, r = 0.02, c = METAL) => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.004, 4, 10, Math.PI), mat(c));
    t.rotation.z = Math.PI;
    t.position.set(x, y, 0);
    g.add(t);
    box(0.006, 0.022, 0.006, x - 0.002, y - 0.005, 0, METAL, 0.3); // (the trigger)
  };
  const grip = (x, y, len = 0.11, c = POLY, lean = 0.28) => box(0.034, len, 0.03, x, y - len / 2, 0, c, lean);
  if (id === 'pistol' || id === 'mpistol') {
    box(0.19, 0.034, 0.028, 0.0, 0.03, 0, METAL); // (the slide)
    for (let k = 0; k < 5; k++) box(0.003, 0.03, 0.029, -0.075 + k * 0.007, 0.03, 0, 0x101010); // (serrations)
    box(0.15, 0.022, 0.026, 0.01, 0.004, 0, POLY); // (the frame)
    tube(0.007, 0.012, 0.1, 0.034, 0, 0x0b0b0b); // (the muzzle)
    box(0.008, 0.01, 0.006, 0.085, 0.052, 0, METAL); // (front sight)
    box(0.01, 0.01, 0.022, -0.085, 0.052, 0, METAL); // (rear sight)
    guard(-0.005, -0.008);
    grip(-0.06, 0.0, id === 'mpistol' ? 0.1 : 0.11);
    if (id === 'mpistol') {
      box(0.026, 0.12, 0.024, -0.075, -0.15, 0, METAL, 0.28); // (the long mag out of the grip)
      tube(0.009, 0.05, 0.12, 0.03, 0, 0x111111); // (a threaded barrel)
      box(0.03, 0.02, 0.026, 0.055, -0.015, 0, POLY); // (the front grip stub)
    }
  } else if (id === 'revolver') {
    tube(0.012, 0.16, 0.075, 0.035, 0, CHROME, 12); // (the barrel)
    box(0.16, 0.012, 0.016, 0.075, 0.05, 0, CHROME); // (the rib on top)
    box(0.01, 0.014, 0.006, 0.15, 0.06, 0, CHROME);
    box(0.09, 0.05, 0.024, -0.03, 0.025, 0, CHROME); // (the frame)
    tube(0.03, 0.05, -0.02, 0.025, 0, STEEL, 12); // (the cylinder)
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      tube(0.006, 0.052, -0.02, 0.025 + Math.sin(a) * 0.018, Math.cos(a) * 0.018, 0x2a2a2a, 6); // (its chambers)
    }
    box(0.016, 0.02, 0.01, -0.075, 0.055, 0, CHROME, -0.5); // (the hammer)
    guard(-0.035, -0.008, 0.018, CHROME);
    grip(-0.08, 0.0, 0.11, WOOD, 0.35);
  } else {
    const L = { smg: 0.55, shotgun: 1.0, rifle: 0.9, ak: 0.88, hunting: 1.12 }[id] || 0.8;
    if (id === 'smg') {
      box(0.26, 0.055, 0.04, 0.0, 0.0, 0, METAL); // (the receiver)
      box(0.2, 0.012, 0.022, 0.0, 0.034, 0, 0x111111); // (the rail)
      tube(0.011, 0.12, 0.19, 0.008, 0, 0x111111); // (the barrel)
      box(0.1, 0.045, 0.042, 0.08, -0.004, 0, POLY); // (the handguard)
      box(0.026, 0.15, 0.03, 0.02, -0.1, 0, METAL, -0.05); // (the mag)
      guard(-0.045, -0.03);
      grip(-0.07, -0.025, 0.1);
      // (a folding stock: a frame back from the receiver)
      box(0.2, 0.01, 0.01, -0.23, 0.012, 0.015, METAL);
      box(0.2, 0.01, 0.01, -0.23, 0.012, -0.015, METAL);
      box(0.012, 0.07, 0.04, -0.33, -0.012, 0, POLY);
      box(0.012, 0.02, 0.022, 0.1, 0.05, 0, METAL); // (front sight)
      box(0.014, 0.02, 0.022, -0.1, 0.05, 0, METAL); // (rear sight)
    } else if (id === 'shotgun') {
      tube(0.013, 0.62, 0.3, 0.03, 0, METAL); // (the barrel)
      tube(0.011, 0.45, 0.24, 0.0, 0, 0x2b2b2b); // (the magazine tube)
      tube(0.022, 0.18, 0.2, 0.0, 0, WOOD, 10); // (the pump)
      for (let k = 0; k < 5; k++) tube(0.0225, 0.004, 0.13 + k * 0.035, 0.0, 0, WOOD2, 10); // (its grooves)
      box(0.2, 0.06, 0.04, -0.06, 0.012, 0, METAL); // (the receiver)
      box(0.007, 0.012, 0.006, 0.6, 0.046, 0, CHROME); // (the bead)
      guard(-0.07, -0.022);
      box(0.12, 0.05, 0.034, -0.2, -0.015, 0, WOOD, 0.12); // (the wrist)
      box(0.26, 0.085, 0.038, -0.36, -0.035, 0, WOOD, 0.08); // (the stock)
      box(0.012, 0.09, 0.04, -0.495, -0.045, 0, 0x111111, 0.08); // (the butt pad)
    } else if (id === 'rifle') {
      box(0.26, 0.06, 0.042, 0.0, 0.0, 0, METAL); // (the receiver)
      box(0.3, 0.014, 0.024, 0.06, 0.038, 0, 0x111111); // (the rail)
      box(0.25, 0.055, 0.05, 0.26, 0.0, 0, POLY); // (the handguard)
      for (let k = 0; k < 6; k++) box(0.02, 0.012, 0.052, 0.17 + k * 0.035, 0.0, 0, 0x151515); // (its vents)
      tube(0.01, 0.2, 0.48, 0.005, 0, 0x111111); // (the barrel)
      box(0.012, 0.06, 0.012, 0.37, 0.04, 0, METAL); // (the front sight post)
      box(0.04, 0.035, 0.012, 0.0, 0.065, 0, METAL); // (the carry handle sight)
      box(0.03, 0.16, 0.03, 0.03, -0.1, 0, METAL, -0.2); // (the mag, a little forward)
      guard(-0.05, -0.03);
      grip(-0.08, -0.025, 0.1);
      box(0.06, 0.03, 0.03, -0.18, 0.005, 0, METAL); // (the buffer tube)
      box(0.2, 0.07, 0.042, -0.29, -0.01, 0, POLY, 0.06); // (the stock)
    } else if (id === 'ak') {
      box(0.24, 0.06, 0.044, 0.0, 0.0, 0, METAL); // (the receiver)
      box(0.2, 0.02, 0.045, -0.01, 0.038, 0, METAL); // (the dust cover)
      box(0.18, 0.05, 0.05, 0.22, -0.002, 0, WOOD); // (the handguard)
      box(0.16, 0.024, 0.04, 0.21, 0.035, 0, WOOD2); // (the gas tube cover)
      tube(0.01, 0.22, 0.42, 0.005, 0, 0x111111); // (the barrel)
      box(0.012, 0.05, 0.01, 0.5, 0.03, 0, METAL); // (the front sight)
      // (the curved mag: two pieces, swept forward)
      box(0.032, 0.09, 0.032, 0.045, -0.07, 0, 0x2a1a10, -0.15);
      box(0.032, 0.09, 0.032, 0.075, -0.15, 0, 0x2a1a10, -0.45);
      guard(-0.03, -0.03);
      grip(-0.07, -0.025, 0.1, WOOD2, 0.3);
      box(0.24, 0.07, 0.04, -0.24, -0.03, 0, WOOD, 0.14); // (the stock)
      box(0.012, 0.08, 0.042, -0.36, -0.048, 0, METAL, 0.14);
    } else if (id === 'hunting') {
      tube(0.011, 0.55, 0.32, 0.03, 0, METAL); // (the barrel)
      box(0.16, 0.045, 0.036, -0.02, 0.025, 0, METAL); // (the action)
      tube(0.019, 0.3, 0.0, 0.085, 0, 0x101010, 12); // (the scope)
      tube(0.024, 0.06, 0.13, 0.085, 0, 0x101010, 12); // (its front bell)
      tube(0.022, 0.05, -0.13, 0.085, 0, 0x101010, 12); // (its eyepiece)
      for (const x of [-0.05, 0.05]) box(0.016, 0.04, 0.02, x, 0.055, 0, 0x101010); // (its mounts)
      box(0.04, 0.012, 0.012, -0.06, 0.03, -0.035, CHROME); // (the bolt handle)
      tube(0.009, 0.012, -0.06, 0.03, -0.05, CHROME, 8);
      box(0.45, 0.05, 0.04, 0.12, -0.005, 0, WOOD); // (the forend)
      guard(-0.06, -0.035);
      box(0.13, 0.055, 0.034, -0.17, -0.03, 0, WOOD, 0.22); // (the wrist)
      box(0.3, 0.09, 0.04, -0.37, -0.05, 0, WOOD, 0.06); // (the stock)
      box(0.012, 0.1, 0.042, -0.525, -0.06, 0, 0x111111, 0.06);
    }
    g.userData.length = L;
  }
  return g;
}

// A box of rounds, its top open: a cardboard box with the cartridges standing in rows.
export function ammoModel(id, mat = lambert) {
  const g = new THREE.Group();
  const big = id === 'shotgun';
  const long = id === 'rifle' || id === 'ak' || id === 'hunting';
  const n = big ? 4 : 5;
  const r = big ? 0.011 : long ? 0.0055 : 0.0065;
  const h = big ? 0.065 : long ? 0.07 : 0.032;
  const W = n * r * 2.6;
  const add = (geo, c, x, y, z) => {
    const m = new THREE.Mesh(geo, mat(c));
    m.position.set(x, y, z);
    g.add(m);
  };
  add(new THREE.BoxGeometry(W + 0.01, h * 0.7, W + 0.01), big ? 0xa83232 : 0x2f6e9a, 0, (h * 0.7) / 2, 0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = -W / 2 + r * 1.3 + i * r * 2.6;
      const z = -W / 2 + r * 1.3 + j * r * 2.6;
      add(new THREE.CylinderGeometry(r, r, h, 8), big ? 0xc0392b : 0xc9a24a, x, h / 2, z); // (the case)
      if (big) add(new THREE.CylinderGeometry(r * 1.05, r * 1.05, h * 0.25, 8), 0xc9a24a, x, h * 0.12, z); // (the brass base)
      else add(new THREE.ConeGeometry(r * 0.9, h * 0.35, 8), 0xb87333, x, h + h * 0.17, z); // (the bullet)
    }
  }
  g.userData.length = W * 2.2;
  return g;
}

// A plate carrier: front panel, shoulder straps, side straps, pouches.
export function vestModel(color = 0x2f3b2a, mat = lambert) {
  const g = new THREE.Group();
  const box = (w, h, d, x, y, z, c) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
    m.position.set(x, y, z);
    g.add(m);
  };
  box(0.36, 0.42, 0.05, 0, 0, 0.1, color); // (front)
  box(0.36, 0.42, 0.05, 0, 0, -0.1, color); // (back)
  for (const s of [1, -1]) {
    box(0.07, 0.04, 0.24, s * 0.12, 0.23, 0, color); // (shoulder straps)
    box(0.04, 0.12, 0.2, s * 0.19, -0.08, 0, 0x1b1b1b); // (side straps)
  }
  for (let k = 0; k < 3; k++) box(0.09, 0.11, 0.04, -0.11 + k * 0.11, -0.12, 0.14, 0x26301f); // (mag pouches)
  box(0.24, 0.05, 0.02, 0, 0.13, 0.13, 0xd8d8d0); // (a patch)
  g.userData.length = 0.5;
  return g;
}
