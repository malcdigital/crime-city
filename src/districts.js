import { CFG } from './config.js';

// The city's layout: which district each block is in, and where the special places are.
// Block (i, j): i runs west to east, j runs north to south.
//
//            i: 0 ......... 4 | 5 ...... 8 | 9 ........ 13
//   j 0-4   The Heights       | Financial  | Government (j 0-3)
//   j 5-8   Midtown           | Downtown   | The Strip (j 4-8)
//   j 9-13  The Projects (i 0-5) | Midtown (i 6-8) | The Docks
export const DISTRICTS = ['Downtown', 'Financial District', 'Government District', 'The Heights', 'Midtown', 'The Projects', 'The Strip', 'The Docks'];

const RECTS = [
  ['The Heights', 0, 4, 0, 4],
  ['Financial District', 5, 8, 0, 4],
  ['Government District', 9, 13, 0, 3],
  ['The Strip', 9, 13, 4, 8],
  ['Downtown', 5, 8, 5, 8],
  ['The Projects', 0, 5, 9, 13],
  ['The Docks', 9, 13, 9, 13],
  ['Midtown', 0, 13, 0, 13], // everything else
];

export function districtOfBlock(i, j) {
  for (const [name, i0, i1, j0, j1] of RECTS) if (i >= i0 && i <= i1 && j >= j0 && j <= j1) return name;
  return 'Midtown';
}

// District at a world position (roads count as the block they border on the south-east).
export function districtAt(x, z) {
  const N = CFG.BLOCKS;
  const i = Math.max(0, Math.min(N - 1, Math.floor(x / CFG.PITCH)));
  const j = Math.max(0, Math.min(N - 1, Math.floor(z / CFG.PITCH)));
  return districtOfBlock(i, j);
}

// Middle of a district (for waypoints and map labels).
export function districtCenter(name) {
  const P = CFG.PITCH;
  const blocks = [];
  for (let i = 0; i < CFG.BLOCKS; i++) for (let j = 0; j < CFG.BLOCKS; j++) if (districtOfBlock(i, j) === name) blocks.push([i, j]);
  if (!blocks.length) return [CFG.SIZE / 2, CFG.SIZE / 2];
  const ci = blocks.reduce((s, b) => s + b[0], 0) / blocks.length;
  const cj = blocks.reduce((s, b) => s + b[1], 0) / blocks.length;
  // Snap to the block nearest the average (Midtown wraps around, so the average can fall outside it).
  let best = blocks[0];
  for (const b of blocks) if (Math.hypot(b[0] - ci, b[1] - cj) < Math.hypot(best[0] - ci, best[1] - cj)) best = b;
  return [best[0] * P + P / 2, best[1] * P + P / 2];
}

// Special blocks, keyed by "i,j".
export const SPECIAL = {
  '9,2': 'police',
  '10,1': 'cityhall',
  '3,7': 'hospital',
  '11,11': 'chop',
  '4,6': 'park', // your crew's hangout
  '2,2': 'park',
  '6,11': 'park',
  '7,3': 'park', // a plaza between the towers
  '12,2': 'park',
};

// Corner stores you can rob.
export const STORES = {
  '1,10': 'Corner 24/7',
  '7,7': 'Liquor Barn',
  '12,10': 'Gas & Go',
  '3,5': 'Quick Mart',
  '10,6': 'Pawn King',
  '7,12': 'Late Nite Deli',
  '2,3': 'Hilltop Market',
  '12,7': 'Night Owl Liquor',
};

// Where things are (block coordinates).
export const PLACES = {
  crewHome: [4, 6], // park: your hangout on its north sidewalk
  gangHome: [2, 11], // the Southside Kings' corner in the Projects
  gunShop: [3, 8],
  garage: [9, 10],
  safehouse: [4, 8],
};

// How each district looks: building colors, heights, and what kind of lots.
export const STYLES = {
  'Financial District': { kind: 'towers', h: [40, 95], colors: [0x6f8fa8, 0x8aa3b8, 0x5c7287, 0x9fb4c7, 0x7d8a99] },
  Downtown: { kind: 'city', h: [22, 65], colors: [0xc9c2b8, 0x9fb4c7, 0xb8a48c, 0x8e9aa6, 0xd6cfc4] },
  'Government District': { kind: 'civic', h: [12, 24], colors: [0xe8e2d4, 0xd9d2c0, 0xcfc6b0, 0xf0ece2] },
  'The Heights': { kind: 'houses', h: [5, 8], colors: [0xe9dfc9, 0xc8d6c2, 0xd8c3a5, 0xbfcad6, 0xf2e8d5] },
  Midtown: { kind: 'city', h: [8, 24], colors: [0xc9c2b8, 0xb8a48c, 0xa89f91, 0xb5aa9c, 0x9fb4c7] },
  'The Projects': { kind: 'projects', h: [9, 15], colors: [0x8a4b3a, 0x7a4334, 0x95553f, 0x6e3d30] },
  'The Strip': { kind: 'strip', h: [6, 16], colors: [0x2d2a3e, 0x3a2f4f, 0x262638, 0x4a3b5c] },
  'The Docks': { kind: 'docks', h: [7, 11], colors: [0x6b6f73, 0x7d6b5a, 0x5e6a70, 0x857a6c] },
};

// Turf everyone starts with (block keys).
export const START_TURF = {
  kings: { home: '2,11', blocks: ['2,11', '1,11', '3,11', '2,10', '1,10', '2,12', '3,12'] },
  crew: { home: '4,6', blocks: ['4,6', '3,6', '4,5', '3,5', '4,7', '5,6'] },
  vipers: { home: '11,7', blocks: ['11,7', '10,7', '12,7', '11,6', '11,8', '10,8', '12,8'] },
};

// City Bank branches (open 9 AM to 6 PM): [i, j, name].
export const BANKS = [
  [6, 2, 'City Bank'],
  [1, 6, 'City Bank · Midtown'],
  [10, 9, 'City Bank · Docks'],
];

// ATMs (withdraw only, daily limit), on the north sidewalk of these blocks.
export const ATMS = [[5, 5], [8, 6], [3, 9], [10, 5], [12, 10], [1, 3], [7, 10], [4, 1], [9, 8], [2, 13]];

// Homes for sale: each has a stash (no fees, open any time, but it can get robbed).
export const HOMES = [
  { id: 'trap', name: 'Trap apartment', block: [3, 10], price: 3000 },
  { id: 'condo', name: 'Midtown condo', block: [0, 7], price: 8000 },
  { id: 'loft', name: 'Strip loft', block: [12, 4], price: 12000 },
  { id: 'house', name: 'Heights house', block: [3, 1], price: 25000 },
  { id: 'penthouse', name: 'Downtown penthouse', block: [6, 7], price: 60000 },
];

// Service companies (each gets its share of every upkeep bill in the city). Offices on these blocks:
// whoever holds the block's turf collects protection money from them.
export const COMPANIES = [
  { id: 'power', name: 'Metro Power & Water', what: 'gas, power and water', share: 0.4, block: [11, 2], color: '#f1c40f' },
  { id: 'fix', name: 'FixRight Maintenance', what: 'repairs and maintenance', share: 0.25, block: [2, 10], color: '#e67e22' },
  { id: 'clean', name: 'SparkleClean', what: 'cleaning', share: 0.2, block: [3, 6], color: '#48c9b0' },
  { id: 'net', name: 'CityNet', what: 'internet and phones', share: 0.15, block: [10, 7], color: '#5dade2' },
];

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
