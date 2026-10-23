export const WEAPONS = [
  { id: 'fists', slot: 'melee', name: 'Fists', melee: true },
  { id: 'pistol', slot: 'pistol', name: 'Pistol', dmg: 34, rate: 0.28, mag: 12, auto: false, spread: 0.02, aimSpread: 0.004, reload: 1.2, range: 110, sound: 'pistol' },
  { id: 'smg', slot: 'smg', name: 'SMG', dmg: 20, rate: 0.085, mag: 30, auto: true, spread: 0.045, aimSpread: 0.014, reload: 1.6, range: 90, sound: 'smg' },
  { id: 'rifle', slot: 'rifle', name: 'Assault Rifle', dmg: 30, rate: 0.11, mag: 30, auto: true, spread: 0.03, aimSpread: 0.006, reload: 2.0, range: 150, sound: 'rifle' },
  { id: 'shotgun', slot: 'shotgun', name: 'Pump Shotgun', dmg: 20, pellets: 8, rate: 0.85, mag: 6, auto: false, spread: 0.08, aimSpread: 0.04, reload: 2.4, range: 45, sound: 'shotgun' },
];

// The player's weapons and ammo. Two hands' worth: two weapon slots (fists when a slot is
// empty). Tap L1 / Tab to swap between them. A new gun goes into an empty slot, or replaces
// the one in your hand. Ammo is kept per gun type, even for guns you aren't carrying.
const byId = (id) => WEAPONS.find((w) => w.id === id);

export class Arsenal {
  constructor() {
    this.slots = ['pistol', null];
    this.active = 0;
    this.idx = WEAPONS.indexOf(byId('pistol'));
    this.ammo = {
      pistol: { mag: 12, reserve: 96 }, smg: { mag: 30, reserve: 180 },
      rifle: { mag: 30, reserve: 180 }, shotgun: { mag: 6, reserve: 36 },
    };
    this.cool = 0;
    this.reloadT = 0;
  }

  current() {
    return WEAPONS[this.idx];
  }

  // The weapon in slot i (fists if it's empty).
  inSlot(i) {
    return byId(this.slots[i] || 'fists');
  }

  has(id) {
    return this.slots.includes(id);
  }

  refresh() {
    this.idx = WEAPONS.indexOf(this.inSlot(this.active));
  }

  selectSlot(i) {
    if (i === this.active || i < 0 || i > 1) return;
    this.active = i;
    this.refresh();
    this.reloadT = 0;
    this.cool = 0.2;
  }

  swap() {
    this.selectSlot(1 - this.active);
  }

  // Pick up or buy a gun: an empty slot if there is one, otherwise it replaces the gun in your
  // hand. Returns the id of the gun it replaced (or null).
  give(id) {
    if (this.has(id)) return null;
    let i = this.slots.indexOf(null);
    let replaced = null;
    if (i < 0) {
      i = this.active;
      replaced = this.slots[i];
    }
    this.slots[i] = id;
    this.active = i;
    this.refresh();
    this.reloadT = 0;
    this.cool = 0.2;
    return replaced;
  }

  // What a new gun would replace (null if there's a free slot).
  wouldReplace(id) {
    if (this.has(id) || this.slots.includes(null)) return null;
    return this.slots[this.active];
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
  // The police helicopter.
  const h = solidOnly ? null : game.police?.heli;
  if (h && !h.removed && h.state !== 'down') {
    const t = rayBox(ox, oy, oz, dx, dy, dz, h.x - 1.6, h.y - 1.3, h.z - 1.6, h.x + 1.6, h.y + 1.0, h.z + 1.6);
    const t2 = rayBox(ox, oy, oz, dx, dy, dz, h.x - 2.4, h.y - 1.3, h.z - 2.4, h.x + 2.4, h.y + 1.0, h.z + 2.4);
    const tt = t ?? t2;
    if (tt !== null && tt < best.t) best = { t: tt, type: 'heli', target: h };
  }
  best.x = ox + dx * best.t;
  best.y = oy + dy * best.t;
  best.z = oz + dz * best.t;
  return best;
}
