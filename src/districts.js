// Where things are in the city: which district a place is in, the special blocks (police,
// city hall, hospital, parks...), stores, banks, homes, companies and starting turf.
// Places are pinned to points on the map (worldplan.js); each one takes the block at that
// point, or the nearest free one if that block is taken or unsuitable.
import { BLOCKS, districtAt } from './worldplan.js';
import { pointInPoly } from './geom.js';

export { districtAt };
export const DISTRICTS = ['Downtown', 'Financial District', 'Government District', 'The Heights', 'Midtown', 'The Projects', 'The Strip', 'The Docks'];

export const districtOfBlock = (b) => b.district;

const taken = new Set();
// The block at (x, z), or the nearest suitable free one.
function pick(x, z, { free = true, types = ['normal'], district = null } = {}) {
  const ok = (b) => types.includes(b.type) && (!free || !taken.has(b)) && (!district || b.district === district);
  let best = BLOCKS.find((b) => ok(b) && pointInPoly(x, z, b.poly));
  if (!best) {
    let bd = Infinity;
    for (const b of BLOCKS) {
      if (!ok(b)) continue;
      const d = Math.hypot(b.cx - x, b.cz - z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
  }
  if (free) taken.add(best);
  return best;
}

// Special blocks: type set on the block itself.
const special = (type, x, z, opts = {}) => {
  const b = pick(x, z, opts);
  b.type = type;
  if (opts.name) b.name = opts.name;
  return b;
};
export const SPECIAL = {
  police: special('police', 1127, 365),
  cityhall: special('cityhall', 1014, 261),
  hospital: special('hospital', 288, 441),
  chop: special('chop', 1133, 1013),
};
// Parks (besides Central Park): the crew's square, and one in most districts.
export const PARKS = [
  special('park', 672, 760, { name: 'Liberty Square' }),
  special('park', 366, 269, { name: 'Grove Park' }),
  special('park', 679, 1113, { name: 'Old Town Square' }),
  special('park', 390, 864, { name: 'Carver Courts' }),
  special('park', 1455, 380, { name: 'Summit Park', types: ['normal'] }),
];
for (const b of BLOCKS) if (b.type === 'park' && !b.name) b.name = 'Central Park';

// Corner stores you can rob: { name, block }.
export const STORES = [
  ['Corner 24/7', 420, 590],
  ['Liquor Barn', 747, 759],
  ['Gas & Go', 1013, 1013],
  ['Quick Mart', 288, 269],
  ['Pawn King', 453, 1029],
  ['Late Nite Deli', 685, 1051],
  ['Hilltop Market', 1335, 420],
  ['Night Owl Liquor', 1125, 587],
].map(([name, x, z]) => {
  const b = pick(x, z);
  b.type = 'store';
  b.store = name;
  return { name, block: b };
});

// Where things are: blocks.
export const PLACES = {
  crewHome: PARKS[0], // Liberty Square: your hangout on its sidewalk
  gangHome: pick(220, 797), // the Southside Kings' corner in the Projects
  gunShop: pick(444, 441),
  garage: pick(1013, 1127),
  safehouse: pick(670, 828),
};
PLACES.gangHome.type = 'normal';

// How each district looks: building colors, heights, and what kind of lots.
export const STYLES = {
  'Financial District': { kind: 'towers', h: [30, 85], colors: [0x6f8fa8, 0x8aa3b8, 0x5c7287, 0x9fb4c7, 0x7d8a99, 0xa89f91] },
  Downtown: { kind: 'city', h: [22, 65], colors: [0xc9c2b8, 0x9fb4c7, 0xb8a48c, 0x8e9aa6, 0xd6cfc4] },
  'Government District': { kind: 'civic', h: [12, 24], colors: [0xe8e2d4, 0xd9d2c0, 0xcfc6b0, 0xf0ece2] },
  'The Heights': { kind: 'houses', h: [5, 8], colors: [0xe9dfc9, 0xc8d6c2, 0xd8c3a5, 0xbfcad6, 0xf2e8d5] },
  Midtown: { kind: 'city', h: [8, 24], colors: [0xc9c2b8, 0xb8a48c, 0xa89f91, 0xb5aa9c, 0x9fb4c7] },
  'The Projects': { kind: 'projects', h: [9, 15], colors: [0x8a4b3a, 0x7a4334, 0x95553f, 0x6e3d30] },
  'The Strip': { kind: 'strip', h: [6, 16], colors: [0x2d2a3e, 0x3a2f4f, 0x262638, 0x4a3b5c] },
  'The Docks': { kind: 'docks', h: [7, 11], colors: [0x6b6f73, 0x7d6b5a, 0x5e6a70, 0x857a6c] },
};

// Turf everyone starts with: a home block and the blocks nearest it in the same district.
function turfAround(home, n) {
  const list = BLOCKS.filter((b) => b !== home && b.district === home.district && (b.type === 'normal' || b.type === 'store' || b.type === 'park'))
    .sort((p, q) => Math.hypot(p.cx - home.cx, p.cz - home.cz) - Math.hypot(q.cx - home.cx, q.cz - home.cz))
    .slice(0, n);
  return { home: home.key, blocks: [home.key, ...list.map((b) => b.key)] };
}
export const START_TURF = {
  kings: turfAround(PLACES.gangHome, 5),
  crew: turfAround(PLACES.crewHome, 5),
  vipers: turfAround(pick(281, 1118, { free: false }), 6),
};

// City Bank branches (open 9 AM to 6 PM): { block, name }.
export const BANKS = [
  [683, 985, 'City Bank'],
  [288, 353, 'City Bank · Midtown'],
  [1013, 928, 'City Bank · Docks'],
].map(([x, z, name]) => ({ block: pick(x, z), name }));

// ATMs (withdraw only, daily limit), on the sidewalk of these blocks.
export const ATMS = [[822, 830], [1035, 587], [625, 381], [210, 269], [420, 590], [282, 1209], [804, 1110], [1133, 1132], [929, 364], [1340, 300]]
  .map(([x, z]) => pick(x, z, { free: false, types: ['normal', 'store'] }));

// Homes for sale: each has a stash (no fees, open any time, but it can get robbed).
export const HOMES = [
  { id: 'trap', name: 'Trap apartment', at: [220, 590], price: 3000 },
  { id: 'condo', name: 'Midtown condo', at: [655, 318], price: 8000 },
  { id: 'loft', name: 'Strip loft', at: [281, 1029], price: 12000 },
  { id: 'house', name: 'Heights house', at: [1455, 300], price: 25000 },
  { id: 'penthouse', name: 'Downtown penthouse', at: [947, 731], price: 60000 },
].map((h) => ({ ...h, block: pick(h.at[0], h.at[1]) }));

// Service companies (each gets its share of every upkeep bill in the city). Offices on these
// blocks: whoever holds the block's turf collects protection money from them.
export const COMPANIES = [
  { id: 'power', name: 'Metro Power & Water', what: 'gas, power and water', share: 0.4, at: [929, 260], color: '#f1c40f' },
  { id: 'fix', name: 'FixRight Maintenance', what: 'repairs and maintenance', share: 0.25, at: [390, 763], color: '#e67e22' },
  { id: 'clean', name: 'SparkleClean', what: 'cleaning', share: 0.2, at: [444, 353], color: '#48c9b0' },
  { id: 'net', name: 'CityNet', what: 'internet and phones', share: 0.15, at: [1125, 731], color: '#5dade2' },
].map((c) => ({ ...c, block: pick(c.at[0], c.at[1]) }));

// How well-off each district is to begin with (people's spending, what homes are like).
export const WEALTH_BASE = {
  'The Heights': 1.3,
  'Financial District': 1.4,
  'Government District': 1.1,
  Downtown: 1.2,
  Midtown: 1.0,
  'The Strip': 0.9,
  'The Docks': 0.8,
  'The Projects': 0.6,
};

// Middle of a district (for waypoints and map labels): the block nearest the average of its
// blocks' centers, weighted by size.
const centers = {};
export function districtCenter(name) {
  if (centers[name]) return centers[name];
  const list = BLOCKS.filter((b) => b.district === name && b.type !== 'ramps');
  if (!list.length) return [800, 800];
  let sx = 0;
  let sz = 0;
  let sa = 0;
  for (const b of list) {
    sx += b.cx * b.area;
    sz += b.cz * b.area;
    sa += b.area;
  }
  const ax = sx / sa;
  const az = sz / sa;
  let best = list[0];
  for (const b of list) if (Math.hypot(b.cx - ax, b.cz - az) < Math.hypot(best.cx - ax, best.cz - az)) best = b;
  centers[name] = [best.cx, best.cz];
  return centers[name];
}
