// Economy tuning: every number that balances the money side of the game, in one place.
// (Drug prices and plug loads live in drugs.js; tax rates per President in politics.js.)
// Times are in game days (one game day = 48 real minutes) unless they say otherwise.
export const TUNE = {
  // ---- City budget (budget.js) ----
  // Normal spending (police + works + community, all Normal) is about 80% of a quiet city's income.
  budget: {
    police: [0, 1200, 2400, 4000], // Cut / Normal / Boosted / Max, per day
    works: [0, 800, 2000], // None / Normal / Big
    community: [0, 650, 1600], // None / Some / Lots
    war: [0, 1200, 2800], // war on drugs: Hands off / Tough / All-out
    crackdown: 500, // per gang
  },
  // City debt: the treasury can go below zero, down to this many days of income, at a daily
  // interest rate. Past the limit, the budget is only partly paid.
  debtLimitDays: 5,
  debtInterest: 0.01,
  // In debt deeper than this many days of income, the President raises taxes (or cuts, depending
  // on who they are). Taxes come back down once the treasury has this many days saved.
  raiseTaxesAtDebtDays: 2,
  lowerTaxesAtSavedDays: 3,
  taxStep: 0.25, // each raise: +25% on the tax rates
  maxTaxBoost: 1.5,

  // ---- Service companies (economy.js) ----
  residentUpkeepPerBlock: 45, // what residents pay per block per day (normal wealth)
  companyProfit: 0.3, // of a company's take (after the tax on services)
  protection: 0.1, // to the gang holding the office block
  companyPriceDays: 180, // a company sells for about this many days of profit
  // When private owners control at least this share of the city's services, the city taxes their
  // profits (except libertarian Presidents); a People's Republic buys them out instead.
  privateControlShare: 0.5,
  profitTax: 0.25,

  // ---- Neighborhoods (economy.js) ----
  wealthMove: 0.25, // how far a district's wealth moves toward its target each day
  wealthCrimeDrag: 0.25, // at 30 crime points above the district's usual level
  wealthSpendLift: 0.15,
  crimeNormRate: 0.05, // how fast a district's "usual" crime level adapts, per day

  // ---- Housing market (property.js) ----
  housing: {
    drift: 0.001, // long-run appreciation per day (about +16% over 150 days)
    noise: 0.0015, // day-to-day wobble in the trend
    trendPull: 0.1, // how fast the trend returns to the long-run drift
    shockChance: 0.04, // per day: a boom or a slump starts
    shock: 0.008, // how much a boom/slump moves the daily trend
    min: 0.6,
    max: 2.5,
  },

  // ---- Elections (president.js) ----
  termLimit: 4, // terms in a row (a term is a game week); then someone else from the party runs

  // ---- President's approval (president.js) ----
  approval: {
    base: 60,
    crimePerPoint: 0.6, // per crime point above 10
    shortfall: 25, // at 0% funded (scales with how much was missing)
    inDebt: 6, // treasury below zero
    taxes: 20, // per 100% over normal tax rates
    wealth: 60, // per +100% average neighborhood wealth vs normal
    honeymoon: 6, // a new President's first 2 days
  },
};
