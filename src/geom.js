// 2D geometry helpers (x, z plane). Polygons are arrays of [x, z] points.

export const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

export function area(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % poly.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

export function centroid(poly) {
  let cx = 0;
  let cz = 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % poly.length];
    const f = x0 * z1 - x1 * z0;
    cx += (x0 + x1) * f;
    cz += (z0 + z1) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

export function bbox(poly) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Closest point on segment ab to p, and the distance.
export function closestOnSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const L2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
  const x = ax + dx * t;
  const z = az + dz * t;
  return { x, z, t, d: Math.hypot(px - x, pz - z) };
}

// Closest point on a polygon's outline.
export function closestOnPoly(px, pz, poly) {
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const c = closestOnSeg(px, pz, ax, az, bx, bz);
    if (!best || c.d < best.d) best = { ...c, edge: i };
  }
  return best;
}

export function polyDist(px, pz, poly) {
  if (pointInPoly(px, pz, poly)) return 0;
  return closestOnPoly(px, pz, poly).d;
}

// Intersection of segments ab and cd: { t, u, x, z } or null.
export function segInter(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax;
  const rz = bz - az;
  const sx = dx - cx;
  const sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { t, u, x: ax + rx * t, z: az + rz * t };
}

// Intersection of two infinite lines (point + direction).
export function lineInter(ax, az, adx, adz, bx, bz, bdx, bdz) {
  const den = adx * bdz - adz * bdx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((bx - ax) * bdz - (bz - az) * bdx) / den;
  return [ax + adx * t, az + adz * t];
}

// Keep the part of a polygon on the left of the directed line a->b (Sutherland-Hodgman).
export function clipHalf(poly, ax, az, bx, bz) {
  const side = (p) => (bx - ax) * (p[1] - az) - (bz - az) * (p[0] - ax);
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

// Clip a polygon to a convex polygon (both counter-clockwise in x/z with +z "up", i.e. area > 0).
export function clipConvex(poly, clip) {
  let out = poly;
  for (let i = 0; i < clip.length && out.length; i++) {
    const [ax, az] = clip[i];
    const [bx, bz] = clip[(i + 1) % clip.length];
    out = clipHalf(out, ax, az, bx, bz);
  }
  return out;
}

// Clip a segment to a convex polygon (positive area). Returns [t0, t1] or null.
export function clipSegConvex(ax, az, bx, bz, clip) {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  for (let i = 0; i < clip.length; i++) {
    const [px, pz] = clip[i];
    const [qx, qz] = clip[(i + 1) % clip.length];
    // Inside = left of p->q: cross(q-p, x-p) >= 0
    const ex = qx - px;
    const ez = qz - pz;
    const f0 = ex * (az - pz) - ez * (ax - px);
    const fd = ex * dz - ez * dx;
    if (Math.abs(fd) < 1e-12) {
      if (f0 < 0) return null;
      continue;
    }
    const t = -f0 / fd;
    if (fd > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

// Shrink a convex polygon: each edge moves in by its own distance d[i] (or a number for all).
export function insetConvex(poly, d) {
  const n = poly.length;
  const ccw = area(poly) > 0;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % n];
    const L = Math.hypot(bx - ax, bz - az) || 1;
    const dx = (bx - ax) / L;
    const dz = (bz - az) / L;
    // Inward normal: left of the edge for ccw polygons.
    const nx = ccw ? -dz : dz;
    const nz = ccw ? dx : -dx;
    const k = typeof d === 'number' ? d : d[i];
    lines.push([ax + nx * k, az + nz * k, dx, dz]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i + n - 1) % n];
    const b = lines[i];
    const p = lineInter(a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]);
    if (p) out.push(p);
    else out.push([b[0], b[1]]);
  }
  // Collapsed (edges crossed over)? Then it's gone.
  if (out.length < 3 || area(out) * area(poly) <= 0 || Math.abs(area(out)) < 1) return [];
  return out;
}

export function isConvex(poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const [cx, cz] = poly[(i + 2) % poly.length];
    const cr = (bx - ax) * (cz - bz) - (bz - az) * (cx - bx);
    if (Math.abs(cr) < 1e-6) continue;
    const s = Math.sign(cr);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

// Drop points that are (almost) on the line between their neighbors, and duplicates.
export function simplify(poly, eps = 0.05) {
  let out = poly.slice();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      if (Math.abs(cr) / L < eps || Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.01) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

// A rotated box (oriented in x/z): center, half sizes, angle (radians, around y; local u axis
// = (cos a, sin a)). Also carries its axis-aligned bounds, so it can live in the same lists as
// plain boxes (collision.js checks `ob` for the exact shape).
export function obb(cx, cz, hx, hz, a, h, y0 = 0) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const ex = Math.abs(c) * hx + Math.abs(s) * hz;
  const ez = Math.abs(s) * hx + Math.abs(c) * hz;
  const axisAligned = Math.abs(s) < 1e-4 || Math.abs(c) < 1e-4;
  const box = { minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, h, y0 };
  if (!axisAligned) box.ob = { cx, cz, hx, hz, c, s };
  return box;
}

// Corners of a rotated rectangle.
export function rectPoly(cx, cz, hx, hz, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([u, v]) => [cx + u * c - v * s, cz + u * s + v * c]);
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
