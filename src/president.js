import { personality, newLeader } from './politics.js';
import { setTaxes } from './property.js';
import { TUNE } from './tuning.js';
// The President's approval rating, driven by crime.
// - Crime level: every crime adds to it (weighted by how bad it is: a cop killed counts far
//   more than a carjacking), and it fades over about 10 minutes of play.
// - Approval drifts toward a target: 65% in a quiet city, falling as the crime level climbs.
//   Arrests and police wins give a small boost; criminals getting away cost a little.
// - Policy: crackdowns on gangs and the war on drugs look strong when crime is high (approval
//   up) and heavy-handed when the city is quiet (approval down).
// City News reports big moves, and the pause menu shows the rating and what's driving it.
const SAVE_KEY = 'crimecity.president.v1';
const TERM = 7; // game days in a term (one game week, 5 h 36 min of play)
const FADE = 1 / 600; // crime level fades with a ~10 minute time constant
export const CRIME_WEIGHT = {
  assault: 1, hitAndRun: 1.5, carjack: 1.5, assaultCop: 3, runOverCop: 4, stealCopCar: 2,
  robberyAlarm: 0, robbery: 3, gunfire: 1, murder: 4, copKilled: 8, gangKill: 2, explosion: 3,
  drugRaid: 1, drugRaidBig: 2, drugDeal: 0.5,
};
const LEVELS = [[0, 'Low'], [15, 'Moderate'], [35, 'High'], [60, 'Out of control']];

export class President {
  constructor(game) {
    this.game = game;
    this.crimeLevel = 0;
    this.approval = 60;
    this.recent = {}; // what's been driving it: label -> weight (fades too)
    this.reported = 60;
    this.leader = null; // { name, id } — see politics.js
    this.termStart = 0;
    this.taxBoost = 1; // taxes raised to pay down city debt (×1 to ×1.5)
    this.load();
    if (!this.leader) this.takeOffice(newLeader(), 0, true);
    else this.applyPolicy();
  }

  // ---- Who's in office ----
  get p() {
    return personality(this.leader?.id);
  }

  title() {
    const p = this.p;
    return `President ${this.leader.name} · ${p.party} (${p.leaning}${p.extreme ? ', extreme' : ''}) · ${p.title}`;
  }

  takeOffice(leader, day, quiet = false) {
    const game = this.game;
    this.leader = leader;
    this.termStart = day;
    this.taxBoost = 1; // a fresh start on taxes
    this.approval = Math.max(this.approval, 55);
    this.reported = Math.round(this.approval);
    const p = this.p;
    this.applyPolicy();
    if (!quiet) {
      game.hud.news(`${leader.name} (${p.party}) sworn in as President: ${p.blurb}`, p.extreme ? 'crime' : 'info');
    }
    // A People's Republic buys out the private service companies (at market price).
    if (p.nationalize && game.economy) {
      for (const c of game.economy.companies) {
        if (!c.owned) continue;
        const get = game.economy.sellPrice(c);
        c.owned = false;
        game.bank.balance += get;
        game.hud.text('City Hall', `${c.name} is now city property. ${get.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} has been paid into your account.`);
      }
      game.economy.save();
      game.bank.save();
    }
    if (game.budget) game.budget.auto = true; // a new President sets their own orders
    this.orders();
    this.save();
  }

  // Tax rates follow whoever is in office.
  applyPolicy() {
    setTaxes(this.p.salesTax * this.taxBoost, this.p.propertyTax * this.taxBoost);
  }

  // The city is deep in debt: raise taxes (libertarians won't — they cut instead, in the budget).
  raiseTaxes() {
    const p = this.p;
    if (p.side === 'lib' || this.taxBoost >= TUNE.maxTaxBoost - 1e-6) return;
    this.taxBoost = Math.min(TUNE.maxTaxBoost, this.taxBoost + TUNE.taxStep);
    this.applyPolicy();
    this.game.hud.news(`President ${this.leader.name} raises taxes ${Math.round((this.taxBoost - 1) * 100)}% to pay down the city's debt`, 'info');
    this.save();
  }

  lowerTaxes() {
    if (this.taxBoost <= 1) return;
    this.taxBoost = Math.max(1, this.taxBoost - TUNE.taxStep);
    this.applyPolicy();
    this.game.hud.news(this.taxBoost > 1 ? `City finances recover: President trims the tax hike to ${Math.round((this.taxBoost - 1) * 100)}%` : 'City finances recover: President ends the tax hike', 'good');
    this.save();
  }

  // The President's standing orders: the war on drugs and gang crackdowns (unless you've taken
  // the orders over in the pause menu).
  orders() {
    const game = this.game;
    if (game.budget && !game.budget.auto) return;
    const p = this.p;
    const high = this.crimeLevel > 35;
    const war = high ? p.warHigh : p.war;
    if (game.market && (game.market.war || 0) !== war) game.market.setWar(war);
    const T = game.turfWars;
    if (!T) return;
    const gangs = ['kings', 'vipers', 'crew'];
    let want = [];
    if (p.crackdown === 'all') want = gangs;
    else if (p.crackdown === 'worst' && high) want = [['kings', 'vipers'].sort((a, b) => T.count(b) - T.count(a))[0]];
    for (const g of gangs) T.setCrackdown(g, want.includes(g));
  }

  // A new game day: an election at the end of each term (a game week); then today's orders.
  newDay(day) {
    const game = this.game;
    if (day - this.termStart >= TERM) {
      const ap = Math.round(this.approval);
      if (ap >= 50) {
        this.termStart = day;
        game.hud.news(`${this.leader.name} re-elected with ${ap}% approval`, 'good');
      } else {
        const old = this.leader.name;
        const next = newLeader(this.p.side);
        game.hud.news(`${old} voted out (${ap}% approval)`, 'info');
        this.takeOffice(next, day);
      }
    }
    this.orders();
    // The Boss skims off the top.
    if (this.p.skim && game.property) {
      const take = Math.round(game.property.treasury * this.p.skim);
      game.property.treasury -= take;
      if (take > 500 && Math.random() < 0.3) game.hud.news(`Auditors can't account for $${take.toLocaleString('en-US')} in city funds`, 'info');
    }
    this.save();
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (s) Object.assign(this, { crimeLevel: s.crimeLevel || 0, approval: s.approval ?? 60, recent: s.recent || {}, reported: s.approval ?? 60, leader: s.leader || null, termStart: s.termStart || 0, taxBoost: s.taxBoost || 1 });
    } catch {
      // Fresh term.
    }
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ crimeLevel: this.crimeLevel, approval: this.approval, recent: this.recent, leader: this.leader, termStart: this.termStart, taxBoost: this.taxBoost }));
    } catch {
      // Storage unavailable.
    }
  }

  // Something criminal happened (by anyone).
  crime(type, label) {
    const w = CRIME_WEIGHT[type] ?? 1;
    if (!w) return;
    this.add(w, label || type);
  }

  add(w, label) {
    this.crimeLevel = Math.min(120, this.crimeLevel + w);
    this.recent[label] = (this.recent[label] || 0) + w;
  }

  // Good news for the President: an arrest, a raid, a sweep.
  win(points, label) {
    this.approval = Math.min(95, this.approval + points);
    this.recent[label] = (this.recent[label] || 0) - points;
  }

  // Bad news that isn't a crime count: a suspect getting away, etc.
  loss(points, label) {
    this.approval = Math.max(5, this.approval - points);
    this.recent[label] = (this.recent[label] || 0) + points;
  }

  // How tough the President is being right now (crackdowns + war on drugs).
  toughness() {
    const T = this.game.turfWars;
    const crackdowns = Object.values(T.crackdown || {}).filter(Boolean).length;
    return crackdowns + (this.game.market.war || 0);
  }

  // Where approval is heading: crime, the city's finances, taxes and how the neighborhoods are
  // doing (weights in tuning.js).
  target() {
    const A = TUNE.approval;
    const game = this.game;
    const c = this.crimeLevel;
    let t = A.base - A.crimePerPoint * Math.max(0, c - 10);
    // Being tough reads well when crime is up and heavy-handed when it's quiet.
    const tough = this.toughness();
    t += tough * (c > 30 ? 4 : c < 10 ? -4 : 1);
    if (game.budget) t -= A.shortfall * (1 - game.budget.funded);
    if (game.property && game.property.treasury < 0) t -= A.inDebt;
    t -= A.taxes * (this.taxBoost - 1);
    const E = game.economy;
    if (E) {
      const ds = Object.keys(E.wealth);
      t += A.wealth * (ds.reduce((n, d) => n + E.wealth[d], 0) / ds.length - 1);
    }
    if (game.bank && game.bank.days - this.termStart < 2) t += A.honeymoon;
    return Math.max(5, Math.min(95, t));
  }

  // What's moving approval right now (for the pause menu and the debug panel).
  approvalWhy() {
    const A = TUNE.approval;
    const game = this.game;
    const out = [];
    const c = this.crimeLevel;
    if (c > 10) out.push(['crime', -A.crimePerPoint * (c - 10)]);
    if (game.budget && game.budget.funded < 0.98) out.push(['budget shortfall', -A.shortfall * (1 - game.budget.funded)]);
    if (game.property && game.property.treasury < 0) out.push(['city in debt', -A.inDebt]);
    if (this.taxBoost > 1) out.push(['tax hike', -A.taxes * (this.taxBoost - 1)]);
    const E = game.economy;
    if (E) {
      const ds = Object.keys(E.wealth);
      const w = A.wealth * (ds.reduce((n, d) => n + E.wealth[d], 0) / ds.length - 1);
      if (Math.abs(w) > 0.5) out.push([w > 0 ? 'neighborhoods doing well' : 'neighborhoods struggling', w]);
    }
    return out;
  }

  levelName() {
    let name = LEVELS[0][1];
    for (const [min, n] of LEVELS) if (this.crimeLevel >= min) name = n;
    return name;
  }

  // Biggest things driving the rating lately.
  drivers() {
    return Object.entries(this.recent).filter(([, w]) => Math.abs(w) >= 0.5).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);
  }

  update(dt) {
    const game = this.game;
    this.crimeLevel = Math.max(0, this.crimeLevel - this.crimeLevel * FADE * (game.budget ? game.budget.crimeFade() : 1) * dt); // community programs help
    for (const k of Object.keys(this.recent)) {
      this.recent[k] -= this.recent[k] * FADE * dt;
      if (Math.abs(this.recent[k]) < 0.2) delete this.recent[k];
    }
    // Approval moves toward where the public is (a point every ~10 seconds at most).
    const t = this.target();
    const step = Math.min(Math.abs(t - this.approval), dt * 0.02); // about a point every 50 s: opinion shifts over a game day
    this.approval += Math.sign(t - this.approval) * step;
    // Big moves make the news.
    const a = Math.round(this.approval);
    if (Math.abs(a - this.reported) >= 8) {
      const up = a > this.reported;
      this.reported = a;
      const why = this.drivers().find(([, w]) => (up ? w < 0 : w > 0));
      game.hud.news(up ? `President's approval climbs to ${a}%${why ? ` (${why[0]})` : ''}` : `President's approval falls to ${a}%${why ? ` amid ${why[0].toLowerCase()}` : ''}`, up ? 'good' : 'info');
    }
    this.saveT = (this.saveT || 0) - dt;
    if (this.saveT <= 0) {
      this.saveT = 10;
      this.save();
    }
  }
}
