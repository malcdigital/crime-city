import { clamp } from './util.js';

// Spatial grid over a big list of boxes, so a check only looks at boxes nearby. Built lazily and
// rebuilt when the list changes length (boxes added or removed). Small lists are just scanned.
const CELL = 24;
let stamp = 0;
function candidates(boxes, minX, maxX, minZ, maxZ) {
  if (boxes.length < 64) return boxes;
  let g = boxes.grid;
  if (!g || g.n !== boxes.length) {
    g = { n: boxes.length, cells: new Map() };
    for (const b of boxes) {
      for (let i = Math.floor(b.minX / CELL); i <= Math.floor(b.maxX / CELL); i++) {
        for (let j = Math.floor(b.minZ / CELL); j <= Math.floor(b.maxZ / CELL); j++) {
          const k = i * 4096 + j;
          let c = g.cells.get(k);
          if (!c) g.cells.set(k, (c = []));
          c.push(b);
        }
      }
    }
    Object.defineProperty(boxes, 'grid', { value: g, writable: true, configurable: true });
  }
  stamp++;
  const out = [];
  for (let i = Math.floor(minX / CELL); i <= Math.floor(maxX / CELL); i++) {
    for (let j = Math.floor(minZ / CELL); j <= Math.floor(maxZ / CELL); j++) {
      const c = g.cells.get(i * 4096 + j);
      if (!c) continue;
      for (const b of c) {
        if (b._q === stamp) continue;
        b._q = stamp;
        out.push(b);
      }
    }
  }
  return out;
}

// Push a circle (x, z, r) out of a list of axis-aligned boxes {minX, maxX, minZ, maxZ}.
export function pushCircle(x, z, r, boxes) {
  let hit = false;
  let nx = 0;
  let nz = 0;
  for (const b of candidates(boxes, x - r, x + r, z - r, z + r)) {
    if (x + r < b.minX || x - r > b.maxX || z + r < b.minZ || z - r > b.maxZ) continue;
    if (b.ob) {
      // A rotated box: work in its own frame.
      const o = b.ob;
      const ex = x - o.cx;
      const ez = z - o.cz;
      let u = ex * o.c + ez * o.s;
      let v = -ex * o.s + ez * o.c;
      const cu = clamp(u, -o.hx, o.hx);
      const cv = clamp(v, -o.hz, o.hz);
      let du = u - cu;
      let dv = v - cv;
      const dd = du * du + dv * dv;
      if (dd >= r * r) continue;
      hit = true;
      if (dd < 1e-8) {
        const l = u + o.hx, rr = o.hx - u, t = v + o.hz, bt = o.hz - v;
        const m = Math.min(l, rr, t, bt);
        let nu = 0;
        let nv = 0;
        if (m === l) { u = -o.hx - r; nu = -1; }
        else if (m === rr) { u = o.hx + r; nu = 1; }
        else if (m === t) { v = -o.hz - r; nv = -1; }
        else { v = o.hz + r; nv = 1; }
        x = o.cx + u * o.c - v * o.s;
        z = o.cz + u * o.s + v * o.c;
        nx += nu * o.c - nv * o.s;
        nz += nu * o.s + nv * o.c;
        continue;
      }
      const d = Math.sqrt(dd);
      du /= d;
      dv /= d;
      u += du * (r - d);
      v += dv * (r - d);
      x = o.cx + u * o.c - v * o.s;
      z = o.cz + u * o.s + v * o.c;
      nx += du * o.c - dv * o.s;
      nz += du * o.s + dv * o.c;
      continue;
    }
    const cx = clamp(x, b.minX, b.maxX);
    const cz = clamp(z, b.minZ, b.maxZ);
    let dx = x - cx;
    let dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    hit = true;
    if (d2 < 1e-8) {
      // Center is inside the box: push out along the shortest axis.
      const l = x - b.minX, rr = b.maxX - x, t = z - b.minZ, bt = b.maxZ - z;
      const m = Math.min(l, rr, t, bt);
      if (m === l) { x = b.minX - r; nx -= 1; }
      else if (m === rr) { x = b.maxX + r; nx += 1; }
      else if (m === t) { z = b.minZ - r; nz -= 1; }
      else { z = b.maxZ + r; nz += 1; }
      continue;
    }
    const d = Math.sqrt(d2);
    dx /= d;
    dz /= d;
    x += dx * (r - d);
    z += dz * (r - d);
    nx += dx;
    nz += dz;
  }
  const nl = Math.hypot(nx, nz) || 1;
  return { x, z, hit, nx: nx / nl, nz: nz / nl };
}

// Does the segment (ax, az)-(bx, bz) cross the box [x0,x1] x [z0,z1]?
function slab(ax, az, bx, bz, x0, x1, z0, z1) {
  const dx = bx - ax;
  const dz = bz - az;
  let tmin = 0;
  let tmax = 1;
  if (Math.abs(dx) < 1e-9) {
    if (ax < x0 || ax > x1) return false;
  } else {
    let t1 = (x0 - ax) / dx;
    let t2 = (x1 - ax) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < z0 || az > z1) return false;
  } else {
    let t1 = (z0 - az) / dz;
    let t2 = (z1 - az) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

// The same for a box that may be rotated (pad: grow it by this much).
function crosses(b, ax, az, bx, bz, pad = 0) {
  if (!b.ob) return slab(ax, az, bx, bz, b.minX - pad, b.maxX + pad, b.minZ - pad, b.maxZ + pad);
  const o = b.ob;
  const lu = (x, z) => (x - o.cx) * o.c + (z - o.cz) * o.s;
  const lv = (x, z) => -(x - o.cx) * o.s + (z - o.cz) * o.c;
  return slab(lu(ax, az), lv(ax, az), lu(bx, bz), lv(bx, bz), -o.hx - pad, o.hx + pad, -o.hz - pad, o.hz + pad);
}

// True if the line from a to b passes through any box (used for line of sight).
export function segmentBlocked(ax, az, bx, bz, boxes) {
  for (const b of candidates(boxes, Math.min(ax, bx), Math.max(ax, bx), Math.min(az, bz), Math.max(az, bz))) {
    if (crosses(b, ax, az, bx, bz)) return true;
  }
  return false;
}

// Like segmentBlocked, but treats each box as `pad` meters bigger (for a body of that radius).
export function segmentBlockedPad(ax, az, bx, bz, boxes, pad) {
  const minX = Math.min(ax, bx) - pad, maxX = Math.max(ax, bx) + pad;
  const minZ = Math.min(az, bz) - pad, maxZ = Math.max(az, bz) + pad;
  for (const b of candidates(boxes, minX, maxX, minZ, maxZ)) {
    if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
    if (crosses(b, ax, az, bx, bz, pad)) return true;
  }
  return false;
}

export { candidates };
