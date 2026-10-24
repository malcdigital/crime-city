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

// True if the line from a to b passes through any box (used for line of sight).
export function segmentBlocked(ax, az, bx, bz, boxes) {
  const dx = bx - ax;
  const dz = bz - az;
  for (const b of candidates(boxes, Math.min(ax, bx), Math.max(ax, bx), Math.min(az, bz), Math.max(az, bz))) {
    let tmin = 0;
    let tmax = 1;
    if (Math.abs(dx) < 1e-9) {
      if (ax < b.minX || ax > b.maxX) continue;
    } else {
      let t1 = (b.minX - ax) / dx;
      let t2 = (b.maxX - ax) / dx;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (Math.abs(dz) < 1e-9) {
      if (az < b.minZ || az > b.maxZ) continue;
    } else {
      let t1 = (b.minZ - az) / dz;
      let t2 = (b.maxZ - az) / dz;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    return true;
  }
  return false;
}

// Like segmentBlocked, but treats each box as `pad` meters bigger (for a body of that radius).
export function segmentBlockedPad(ax, az, bx, bz, boxes, pad) {
  const minX = Math.min(ax, bx) - pad, maxX = Math.max(ax, bx) + pad;
  const minZ = Math.min(az, bz) - pad, maxZ = Math.max(az, bz) + pad;
  const dx = bx - ax;
  const dz = bz - az;
  for (const b of candidates(boxes, minX, maxX, minZ, maxZ)) {
    if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
    const x0 = b.minX - pad, x1 = b.maxX + pad, z0 = b.minZ - pad, z1 = b.maxZ + pad;
    let tmin = 0;
    let tmax = 1;
    if (Math.abs(dx) < 1e-9) {
      if (ax < x0 || ax > x1) continue;
    } else {
      let t1 = (x0 - ax) / dx;
      let t2 = (x1 - ax) / dx;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (Math.abs(dz) < 1e-9) {
      if (az < z0 || az > z1) continue;
    } else {
      let t1 = (z0 - az) / dz;
      let t2 = (z1 - az) / dz;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    return true;
  }
  return false;
}
