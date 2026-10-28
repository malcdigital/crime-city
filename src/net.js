import * as THREE from 'three';

// A basketball net that moves: a cloth sim per hoop, drawn as real cord.
//
// Built like a regulation nylon net: 12 loops hooked under the rim, then the cords run down
// in the diamond pattern (each knot tied to the two below it), tapering to the narrower
// bottom ring. Gravity hangs it; each cord holds its length (slack cords don't push), and the
// rings keep the taper loosely, so it holds its shape but swings and bunches like the real
// thing. The ball touches it along every cord, not just at the knots, so it can't slip
// between them: a swish grabs the cords it rubs and whips them down and out, then the net
// snaps back and sways to rest; a ball off the rim rattles it. Two substeps a frame and
// time-based damping keep it the same at any frame rate. It sleeps when nothing's near.

const ROWS = 7; // (rings of knots, the top one on the rim)
const COLS = 12; // (loops on the rim, cords around)
const TOP_R = 0.222; // (just inside the rim: the loops hook under it)
const BOT_R = 0.135; // (a bit narrower than the ball: it has to push through)
const LEN = 0.43;
const G = 9.8;
const DAMP = 0.6; // (fraction of its speed a knot keeps per second of free swinging, roughly)
const ITER = 5;
const SUB = 2;
const BALL_R = 0.12;
const CORD = 0.0055; // (cord radius: thick braided nylon)
const GRIP = 0.55; // (how much a cord the ball rubs is dragged along with it)

const _up = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _a = new THREE.Vector3();
let CORD_GEO = null;
let CORD_MAT = null;
let LOOP_GEO = null;

export class HoopNet {
  // hoop: { x, y, z } (the rim's center).
  constructor(scene, hoop) {
    this.h = hoop;
    const n = ROWS * COLS;
    this.p = new Float32Array(n * 3); // (positions)
    this.q = new Float32Array(n * 3); // (last step's: verlet)
    this.rest = new Float32Array(n * 3);
    for (let i = 0; i < ROWS; i++) {
      const k = i / (ROWS - 1);
      // (the taper: it narrows quickly near the rim, then hangs almost straight, like a real net)
      const r = BOT_R + (TOP_R - BOT_R) * Math.pow(1 - k, 1.6);
      for (let j = 0; j < COLS; j++) {
        const a = ((j + (i % 2) * 0.5) / COLS) * Math.PI * 2; // (every other ring offset half a gap: diamonds)
        const o = (i * COLS + j) * 3;
        this.rest[o] = hoop.x + Math.cos(a) * r;
        this.rest[o + 1] = hoop.y - 0.012 - k * LEN;
        this.rest[o + 2] = hoop.z + Math.sin(a) * r;
      }
    }
    this.p.set(this.rest);
    this.q.set(this.rest);
    // The cords: each knot down to the two below it (the diamonds) and the bottom ring; plus a
    // looser ring at each row (the net's own stiffness), not drawn.
    const links = [];
    const id = (i, j) => i * COLS + ((j + COLS) % COLS);
    for (let i = 0; i < ROWS - 1; i++) {
      for (let j = 0; j < COLS; j++) {
        const odd = i % 2;
        links.push([id(i, j), id(i + 1, j - 1 + odd), 1, true]);
        links.push([id(i, j), id(i + 1, j + odd), 1, true]);
      }
    }
    for (let i = 1; i < ROWS; i++) for (let j = 0; j < COLS; j++) links.push([id(i, j), id(i, j + 1), i === ROWS - 1 ? 1 : 0.25, i === ROWS - 1]);
    this.links = links.map(([a, b, k, draw]) => {
      const dx = this.rest[a * 3] - this.rest[b * 3];
      const dy = this.rest[a * 3 + 1] - this.rest[b * 3 + 1];
      const dz = this.rest[a * 3 + 2] - this.rest[b * 3 + 2];
      return { a, b, k, draw, L: Math.hypot(dx, dy, dz) };
    });
    this.drawn = this.links.filter((l) => l.draw);
    // The cords: one thin tube each (instanced), lit, so it reads as rope from any angle.
    CORD_GEO ||= new THREE.CylinderGeometry(CORD, CORD, 1, 5, 1, true).translate(0, 0.5, 0);
    CORD_MAT ||= new THREE.MeshLambertMaterial({ color: 0xf4f4f0 });
    LOOP_GEO ||= new THREE.TorusGeometry(0.014, CORD, 4, 8);
    this.mesh = new THREE.InstancedMesh(CORD_GEO, CORD_MAT, this.drawn.length);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    // (the loops hooked round the rim, where each cord starts)
    this.loops = new THREE.InstancedMesh(LOOP_GEO, CORD_MAT, COLS);
    for (let j = 0; j < COLS; j++) {
      const a = (j / COLS) * Math.PI * 2;
      _a.set(hoop.x + Math.cos(a) * (TOP_R + 0.008), hoop.y - 0.004, hoop.z + Math.sin(a) * (TOP_R + 0.008));
      _q.setFromAxisAngle(_up, -a);
      _m.compose(_a, _q, _s.set(1, 1, 1));
      this.loops.setMatrixAt(j, _m);
    }
    scene.add(this.loops);
    this.calm = 0;
    this.last = new WeakMap(); // (where each ball was last frame)
    this.draw();
  }

  // balls: anything with x, y, z (and an optional r).
  step(dt, balls) {
    const h = this.h;
    // Anything close? Otherwise, once it's settled, it sleeps.
    let near = false;
    for (const b of balls) if (b && Math.abs(b.x - h.x) < 0.9 && Math.abs(b.z - h.z) < 0.9 && b.y > h.y - LEN - 0.5 && b.y < h.y + 0.6) near = true;
    if (!near && this.calm > 1.5) {
      for (const b of balls) if (b) this.last.set(b, [b.x, b.y, b.z]);
      return;
    }
    dt = Math.min(dt, 1 / 20);
    const h2 = dt / SUB;
    const keep = Math.pow(DAMP, h2); // (the same swing at any frame rate)
    let moving = 0;
    for (let sub = 0; sub < SUB; sub++) {
      const f0 = sub / SUB;
      const f1 = (sub + 1) / SUB;
      moving = Math.max(moving, this.integrate(h2, keep));
      this.solve(balls, f0, f1);
    }
    for (const b of balls) if (b) this.last.set(b, [b.x, b.y, b.z]);
    this.calm = moving < 0.0003 && !near ? this.calm + dt : 0;
    this.draw();
  }

  // Verlet: carry on the way it was going, damped, and gravity.
  integrate(dt, keep) {
    const p = this.p;
    const q = this.q;
    let moving = 0;
    for (let i = COLS; i < ROWS * COLS; i++) {
      const o = i * 3;
      for (let c = 0; c < 3; c++) {
        const v = (p[o + c] - q[o + c]) * keep;
        q[o + c] = p[o + c];
        p[o + c] += v + (c === 1 ? -G * dt * dt : 0);
        moving = Math.max(moving, Math.abs(v));
      }
    }
    return moving;
  }

  // The cords hold their length, and the balls push them aside (and drag the ones they rub).
  // f0..f1: how far through this frame's ball move this substep is.
  solve(balls, f0, f1) {
    const p = this.p;
    const h = this.h;
    const here = [];
    for (const b of balls) {
      if (!b) continue;
      if (Math.abs(b.x - h.x) > 0.7 || Math.abs(b.z - h.z) > 0.7 || b.y < h.y - LEN - 0.4 || b.y > h.y + 0.4) continue;
      const L = this.last.get(b) || [b.x, b.y, b.z];
      const at = (f) => [L[0] + (b.x - L[0]) * f, L[1] + (b.y - L[1]) * f, L[2] + (b.z - L[2]) * f];
      const [x0, y0, z0] = at(f0);
      const [x1, y1, z1] = at(f1);
      here.push({ x: x1, y: y1, z: z1, R: (b.r || BALL_R) + CORD + 0.004, mx: (x1 - x0) / ITER, my: (y1 - y0) / ITER, mz: (z1 - z0) / ITER });
    }
    for (let it = 0; it < ITER; it++) {
      for (let o = 0; o < COLS * 3; o++) p[o] = this.rest[o]; // (the top ring stays on the rim)
      for (const l of this.links) {
        const a = l.a * 3;
        const b = l.b * 3;
        const dx = p[b] - p[a];
        const dy = p[b + 1] - p[a + 1];
        const dz = p[b + 2] - p[a + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        if (l.k >= 1 && d <= l.L) continue; // (a cord goes slack, it doesn't push)
        const f = ((d - l.L) / d) * 0.5 * l.k;
        const pa = l.a < COLS ? 0 : 1;
        const pb = l.b < COLS ? 0 : 1;
        const s = pa + pb || 1;
        p[a] += dx * f * ((2 * pa) / s);
        p[a + 1] += dy * f * ((2 * pa) / s);
        p[a + 2] += dz * f * ((2 * pa) / s);
        p[b] -= dx * f * ((2 * pb) / s);
        p[b + 1] -= dy * f * ((2 * pb) / s);
        p[b + 2] -= dz * f * ((2 * pb) / s);
      }
      // (each cord against each ball: the nearest point on the cord, pushed out to the ball's
      // surface, split between its two knots by how near each is; a rubbed cord is dragged along)
      for (const B of here) {
        for (const l of this.drawn) {
          const a = l.a * 3;
          const b = l.b * 3;
          const ex = p[b] - p[a];
          const ey = p[b + 1] - p[a + 1];
          const ez = p[b + 2] - p[a + 2];
          const e2 = ex * ex + ey * ey + ez * ez || 1e-9;
          let t = ((B.x - p[a]) * ex + (B.y - p[a + 1]) * ey + (B.z - p[a + 2]) * ez) / e2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const cx = p[a] + ex * t - B.x;
          const cy = p[a + 1] + ey * t - B.y;
          const cz = p[a + 2] + ez * t - B.z;
          const d2 = cx * cx + cy * cy + cz * cz;
          if (d2 >= B.R * B.R) continue;
          const d = Math.sqrt(d2) || 1e-6;
          const k = Math.min(0.04, B.R - d) / d; // (at most 4 cm a pass)
          const wa = l.a < COLS ? 0 : 1 - t;
          const wb = l.b < COLS ? 0 : t;
          const norm = Math.max(0.35, wa * wa + wb * wb); // (near the rim end the cord can't give much: never a fling)
          const px = cx * k + B.mx * GRIP;
          const py = cy * k + B.my * GRIP;
          const pz = cz * k + B.mz * GRIP;
          p[a] += (px * wa) / norm;
          p[a + 1] += (py * wa) / norm;
          p[a + 2] += (pz * wa) / norm;
          p[b] += (px * wb) / norm;
          p[b + 1] += (py * wb) / norm;
          p[b + 2] += (pz * wb) / norm;
        }
      }
    }
  }

  draw() {
    const p = this.p;
    for (let i = 0; i < this.drawn.length; i++) {
      const l = this.drawn[i];
      _a.set(p[l.a * 3], p[l.a * 3 + 1], p[l.a * 3 + 2]);
      _d.set(p[l.b * 3] - _a.x, p[l.b * 3 + 1] - _a.y, p[l.b * 3 + 2] - _a.z);
      const len = _d.length() || 1e-6;
      _q.setFromUnitVectors(_up, _d.multiplyScalar(1 / len));
      _m.compose(_a, _q, _s.set(1, len, 1));
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
