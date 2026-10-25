import { WEALTH_BASE } from './districts.js';
import { TUNE } from './tuning.js';

// The city budget: the treasury (taxes and city-run company profits) pays for the city every
// game day, the way the President wants.
// - Police: Cut / Normal / Boosted / Max. More money, more cops per wanted star, the helicopter
//   up sooner, fewer dirty cops (they're paid better). Cuts do the opposite.
// - Public works (roads, transit, parks): None / Normal / Big. Lifts every neighborhood.
// - Community programs: None / Some / Lots. Crime fades faster, and the poorest neighborhoods
//   get a lift.
// - The war on drugs and each gang crackdown cost money too.
// By default the President decides each day (tough when crime is high, building when it's quiet,
// cutting back when money is short). Set the budget yourself in the pause menu (President's
// orders) and you're in charge until you hand it back.
// Short on money? The city can borrow (the treasury goes below zero, with interest) down to a
// limit of a few days' income; past that, everything gets only part of its money (and part of its
// effect). Deep in debt, the President raises taxes (or cuts, depending on who they are). Debt
// and shortfalls both cost approval. All the numbers are in tuning.js.
const SAVE_KEY = 'crimecity.budget.v1';
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
export const LINES = {
  police: { name: 'Police', levels: ['Cut', 'Normal', 'Boosted', 'Max'], cost: TUNE.budget.police, mult: [0.6, 1, 1.3, 1.6] },
  works: { name: 'Public works', levels: ['None', 'Normal', 'Big'], cost: TUNE.budget.works, bonus: [-0.03, 0, 0.06] },
  community: { name: 'Community programs', levels: ['None', 'Some', 'Lots'], cost: TUNE.budget.community, fade: [1, 1.3, 1.7], lift: [0, 0.03, 0.06] },
};
const WAR_COST = TUNE.budget.war;
const CRACKDOWN_COST = TUNE.budget.crackdown;

export class CityBudget {
  constructor(game) {
    this.game = game;
    this.level = { police: 1, works: 1, community: 1 };
    this.auto = true; // the President decides
    this.funded = 1; // share of yesterday's budget the treasury covered
    this.lastSpend = 0;
    this.load();
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!s) return;
      Object.assign(this.level, s.level || {});
      this.auto = s.auto ?? true;
      this.funded = s.funded ?? 1;
    } catch {
      // Fresh start.
    }
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ level: this.level, auto: this.auto, funded: this.funded }));
    } catch {
      // Storage unavailable.
    }
  }

  // What today's budget costs.
  cost() {
    const game = this.game;
    let n = 0;
    for (const [k, L] of Object.entries(LINES)) n += L.cost[this.level[k]];
    n += WAR_COST[game.market.war || 0];
    n += Object.values(game.turfWars.crackdown || {}).filter(Boolean).length * CRACKDOWN_COST;
    return n;
  }

  // An upgrade only works as well as it's funded; a cut always bites.
  scaled(v) {
    return v > 1 ? 1 + (v - 1) * this.funded : v;
  }

  // ---- Effects other systems ask for ----
  policeMult() {
    let m = this.scaled(LINES.police.mult[this.level.police]);
    // A curfew (the Iron Fist): even more cops after dark.
    const P = this.game.president;
    if (P && P.p.curfew) {
      const t = this.game.clockMinutes();
      if (t >= 22 * 60 || t < 6 * 60) m *= 1.3;
    }
    return m;
  }

  // Better-paid police: fewer dirty cops.
  dirtyMult() {
    return Math.max(0.5, 1.4 - 0.4 * this.policeMult()) * (this.game.president?.p.dirtyMult || 1); // the Boss: cops on the take
  }

  crimeFade() {
    return this.scaled(LINES.community.fade[this.level.community]);
  }

  // Extra lift (or drag) on a district's wealth.
  wealthBonus(d) {
    const w = LINES.works.bonus[this.level.works];
    const c = (WEALTH_BASE[d] || 1) < 1 ? LINES.community.lift[this.level.community] : 0;
    return (w > 0 ? w * this.funded : w) + c * this.funded;
  }

  // ---- The President's choices ----
  decide() {
    const game = this.game;
    const P = game.president;
    const T = game.property.treasury;
    const crime = P.crimeLevel;
    const income = Math.max(1000, this.lastIncome || 3000);
    let police = crime > 60 ? 3 : crime > 35 ? 2 : 1;
    let works = crime < 15 ? 2 : 1;
    let community = crime > 35 ? 2 : 1;
    // The President's leanings (politics.js): their own priorities, and maybe tougher on crime.
    const p = P.p;
    if (p.budget) {
      ({ police, works, community } = p.budget);
      if (p.toughOnCrime && crime > 35) police = Math.min(3, police + 1);
    }
    const reserve = T / income; // days of income in the bank
    // Extremes spend what they want, money or not.
    if (!p.frugal) {
      this.setLevels(police, works, community);
      return;
    }
    // Money short: cut back, building first.
    if (reserve < 1) {
      works = Math.min(works, 1);
      community = Math.min(community, 1);
      if (reserve < 0.4) {
        works = 0;
        police = Math.min(police, 1);
      }
    }
    // Stay within what the city can afford: about today's income plus a bit of the savings.
    // Cut building first, then programs, then police (never below normal unless broke).
    const fixed = WAR_COST[game.market.war || 0] + Object.values(game.turfWars.crackdown || {}).filter(Boolean).length * CRACKDOWN_COST;
    // In debt: spend a bit under income to pay it down. Saved up: spend some of the savings.
    const afford = T < 0 ? income * 0.9 : income * 1.0 + T * 0.15;
    const total = () => LINES.police.cost[police] + LINES.works.cost[works] + LINES.community.cost[community] + fixed;
    while (total() > afford) {
      if (works > 1) works--;
      else if (community > 1) community--;
      else if (police > (p.toughOnCrime && p.budget && reserve > -TUNE.debtLimitDays * 0.6 ? p.budget.police : 1)) police--; // tough-on-crime keeps its cops (until the debt gets deep)
      else if (works > 0) works--;
      else if (community > 0) community--;
      else if (police > 0 && reserve < -TUNE.debtLimitDays * 0.6) police--;
      else break;
    }
    this.setLevels(police, works, community);
  }

  setLevels(police, works, community) {
    const game = this.game;
    const changed = police !== this.level.police || works !== this.level.works || community !== this.level.community;
    this.level = { police, works, community };
    if (changed) {
      const parts = Object.entries(LINES).map(([k, L]) => `${L.name.toLowerCase()} ${L.levels[this.level[k]].toLowerCase()}`).join(', ');
      game.hud.news(`President sets the city budget: ${parts}`, 'info');
    }
  }

  // ---- Each game day ----
  newDay(income) {
    const game = this.game;
    const P = game.property;
    this.lastIncome = income;
    if (this.auto) this.decide();
    // Interest on what the city owes.
    if (P.treasury < 0) P.treasury += P.treasury * TUNE.debtInterest;
    const ref = Math.max(1000, income);
    const limit = -ref * TUNE.debtLimitDays;
    const need = this.cost();
    const pay = Math.min(need, Math.max(0, P.treasury - limit)); // borrow down to the limit
    this.funded = need > 0 ? pay / need : 1;
    P.treasury -= pay;
    this.lastSpend = pay;
    if (this.funded < 0.98) game.hud.news(`City hits its debt limit: only ${Math.round(this.funded * 100)}% of the budget paid — services cut`, 'info');
    // Taxes up when the debt gets deep, back down once there's money saved.
    const Pr = game.president;
    if (P.treasury < -ref * TUNE.raiseTaxesAtDebtDays) Pr.raiseTaxes();
    else if (P.treasury > ref * TUNE.lowerTaxesAtSavedDays) Pr.lowerTaxes();
    this.save();
    P.save();
  }

  // Click a line in the pause menu: step it (and take the budget over from the President).
  step(k) {
    const L = LINES[k];
    this.level[k] = (this.level[k] + 1) % L.levels.length;
    this.auto = false;
    this.save();
  }

  toggleAuto() {
    this.auto = !this.auto;
    if (this.auto) {
      this.decide();
      this.game.president.orders();
    }
    this.save();
  }

  // Pause-menu HTML.
  html() {
    const game = this.game;
    const T = game.property.treasury;
    const rows = Object.entries(LINES).map(([k, L]) => {
      const i = this.level[k];
      return `<button class="cd budget lv${i}" data-line="${k}"><span class="sw"></span>${L.name}<b>${L.levels[i].toUpperCase()}</b><i>${money(L.cost[i])}/day</i></button>`;
    }).join('');
    const short = (this.funded < 0.98 ? ` · <span class="bad">only ${Math.round(this.funded * 100)}% funded</span>` : '') + (T < 0 ? ' · <span class="bad">in debt</span>' : '') + (game.president.taxBoost > 1.001 ? ` · taxes +${Math.round((game.president.taxBoost - 1) * 100)}%` : '');
    return `<div class="ap-why budget-head"><span>City treasury ${money(T)} · budget ${money(this.cost())}/day${short}</span></div>`
      + `<button class="cd budget-auto ${this.auto ? 'on' : ''}"><span class="sw"></span>Budget<b>${this.auto ? 'THE PRESIDENT DECIDES' : 'YOU DECIDE'}</b><i>${this.auto ? 'Budget, war on drugs and crackdowns. Click any of them to take over' : 'Click to hand the orders back to the President'}</i></button>`
      + rows;
  }
}

