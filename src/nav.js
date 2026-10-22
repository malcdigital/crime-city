import { pushCircle, segmentBlockedPad } from './collision.js';
import { dist } from './util.js';

// Directions to try (radians from the straight line) when the way ahead is blocked.
const TRY = [0.45, 0.9, 1.35, 1.8, 2.3];

// Move an on-foot character `e` ({x, z}) toward a goal, steering around buildings and
// sliding along walls instead of running into them. Returns the heading it moved along.
export function navStep(e, finalX, finalZ, speed, dt, game, radius = 0.4) {
  // Long trips follow the streets instead of cutting through buildings.
  e.navWpT = (e.navWpT || 0) - dt;
  if (e.navWpT <= 0 || !e.navWp || e.navGoalX !== finalX || e.navGoalZ !== finalZ) {
    e.navWp = waypoint(game, e, finalX, finalZ);
    e.navWpT = 0.5;
    e.navGoalX = finalX;
    e.navGoalZ = finalZ;
  }
  const [goalX, goalZ] = e.navWp;
  const dx = goalX - e.x;
  const dz = goalZ - e.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05 || speed <= 0) return null;
  const boxes = game.city.colliders;
  let ux = dx / d;
  let uz = dz / d;

  if (e.navDetourT > 0) {
    // Following a wall for a moment after getting stuck.
    e.navDetourT -= dt;
    ux = e.navDX;
    uz = e.navDZ;
  } else {
    const look = Math.min(d, 2.5);
    const pad = radius * 0.75; // a bit less than the body, so hugging a wall still counts as clear
    if (segmentBlockedPad(e.x, e.z, e.x + ux * look, e.z + uz * look, boxes, pad)) {
      const base = Math.atan2(ux, uz);
      const side = e.navSide || 1;
      for (const a of TRY) {
        let ok = false;
        for (const s of [side, -side]) {
          const h = base + a * s;
          const cx = Math.sin(h);
          const cz = Math.cos(h);
          if (!segmentBlockedPad(e.x, e.z, e.x + cx * 2.5, e.z + cz * 2.5, boxes, pad)) {
            ux = cx;
            uz = cz;
            e.navSide = s; // keep turning the same way so we don't zigzag
            ok = true;
            break;
          }
        }
        if (ok) break;
      }
    }
  }

  const step = Math.min(d, speed * dt);
  const ox = e.x;
  const oz = e.z;
  e.x += ux * step;
  e.z += uz * step;
  const r = pushCircle(e.x, e.z, radius, boxes);
  e.x = r.x;
  e.z = r.z;
  const moved = Math.hypot(e.x - ox, e.z - oz);

  // Barely moving: slide along the wall for a bit.
  if (moved < step * 0.35) {
    e.navStuckT = (e.navStuckT || 0) + dt;
    if (e.navStuckT > 0.35) {
      e.navStuckT = 0;
      let tx = -r.nz;
      let tz = r.nx;
      if (!r.hit) {
        const a = Math.random() * Math.PI * 2;
        tx = Math.sin(a);
        tz = Math.cos(a);
      } else if (tx * ux + tz * uz < 0) {
        tx = -tx;
        tz = -tz;
      }
      e.navDX = tx;
      e.navDZ = tz;
      e.navDetourT = 0.8;
      e.navSide = -(e.navSide || 1);
    }
  } else e.navStuckT = 0;

  // Not getting closer to the goal over a couple of seconds: break free in an open direction.
  e.navCheckT = (e.navCheckT || 0) + dt;
  if (e.navCheckT > 1.5) {
    const now = Math.hypot(finalX - e.x, finalZ - e.z);
    if (e.navLastD !== undefined && e.navLastD - now < speed * 1.5 * 0.2 && now > 2) {
      e.navFails = (e.navFails || 0) + 1;
      const start = Math.random() * Math.PI * 2;
      for (let k = 0; k < 8; k++) {
        const h = start + (k * Math.PI) / 4;
        const cx = Math.sin(h);
        const cz = Math.cos(h);
        if (!segmentBlockedPad(e.x, e.z, e.x + cx * 4, e.z + cz * 4, boxes, radius * 0.75)) {
          e.navDX = cx;
          e.navDZ = cz;
          e.navDetourT = 1.3;
          break;
        }
      }
    } else e.navFails = 0;
    e.navLastD = now;
    e.navCheckT = 0;
  }
  return Math.atan2(ux, uz);
}

// A street intersection to run to, away from a threat and not too far from `e`.
export function escapePoint(game, e, threatX, threatZ) {
  let best = null;
  let bestScore = -Infinity;
  for (const n of game.city.nodes) {
    const de = dist(n.x, n.z, e.x, e.z);
    if (de < 8 || de > 75) continue;
    const dt = dist(n.x, n.z, threatX, threatZ);
    // Don't run past the threat.
    if (dt < dist(e.x, e.z, threatX, threatZ)) continue;
    const score = dt - de * 0.5 + Math.random() * 6;
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best ? [best.x, best.z] : [e.x + (e.x - threatX), e.z + (e.z - threatZ)];
}

// Next point to head for on the way to (gx, gz): the goal itself if the way is clear,
// otherwise out of the block onto the road, then along the road to an intersection.
export function waypoint(game, e, gx, gz) {
  const { city } = game;
  if (!segmentBlockedPad(e.x, e.z, gx, gz, city.los, 0.3)) return [gx, gz];
  const clear = (x, z) => !segmentBlockedPad(e.x, e.z, x, z, city.los, 0.3);
  let best = null;
  let bestScore = Infinity;
  const consider = (x, z) => {
    if (!clear(x, z)) return;
    const score = Math.hypot(x - e.x, z - e.z) + Math.hypot(gx - x, gz - z);
    if (score < bestScore) {
      bestScore = score;
      best = [x, z];
    }
  };
  const b = city.blockAt(e.x, e.z);
  if (b) {
    // On a sidewalk: step out onto the road on whichever side leads toward the goal.
    const pad = 3;
    consider(b.minX - pad, e.z);
    consider(b.maxX + pad, e.z);
    consider(e.x, b.minZ - pad);
    consider(e.x, b.maxZ + pad);
  } else {
    // On a road: head to an intersection on this road.
    const P = city.P;
    const onX = Math.abs(e.x - Math.round(e.x / P) * P) < 9; // on a north-south road
    const onZ = Math.abs(e.z - Math.round(e.z / P) * P) < 9; // on an east-west road
    for (const n of city.nodes) {
      if ((onX && Math.abs(n.x - e.x) < 9) || (onZ && Math.abs(n.z - e.z) < 9)) {
        if (Math.hypot(n.x - e.x, n.z - e.z) < 1) continue;
        consider(n.x, n.z);
      }
    }
  }
  return best || [gx, gz];
}
