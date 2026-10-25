import * as THREE from 'three';
import { DISTRICTS, COMPANIES, WEALTH_BASE, districtOfBlock } from './districts.js';
import { storefront, signTexture } from './shops.js';
import { streetAt, districtAt } from './city.js';
import { GANGS } from './turf.js';
import { SALES_TAX } from './property.js';
import { dist } from './util.js';
import { TUNE } from './tuning.js';

// Where upkeep money goes, so it stays in the city's economy.
// Every game day, everyone with a home pays upkeep: you, and the city's residents (each block's
// worth, more in richer districts). That money is split between four service companies by what
// they do (power & water 40%, maintenance 25%, cleaning 20%, internet 15%). Of each company's take:
// - 6% is tax on services: to the city treasury (already inside the bills).
// - 30% of the rest is profit: to whoever owns the company (you can buy one at its office), or to
//   the city if nobody does (city-run services).
// - 10% of the rest is protection money: to whichever gang holds the block the office is on
//   (your crew's goes into the turf stash). No gang there: the owner keeps it.
// - The rest is wages and supplies: it's spent in the neighborhoods the money came from, which
//   makes them better off.
// Neighborhood wealth (per district, around its starting level): goes up when there's more
// spending there, down with crime. Wealthier districts pay more for drugs and their homes are
// worth more.
const SAVE_KEY = 'crimecity.economy.v1';
// Numbers live in tuning.js.
const PER_BLOCK = TUNE.residentUpkeepPerBlock;
const PROFIT = TUNE.companyProfit;
const PROTECTION = TUNE.protection;
const PRICE_DAYS = TUNE.companyPriceDays;
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const roundPrice = (v) => {
  const step = Math.max(100, 10 ** (Math.floor(Math.log10(Math.max(1, v))) - 2));
  return Math.max(500, Math.round(v / step) * step);
};

export class Economy {
  constructor(game) {
    this.game = game;
    const city = game.city;
    const scene = game.scene;
    this.wealth = {}; // district -> multiplier on its base wealth (0.75..1.25)
    this.trend = {};
    for (const d of DISTRICTS) this.wealth[d] = 1;
    this.gangIncome = { kings: 0, vipers: 0, crew: 0 };
    this.crimeNorm = {}; // each district's usual crime level (wealth reacts to crime above it)
    this.profitTaxOn = false; // the city taxes private service companies' profits
    this.blocks = {}; // district -> number of blocks
    for (const b of city.blocks) this.blocks[b.district] = (this.blocks[b.district] || 0) + 1;

    this.companies = COMPANIES.map((c) => {
      const f = storefront(city, c.block);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.8), new THREE.MeshBasicMaterial({ map: signTexture(c.name.toUpperCase(), '#1c2833', c.color) }));
      sign.position.set(0, Math.min(f.h - 1, 5.2), -0.07);
      sign.rotation.y = Math.PI;
      f.group(scene).add(sign);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.98, 1.2, 32), new THREE.MeshBasicMaterial({ color: c.color, transparent: true, opacity: 0.7, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(f.x, city.groundY(f.x, f.z) + 0.05, f.z);
      scene.add(ring);
      return { ...c, x: f.x, z: f.z, blockRef: f.block, street: streetAt(f.x, f.z), district: c.block.district, owned: false, lastProfit: 0, lastProtection: 0 };
    });
    this.load();
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!s) return;
      Object.assign(this.wealth, s.wealth || {});
      Object.assign(this.gangIncome, s.gangIncome || {});
      Object.assign(this.crimeNorm, s.crimeNorm || {});
      this.profitTaxOn = !!s.profitTaxOn;
      for (const c of this.companies) if (s.owned?.[c.id]) c.owned = true;
    } catch {
      // Fresh start.
    }
  }

  save() {
    try {
      const owned = {};
      for (const c of this.companies) owned[c.id] = c.owned;
      localStorage.setItem(SAVE_KEY, JSON.stringify({ wealth: this.wealth, gangIncome: this.gangIncome, owned, crimeNorm: this.crimeNorm, profitTaxOn: this.profitTaxOn }));
    } catch {
      // Storage unavailable.
    }
  }

  // How well-off a district is now (its base × how it's doing).
  level(d) {
    return (WEALTH_BASE[d] || 1) * (this.wealth[d] || 1);
  }

  levelName(d) {
    const v = this.level(d);
    return v >= 1.35 ? 'Rich' : v >= 1.1 ? 'Well-off' : v >= 0.9 ? 'Comfortable' : v >= 0.7 ? 'Getting by' : 'Struggling';
  }

  // What residents of a district pay in upkeep per game day.
  residentUpkeep(d) {
    return (this.blocks[d] || 0) * PER_BLOCK * this.level(d);
  }

  // Drug buyers in richer districts spend a bit more (about −6% in the Projects, +6% downtown money).
  spend(x, z) {
    return Math.max(0.9, Math.min(1.12, 0.85 + 0.15 * this.level(districtAt(x, z))));
  }

  // Home values move with the neighborhood's fortunes.
  propertyFactor(d) {
    return Math.pow(this.wealth[d] || 1, 0.6);
  }

  // The gang holding a company's office block (or null).
  protector(c) {
    const t = this.game.turfWars.turfAt(c.x, c.z);
    return t && GANGS[t.id] && !GANGS[t.id].hidden ? t.id : null;
  }

  // A company's take per game day at today's spending (for its price and the phone).
  dailyIncome(c, playerUpkeep = 0) {
    const total = DISTRICTS.reduce((n, d) => n + this.residentUpkeep(d), 0) + playerUpkeep;
    return total * c.share;
  }

  dailyProfit(c) {
    const net = this.dailyIncome(c) / (1 + SALES_TAX);
    // No gang on the block: the owner keeps what would have gone to protection.
    const profit = net * PROFIT + (this.protector(c) ? 0 : net * PROTECTION);
    return profit * (c.owned && this.profitTaxOn ? 1 - TUNE.profitTax : 1);
  }

  price(c) {
    return roundPrice(this.dailyProfit(c) * PRICE_DAYS);
  }

  sellPrice(c) {
    const p = this.price(c);
    return Math.round(p / (1 + SALES_TAX));
  }

  // ---- The day's money ----
  // playerUpkeep: district -> what you paid in upkeep today.
  newDay(playerUpkeep) {
    const game = this.game;
    const P = game.property;
    const resident = {};
    let total = 0;
    for (const d of DISTRICTS) {
      resident[d] = this.residentUpkeep(d);
      total += resident[d] + (playerUpkeep[d] || 0);
    }
    // Tax on the residents' bills (yours was counted when you paid).
    const residentTotal = DISTRICTS.reduce((n, d) => n + resident[d], 0);
    P.treasury += residentTotal - residentTotal / (1 + SALES_TAX);
    let mine = 0;
    let stash = 0;
    // Private owners control most of the city's services: the city taxes their profits (unless
    // a libertarian is in office).
    const privateShare = this.companies.filter((c) => c.owned).reduce((n, c) => n + c.share, 0);
    const taxIt = privateShare >= TUNE.privateControlShare && game.president.p.side !== 'lib' && !game.president.p.nationalize;
    if (taxIt !== this.profitTaxOn) {
      this.profitTaxOn = taxIt;
      game.hud.news(taxIt ? `City Hall slaps a ${Math.round(TUNE.profitTax * 100)}% tax on private utility profits` : 'City Hall drops the tax on private utility profits', 'info');
    }
    for (const c of this.companies) {
      const net = (total * c.share) / (1 + SALES_TAX);
      let profit = net * PROFIT;
      const g = this.protector(c);
      const prot = net * PROTECTION;
      if (g) this.gangIncome[g] = (this.gangIncome[g] || 0) + prot; // (for gang strength later)
      if (g === 'crew') stash += prot;
      else if (!g) profit += prot; // nobody to pay off
      c.lastProfit = Math.round(profit);
      c.lastProtection = g ? Math.round(prot) : 0;
      if (c.owned && this.profitTaxOn) {
        P.treasury += profit * TUNE.profitTax;
        profit *= 1 - TUNE.profitTax;
      }
      if (c.owned) mine += profit;
      else P.treasury += profit; // city-run
    }
    if (mine > 0) {
      game.bank.balance += Math.round(mine);
      game.hud.text('Your companies', `Today's profit: ${money(mine)} (into the bank)`);
      game.bank.save();
    }
    if (stash > 0) {
      game.shops.stash += Math.round(stash);
      game.shops.bag.visible = true;
      game.hud.text(game.shops.homie(), `${this.companies.filter((c) => this.protector(c) === 'crew').map((c) => c.name).join(' & ')} paid up. ${money(stash)} in the stash`);
      game.shops.save();
    }
    // Neighborhoods: more spending lifts them, crime drags them down. Moves over a few days.
    for (const d of DISTRICTS) {
      const spendUp = Math.min(1, (playerUpkeep[d] || 0) / Math.max(1, resident[d]));
      // Crime compared to what's usual there (so everyday crime doesn't sink every district).
      const c = P.crimeLevel[d] || 0;
      if (this.crimeNorm[d] == null) this.crimeNorm[d] = c;
      const crime = Math.max(-0.5, Math.min(1, (c - this.crimeNorm[d]) / 30));
      this.crimeNorm[d] += (c - this.crimeNorm[d]) * TUNE.crimeNormRate;
      const target = Math.max(0.75, Math.min(1.25, 1 + TUNE.wealthSpendLift * spendUp - TUNE.wealthCrimeDrag * crime + (game.budget ? game.budget.wealthBonus(d) : 0)));
      const before = this.wealth[d];
      this.wealth[d] += (target - this.wealth[d]) * TUNE.wealthMove;
      this.trend[d] = this.wealth[d] > before + 0.005 ? '▲' : this.wealth[d] < before - 0.005 ? '▼' : '';
    }
    this.save();
  }

  // ---- On foot: company offices ----
  interact(a) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    for (const c of this.companies) {
      if (dist(px, pz, c.x, c.z) > 1.6) continue;
      const key = game.input.label('interact');
      game.prompt = c.owned ? `Press ${key} for ${c.name} (yours · ~${money(this.dailyProfit(c))}/day)` : `Press ${key} to look at buying ${c.name} (${money(this.price(c))})`;
      if (a.interactHeld && !game.interactWasHeld) game.shops.openCustom(c.name, () => this.items(c));
      return true;
    }
    return false;
  }

  items(c) {
    const game = this.game;
    const g = this.protector(c);
    const prot = g ? `${GANGS[g].name} collect protection here (10%).` : 'No gang on this block: no protection to pay.';
    const info = `${c.name} gets ${Math.round(c.share * 100)}% of everyone's upkeep (${c.what}). Profit about ${money(this.dailyProfit(c))} a game day. ${prot}`;
    if (!c.owned && game.president?.p.nationalize) {
      return [{ label: `${c.name} is city property`, price: 0, priceText: '', detail: `${info} Not for sale under the People's Republic.`, can: 'Not for sale', buy: () => {} }];
    }
    if (!c.owned) {
      const price = this.price(c);
      return [{
        label: `Buy ${c.name}`, price: 0, priceText: money(price), detail: `${info} Price includes ${money(price - price / (1 + SALES_TAX))} sales tax.`, can: true,
        buy: () => {
          if (!game.bank.pay(price)) return game.hud.toast(`You need ${money(price)} (bank + cash)`, '#ff8080');
          c.owned = true;
          game.property.treasury += price - price / (1 + SALES_TAX);
          game.hud.toast(`You own ${c.name}. Its profit goes into your bank every game day.`);
          game.hud.news(`${c.name} bought by a private investor`, 'info');
          game.shops.close();
          game.save();
          this.save();
        },
      }];
    }
    return [
      { label: 'Last day', price: 0, priceText: money(c.lastProfit || this.dailyProfit(c)), detail: info, can: true, buy: () => {} },
      {
        label: `Sell ${c.name}`, price: 0, priceText: money(this.sellPrice(c)), detail: `Market price ${money(this.price(c))}, less sales tax. The sale goes into the bank.`, can: true,
        buy: () => {
          const get = this.sellPrice(c);
          game.property.treasury += this.price(c) - get;
          game.bank.balance += get;
          c.owned = false;
          game.hud.toast(`Sold ${c.name}: +${money(get)} to the bank`);
          game.shops.close();
          game.bank.save();
          this.save();
        },
      },
    ];
  }

  // ---- Map and phone ----
  blips() {
    return this.companies.map((c) => [c.x, c.z, c.owned ? c.color : '#566573', '◆']);
  }

  legend(add) {
    for (const c of this.companies) add('blip', c.owned ? c.color : '#566573', '◆', `${c.name}${c.owned ? ' (yours)' : ` · ${money(this.price(c))}`}`, c.x, c.z);
  }

  rows() {
    const out = [{ head: true, label: 'Service companies', right: '' }];
    for (const c of this.companies) {
      const g = this.protector(c);
      out.push({
        label: `${c.name}${c.owned ? ' (yours)' : ''}`,
        right: c.owned ? `+${money(this.dailyProfit(c))}/day` : money(this.price(c)),
        detail: `${Math.round(c.share * 100)}% of the city's upkeep (${c.what}). Office on ${c.street}, ${c.district}. ${g ? `${GANGS[g].name} take 10% for protection.` : 'Nobody collecting protection.'} ${c.owned ? '' : 'Buy it at the office.'} ✕ sets a waypoint.`,
        x: c.x,
        z: c.z,
      });
    }
    out.push({ head: true, label: 'Neighborhoods', right: '' });
    for (const d of DISTRICTS) {
      out.push({ label: d, right: `${this.levelName(d)} ${this.trend[d] || ''}`, detail: `Richer neighborhoods pay more for drugs and their homes are worth more. Spending lifts a district; crime drags it down.` });
    }
    return out;
  }
}

