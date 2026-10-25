import { DISTRICTS } from './districts.js';
import { districtAt, streetAt } from './city.js';
import { CRIME_WEIGHT } from './president.js';
import { GANGS } from './turf.js';
import { pick, rand } from './util.js';

// The property market: what homes are worth, and what owning one costs.
// - Value = base price × district demand × crime × turf × the city's mood.
//   - District demand drifts over time, and news moves it (a new transit line, a plant closing).
//   - Crime: every crime (yours or anyone's) raises the crime level of that district; it fades
//     over ~10 minutes. High crime knocks up to 35% off.
//   - Turf: on a rival gang's turf, 10% off; a turf war in the district, 8% off.
//   - The city's mood: the President's approval (a happy city pays a little more).
// - Prices are simple round numbers (3 significant figures: $3,000, $25,500, $1,020,000), and the 6% sales tax is already in
//   them: a $60,000 home costs $60,000, of which $3,396 is sales tax (to the government).
// - Selling: you get the price minus the sales tax in it.
// - Property tax: 0.25% of the current value, every game week (7 game days = 5h36m of play).
// - Upkeep (utilities, maintenance): every game day, progressive on the current value
//   (0.10% of the first $5k, 0.20% up to $20k, 0.35% up to $50k, 0.50% above).
// - Bills come out of the bank first, then that home's stash. Can't cover it? It's owed; still
//   owing a week later is a strike, and on the second strike the city seizes the home (and
//   what's in its stash).
// Taxes go to the city treasury (shown in the pause menu). Upkeep goes to the companies that
// provide the services, but 6% of every upkeep bill is the tax on those services: it goes to the
// treasury too (already in the bill, like the sales tax in a price).
const SAVE_KEY = 'crimecity.property.v1';
export const SALES_TAX = 0.06;
const PROPERTY_TAX = 0.0025; // of value, per week
const TAX_EVERY = 7; // game days
// Upkeep per game day, progressive like tax brackets: each slice of the current value pays its
// own rate, so pricier places cost more to keep, without jumps at the bracket lines.
const UPKEEP_BRACKETS = [
  [5000, 0.001], // first $5,000: 0.10% a day
  [20000, 0.002], // $5,000-$20,000: 0.20%
  [50000, 0.0035], // $20,000-$50,000: 0.35%
  [Infinity, 0.005], // above $50,000: 0.50%
];
const CRIME_FADE = 1 / 600;
// Round to 3 significant figures so prices stay simple at every size.
const roundPrice = (v) => {
  const step = Math.max(100, 10 ** (Math.floor(Math.log10(Math.max(1, v))) - 2));
  return Math.max(500, Math.round(v / step) * step);
};
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const EVENTS = [
  ['New transit line announced for {d}', 0.1],
  ['Developers buying up lots in {d}', 0.08],
  ['Tech company opens offices in {d}', 0.09],
  ['Factory closing in {d}', -0.08],
  ['{d} landlords report empty units', -0.07],
  ['Flooding damages homes in {d}', -0.06],
];

export class PropertyMarket {
  constructor(game) {
    this.game = game;
    this.crimeLevel = {}; // district -> crime level (fades)
    this.demand = {}; // district -> multiplier (drifts 0.8..1.25)
    this.treasury = 10000; // taxes collected by the city (starts with a reserve)
    this.prev = {}; // id -> value a minute ago (for trend arrows)
    for (const d of DISTRICTS) {
      this.crimeLevel[d] = 0;
      this.demand[d] = 1;
    }
    this.eventT = rand(180, 300);
    this.snapT = 0;
    this.load();
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!s) return;
      Object.assign(this.crimeLevel, s.crimeLevel || {});
      Object.assign(this.demand, s.demand || {});
      this.treasury = s.treasury ?? 10000;
      for (const h of this.all()) {
        const o = s.homes?.[h.id];
        if (o) Object.assign(h, { owed: o.owed || 0, strikes: o.strikes || 0, taxDay: o.taxDay ?? null });
      }
    } catch {
      // Fresh start.
    }
  }

  save() {
    try {
      const homes = {};
      for (const h of this.all()) homes[h.id] = { owed: h.owed || 0, strikes: h.strikes || 0, taxDay: h.taxDay ?? null };
      localStorage.setItem(SAVE_KEY, JSON.stringify({ crimeLevel: this.crimeLevel, demand: this.demand, treasury: this.treasury, homes }));
    } catch {
      // Storage unavailable.
    }
  }

  // Every property: the homes for sale, and the safehouse.
  all() {
    const B = this.game.bank;
    return B ? [B.safeHome, ...B.homes] : [];
  }

  base(h) {
    return h.id === 'safe' ? 5000 : h.price;
  }

  districtOf(h) {
    return districtAt(h.x, h.z);
  }

  // A crime happened at (x, z): that district's crime level goes up.
  crime(x, z, w) {
    const d = districtAt(x, z);
    this.crimeLevel[d] = Math.min(60, (this.crimeLevel[d] || 0) + w);
  }

  crimeType(type, x, z) {
    const w = CRIME_WEIGHT[type] ?? 1;
    if (w) this.crime(x, z, w);
  }

  // What drives a property's value right now: [{ label, k }] where k is the multiplier.
  factors(h) {
    const game = this.game;
    const d = this.districtOf(h);
    const out = [];
    const dem = this.demand[d] || 1;
    out.push({ label: dem > 1.04 ? `${d} in demand` : dem < 0.96 ? `${d} out of favor` : null, k: dem });
    const w = game.economy ? game.economy.propertyFactor(d) : 1;
    out.push({ label: w > 1.03 ? 'neighborhood doing better' : w < 0.97 ? 'neighborhood struggling' : null, k: w });
    const c = this.crimeLevel[d] || 0;
    const ck = 1 - 0.35 * Math.min(1, c / 30);
    out.push({ label: c > 12 ? 'high crime' : c > 4 ? 'some crime' : null, k: ck });
    const T = game.turfWars;
    const t = T.turfAt(h.x, h.z);
    if (t && t.id !== 'crew' && GANGS[t.id]) out.push({ label: `${GANGS[t.id].name} turf`, k: 0.9 });
    if (T.wars.some((w) => w.state === 'active' && districtAt(w.block.cx, w.block.cz) === d)) out.push({ label: 'turf war nearby', k: 0.92 });
    const ap = game.president ? game.president.approval : 60;
    out.push({ label: ap > 70 ? 'city doing well' : ap < 35 ? 'city in trouble' : null, k: 0.9 + ap / 500 });
    return out;
  }

  // Current market value (with sales tax in it), a round number.
  price(h) {
    const k = this.factors(h).reduce((m, f) => m * f.k, 1);
    return roundPrice(this.base(h) * Math.max(0.55, Math.min(1.6, k)));
  }

  salesTax(price) {
    return Math.round(price - price / (1 + SALES_TAX));
  }

  // What you get for it: the price less the sales tax in it.
  sellPrice(h) {
    const p = this.price(h);
    return p - this.salesTax(p);
  }

  weeklyTax(h) {
    return Math.round((this.price(h) * PROPERTY_TAX) / 10) * 10;
  }

  dailyUpkeep(h) {
    const v = this.price(h);
    let total = 0;
    let lo = 0;
    for (const [hi, rate] of UPKEEP_BRACKETS) {
      if (v > lo) total += (Math.min(v, hi) - lo) * rate;
      lo = hi;
    }
    return Math.max(1, Math.round(total));
  }

  trend(h) {
    const p = this.prev[h.id];
    const now = this.price(h);
    return p == null || p === now ? '' : now > p ? '▲' : '▼';
  }

  why(h) {
    const f = this.factors(h).filter((x) => x.label);
    return f.length ? f.map((x) => `${x.k >= 1 ? '+' : '−'} ${x.label}`).join(', ') : 'steady';
  }

  // Bought: the sales tax goes to the city.
  bought(h, price) {
    this.treasury += this.salesTax(price);
    h.taxDay = this.game.bank.days;
    h.owed = 0;
    h.strikes = 0;
    this.save();
  }

  sold(h, price) {
    this.treasury += this.salesTax(price);
    h.owed = 0;
    h.strikes = 0;
    this.save();
  }

  // ---- Each frame ----
  update(dt) {
    const game = this.game;
    for (const d of DISTRICTS) {
      this.crimeLevel[d] -= this.crimeLevel[d] * CRIME_FADE * (game.budget ? game.budget.crimeFade() : 1) * dt;
      // Demand drifts back toward normal, slowly.
      this.demand[d] += (1 - this.demand[d]) * dt / 1800;
    }
    // Now and then something moves a district's property values.
    this.eventT -= dt;
    if (this.eventT <= 0) {
      this.eventT = rand(240, 420);
      const d = pick(DISTRICTS);
      const [t, k] = pick(EVENTS);
      this.demand[d] = Math.max(0.8, Math.min(1.25, this.demand[d] + k));
      game.hud.news(`${t.replace('{d}', d)}: home prices ${k > 0 ? 'up' : 'down'}`, 'info');
    }
    // Trend arrows: compare to a minute ago.
    this.snapT -= dt;
    if (this.snapT <= 0) {
      this.snapT = 60;
      for (const h of this.all()) this.prev[h.id] = this.price(h);
      this.save();
    }
  }

  // A new game day (from the bank's clock): upkeep today; property tax once a week.
  newDay(day) {
    const game = this.game;
    let upkeep = 0;
    let tax = 0;
    const byDistrict = {}; // your upkeep, by where it was paid (it goes to the service companies)
    const t0 = this.treasury;
    for (const h of game.bank.ownedHomes()) {
      const behind = h.owed || 0; // owed before today's bills
      const paid = this.charge(h, this.dailyUpkeep(h), false);
      upkeep += paid;
      const d = this.districtOf(h);
      byDistrict[d] = (byDistrict[d] || 0) + paid;
      if (h.taxDay == null) h.taxDay = day;
      if (day - h.taxDay >= TAX_EVERY) {
        h.taxDay = day;
        // Still owing from last week: a strike. Two strikes and the city takes it.
        if (behind > 0) {
          h.strikes = (h.strikes || 0) + 1;
          if (h.strikes >= 2) {
            this.seize(h);
            continue;
          }
          game.hud.text('City Tax Office', `Your ${h.name.toLowerCase()} is behind ${money(h.owed)}. Pay it or the city takes the property.`);
        }
        tax += this.charge(h, this.weeklyTax(h), true);
      }
    }
    if (tax) game.hud.text('City Tax Office', `Property tax: ${money(tax)} paid. Thank you.`);
    if (upkeep >= 25) game.hud.toast(`Upkeep on your properties: -${money(upkeep)}`);
    game.economy?.newDay(byDistrict);
    game.budget?.newDay(this.treasury - t0); // then the city spends it
    this.save();
  }

  // Take a bill out of the bank, then the home's stash; the rest is owed. Returns what was paid.
  charge(h, amount, isTax) {
    const B = this.game.bank;
    let left = amount;
    const fromBank = Math.min(B.balance, left);
    B.balance -= fromBank;
    left -= fromBank;
    const fromStash = Math.min(h.stash, left);
    h.stash -= fromStash;
    left -= fromStash;
    if (left > 0) h.owed = (h.owed || 0) + left;
    const paid = amount - left;
    this.treasury += isTax ? paid : paid - paid / (1 + SALES_TAX); // the tax on services is in the upkeep bill
    B.save();
    return paid;
  }

  // Pay what you owe on a home (bank, then cash).
  payOwed(h) {
    const game = this.game;
    const n = h.owed || 0;
    if (!n) return;
    if (!game.bank.pay(n)) {
      game.hud.toast(`You need ${money(n)} (bank + cash)`, '#ff8080');
      return;
    }
    this.treasury += n;
    h.owed = 0;
    h.strikes = 0;
    game.hud.toast(`Paid ${money(n)} in back taxes and bills`);
    game.save();
    this.save();
  }

  seize(h) {
    const game = this.game;
    const lost = h.stash;
    h.stash = 0;
    h.owed = 0;
    h.strikes = 0;
    if (h.id === 'safe') game.shops.safehouse = false;
    else h.owned = false;
    game.bank.refreshSigns();
    game.hud.text('City Tax Office', `Your ${h.name.toLowerCase()} has been seized for unpaid taxes.`);
    game.hud.toast(`The city seized your ${h.name.toLowerCase()}${lost ? ` (and ${money(lost)} in its stash)` : ''}`, '#ff8080');
    game.hud.news(`City seizes ${h.name.toLowerCase()} on ${streetAt(h.x, h.z)} over unpaid taxes`, 'info');
    game.shops.save();
    game.bank.save();
    this.save();
  }

  // ---- Phone app ----
  rows() {
    const game = this.game;
    const B = game.bank;
    const out = [];
    const mine = B.ownedHomes();
    if (mine.length) {
      const tax = mine.reduce((n, h) => n + this.weeklyTax(h), 0);
      const up = mine.reduce((n, h) => n + this.dailyUpkeep(h), 0);
      const owed = mine.reduce((n, h) => n + (h.owed || 0), 0);
      out.push({ head: true, label: 'Your properties', right: '' });
      out.push({ label: `Bills: ${money(tax)} tax a week · ${money(up)} upkeep a day`, right: owed ? `owe ${money(owed)}` : '', detail: `Taken from the bank, then that home's stash. ${owed ? 'You owe money on a property: pay it at the property or the city seizes it after two missed weeks.' : 'All paid up.'}` });
    }
    out.push({ head: true, label: 'Property market', right: '' });
    for (const h of this.all()) {
      const p = this.price(h);
      const owned = h.owned;
      out.push({
        label: `${h.name} · ${this.districtOf(h)}${owned ? ' (yours)' : ''}`,
        right: `${money(p)} ${this.trend(h)}`,
        detail: `${this.why(h)}. ${owned ? `Sells for ${money(this.sellPrice(h))}. Stash ${money(h.stash)}.` : `Includes ${money(this.salesTax(p))} sales tax.`} Property tax ~${money(this.weeklyTax(h))}/week, upkeep ${money(this.dailyUpkeep(h))}/day. ✕ sets a waypoint.`,
        x: h.x,
        z: h.z,
      });
    }
    return out;
  }

  // Treasury line for the pause menu.
  summary() {
    return `City treasury: ${money(this.treasury)} in taxes`;
  }
}

