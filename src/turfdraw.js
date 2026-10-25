// Drawing turf on the radar and the map: each block's area out to the middle of its streets,
// with a border round the outside of a gang's turf (not between two of its own blocks).

// Which blocks share each street edge (built once).
let shared = null;
function sharedEdges(all) {
  if (shared) return shared;
  shared = new Map();
  for (const b of all) {
    for (const e of b.edges || []) {
      if (!shared.has(e)) shared.set(e, []);
      shared.get(e).push(b);
    }
  }
  return shared;
}

const outline = (b) => (b.ring && b.edges && b.edges.length === b.ring.length ? b.ring : b.poly);

function trace(ctx, pts, ox, oz) {
  ctx.moveTo(pts[0][0] - ox, pts[0][1] - oz);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] - ox, pts[i][1] - oz);
  ctx.closePath();
}

// Fill blocks (their area out to the street middles). ox, oz: subtracted from every point.
export function fillTurf(ctx, blocks, ox = 0, oz = 0) {
  ctx.beginPath();
  for (const b of blocks) trace(ctx, outline(b), ox, oz);
  ctx.fill();
}

// Just the blocks themselves (curb to curb).
export function fillBlocks(ctx, blocks, ox = 0, oz = 0) {
  ctx.beginPath();
  for (const b of blocks) trace(ctx, b.poly, ox, oz);
  ctx.fill();
}

export function strokeBlock(ctx, b, ox = 0, oz = 0) {
  ctx.beginPath();
  trace(ctx, b.poly, ox, oz);
  ctx.stroke();
}

// The border round a set of blocks: every street edge that doesn't have another of the set
// across it.
export function strokeTurf(ctx, blocks, all, ox = 0, oz = 0) {
  const set = new Set(blocks);
  const sh = sharedEdges(all);
  ctx.beginPath();
  for (const b of blocks) {
    const ring = outline(b);
    if (ring === b.poly) {
      trace(ctx, ring, ox, oz);
      continue;
    }
    for (let i = 0; i < ring.length; i++) {
      const others = sh.get(b.edges[i]) || [];
      if (others.some((o) => o !== b && set.has(o))) continue;
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      ctx.moveTo(p[0] - ox, p[1] - oz);
      ctx.lineTo(q[0] - ox, q[1] - oz);
    }
  }
  ctx.stroke();
}
