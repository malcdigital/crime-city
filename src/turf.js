import { CFG, GANG_NAME, CREW_NAME } from './config.js';
import { GangFighter } from './gang.js';
import { pushCircle } from './collision.js';
import { dist, pick, rand } from './util.js';
import { streetAt } from './city.js';
import { SKIN_TONES } from './character.js';

// Turf wars. Rules (agreed with the designer):
// - Each gang holds blocks; the rest of the city is unclaimed. No border rule, no cap.
// - Start a war on a gang's block by killing 3 of its members there. The defenders then come
//   in waves, and the attackers must wipe out every opp from every wave to take the block.
//   Waves scale with the defending gang's strength (3 waves of 3, +1 per wave per 2 blocks
//   held). Home blocks get an extra wave per other block held and 1.5x bigger waves; taking
//   a home block takes all of that gang's turf, and the gang goes underground (no turf) and
//   can't start a war for 24 hours.
// - Unclaimed blocks: hold them for 60 seconds with no enemies on them.
// - A block that changes hands is locked from attack for 2 hours.
// - NPC gangs: every 45 minutes each rolls a 1 in 3 chance to attack. They go after blocks
//   they lost first; otherwise the leader decides (reckless leaders hit stronger gangs, even
//   home blocks; calculating ones pick off unclaimed blocks or the weakest gang).
// - NPC attackers come in waves scaled to their own strength; whichever side runs out of
//   fighters first loses. Every war plays out for real, wherever it is.
// - You lose an attack if you die or leave the block for more than 20 seconds.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
// Test timings (CFG.TURF_FAST) so the system can be tried in one sitting.
const T = CFG.TURF_FAST
  ? { lock: 2 * MIN, roll: 3 * MIN, underground: 5 * MIN, remember: 15 * MIN }
  : { lock: 2 * HOUR, roll: 45 * MIN, underground: 24 * HOUR, remember: 24 * HOUR };

export const GANGS = {
  kings: { id: 'kings', name: GANG_NAME, color: '#9c27b0', shirt: 0x6a1b9a, bandana: 0x8e24aa, reckless: 0.85, leader: 'Big Lo' },
  vipers: { id: 'vipers', name: 'East Side Vipers', color: '#ff7a1a', shirt: 0xc0561a, bandana: 0xff8f2a, reckless: 0.3, leader: 'Slim' },
  crew: { id: 'crew', name: CREW_NAME, color: '#3dff6e', shirt: 0x1e7d32, bandana: 0x2e7d32, reckless: 0.5, leader: 'You' },
};
const START = {
  kings: { home: '1,6', blocks: ['1,6', '0,6', '0,7', '1,7', '1,5', '0,5'] },
  crew: { home: '3,4', blocks: ['3,4', '4,4', '3,5', '4,5', '3,3', '4,3'] },
  vipers: { home: '6,2', blocks: ['6,2', '6,1', '7,1', '7,2', '6,3', '7,3'] },
};
const SAVE_KEY = 'crimecity.turf.v1';
const key = (b) => `${b.i},${b.j}`;

// A gang soldier: a turf guard, or a fighter in a turf war.
export class Soldier extends GangFighter {
  constructor(game, mgr, x, z, gangId, war, side) {
    const g = GANGS[gangId];
    super(game, x, z, { shirt: g.shirt, pants: 0x1b1b1b, skin: pick(SKIN_TONES), bandana: g.bandana });
    this.mgr = mgr;
    this.gangId = gangId;
    this.war = war;
    this.side = side; // 'att' | 'def' | 'guard'
    this.isSoldier = true;
    if (gangId === 'crew') this.isCrew = true;
    // Soldiers sent into a war have more nerve than corner boys.
    this.baseHeart = war ? rand(0.35, 1) : rand(0.2, 1);
    this.heart = this.baseHeart;
    this.aggroUntil = 0;
  }

  // Shot at by you: this one (and its gang's guards nearby) come after you.
  onPlayerAttack() {
    if (this.gangId === 'crew') return;
    this.mgr.aggro(this.gangId, this.x, this.z);
  }

  giveUp() {
    this.behavior = 'leave';
    this.leaveGoal = null;
  }

  onDeath() {
    for (const o of this.mgr.soldiers) {
      if (o !== this && o.alive && o.gangId === this.gangId && dist(o.x, o.z, this.x, this.z) < 25) o.shaken(0.12);
    }
  }

  enemies() {
    const game = this.game;
    const list = [];
    const w = this.war && this.war.state === 'active' ? this.war : null;
    if (w) {
      const other = this.side === 'att' ? 'def' : 'att';
      for (const f of w.fighters) if (f.side === other && f.standing) list.push({ x: f.x, z: f.z, ref: f });
      const otherGang = this.side === 'att' ? w.defender : w.attacker;
      if (otherGang === 'crew') list.push(...game.playerFaction());
      // Fighting on this block: their guards are fair game too.
      for (const s of this.mgr.soldiers) {
        if (s.side === 'guard' && s.standing && s.gangId === otherGang && w.onBlock(s.x, s.z, 20)) list.push({ x: s.x, z: s.z, ref: s });
      }
    }
    if (this.gangId !== 'crew' && this.aggroUntil > game.time) list.push(...game.playerFaction());
    return list;
  }

  update(dt) {
    if (this.updateDown(dt)) return;
    const game = this.game;
    const list = this.enemies();
    const target = list.length ? game.pickTarget(this, list, 55) : null;
    const leaving = this.state === 'fight' && this.behavior === 'leave';
    if (target || leaving) {
      this.startFight(game.copsNear(this.x, this.z));
      this.fight(dt, target || { x: game.player.x, z: game.player.z, ref: 'player' }, 0.85);
    } else {
      if (this.state === 'fight') this.endFight();
      this.char.armR.rotation.x = this.war ? -1.2 : -0.3;
      const w = this.war && this.war.state === 'active' ? this.war : null;
      if (w) {
        // Head for the fight: the nearest opp anywhere, or the block itself.
        let goal = null;
        let best = Infinity;
        for (const e of list) {
          const d = dist(this.x, this.z, e.x, e.z);
          if (d < best) {
            best = d;
            goal = e;
          }
        }
        const gx = goal ? goal.x : w.block.cx;
        const gz = goal ? goal.z : w.block.cz;
        if (dist(this.x, this.z, gx, gz) > 3) this.move(dt, gx, gz, 4.6, null);
        else this.move(dt, this.x, this.z, 0, null);
      } else if (dist(this.x, this.z, this.homeX, this.homeZ) > 1) this.move(dt, this.homeX, this.homeZ, 1.6, null);
      else this.move(dt, this.x, this.z, 0, null);
    }
    this.animate(dt);
    this.place();
  }
}

class War {
  constructor(mgr, block, attacker, defender, byPlayer) {
    const game = mgr.game;
    this.mgr = mgr;
    this.game = game;
    this.block = block;
    this.key = key(block);
    this.attacker = attacker;
    this.defender = defender;
    this.byPlayer = byPlayer;
    this.home = !!defender && mgr.home[defender] === this.key;
    this.fighters = [];
    this.state = 'active';
    this.t = 0;
    this.holdT = 0;
    this.awayT = 0;
    this.spawnT = { att: 0, def: 1.5 };
    // Waves scale with each gang's strength.
    const size = (g) => (mgr.underground(g) || !mgr.count(g) ? 3 : 3 + Math.floor(mgr.count(g) / 2));
    this.waves = { att: [], def: [] };
    if (defender) {
      const n = this.home ? 3 + Math.max(0, mgr.count(defender) - 1) : 3;
      const s = this.home ? Math.ceil(size(defender) * 1.5) : size(defender);
      this.waves.def = Array(n).fill(s);
    }
    if (!byPlayer) this.waves.att = Array(3).fill(size(attacker));
    this.waveIdx = { att: 0, def: 0 };
    this.street = streetAt(block.cx, block.cz);
    // Guards already on the block join the defense.
    for (const s of mgr.soldiers) {
      if (s.side === 'guard' && s.gangId === defender && this.onBlock(s.x, s.z, 12)) {
        s.war = this;
        s.side = 'def';
        this.fighters.push(s);
      }
    }
  }

  onBlock(x, z, pad = CFG.ROAD / 2) {
    const b = this.block;
    return x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad;
  }

  living(side) {
    return this.fighters.filter((f) => f.side === side && f.alive && !f.removed && f.behavior !== 'leave');
  }

  // Where a side's next wave comes from.
  spawnPoint(side, i) {
    const b = this.block;
    const city = this.game.city;
    let x, z;
    if (side === 'def') {
      // Out of the buildings onto the block's sidewalks.
      const edge = Math.floor(Math.random() * 4);
      const u = rand(4, 60);
      [x, z] = [[b.minX + u, b.minZ + 2.2], [b.minX + u, b.maxZ - 2.2], [b.minX + 2.2, b.minZ + u], [b.maxX - 2.2, b.minZ + u]][edge];
    } else {
      // Rolling in from the direction of their own turf (or anywhere), down the street.
      const home = this.mgr.homeBlock(this.attacker);
      let ang = home ? Math.atan2(home.cz - b.cz, home.cx - b.cx) : Math.random() * Math.PI * 2;
      ang += (i - 1) * 0.15;
      const r = 48 + Math.random() * 6;
      x = b.cx + Math.cos(ang) * r;
      z = b.cz + Math.sin(ang) * r;
    }
    const p = pushCircle(x, z, 0.5, city.colliders);
    return [p.x, p.z];
  }

  spawnWave(side) {
    const n = this.waves[side][this.waveIdx[side]];
    const gang = side === 'att' ? this.attacker : this.defender;
    for (let i = 0; i < n; i++) {
      const [x, z] = this.spawnPoint(side, i);
      const s = new Soldier(this.game, this.mgr, x + rand(-1.5, 1.5), z + rand(-1.5, 1.5), gang, this, side);
      this.fighters.push(s);
      this.mgr.soldiers.push(s);
    }
    this.waveIdx[side]++;
  }

  // HUD summary: wave and opps left, from your side's point of view if you're in it.
  summary() {
    const mine = this.attacker === 'crew' ? 'att' : this.defender === 'crew' ? 'def' : null;
    const opp = mine === 'att' ? 'def' : 'att';
    const g = (id) => (id ? GANGS[id].name : 'nobody');
    const side = mine ? opp : 'def';
    const waves = this.waves[side].length;
    const idx = Math.max(1, this.waveIdx[side]);
    const left = this.living(side).length + this.waves[side].slice(this.waveIdx[side]).reduce((a, b) => a + b, 0);
    let text = `TURF WAR · ${g(this.attacker)} vs ${g(this.defender)} · ${this.street}`;
    if (this.defender || !this.byPlayer) text += ` · wave ${Math.min(idx, waves || 1)}/${waves || 1} · ${left} opps left`;
    if (!this.defender) text += ` · hold ${Math.max(0, 60 - this.holdT).toFixed(0)}s`;
    if (this.home) text += ' · HOME BLOCK';
    if (this.byPlayer && this.awayT > 0) text += ` · get back on the block! ${Math.max(0, 20 - this.awayT).toFixed(0)}s`;
    return text;
  }

  update(dt) {
    if (this.state !== 'active') return;
    const game = this.game;
    this.t += dt;
    // Next wave once the last one is down.
    for (const side of ['def', 'att']) {
      if (this.waveIdx[side] >= this.waves[side].length) continue;
      if (this.living(side).length) {
        this.spawnT[side] = 2.5;
        continue;
      }
      this.spawnT[side] -= dt;
      if (this.spawnT[side] <= 0) this.spawnWave(side);
    }
    const defOut = this.waveIdx.def >= this.waves.def.length && !this.living('def').length;
    const attOut = !this.byPlayer && this.waveIdx.att >= this.waves.att.length && !this.living('att').length;

    // You leading the attack: stay alive and stay on the block.
    if (this.byPlayer) {
      if (game.wastedT > 0) return this.end(false, 'you went down');
      const [px, pz] = game.player.pos();
      this.awayT = this.onBlock(px, pz) ? 0 : this.awayT + dt;
      if (this.awayT > 20) return this.end(false, 'you left the block');
    }
    if (!this.defender) {
      // Unclaimed: hold it with nobody else's people on it.
      const [px, pz] = game.player.pos();
      const here = this.byPlayer ? this.onBlock(px, pz) : this.living('att').some((f) => this.onBlock(f.x, f.z));
      const contested = this.mgr.soldiers.some((s) => s.standing && s.gangId !== this.attacker && this.onBlock(s.x, s.z))
        || (!this.byPlayer && this.attacker !== 'crew' && this.onBlock(px, pz) && game.wastedT <= 0 && this.living('att').some((f) => f.aggroUntil > game.time));
      if (here && !contested) this.holdT += dt;
      if (this.holdT >= 60) return this.end(true);
      if (attOut) return this.end(false, 'they were wiped out');
    } else {
      if (defOut) return this.end(true);
      if (attOut) return this.end(false, 'they ran out of soldiers');
    }
    if (this.t > 12 * 60) return this.end(false, 'it stalled');
  }

  end(won, why = '') {
    this.state = 'over';
    const game = this.game;
    const A = GANGS[this.attacker].name;
    const D = this.defender ? GANGS[this.defender].name : null;
    const b = this.block;
    if (won) {
      this.mgr.transfer(this, this.attacker, this.defender, this.home);
      const head = this.defender
        ? `${A} take ${D} turf on ${this.street}${this.home ? ' — their home block' : ''}`
        : `${A} claim a block on ${this.street}`;
      game.newsIncident(head, b.cx, b.cz, this.attacker === 'crew' ? 'good' : 'crime');
      if (this.attacker === 'crew') game.hud.toast(this.home ? `${D} turf is yours!` : 'Block taken!');
    } else {
      const head = this.defender ? `${D} hold off ${A} on ${this.street}` : `${A} fail to claim ${this.street}`;
      game.hud.news(head, this.defender === 'crew' ? 'good' : 'info');
      if (this.attacker === 'crew') game.hud.toast(`Turf war lost: ${why}`, '#ff8080');
      if (this.defender === 'crew') game.hud.toast('Your block held!');
    }
    // Survivors drift off.
    for (const f of this.fighters) {
      if (!f.alive) continue;
      f.war = null;
      f.side = 'guard';
      if (f.gangId !== (won ? this.attacker : this.defender)) f.giveUp();
      else {
        f.homeX = f.x;
        f.homeZ = f.z;
        f.leaveAfter = game.time + 40;
      }
    }
    this.mgr.save();
  }
}

export class TurfManager {
  constructor(game) {
    this.game = game;
    this.soldiers = [];
    this.wars = [];
    this.provoke = {}; // key -> { n, t }
    this.claimHold = 0;
    this.blocks = game.city.blocks.filter((b) => b.type !== 'police' && b.type !== 'hospital');
    this.byKey = Object.fromEntries(this.blocks.map((b) => [key(b), b]));
    if (!this.load()) this.reset();
    this.rollT = 0;
    this.guardT = 0;
    this.version = 0;
  }

  reset() {
    this.owner = {};
    this.home = {};
    for (const [g, s] of Object.entries(START)) {
      this.home[g] = s.home;
      for (const k of s.blocks) this.owner[k] = g;
    }
    this.lock = {};
    this.lost = { kings: [], vipers: [], crew: [] };
    this.under = {};
    const now = Date.now();
    this.nextRoll = { kings: now + T.roll * rand(0.3, 1), vipers: now + T.roll * rand(0.3, 1) };
    this.save();
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!s || !s.owner) return false;
      Object.assign(this, { owner: s.owner, home: s.home, lock: s.lock || {}, lost: s.lost || { kings: [], vipers: [], crew: [] }, under: s.under || {}, nextRoll: s.nextRoll || {} });
      return true;
    } catch {
      return false;
    }
  }

  save() {
    this.version++;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ owner: this.owner, home: this.home, lock: this.lock, lost: this.lost, under: this.under, nextRoll: this.nextRoll }));
    } catch {
      // Storage unavailable: turf just won't persist.
    }
  }

  count(g) {
    let n = 0;
    for (const v of Object.values(this.owner)) if (v === g) n++;
    return n;
  }

  underground(g) {
    return (this.under[g] || 0) > Date.now() || (!this.count(g) && !this.home[g]);
  }

  undergroundLeft(g) {
    return Math.max(0, (this.under[g] || 0) - Date.now());
  }

  homeBlock(g) {
    return this.home[g] ? this.byKey[this.home[g]] : null;
  }

  ownerKeyAt(x, z) {
    const h = CFG.ROAD / 2;
    for (const b of this.blocks) {
      if (x >= b.minX - h && x <= b.maxX + h && z >= b.minZ - h && z <= b.maxZ + h) return key(b);
    }
    return null;
  }

  blockAt(x, z) {
    for (const b of this.blocks) if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return b;
    return null;
  }

  // Whose turf (gang definition) a point is on.
  turfAt(x, z) {
    const k = this.ownerKeyAt(x, z);
    const g = k && this.owner[k];
    return g ? GANGS[g] : null;
  }

  // For the radar: each gang's blocks, plus blocks being fought over.
  view() {
    if (this.viewCache && this.viewCache.v === this.version) return this.viewCache.list;
    const list = Object.values(GANGS).map((g) => ({ gang: g.id, name: g.name, color: g.color, blocks: [] }));
    for (const [k, g] of Object.entries(this.owner)) {
      const b = this.byKey[k];
      if (b && g) list.find((t) => t.gang === g).blocks.push(b);
    }
    this.viewCache = { v: this.version, list };
    return list;
  }

  locked(k) {
    return (this.lock[k] || 0) > Date.now();
  }

  warOn(k) {
    return this.wars.find((w) => w.state === 'active' && w.key === k);
  }

  startWar(b, attacker, defender, byPlayer) {
    const k = key(b);
    if (this.warOn(k)) return null;
    const w = new War(this, b, attacker, defender, byPlayer);
    this.wars.push(w);
    const A = GANGS[attacker].name;
    const D = defender ? GANGS[defender].name : null;
    const game = this.game;
    if (defender === 'crew') {
      game.hud.news(`${A} are hitting your block on ${w.street}!`, 'crime');
      game.hud.toast(`${A} attacking your turf on ${w.street}`, '#ff8080');
    } else if (attacker === 'crew') {
      game.hud.news(defender ? `Turf war: Green Street move on ${D} at ${w.street}` : `Green Street moving to claim ${w.street}`, 'info');
    } else {
      game.hud.news(defender ? `${A} move on ${D} turf on ${w.street}` : `${A} moving into ${w.street}`, 'info');
    }
    return w;
  }

  // The winner takes the block (or, for a home block, all of the loser's turf).
  transfer(war, winner, loser, home) {
    const now = Date.now();
    const keys = home ? Object.keys(this.owner).filter((k) => this.owner[k] === loser) : [war.key];
    if (!keys.includes(war.key)) keys.push(war.key);
    for (const k of keys) {
      this.owner[k] = winner;
      this.lock[k] = now + T.lock;
      if (loser) this.lost[loser] = [...(this.lost[loser] || []), { key: k, t: now }].slice(-12);
    }
    if (!this.home[winner]) this.home[winner] = war.key; // back on the map: this is the new home
    if (home && loser) {
      this.home[loser] = null;
      this.under[loser] = now + T.underground;
      this.game.hud.news(`${GANGS[loser].name} wiped off the map — they've gone underground`, loser === 'crew' ? 'crime' : 'info');
      if (loser === 'kings') this.game.gang.wipeOut?.();
    }
    this.save();
  }

  // You shot at a gang member: they and nearby guards of the same gang come for you.
  aggro(g, x, z) {
    const until = this.game.time + 40;
    for (const s of this.soldiers) if (s.gangId === g && s.alive && dist(s.x, s.z, x, z) < 45) s.aggroUntil = until;
  }

  // You killed a gang member: three on the same block of their turf starts a war.
  onPlayerKill(c) {
    const g = c.isSoldier ? c.gangId : c.isGang ? 'kings' : null;
    if (!g || g === 'crew') return;
    const k = this.ownerKeyAt(c.x, c.z);
    if (!k || this.owner[k] !== g || this.warOn(k)) return;
    const game = this.game;
    const p = this.provoke[k] && game.time - this.provoke[k].t < 120 ? this.provoke[k] : { n: 0, t: game.time };
    p.n++;
    p.t = game.time;
    this.provoke[k] = p;
    if (p.n < 3) {
      game.hud.toast(`${GANGS[g].name} turf: ${p.n}/3 to start a turf war`, '#ffd36b');
      return;
    }
    delete this.provoke[k];
    if (this.underground('crew')) return game.hud.toast(`Green Street is underground for ${fmt(this.undergroundLeft('crew'))}`, '#ff8080');
    if (this.locked(k)) return game.hud.toast(`This block just changed hands. Locked for ${fmt(this.lock[k] - Date.now())}`, '#ff8080');
    this.startWar(this.byKey[k], 'crew', g, true);
  }

  // Prompt to claim an unclaimed block (hold E / D-pad →). Returns true if it showed one.
  interact(a, dt) {
    const game = this.game;
    const p = game.player;
    if (p.vehicle) return false;
    const b = this.blockAt(p.x, p.z);
    if (!b) return false;
    const k = key(b);
    if (this.owner[k] || this.warOn(k)) return false;
    const label = game.input.label('interact');
    if (this.underground('crew')) {
      game.prompt = `Green Street is underground — you can claim turf in ${fmt(this.undergroundLeft('crew'))}`;
      return true;
    }
    if (this.locked(k)) {
      game.prompt = `Unclaimed block · locked for ${fmt(this.lock[k] - Date.now())}`;
      return true;
    }
    if (a.interactHeld) {
      this.claimHold += dt;
      game.progress = { value: Math.min(1, this.claimHold / 1.5), label: 'Claiming…' };
      if (this.claimHold >= 1.5) {
        this.claimHold = 0;
        this.startWar(b, 'crew', null, true);
      }
    } else this.claimHold = 0;
    game.prompt = `Unclaimed block · hold ${label} to claim it for Green Street`;
    return true;
  }

  // NPC gangs deciding whether (and where) to attack.
  rollAttacks() {
    const now = Date.now();
    for (const g of ['kings', 'vipers']) {
      if (now < (this.nextRoll[g] || 0)) continue;
      this.nextRoll[g] = now + T.roll;
      this.save();
      if ((this.under[g] || 0) > now) continue;
      if (this.wars.some((w) => w.state === 'active' && (w.attacker === g || w.defender === g))) continue;
      if (Math.random() > 1 / 3) continue;
      const target = this.chooseTarget(g);
      if (target) this.startWar(target, g, this.owner[key(target)] || null, false);
    }
  }

  chooseTarget(g) {
    const now = Date.now();
    const free = (b) => {
      const k = key(b);
      return this.owner[k] !== g && !this.locked(k) && !this.warOn(k);
    };
    // 1. Win back what they lost.
    const lost = (this.lost[g] || []).filter((l) => now - l.t < T.remember).map((l) => this.byKey[l.key]).filter((b) => b && free(b));
    if (lost.length) return pick(lost);
    const cands = this.blocks.filter(free);
    if (!cands.length) return null;
    const strength = (o) => (o ? this.count(o) : 0);
    const reckless = GANGS[g].reckless;
    if (Math.random() < reckless) {
      // Reckless: go at the strongest rival, sometimes straight at their home block.
      const rivals = ['kings', 'vipers', 'crew'].filter((o) => o !== g && this.count(o) > 0).sort((a, b) => strength(b) - strength(a));
      if (rivals.length) {
        const r = rivals[0];
        const theirs = cands.filter((b) => this.owner[key(b)] === r);
        const homeK = this.home[r];
        if (homeK && reckless > 0.7 && Math.random() < 0.25 && theirs.some((b) => key(b) === homeK)) return this.byKey[homeK];
        const nonHome = theirs.filter((b) => key(b) !== homeK);
        if (nonHome.length) return pick(nonHome);
      }
    }
    // Calculating: unclaimed blocks near their turf, or the weakest gang's outer blocks.
    const mine = this.blocks.filter((b) => this.owner[key(b)] === g);
    const near = (b) => (mine.length ? Math.min(...mine.map((m) => Math.abs(m.i - b.i) + Math.abs(m.j - b.j))) : 0);
    const open = cands.filter((b) => !this.owner[key(b)]).sort((a, b) => near(a) - near(b));
    if (open.length && Math.random() < 0.7) return open[Math.floor(Math.random() * Math.min(3, open.length))];
    const weakest = ['kings', 'vipers', 'crew'].filter((o) => o !== g && this.count(o) > 0).sort((a, b) => strength(a) - strength(b))[0];
    const targets = cands.filter((b) => this.owner[key(b)] === weakest && key(b) !== this.home[weakest]);
    return targets.length ? pick(targets) : open[0] || null;
  }

  // Corner boys on the turf near you (so there's someone to provoke).
  updateGuards(dt) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    this.guardT -= dt;
    if (this.guardT > 0) return;
    this.guardT = 1;
    const guards = this.soldiers.filter((s) => s.side === 'guard' && s.alive && !s.war);
    for (const b of this.blocks) {
      const g = this.owner[key(b)];
      if (!g || g === 'crew' || this.warOn(key(b))) continue;
      if (g === 'kings' && key(b) === this.home.kings && game.gang.members.some((m) => m.alive)) continue; // the hangout crew is there
      const d = dist(b.cx, b.cz, px, pz);
      if (d > 140 || d < 45) continue; // appear out of view, not in front of you
      const here = guards.filter((s) => s.gangId === g && dist(s.homeX, s.homeZ, b.cx, b.cz) < 45);
      if (here.length >= 2 || guards.length >= 14) continue;
      const corner = [[b.minX + 2, b.minZ + 2], [b.maxX - 2, b.minZ + 2], [b.maxX - 2, b.maxZ - 2], [b.minX + 2, b.maxZ - 2]][here.length * 2 + Math.floor(Math.random() * 2)];
      const s = new Soldier(game, this, corner[0], corner[1], g, null, 'guard');
      this.soldiers.push(s);
      guards.push(s);
    }
  }

  fighters() {
    return this.soldiers;
  }

  update(dt) {
    const game = this.game;
    this.rollT -= dt;
    if (this.rollT <= 0) {
      this.rollT = 2;
      this.rollAttacks();
    }
    this.updateGuards(dt);
    for (const w of this.wars) w.update(dt);
    this.wars = this.wars.filter((w) => w.state === 'active');
    // Everyone fights for real, wherever they are; distant soldiers think a bit less often.
    const [px, pz] = game.player.pos();
    this.tick = (this.tick || 0) + 1;
    for (const s of this.soldiers) {
      const far = dist(s.x, s.z, px, pz) > 160;
      if (!far) s.update(dt);
      else {
        s.farDt = (s.farDt || 0) + dt;
        if ((this.tick + (s.homeX | 0)) % 3 === 0) {
          s.update(Math.min(s.farDt, 0.1));
          s.farDt = 0;
        }
      }
    }
    // Clear the dead, the departed, and idle guards far from you.
    for (const s of this.soldiers) {
      const d = dist(s.x, s.z, px, pz);
      if (s.state === 'dead' && s.t <= 0 && d > 50) s.dispose();
      else if (s.alive && !s.war && s.behavior === 'leave' && d > 70) s.dispose();
      else if (s.alive && !s.war && s.leaveAfter && game.time > s.leaveAfter && d > 90) s.dispose();
      else if (s.alive && s.side === 'guard' && !s.war && d > 220 && s.state !== 'fight') s.dispose();
    }
    this.soldiers = this.soldiers.filter((s) => !s.removed);
    for (const w of this.wars) w.fighters = w.fighters.filter((f) => !f.removed || f.state === 'dead');
  }

  // HUD banner: the war you're in or near.
  banner() {
    const [px, pz] = this.game.player.pos();
    const w = this.wars.find((x) => x.state === 'active' && (x.attacker === 'crew' || x.defender === 'crew'))
      || this.wars.find((x) => x.state === 'active' && dist(x.block.cx, x.block.cz, px, pz) < 160);
    return w ? w.summary() : '';
  }
}

function fmt(ms) {
  const m = Math.ceil(ms / MIN);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}
