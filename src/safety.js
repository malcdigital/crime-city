import { districtAt } from './districts.js';
import { dist } from './util.js';

// How safe a spot feels to the people who'd go there (the courts, the field, the children's
// park): 1 = a quiet, well-policed day, 0 = nobody's going out. It's what sets how many turn up.
// - The district's crime level (property.js: every crime adds to it, and it fades over about
//   10 minutes) - the biggest part of it.
// - Trouble close by just now: a crime within 250 m in the last few minutes (shootings and
//   murders count most).
// - A turf war going on within 200 m; rival gang turf right there.
// - You, if the police are after you (3+ stars and they're close behind).
// - The police budget: well-funded police make people a little bolder, cuts the other way.
// Returns { k, why } (why: the main reason it's down, for a message).
const RECENT = 240; // seconds a crime nearby keeps people away
const CRIME_W = { gunfire: 2, murder: 3, gangKill: 2.5, copKilled: 3, explosion: 3, robbery: 1.5, assault: 0.8, carjack: 0.8, hitAndRun: 0.8 };

export function noteCrime(game, type, x, z) {
  const w = CRIME_W[type];
  if (!w) return;
  const list = (game.recentCrimes = game.recentCrimes || []);
  list.push({ x, z, t: game.time, w });
  while (list.length && game.time - list[0].t > RECENT) list.shift();
}

export function safetyAt(game, x, z) {
  const why = [];
  let k = 1;
  // The district's crime level.
  const d = districtAt(x, z);
  const c = game.property?.crimeLevel?.[d] || 0;
  const ck = Math.max(0.15, Math.min(1, 1.1 - c / 50)); // (moderate crime ~0.8, high ~0.4, out of control 0.15)
  if (ck < 0.85) why.push([ck, `crime's been high in ${d}`]);
  k *= Math.min(1, ck);
  // Trouble nearby, just now.
  let near = 0;
  for (const e of game.recentCrimes || []) {
    if (game.time - e.t > RECENT) continue;
    const dd = dist(e.x, e.z, x, z);
    if (dd < 250) near += e.w * (1 - (game.time - e.t) / RECENT) * (dd < 120 ? 1 : 0.5);
  }
  const nk = Math.max(0, 1 - near * 0.25);
  if (nk < 0.85) why.push([nk, 'after the trouble nearby']);
  k *= nk;
  // Gang trouble.
  const T = game.turfWars;
  if (T) {
    const war = (T.wars || []).some((w) => w.state === 'active' && T.byKey[w.key] && dist(T.byKey[w.key].cx, T.byKey[w.key].cz, x, z) < 200);
    if (war) {
      why.push([0.35, 'with a turf war going on next door']);
      k *= 0.35;
    } else {
      const g = T.turfAt?.(x, z);
      if (g && g.id !== 'crew') {
        why.push([0.8, `on ${g.name} turf`]);
        k *= 0.8;
      }
    }
  }
  // You, with the police on your heels.
  if (game.stars >= 3) {
    const [px, pz] = game.player.pos();
    if (dist(px, pz, x, z) < 200) {
      const s = 1 - 0.15 * game.stars;
      why.push([s, 'with the police chasing you round here']);
      k *= s;
    }
  }
  // The police budget.
  const pm = game.budget?.policeMult?.() ?? 1;
  k *= Math.max(0.85, Math.min(1.1, 0.85 + 0.15 * pm));
  why.sort((a, b) => a[0] - b[0]);
  return { k: Math.max(0, Math.min(1, k)), why: why.map((w) => w[1]) };
}

// How many of `n` turn up when it's this safe (rounding by chance, so a 1.5 is sometimes 1 and
// sometimes 2). Below `min` nobody comes.
export function turnout(n, k, min = 0.2) {
  if (k < min) return 0;
  const v = n * k;
  return Math.floor(v) + (Math.random() < v - Math.floor(v) ? 1 : 0);
}

// A short message when it's emptier than usual (once per visit).
export function quietNote(game, name, s) {
  if (s.k > 0.7 || !s.why.length) return;
  if (game.time < (game.parkNoteT || 0)) return; // (one at a time: parks are close together)
  game.parkNoteT = game.time + 60;
  const how = s.k < 0.2 ? 'empty' : 'quiet';
  game.hud.toast(`${name} is ${how} ${s.why[0]}`, '#9fc3ff');
}
