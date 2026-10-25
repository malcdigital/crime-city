import { WEALTH_BASE } from './districts.js';

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
// Can't cover the day? Everything gets part of its money (and its effect), and the President's
// approval takes a hit.
const SAVE_KEY = 'crimecity.budget.v1';
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
export const LINES = {
  police: { name: 'Police', levels: ['Cut', 'Normal', 'Boosted', 'Max'], cost: [0, 1500, 3000, 5000], mult: [0.6, 1, 1.3, 1.6] },
  works: { name: 'Public works', levels: ['None', 'Normal', 'Big'], cost: [0, 1000, 2500], bonus: [-0.03, 0, 0.06] },
  community: { name: 'Community programs', levels: ['None', 'Some', 'Lots'], cost: [0, 800, 2000], fade: [1, 1.3, 1.7], lift: [0, 0.03, 0.06] },
};
const WAR_COST = [0, 1500, 3500];
const CRACKDOWN_COST = 600;

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
    return this.scaled(LINES.police.mult[this.level.police]);
  }

  // Better-paid police: fewer dirty cops.
  dirtyMult() {
    return Math.max(0.5, 1.4 - 0.4 * this.policeMult());
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
    // Money short: cut back, building first.
    const reserve = T / income; // days of income in the bank
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
    const afford = income * 1.05 + T * 0.15;
    const total = () => LINES.police.cost[police] + LINES.works.cost[works] + LINES.community.cost[community] + fixed;
    while (total() > afford) {
      if (works > 1) works--;
      else if (community > 1) community--;
      else if (police > 1) police--;
      else if (works > 0) works--;
      else if (community > 0) community--;
      else if (police > 0 && reserve < 0.4) police--;
      else break;
    }
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
    const need = this.cost();
    const pay = Math.min(need, Math.max(0, P.treasury));
    this.funded = need > 0 ? pay / need : 1;
    P.treasury -= pay;
    this.lastSpend = pay;
    if (this.funded < 0.98) {
      game.president.loss(2, 'Budget shortfall');
      game.hud.news(`City can only cover ${Math.round(this.funded * 100)}% of its budget — services cut`, 'info');
    }
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
    if (this.auto) this.decide();
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
    const short = this.funded < 0.98 ? ` · <span class="bad">only ${Math.round(this.funded * 100)}% funded</span>` : '';
    return `<div class="ap-why budget-head"><span>City treasury ${money(T)} · budget ${money(this.cost())}/day${short}</span></div>`
      + `<button class="cd budget-auto ${this.auto ? 'on' : ''}"><span class="sw"></span>Budget<b>${this.auto ? 'THE PRESIDENT DECIDES' : 'YOU DECIDE'}</b><i>${this.auto ? 'Click a line to take over' : 'Click to hand it back'}</i></button>`
      + rows;
  }
}

