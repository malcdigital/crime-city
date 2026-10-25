import { CFG } from './config.js';
import { districtAt } from './districts.js';

// The city's daily rhythm: how many cars and people are out, by time of day and district.
// - Morning rush (7-9 AM) and evening rush (4:30-6:30 PM) are the busiest times on the roads.
// - The Financial and Government districts fill up in working hours and empty out at night.
// - The Strip wakes up after dark and is packed from about 10 PM to 2 AM.
// - The Heights stays quiet; the Projects are about as busy at night as in the day.
// - Around 4 AM the whole city is close to empty.
// Traffic (traffic.js) and pedestrians (peds.js) ask here how many to keep around you and
// where to put new ones.

// Piecewise-linear curve over the 24-hour clock: [[hour, value], ...], wrapping at midnight.
function curve(pts) {
  return (h) => {
    h = ((h % 24) + 24) % 24;
    for (let k = 1; k < pts.length; k++) {
      const [h1, v1] = pts[k];
      const [h0, v0] = pts[k - 1];
      if (h <= h1) return v0 + ((v1 - v0) * (h - h0)) / (h1 - h0 || 1);
    }
    return pts[pts.length - 1][1];
  };
}

// Whole-city level (1 = normal daytime).
const CITY_TRAFFIC = curve([[0, 0.45], [3, 0.2], [4.5, 0.15], [6, 0.5], [7.5, 1.3], [9, 1.2], [10, 0.9], [12, 1.0], [15, 0.95], [16.5, 1.25], [17.5, 1.35], [19, 1.0], [21, 0.75], [23, 0.6], [24, 0.45]]);
const CITY_PEDS = curve([[0, 0.4], [3, 0.15], [4.5, 0.1], [6, 0.35], [8, 1.0], [12, 1.15], [14, 1.05], [17.5, 1.2], [19, 1.0], [21, 0.75], [23, 0.55], [24, 0.4]]);
// Working hours (offices and the port are busy) and nightlife (bars and clubs).
const WORK = curve([[0, 0], [6, 0], [8, 1], [17, 1], [19.5, 0], [24, 0]]);
const NIGHTLIFE = curve([[0, 0.9], [2, 0.7], [4, 0.1], [6, 0], [19, 0], [21, 0.6], [22.5, 1], [24, 0.9]]);

// Per district: [working hours, off hours, nightlife boost], for traffic (t) and people (p).
const DISTRICT = {
  'Financial District': { t: [1.3, 0.35, 0], p: [1.35, 0.2, 0] },
  'Government District': { t: [1.2, 0.4, 0], p: [1.25, 0.25, 0] },
  Downtown: { t: [1.15, 0.85, 0.25], p: [1.2, 0.85, 0.35] },
  Midtown: { t: [1.0, 0.8, 0.15], p: [1.0, 0.8, 0.2] },
  'The Strip': { t: [0.75, 0.7, 1.1], p: [0.7, 0.7, 2.6] },
  'The Heights': { t: [0.75, 0.5, 0], p: [0.7, 0.4, 0] },
  'The Projects': { t: [0.85, 0.85, 0.2], p: [0.9, 0.95, 0.35] },
  'The Docks': { t: [1.15, 0.35, 0], p: [0.6, 0.25, 0] },
};

const LIMITS = { t: [8, 75], p: [10, 150] };

export class Rhythm {
  constructor(game) {
    this.game = game;
    this.t = 99;
    this.traffic = CFG.TRAFFIC_CARS;
    this.peds = CFG.PEDS;
  }

  hour() {
    const m = this.game.clockMinutes();
    return Number.isFinite(m) ? m / 60 : 9; // (before the clock starts: the game opens at 9 AM)
  }

  // How busy a spot is right now (1 = a normal day). kind: 't' traffic, 'p' people.
  weight(x, z, kind, h = this.hour()) {
    const d = DISTRICT[districtAt(x, z)] || DISTRICT.Midtown;
    const [work, off, nl] = d[kind];
    const w = WORK(h);
    const base = kind === 't' ? CITY_TRAFFIC(h) : CITY_PEDS(h);
    return base * (work * w + off * (1 - w) + nl * NIGHTLIFE(h));
  }

  // Average over the area around a spot (so crossing into another district eases in).
  local(x, z, kind, h = this.hour()) {
    let sum = 0;
    let n = 0;
    for (const dx of [-110, 0, 110]) {
      for (const dz of [-110, 0, 110]) {
        const k = dx === 0 && dz === 0 ? 2 : 1;
        sum += this.weight(x + dx, z + dz, kind, h) * k;
        n += k;
      }
    }
    return sum / n;
  }

  // Should a new car or person go here? (Busier spots get more of them.)
  accept(x, z, kind) {
    const here = kind === 't' ? this.trafficLocal : this.pedsLocal;
    return Math.random() < Math.min(1, this.weight(x, z, kind) / Math.max(0.05, (here || 1) * 1.3));
  }

  // Targets near the player, refreshed once a second.
  update(dt, force = false) {
    this.t += dt;
    if (this.t < 1 && !force) return;
    this.t = 0;
    const [px, pz] = this.game.player.pos();
    const h = this.hour();
    this.trafficLocal = this.local(px, pz, 't', h);
    this.pedsLocal = this.local(px, pz, 'p', h);
    const clamp = (v, [a, b]) => Math.max(a, Math.min(b, Math.round(v)));
    this.traffic = clamp(CFG.TRAFFIC_CARS * this.trafficLocal, LIMITS.t);
    this.peds = clamp(CFG.PEDS * this.pedsLocal, LIMITS.p);
  }
}
