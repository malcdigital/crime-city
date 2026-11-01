import * as THREE from 'three';

// Swing doors you push through: every door into a building interior is one of these (CLAUDE.md).
// A leaf hangs on its hinge; walk into it from either side and it swings away from you, you go
// through, and it swings shut behind you on its own (a damped spring: a little bounce as it
// settles). Anyone walking (you, cops, people on the street) pushes it the same way. It never
// stops you or your bullets (it's not in city.colliders or city.los).
//
// Use: const doors = new DoorSet(); doors.add(frame, { hinge: [x, z], dir: [dx, dz], width,
// height, leaf: (w, h) => Mesh/Group built along +x from the hinge }); then every frame
// doors.update(dt, pushers) with pushers [{ x, z }] in world space. frame is the Object3D the
// door's numbers are in (a room's own frame); its world matrix is read once, so it must be in
// place first.

const OPEN = 1.45; // (how far it swings: about 83°)
const REACH = 1.7; // (how close you are, in front of it or behind, when it starts to open)

export class DoorSet {
  constructor() {
    this.doors = [];
  }

  add(frame, { hinge, dir, width, height = 2.5, leaf, y0 = 0 }) {
    const [dx, dz] = dir;
    const phi = Math.atan2(-dz, dx); // (the pivot's turn that lays its +x along dir)
    const pivot = new THREE.Group();
    pivot.position.set(hinge[0], y0, hinge[1]);
    pivot.rotation.y = phi;
    pivot.add(leaf(width, height));
    frame.add(pivot);
    frame.updateMatrixWorld(true);
    const d = {
      frame, pivot, phi, width,
      hinge: new THREE.Vector3(hinge[0], 0, hinge[1]).applyMatrix4(frame.matrixWorld),
      u: null, v: null, angle: 0, vel: 0, target: 0,
    };
    // (its axes in the world: u along the closed leaf, v across it)
    const o = new THREE.Vector3(0, 0, 0).applyMatrix4(pivot.matrixWorld);
    d.u = new THREE.Vector3(1, 0, 0).applyMatrix4(pivot.matrixWorld).sub(o);
    d.v = new THREE.Vector3(0, 0, 1).applyMatrix4(pivot.matrixWorld).sub(o);
    this.doors.push(d);
    return d;
  }

  // Swing them: pushers within reach open them away from themselves; otherwise they close.
  update(dt, pushers) {
    dt = Math.min(dt, 0.05);
    for (const d of this.doors) {
      let want = 0;
      for (const p of pushers) {
        const rx = p.x - d.hinge.x;
        const rz = p.z - d.hinge.z;
        if (rx * rx + rz * rz > (d.width + REACH + 0.5) ** 2) continue;
        const u = rx * d.u.x + rz * d.u.z;
        const v = rx * d.v.x + rz * d.v.z;
        if (u < -0.3 || u > d.width + 0.4 || Math.abs(v) > REACH) continue;
        // (in the doorway or walking up to it: open, away from them; nearer, wider)
        const k = Math.min(1, (REACH - Math.abs(v)) / (REACH - 0.9));
        // (already swung the other way and they're behind it now: it stays that way, so it
        // doesn't swing back through them)
        const side = Math.abs(d.angle) > 0.3 && Math.sign(d.angle) !== Math.sign(v) && Math.abs(v) < 0.6 ? Math.sign(d.angle) : Math.sign(v) || 1;
        const t = side * OPEN * k;
        if (Math.abs(t) > Math.abs(want)) want = t;
      }
      d.target = want;
      // (a spring to where it's pushed; shut, it settles with a little bounce)
      const stiff = want ? 160 : 16;
      const damp = want ? 20 : 3.4;
      d.vel += (stiff * (d.target - d.angle) - damp * d.vel) * dt;
      d.angle += d.vel * dt;
      d.angle = Math.max(-OPEN - 0.05, Math.min(OPEN + 0.05, d.angle));
      if (!want && Math.abs(d.angle) < 0.002 && Math.abs(d.vel) < 0.01) d.angle = d.vel = 0;
      d.pivot.rotation.y = d.phi + d.angle;
    }
  }
}

// A door leaf (along +x from the hinge, standing on y 0..h): a frame round it, glass in it
// (a shop's front door) or solid with a little window (a back door), a push bar.
export function doorLeaf(w, h, { frame = 0x2b2b2b, glass = null, panel = 0x6b4f35, bar = 0xc8ccd0, mats = null } = {}) {
  const g = new THREE.Group();
  const mat = (c, extra) => {
    const m = extra || new THREE.MeshLambertMaterial({ color: c });
    mats?.push(m);
    return m;
  };
  const box = (bw, bh, bd, x, y, z, m) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  const fm = mat(frame);
  const t = 0.06;
  if (glass) {
    // (a frame and the glass in it)
    box(w - 0.02, 0.1, t, w / 2, 0.05, 0, fm);
    box(w - 0.02, 0.12, t, w / 2, h - 0.06, 0, fm);
    box(0.08, h, t, 0.05, h / 2, 0, fm);
    box(0.08, h, t, w - 0.05, h / 2, 0, fm);
    box(w - 0.02, 0.22, t, w / 2, 0.2, 0, fm); // (the kick plate)
    const gm = mat(0, new THREE.MeshLambertMaterial({ color: glass, transparent: true, opacity: 0.32, depthWrite: false }));
    box(w - 0.16, h - 0.4, 0.02, w / 2, h / 2 + 0.08, 0, gm);
  } else {
    const pm = mat(panel);
    box(w - 0.02, h, t, w / 2, h / 2, 0, pm);
    const gm = mat(0, new THREE.MeshLambertMaterial({ color: 0x9cc3d6, transparent: true, opacity: 0.4, depthWrite: false }));
    box(0.3, 0.4, t + 0.01, w * 0.6, h * 0.7, 0, gm); // (a little window)
    box(0.34, 0.03, t + 0.012, w * 0.6, h * 0.7 + 0.21, 0, fm);
    box(0.34, 0.03, t + 0.012, w * 0.6, h * 0.7 - 0.21, 0, fm);
  }
  // (push bars, both sides, at the free edge)
  const bm = mat(bar);
  for (const s of [1, -1]) box(w * 0.55, 0.04, 0.04, w * 0.6, 1.05, s * 0.07, bm);
  return g;
}
