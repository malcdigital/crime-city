export const WEAPONS = [
  { id: 'fists', name: 'Fists', melee: true },
  { id: 'pistol', name: 'Pistol', dmg: 34, rate: 0.28, mag: 12, auto: false, spread: 0.02, aimSpread: 0.004, reload: 1.2, range: 110, sound: 'pistol' },
  { id: 'smg', name: 'SMG', dmg: 20, rate: 0.085, mag: 30, auto: true, spread: 0.045, aimSpread: 0.014, reload: 1.6, range: 90, sound: 'smg' },
];

// The player's weapons and ammo.
export class Arsenal {
  constructor() {
    this.idx = 1;
    this.ammo = { pistol: { mag: 12, reserve: 96 }, smg: { mag: 30, reserve: 180 } };
    this.cool = 0;
    this.reloadT = 0;
  }

  current() {
    return WEAPONS[this.idx];
  }

  select(i) {
    if (i < 0 || i >= WEAPONS.length || i === this.idx) return;
    this.idx = i;
    this.reloadT = 0;
    this.cool = 0.2;
  }

  cycle(dir) {
    this.select((this.idx + dir + WEAPONS.length) % WEAPONS.length);
  }

  startReload() {
    const w = this.current();
    if (w.melee || this.reloadT > 0) return false;
    const am = this.ammo[w.id];
    if (am.mag >= w.mag || am.reserve <= 0) return false;
    this.reloadT = w.reload;
    return true;
  }

  update(dt) {
    this.cool = Math.max(0, this.cool - dt);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const w = this.current();
        const am = this.ammo[w.id];
        const take = Math.min(w.mag - am.mag, am.reserve);
        am.mag += take;
        am.reserve -= take;
        this.reloadT = 0;
      }
    }
  }
}

// Ray vs axis-aligned box. Returns the entry distance or null.
export function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = 0;
  let tmax = Infinity;
  const axes = [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]];
  for (const [o, d, a, b] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < a || o > b) return null;
    } else {
      let t1 = (a - o) / d;
      let t2 = (b - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

// Bullet ray test against the ground, buildings, people and cars.
export function raycast(game, ox, oy, oz, dx, dy, dz, maxT, ignore = null, solidOnly = false) {
  let best = { t: maxT, type: 'none' };
  if (dy < -1e-4) {
    const t = -oy / dy;
    if (t > 0 && t < best.t) best = { t, type: 'ground' };
  }
  for (const b of game.city.los) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, b.minX, 0, b.minZ, b.maxX, b.h || 30, b.maxZ);
    if (t !== null && t < best.t) best = { t, type: 'world' };
  }
  for (const b of game.city.crates) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, b.minX, 0, b.minZ, b.maxX, b.h, b.maxZ);
    if (t !== null && t < best.t) best = { t, type: 'world' };
  }
  for (const c of solidOnly ? [] : game.characters()) {
    if (c === ignore || !c.alive) continue;
    const y = game.city.groundY(c.x, c.z);
    const top = !c.standing ? y + 0.5 : c.crouched ? y + 1.1 : y + 1.95;
    const r = c.standing ? 0.33 : 0.9;
    const t = rayBox(ox, oy, oz, dx, dy, dz, c.x - r, y, c.z - r, c.x + r, top, c.z + r);
    if (t !== null && t < best.t) {
      const hy = oy + dy * t;
      best = { t, type: 'char', target: c, head: c.standing && hy > y + (c.crouched ? 0.85 : 1.6) };
    }
  }
  for (const v of game.vehicles) {
    if (v === ignore || v.removed || !v.doors) continue;
    for (const b of v.doorBoxes()) {
      const t = rayBox(ox, oy, oz, dx, dy, dz, b.minX, 0.45, b.minZ, b.maxX, b.h, b.maxZ);
      if (t !== null && t < best.t) best = { t, type: 'car', target: v };
    }
  }
  for (const v of game.vehicles) {
    if (v === ignore || v.removed) continue;
    const ex = ox - v.x;
    const ez = oz - v.z;
    if (ex * ex + ez * ez > (maxT + 6) * (maxT + 6)) continue;
    const c = Math.cos(v.heading);
    const s = Math.sin(v.heading);
    // World to car-local space (car faces local +z).
    const lox = ex * c - ez * s;
    const loz = ex * s + ez * c;
    const ldx = dx * c - dz * s;
    const ldz = dx * s + dz * c;
    const t = rayBox(lox, oy, loz, ldx, dy, ldz, -v.type.w / 2, 0.2, -v.type.l / 2, v.type.w / 2, 1.9, v.type.l / 2);
    if (t !== null && t < best.t) best = { t, type: 'car', target: v };
  }
  best.x = ox + dx * best.t;
  best.y = oy + dy * best.t;
  best.z = oz + dz * best.t;
  return best;
}
