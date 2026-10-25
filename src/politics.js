// NPC Presidents: who runs the city until players can. Each one has a political leaning, and
// the leaning decides the budget, the war on drugs, gang crackdowns and the tax rates. Parties
// are made up. Now and then someone extreme gets in.
//
// budget: starting levels for police / works / community (see budget.js); null = balanced.
// toughOnCrime: pushes police (and the war on drugs) up when crime is high.
// war / warHigh: war-on-drugs level normally / when crime is high.
// crackdown: 'worst' (the biggest rival gang when crime is high), 'all' (every gang, yours too),
//   or null (none).
// salesTax / propertyTax: rates (property tax per week).
// frugal: stays within the city's means (extremes often don't).
export const PERSONALITIES = [
  {
    id: 'law', title: 'Law & Order', leaning: 'Right', side: 'right', party: 'Order Party',
    blurb: 'Tough on crime: more police, a tough war on drugs, crackdowns on the worst gang.',
    budget: { police: 2, works: 1, community: 0 }, toughOnCrime: true, war: 1, warHigh: 2, crackdown: 'worst',
    salesTax: 0.06, propertyTax: 0.0025, frugal: true,
  },
  {
    id: 'small', title: 'Small Government', leaning: 'Libertarian', side: 'lib', party: 'Liberty Party',
    blurb: 'Low taxes and a small budget. Leaves people (and the drug trade) alone.',
    budget: { police: 1, works: 0, community: 0 }, war: 0, warHigh: 0, crackdown: null,
    salesTax: 0.04, propertyTax: 0.0015, frugal: true,
  },
  {
    id: 'mod', title: 'Moderate', leaning: 'Center', side: 'center', party: 'Unity Party',
    blurb: "Balanced: tougher when crime is up, builds when it's quiet.",
    budget: null, toughOnCrime: true, war: 0, warHigh: 1, crackdown: null,
    salesTax: 0.06, propertyTax: 0.0025, frugal: true,
  },
  {
    id: 'prog', title: 'Progressive', leaning: 'Left', side: 'left', party: "People's Party",
    blurb: 'Community programs and public works over policing. Treats drugs as a health problem.',
    budget: { police: 1, works: 2, community: 2 }, war: 0, warHigh: 0, crackdown: null,
    salesTax: 0.07, propertyTax: 0.0035, frugal: true,
  },
  // Extremes: rare.
  {
    id: 'iron', title: 'Iron Fist', leaning: 'Far right', side: 'right', party: 'Iron Order', extreme: true,
    blurb: 'Max police, all-out war on drugs, crackdowns on every gang (yours too) and a night curfew: even more cops after dark.',
    budget: { police: 3, works: 0, community: 0 }, toughOnCrime: true, war: 2, warHigh: 2, crackdown: 'all', curfew: true,
    salesTax: 0.08, propertyTax: 0.004, frugal: false,
  },
  {
    id: 'free', title: 'Free City', leaning: 'Far libertarian', side: 'lib', party: 'Free City Movement', extreme: true,
    blurb: 'Police budget slashed, taxes nearly gone, and weed is legal: no weed raids or undercover weed buys, but legal shops push street prices down.',
    budget: { police: 0, works: 0, community: 0 }, war: 0, warHigh: 0, crackdown: null, legalWeed: true,
    salesTax: 0.02, propertyTax: 0.0005, frugal: true,
  },
  {
    id: 'red', title: "People's Republic", leaning: 'Far left', side: 'left', party: "Workers' Front", extreme: true,
    blurb: 'Huge programs and public works, sky-high property taxes, and private service companies bought out by the city (yours included, at market price).',
    budget: { police: 1, works: 2, community: 2 }, war: 0, warHigh: 0, crackdown: null, nationalize: true,
    salesTax: 0.08, propertyTax: 0.008, frugal: false,
  },
  {
    id: 'boss', title: 'The Boss', leaning: 'Corrupt', side: 'any', party: 'Machine Party', extreme: true,
    blurb: 'Skims a quarter of the treasury every day, and the police are on the take: twice as many dirty cops.',
    budget: { police: 1, works: 0, community: 0 }, war: 1, warHigh: 1, crackdown: null, skim: 0.25, dirtyMult: 2,
    salesTax: 0.06, propertyTax: 0.003, frugal: false,
  },
];

const FIRST = ['Margaret', 'Raymond', 'Delores', 'Victor', 'Angela', 'Harold', 'Simone', 'Curtis', 'Lorraine', 'Benny', 'Gloria', 'Walter', 'Yvonne', 'Frank', 'Teresa', 'Marcus'];
const LAST = ['Holloway', 'Pruitt', 'Vance', 'Okafor', 'Castellano', 'Whitfield', 'Brennan', 'Delacroix', 'Mercer', 'Abernathy', 'Quintero', 'Sloane', 'Hargrove', 'Takeda', 'Lindqvist', 'Boateng'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function personality(id) {
  return PERSONALITIES.find((p) => p.id === id) || PERSONALITIES[2];
}

// A new President: usually from a different side than the one who lost; extremes now and then.
export function newLeader(loserSide = null) {
  const extreme = Math.random() < 0.15;
  let pool = PERSONALITIES.filter((p) => !!p.extreme === extreme);
  const other = pool.filter((p) => p.side !== loserSide);
  if (loserSide && other.length && Math.random() < 0.8) pool = other;
  const p = pick(pool);
  return { name: `${pick(FIRST)} ${pick(LAST)}`, id: p.id };
}
