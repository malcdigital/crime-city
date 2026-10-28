import * as THREE from 'three';

// A basketball net that moves: a little cloth sim per hoop. The top ring is tied to the rim;
// below it the strings run in the usual diamond pattern, tapering down to the bottom loops.
// Gravity hangs it, the strings hold their length (a few relaxation passes a frame), and any
// ball that touches it pushes the strings out of the way: a swish snaps the net down and out
// and it swings back, a ball off the rim rattles it. It sleeps when it's still and nothing's near.

const ROWS = 5; // (rings, the top one on the rim)
const COLS = 12; // (strings around)
const TOP_R = 0.23;
const BOT_R = 0.115; // (a little narrower than the ball: it has to push through)
const LEN = 0.45;
const G = 9.8;
const DAMP = 0.985;
const ITER = 6;
const BALL_R = 0.125;

export class HoopNet {
  // hoop: { x, y, z } (the rim's center).
  constructor(scene, hoop) {
    this.h = hoop;
    const n = ROWS * COLS;
    this.p = new Float32Array(n * 3); // (positions)
    this.q = new Float32Array(n * 3); // (last frame's: verlet)
    this.rest = new Float32Array(n * 3); // (where it hangs at rest, for the pinned ring)
    for (let i = 0; i < ROWS; i++) {
      const k = i / (ROWS - 1);
      const r = TOP_R + (BOT_R - TOP_R) * k;
      for (let j = 0; j < COLS; j++) {
        const a = ((j + (i % 2) * 0.5) / COLS) * Math.PI * 2; // (every other ring offset half a gap: diamonds)
        const o = (i * COLS + j) * 3;
        this.rest[o] = hoop.x + Math.cos(a) * r;
        this.rest[o + 1] = hoop.y - k * LEN;
        this.rest[o + 2] = hoop.z + Math.sin(a) * r;
      }
    }
    this.p.set(this.rest);
    this.q.set(this.rest);
    // The strings: from each knot down to the two below it (the diamonds), and the bottom loops
    // round; plus a softer ring at each row to keep the taper (the net's own stiffness).
    const links = [];
    const id = (i, j) => i * COLS + ((j + COLS) % COLS);
    for (let i = 0; i < ROWS - 1; i++) {
      for (let j = 0; j < COLS; j++) {
        const odd = i % 2;
        links.push([id(i, j), id(i + 1, j - 1 + odd), 1, true]);
        links.push([id(i, j), id(i + 1, j + odd), 1, true]);
      }
    }
    for (let i = 1; i < ROWS; i++) for (let j = 0; j < COLS; j++) links.push([id(i, j), id(i, j + 1), i === ROWS - 1 ? 1 : 0.35, i === ROWS - 1]);
    this.links = links.map(([a, b, k, draw]) => {
      const dx = this.rest[a * 3] - this.rest[b * 3];
      const dy = this.rest[a * 3 + 1] - this.rest[b * 3 + 1];
      const dz = this.rest[a * 3 + 2] - this.rest[b * 3 + 2];
      return { a, b, k, draw, L: Math.hypot(dx, dy, dz) };
    });
    this.drawn = this.links.filter((l) => l.draw);
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.drawn.length * 6);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo = geo;
    this.mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.9 }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
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
    if (!near && this.calm > 1.5) return;
    dt = Math.min(dt, 1 / 30);
    const p = this.p;
    const q = this.q;
    let moving = 0;
    // Verlet: carry on the way it was going, damped, and gravity.
    for (let i = COLS; i < ROWS * COLS; i++) {
      const o = i * 3;
      for (let c = 0; c < 3; c++) {
        const v = (p[o + c] - q[o + c]) * DAMP;
        q[o + c] = p[o + c];
        p[o + c] += v + (c === 1 ? -G * dt * dt : 0);
        moving = Math.max(moving, Math.abs(v));
      }
    }
    for (let it = 0; it < ITER; it++) {
      // (the top ring stays on the rim)
      for (let o = 0; o < COLS * 3; o++) p[o] = this.rest[o];
      // (strings: no longer than they are; the rings keep the taper, more loosely)
      for (const l of this.links) {
        const a = l.a * 3;
        const b = l.b * 3;
        const dx = p[b] - p[a];
        const dy = p[b + 1] - p[a + 1];
        const dz = p[b + 2] - p[a + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        if (l.k >= 1 && d <= l.L) continue; // (a string goes slack, it doesn't push)
        const f = ((d - l.L) / d) * 0.5 * l.k;
        const pa = l.a < COLS ? 0 : 1;
        const pb = l.b < COLS ? 0 : 1;
        const s = pa + pb || 1;
        p[a] += dx * f * (2 * pa / s);
        p[a + 1] += dy * f * (2 * pa / s);
        p[a + 2] += dz * f * (2 * pa / s);
        p[b] -= dx * f * (2 * pb / s);
        p[b + 1] -= dy * f * (2 * pb / s);
        p[b + 2] -= dz * f * (2 * pb / s);
      }
      // (the balls push the strings out of their way)
      for (const b of balls) {
        if (!b) continue;
        const R = (b.r || BALL_R) + 0.012;
        const last = this.last.get(b);
        const mx = last ? (b.x - last[0]) / ITER : 0; // (the ball's move this frame, a share per pass)
        const my = last ? (b.y - last[1]) / ITER : 0;
        const mz = last ? (b.z - last[2]) / ITER : 0;
        if (Math.abs(b.x - h.x) > 0.7 || Math.abs(b.z - h.z) > 0.7 || b.y < h.y - LEN - 0.4 || b.y > h.y + 0.4) continue;
        for (let i = COLS; i < ROWS * COLS; i++) {
          const o = i * 3;
          const dx = p[o] - b.x;
          const dy = p[o + 1] - b.y;
          const dz = p[o + 2] - b.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= R * R) continue;
          const d = Math.sqrt(d2) || 1e-6;
          const k = (R - d) / d;
          // (pushed out of the way, and dragged along with it a little: the swish whips the net)
          p[o] += dx * k + mx * 0.45;
          p[o + 1] += dy * k + my * 0.45;
          p[o + 2] += dz * k + mz * 0.45;
        }
      }
    }
    for (const b of balls) if (b) this.last.set(b, [b.x, b.y, b.z]);
    this.calm = moving < 0.0004 && !near ? this.calm + dt : 0;
    this.draw();
  }

  draw() {
    const p = this.p;
    let o = 0;
    for (const l of this.drawn) {
      for (const i of [l.a, l.b]) {
        this.pos[o++] = p[i * 3];
        this.pos[o++] = p[i * 3 + 1];
        this.pos[o++] = p[i * 3 + 2];
      }
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
