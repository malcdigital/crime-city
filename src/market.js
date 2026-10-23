import { CFG } from './config.js';
import { districtAt, streetAt } from './city.js';
import { Soldier, GANGS } from './turf.js';
import { dist, pick, rand, clamp } from './util.js';

// The drug market: supply and demand, per district and per product.
// - Demand: each district has its own taste (Downtown pays for coke, Southgate smokes weed…).
//   Selling a lot in one place saturates it (demand drops, then slowly comes back), and now and
//   then something shifts it (a party weekend, a clinic shutting down).
// - Supply: citywide per product (the plugs) and local per district (the rival gangs dealing
//   on their turf). Raids cut a product's supply; a plug dying dries it up until a new plug
//   takes over (your tab passes to them); a rival kingpin dying dries up their district.
//   Big runs (yours) put more product on the street and push prices down.
// - Price = base street price × demand / supply (kept between 0.5× and 2.2×). Plugs charge
//   more when supply is short. Buyers come more often where demand is high.
// Everything drifts back toward normal over several minutes of play.
export const DISTRICTS = ['Downtown', 'Hillcrest', 'Southgate', 'Eastside', 'Harbor'];
const BASE_DEMAND = {
  Downtown: { weed: 1.0, pills: 1.2, coke: 1.45 },
  Hillcrest: { weed: 1.15, pills: 1.0, coke: 1.3 },
  Southgate: { weed: 1.35, pills: 0.9, coke: 0.8 },
  Eastside: { weed: 1.0, pills: 1.35, coke: 0.9 },
  Harbor: { weed: 0.85, pills: 1.15, coke: 1.2 },
};
const PRODUCTS = ['weed', 'pills', 'coke'];
const RELAX = 1 / (8 * 60); // fraction of the gap closed per second (≈8 min to settle)
const SHOCK_EVERY = CFG.MARKET_HOT ? 45 : CFG.TURF_FAST ? 120 : 300;
const HOT = CFG.MARKET_HOT ? 1.5 : 1; // testing: demand boost everywhere
// The President's war on drugs (0 hands off, 1 tough on drugs, 2 all-out war): buyers get
// scared off (less demand), seizures cut supply (prices and plug costs go up), and the cops
// work the trade harder (more raids on runs, more undercover buyers, street sweeps).
export const WAR_LEVELS = [
  { name: 'Hands off', detail: 'Police leave the drug trade alone unless someone gets hurt.' },
  { name: 'Tough on drugs', detail: 'Fewer buyers, less supply, more raids and undercover cops.' },
  { name: 'All-out war', detail: 'Buyers scared off, supply seized, raids and undercovers everywhere, street sweeps.' },
];
let warLevel = 0;
const base = (d, p) => BASE_DEMAND[d][p] * HOT * (1 - 0.15 * warLevel);
const PLUG_REPLACE = CFG.TURF_FAST ? 180 : 600; // seconds until a dead plug is replaced
const KINGPIN_BACK = CFG.TURF_FAST ? 240 : 900;
const SAVE_KEY = 'crimecity.market.v1';
const NEW_PLUGS = { weed: ['Lil Smoke', 'Greeny', 'Dub'], pills: ['Script', 'Nurse', 'Benji'], coke: ['Snow', 'Rico', 'White Mike'] };
const SHOCKS = [
  ['coke', +0.4, 'Party weekend in {d}: coke demand jumping'],
  ['pills', +0.4, 'Pain clinic shut down in {d}: pills demand up'],
  ['weed', +0.35, 'Block party in {d}: everybody want weed'],
  ['coke', -0.3, 'Heavy patrols in {d}: coke buyers laying low'],
  ['weed', -0.3, 'Dispensary opened in {d}: weed demand down'],
  ['pills', -0.3, 'Pharmacy crackdown in {d}: pills buyers spooked'],
];

export class Market {
  constructor(game) {
    this.game = game;
    this.demand = {};
    this.flood = {}; // extra local supply (big runs landing)
    for (const d of DISTRICTS) {
      this.demand[d] = { weed: base(d, 'weed'), pills: base(d, 'pills'), coke: base(d, 'coke') };
      this.flood[d] = { weed: 0, pills: 0, coke: 0 };
    }
    this.city = { weed: 1, pills: 1, coke: 1 }; // citywide supply (the plugs)
    this.news = {}; // product -> latest reason
    this.shockT = SHOCK_EVERY;
    this.trendT = 0;
    this.kingpins = {}; // gang -> { s, deadT }
    this.war = 0;
    this.last = this.snapshot();
    this.prev = this.last;
    this.load();
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!s) return;
      for (const d of DISTRICTS) {
        Object.assign(this.demand[d], s.demand?.[d] || {});
        if (HOT > 1) for (const p of PRODUCTS) this.demand[d][p] = Math.max(this.demand[d][p], base(d, p)); // testing: start hot
        Object.assign(this.flood[d], s.flood?.[d] || {});
      }
      Object.assign(this.city, s.city || {});
      this.war = warLevel = s.war || 0;
      this.news = s.news || {};
    } catch {
      // Fresh market.
    }
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ demand: this.demand, flood: this.flood, city: this.city, news: this.news, war: this.war }));
    } catch {
      // Storage unavailable.
    }
  }

  // ---- The war on drugs ----
  setWar(level) {
    const game = this.game;
    this.war = warLevel = level;
    this.save();
    game.hud.news(['President ends the war on drugs: police told to stand down', 'President gets tough on drugs: more raids and undercover operations', 'President declares all-out war on drugs'][level], level ? 'crime' : 'info');
  }

  // Street sweeps (all-out war only): the cops hit a district's corners now and then.
  sweep(dt) {
    if (warLevel < 2) return;
    this.sweepT = (this.sweepT ?? 120) - dt;
    if (this.sweepT > 0) return;
    this.sweepT = (CFG.MARKET_HOT ? 90 : 240) * rand(0.7, 1.3);
    const d = pick(DISTRICTS);
    const p = pick(PRODUCTS);
    this.flood[d][p] = Math.max(-0.5, this.flood[d][p] - 0.4);
    this.demand[d][p] = Math.max(0.35, this.demand[d][p] - 0.25);
    this.news[`${d}.${p}`] = `Street sweep in ${d}: ${p} dealers locked up`;
    this.game.hud.news(`Police sweep ${d} corners in the war on drugs`, 'crime');
    this.game.president?.win(1, 'Street sweeps');
  }

  // ---- Supply and prices ----
  // Rival gangs dealing in a district add supply there (more if their kingpin is alive).
  rivalSupply(d) {
    const T = this.game.turfWars;
    let n = 0;
    let rival = 0;
    for (const b of T.blocks) {
      if (districtAt(b.cx, b.cz) !== d) continue;
      n++;
      const g = T.owner[`${b.i},${b.j}`];
      if (g && g !== 'crew') rival += this.kingpinAlive(g) ? 1 : 0.3;
    }
    return n ? (rival / n) * 0.6 : 0;
  }

  supply(d, p) {
    return Math.max(0.15, this.city[p] * (1 + this.rivalSupply(d) + this.flood[d][p]));
  }

  // Price multiplier on the base street price.
  mult(d, p) {
    return clamp(this.demand[d][p] / this.supply(d, p), 0.5, 2.2);
  }

  // What a plug charges per unit right now: more when that product is scarce.
  costMult(p) {
    return clamp(1 / this.city[p], 0.85, 2.2);
  }

  snapshot() {
    const s = {};
    for (const d of DISTRICTS) for (const p of PRODUCTS) s[`${d}.${p}`] = this.mult(d, p);
    return s;
  }

  trend(d, p) {
    const k = `${d}.${p}`;
    const now = this.mult(d, p);
    const was = this.prev[k] ?? now;
    return now > was * 1.03 ? '▲' : now < was * 0.97 ? '▼' : '';
  }

  // Why a price is what it is (for the Market app).
  reason(d, p) {
    const dem = this.demand[d][p] / base(d, p);
    const why = [];
    if (this.city[p] < 0.8) why.push(this.news[p] || `${p} supply short citywide`);
    else if (this.city[p] > 1.15) why.push(`lot of ${p} on the street`);
    if (this.flood[d][p] > 0.15) why.push('flooded by a big run');
    const rs = this.rivalSupply(d);
    if (rs > 0.15) why.push('rival gangs dealing here');
    if (dem < 0.8) why.push('buyers here are tapped out');
    else if (dem > 1.2) why.push('demand up here');
    return why.join(' · ') || (BASE_DEMAND[d][p] >= 1.2 ? `${d} loves ${p}` : BASE_DEMAND[d][p] <= 0.9 ? `${d} not big on ${p}` : 'normal');
  }

  // ---- Events ----
  // A unit sold in a district: buyers there get a little tapped out.
  sold(d, p, units) {
    this.demand[d][p] = Math.max(0.35, this.demand[d][p] - 0.012 * units);
  }

  // A run landed: more product on the street (citywide a little, around the drop a lot).
  landed(p, units, x, z) {
    const d = districtAt(x, z);
    this.flood[d][p] = Math.min(1.2, this.flood[d][p] + units * 0.004);
    this.city[p] = Math.min(1.5, this.city[p] + units * 0.0015);
    this.save();
  }

  // The cops hit a spot: that product gets scarce.
  raided(p) {
    this.city[p] = Math.max(0.3, this.city[p] - 0.25);
    this.news[p] = `raids cut the ${p} supply`;
    this.game.president?.win(1.5, 'Drug raids');
    this.save();
  }

  plugDied(plug) {
    this.city[plug.product] = Math.max(0.25, this.city[plug.product] - 0.6);
    this.news[plug.product] = `${plug.name} got killed — ${plug.product} drying up`;
    this.game.hud.news(`Drug supplier ${plug.name} found dead on ${plug.street}`, 'crime');
    this.game.president?.add(3, 'Drug killings');
    this.save();
  }

  kingpinAlive(g) {
    const k = this.kingpins[g];
    return !k || (k.s && k.s.alive);
  }

  // ---- Rival kingpins: a big dealer at each rival gang's home base ----
  updateKingpins(dt) {
    const game = this.game;
    const T = game.turfWars;
    for (const g of ['kings', 'vipers']) {
      const home = T.homeBlock(g);
      let k = this.kingpins[g];
      if (k && k.s && !k.s.alive && !k.dead) {
        k.dead = true;
        k.deadT = KINGPIN_BACK;
        game.hud.news(`${GANGS[g].name} kingpin killed — their corners going dry`, 'crime');
        game.president?.add(4, 'Drug killings');
        for (const d of DISTRICTS) for (const p of PRODUCTS) if (this.rivalSupply(d) > 0) this.demand[d][p] = Math.min(2, this.demand[d][p] + 0.1);
      }
      if (k && k.dead) {
        k.deadT -= dt;
        if (k.deadT > 0) continue;
        k = null;
        delete this.kingpins[g];
      }
      if (!k && home && !T.underground(g)) {
        // Standing in the middle of their home base crowd.
        const [px, pz] = game.player.pos();
        if (dist(home.cx, home.cz, px, pz) < 90) continue; // not while you're watching
        const x = home.cx + rand(-4, 4);
        const z = home.minZ + 5;
        const s = new Soldier(game, T, x, z, g, null, 'guard');
        s.kingpin = true;
        s.health = 260;
        s.baseHeart = s.heart = 1;
        s.char.group.scale.setScalar(1.08);
        T.soldiers.push(s);
        this.kingpins[g] = { s, dead: false };
      }
    }
  }

  // Map/legend positions of the kingpins.
  kingpinSpots() {
    return Object.entries(this.kingpins).filter(([, k]) => k.s && k.s.alive).map(([g, k]) => ({ g, x: k.s.x, z: k.s.z }));
  }

  update(dt) {
    // Drift back toward normal.
    for (const d of DISTRICTS) {
      for (const p of PRODUCTS) {
        this.demand[d][p] += (base(d, p) - this.demand[d][p]) * RELAX * dt;
        this.flood[d][p] += (0 - this.flood[d][p]) * RELAX * dt;
      }
    }
    const plugs = this.game.drugs.plugs;
    for (const p of PRODUCTS) {
      const pl = plugs.find((x) => x.product === p);
      const target = (pl && pl.dead ? 0.35 : 1) * (1 - 0.2 * warLevel); // seizures
      this.city[p] += (target - this.city[p]) * RELAX * 1.5 * dt;
      if (this.city[p] > 0.85 && !(pl && pl.dead)) delete this.news[p];
    }
    // Now and then something shifts demand somewhere.
    this.shockT -= dt;
    if (this.shockT <= 0) {
      this.shockT = SHOCK_EVERY * rand(0.7, 1.3);
      const [p, amt, msg] = pick(SHOCKS);
      const d = pick(DISTRICTS);
      this.demand[d][p] = clamp(this.demand[d][p] + amt * HOT, 0.35, 2.2 * HOT);
      this.news[`${d}.${p}`] = msg.replace('{d}', d);
    }
    // Trend arrows compare against a minute ago.
    this.trendT -= dt;
    if (this.trendT <= 0) {
      this.trendT = 60;
      this.prev = this.last;
      this.last = this.snapshot();
      this.save();
    }
    this.updateKingpins(dt);
    this.sweep(dt);
  }

  // ---- Phone app rows ----
  rows() {
    const game = this.game;
    const [px, pz] = game.player.pos();
    const here = districtAt(px, pz);
    const D = game.drugs;
    const out = [];
    const base = { weed: 40, pills: 85, coke: 190 };
    for (const p of PRODUCTS) {
      const pl = D.plugs.find((x) => x.product === p);
      const cm = this.costMult(p);
      out.push({
        head: true,
        label: `${p[0].toUpperCase() + p.slice(1)} · plug ${pl && pl.dead ? 'DEAD' : `$${Math.round(D.unitCost(p))}/unit`}`,
        right: this.city[p] < 0.8 ? 'SHORT' : this.city[p] > 1.15 ? 'PLENTY' : '',
        detail: pl && pl.dead ? `${pl.name} is dead. A new plug takes over in ${Math.ceil(pl.deadT / 60)} min.` : cm > 1.05 ? `Supply is short: plugs are charging ${Math.round((cm - 1) * 100)}% more.` : 'Supply normal.',
      });
      const rows = DISTRICTS.map((d) => ({ d, price: Math.round(base[p] * this.mult(d, p)) })).sort((a, b) => b.price - a.price);
      for (const r of rows) {
        const shock = this.news[`${r.d}.${p}`];
        out.push({
          label: `${r.d}${r.d === here ? ' (here)' : ''}`,
          right: `$${r.price} ${this.trend(r.d, p)}`,
          detail: `${shock ? `${shock}. ` : ''}${this.reason(r.d, p)}. ✕ sets a waypoint there.`,
          district: r.d,
        });
      }
    }
    return out;
  }

  // Middle of a district, for waypoints and map labels.
  center(d) {
    const S = CFG.SIZE;
    return { Downtown: [S / 2, S / 2], Hillcrest: [S * 0.2, S * 0.2], Southgate: [S * 0.2, S * 0.8], Eastside: [S * 0.8, S * 0.2], Harbor: [S * 0.8, S * 0.8] }[d];
  }
}

export { streetAt, NEW_PLUGS, PLUG_REPLACE };
