import { START_TURF } from './districts.js';
import { CFG, GANG_NAME, CREW_NAME, CRED_TIERS } from './config.js';
import { GangFighter } from './gang.js';
import { pushCircle, segmentBlocked } from './collision.js';
import { Vehicle } from './vehicle.js';
import { steerToward, throttleFor, StuckHelper } from './driving.js';
import { dist, pick, rand } from './util.js';
import { streetAt } from './city.js';
import { SKIN_TONES } from './character.js';
import { Claim, claimTier, tierOf, makeTag } from './claim.js';

// Turf wars. Rules (agreed with the designer):
// - Each gang holds blocks; the rest of the city is unclaimed. No border rule, no cap.
// - Start a war on a gang's block by killing 3 of its members there. The defenders then come
//   in waves, and the attackers must wipe out every opp from every wave to take the block.
//   Waves scale with the defending gang's strength (3 waves of 3, +1 per wave per 2 blocks
//   held). Home blocks get an extra wave per other block held and 1.5x bigger waves; taking
//   a home block takes all of that gang's turf, and the gang goes underground (no turf) and
//   can't start a war for 24 hours.
// - Unclaimed blocks: NPC gangs hold them for 60 seconds with no enemies on them. You have to
//   earn them (see claim.js): enough street cred, tag the block, shake down the shops, then
//   survive the nearest rival gang's response.
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
  ? { lock: 2 * MIN, roll: 15 * MIN, underground: 5 * MIN, remember: 15 * MIN, quiet: 10 * MIN }
  : { lock: 2 * HOUR, roll: 45 * MIN, underground: 24 * HOUR, remember: 24 * HOUR, quiet: 30 * MIN };

export const GANGS = {
  kings: { id: 'kings', name: GANG_NAME, car: 0x5b1a7a, color: '#9c27b0', shirt: 0x6a1b9a, bandana: 0x8e24aa, reckless: 0.85, leader: 'Big Lo' },
  vipers: { id: 'vipers', name: 'East Side Vipers', car: 0xc8551b, color: '#ff7a1a', shirt: 0xc0561a, bandana: 0xff8f2a, reckless: 0.3, leader: 'Slim' },
  crew: { id: 'crew', name: CREW_NAME, car: 0x1f6b34, color: '#3dff6e', shirt: 0x1e7d32, bandana: 0x2e7d32, reckless: 0.5, leader: 'You' },
  // Not a turf gang: the plug's shooters, sent when you don't pay up.
  plug: { id: 'plug', name: "The plug's shooters", car: 0x111111, color: '#c8c8c8', shirt: 0x202020, bandana: 0x111111, reckless: 0, leader: '', hidden: true },
};
const START = START_TURF; // see districts.js
const SAVE_KEY = 'crimecity.turf.v2'; // v2: the bigger map (turf reset to the preset)
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
    // Police cracking down on this gang: shoot back.
    for (const o of game.police.officers()) {
      const task = o.unit.task;
      if (o.standing && task && task.type === 'crackdown' && task.gangs.includes(this.gangId) && dist(o.x, o.z, this.x, this.z) < 70) list.push({ x: o.x, z: o.z, ref: o });
    }
    return list;
  }

  update(dt) {
    if (this.boarding) {
      // Running to the gang car to jump in.
      const c = this.boarding.car;
      if (dist(this.x, this.z, c.x, c.z) < 2.6) this.boarding.board(this);
      else this.move(dt, c.x, c.z, 6, null);
      this.char.armR.rotation.x = -0.3;
      this.animate(dt);
      this.place();
      return;
    }
    if (this.state === 'inCar') {
      // Riding to a fight: just keep up with the car.
      if (this.ride) {
        this.x = this.ride.car.x;
        this.z = this.ride.car.z;
      }
      return;
    }
    if (this.updateDown(dt)) return;
    const game = this.game;
    if (this.taxing) {
      // Walking up to collect a cut from you for selling on their block.
      const [px, pz] = game.player.pos();
      const d = dist(this.x, this.z, px, pz);
      if (this.state === 'fight') this.endFight();
      if (d > 1.9) this.move(dt, px, pz, d > 10 ? 5 : 2.2, null);
      else {
        this.move(dt, this.x, this.z, 0, null);
        this.heading = Math.atan2(px - this.x, pz - this.z);
      }
      this.char.armR.rotation.x = -0.3;
      this.animate(dt);
      this.place();
      return;
    }
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
        // Defenders hold the block (meeting opps that get close to it); attackers head for
        // the block, taking on any opps they run into on the way.
        let goal = null;
        let best = Infinity;
        for (const e of list) {
          const d = this.side === 'def' ? dist(w.block.cx, w.block.cz, e.x, e.z) : dist(this.x, this.z, e.x, e.z);
          if (d < (this.side === 'def' ? 80 : 60) && d < best) {
            best = d;
            goal = e;
          }
        }
        let gx = goal ? goal.x : w.block.cx;
        let gz = goal ? goal.z : w.block.cz;
        // Far away: follow the streets instead of walking into buildings.
        if (dist(this.x, this.z, gx, gz) > 70) [gx, gz] = this.mgr.streetStep(this, gx, gz);
        else this.route = null;
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
  constructor(mgr, block, attacker, defender, byPlayer, responder = null) {
    const game = mgr.game;
    this.mgr = mgr;
    this.game = game;
    this.block = block;
    this.key = key(block);
    this.attacker = attacker;
    this.defender = defender;
    this.byPlayer = byPlayer;
    this.responder = responder; // a rival answering a claim on an unclaimed block
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
    } else if (responder) {
      // Answering a claim: two waves, three if they're bigger than Green Street.
      const n = mgr.count(responder) > mgr.count(attacker) ? 3 : 2;
      this.waves.def = Array(n).fill(size(responder));
    }
    // NPC attackers come lighter than defenders (about 40% fewer).
    if (!byPlayer) this.waves.att = Array(3).fill(Math.max(2, Math.round(size(attacker) * 0.6)));
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

  // Send a side's next wave: real members of that gang, nearest first (the ones already on
  // or near the block, then crews from posts and the home base). Far ones drive over in the
  // gang's cars. If the gang has nobody left to send, it's out of waves.
  dispatchWave(side) {
    const n = this.waves[side][this.waveIdx[side]];
    const gang = side === 'att' ? this.attacker : this.defender || this.responder;
    const b = this.block;
    const free = this.mgr.available(gang).sort((p, q) => dist(p.x, p.z, b.cx, b.cz) - dist(q.x, q.z, b.cx, b.cz));
    const picked = free.slice(0, n);
    if (!picked.length) {
      this.waveIdx[side] = this.waves[side].length; // nobody left to send
      return;
    }
    for (const s of picked) {
      s.war = this;
      s.side = side;
      s.aggroUntil = 0;
      if (s.group) s.group.members = s.group.members.filter((m) => m !== s);
      s.group = null;
      this.fighters.push(s);
    }
    this.mgr.sendRides(picked.filter((s) => dist(s.x, s.z, b.cx, b.cz) > 90), b);
    this.waveIdx[side]++;
  }

  // HUD summary: wave and opps left, from your side's point of view if you're in it.
  summary() {
    const mine = this.attacker === 'crew' ? 'att' : this.defender === 'crew' ? 'def' : null;
    const opp = mine === 'att' ? 'def' : 'att';
    const g = (id) => (id ? GANGS[id].name : 'nobody');
    const defG = this.defender || this.responder;
    const side = mine ? opp : 'def';
    const waves = this.waves[side].length;
    const idx = Math.max(1, this.waveIdx[side]);
    const gang = side === 'att' ? this.attacker : defG;
    const queued = this.waves[side].slice(this.waveIdx[side]).reduce((a, b) => a + b, 0);
    const left = this.living(side).length + Math.min(queued, gang ? this.mgr.available(gang).length : 0);
    let text = this.responder ? `CLAIMING ${this.street} · 3/3 survive ${g(this.responder)}` : `TURF WAR · ${g(this.attacker)} vs ${g(this.defender)} · ${this.street}`;
    if (defG || !this.byPlayer) text += ` · wave ${Math.min(idx, waves || 1)}/${waves || 1} · ${left} opps left`;
    if (!defG) text += ` · hold ${Math.max(0, 60 - this.holdT).toFixed(0)}s`;
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
      // The next crew heads out when the current wave is nearly finished (they need time to get there).
      if (this.living(side).length > (this.waveIdx[side] === 0 ? 0 : 1)) {
        this.spawnT[side] = 2;
        continue;
      }
      this.spawnT[side] -= dt;
      if (this.spawnT[side] <= 0) this.dispatchWave(side);
    }
    const defOut = this.waveIdx.def >= this.waves.def.length && !this.living('def').length;
    const attOut = !this.byPlayer && this.waveIdx.att >= this.waves.att.length && !this.living('att').length;

    // You leading the attack: stay alive and stay on the block.
    if (this.byPlayer) {
      if (game.wastedT > 0) return this.end(false, 'you went down');
      if (game.bustedT > 0) return this.end(false, 'you got busted');
      const [px, pz] = game.player.pos();
      this.awayT = this.onBlock(px, pz) ? 0 : this.awayT + dt;
      if (this.awayT > 20) return this.end(false, 'you left the block');
    }
    if (!this.defender && !this.responder) {
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
    // Bodies in the street count against the President.
    const dead = this.fighters.filter((f) => !f.alive).length;
    game.president?.add(3 + dead * 1.5, 'Gang wars');
    const A = GANGS[this.attacker].name;
    const D = this.defender ? GANGS[this.defender].name : null;
    const b = this.block;
    if (won) {
      this.mgr.transfer(this, this.attacker, this.defender, this.home);
      const head = this.defender
        ? `${A} take ${D} turf on ${this.street}${this.home ? ' — their home block' : ''}`
        : `${A} claim a block on ${this.street}`;
      game.newsIncident(head, b.cx, b.cz, this.attacker === 'crew' ? 'good' : 'crime');
      if (this.attacker === 'crew') game.hud.toast(this.home ? `${D} turf is yours!` : this.responder ? `${GANGS[this.responder].name} ran off. ${this.street} is Green Street now!` : 'Block taken!');
    } else {
      const head = this.defender ? `${D} hold off ${A} on ${this.street}` : `${A} fail to claim ${this.street}`;
      game.hud.news(head, this.defender === 'crew' ? 'good' : 'info');
      if (this.attacker === 'crew') game.hud.toast(this.responder ? `Claim failed: ${why}` : `Turf war lost: ${why}`, '#ff8080');
      if (this.defender === 'crew') game.hud.toast('Your block held!');
    }
    if (!this.byPlayer) this.mgr.quietUntil = Date.now() + T.quiet;
    // Police come by afterwards to look into it (unless they were already here cracking down).
    if (!game.police.units.some((u) => u.task && u.task.war === this)) game.police.investigateLater(this.block, this.street);
    // Survivors: the side that holds the block posts up there; the others head home.
    const holder = won ? this.attacker : this.defender;
    const stay = this.fighters.filter((f) => f.alive && f.gangId === holder && f.state !== 'inCar');
    if (holder && stay.length) this.mgr.postGroup(holder, this.block, stay);
    for (const f of this.fighters) {
      if (!f.alive || stay.includes(f)) continue;
      f.war = null;
      f.side = 'guard';
      this.mgr.sendHome(f);
    }
    this.mgr.save();
  }
}

// A gang car taking a crew to a fight: drives the street grid, pulls up near the block, and
// everyone piles out.
export class GangRide {
  constructor(mgr, car, riders, block, mode = 'war') {
    this.mgr = mgr;
    this.game = mgr.game;
    this.car = car;
    this.riders = riders;
    this.block = block;
    this.mode = mode; // 'war' (to a block), 'chase' (after you), 'home' (heading back)
    this.boardingT = 0;
    this.fireT = 1;
    this.stuck = new StuckHelper();
    this.to = null;
    this.from = null;
    this.done = false;
    this.keep = true;
    this.t = 0;
    car.driver = this;
    // Everyone runs to the car and climbs in.
    for (const r of riders) {
      if (r.state === 'fight') r.endFight();
      r.boarding = this;
    }
  }

  board(r) {
    r.boarding = null;
    r.state = 'inCar';
    r.ride = this;
    r.char.group.visible = false;
    this.car.openDoor(this.riders.indexOf(r) % 2 ? 1 : -1, 0.8);
  }

  get boarded() {
    return this.riders.every((r) => r.state === 'inCar' || !r.alive);
  }

  dismount() {
    const c = this.car;
    const [fx, fz] = c.forward();
    this.riders.forEach((r, i) => {
      if (r.boarding === this) r.boarding = null;
      if (!r.alive || r.state !== 'inCar') return;
      const side = i % 2 ? 1 : -1;
      const p = pushCircle(c.x - fz * side * 1.9 - fx * (i > 1 ? 1.6 : 0), c.z + fx * side * 1.9 - fz * (i > 1 ? 1.6 : 0), 0.4, this.game.city.colliders);
      r.x = p.x;
      r.z = p.z;
      r.state = 'idle';
      r.ride = null;
      r.char.group.visible = true;
      c.openDoor(side, 1.2);
    });
    if (c.driver === this) c.driver = null;
    this.done = true;
    const game = this.game;
    if (this.mode === 'chase') {
      // Out of the car and still after you.
      for (const r of this.riders) if (r.alive) r.aggroUntil = game.time + 45;
    } else if (this.mode === 'home') {
      for (const r of this.riders) if (r.alive) this.mgr.sendHome(r);
    }
  }

  update(dt) {
    if (this.done) return;
    const c = this.car;
    const game = this.game;
    this.t += dt;
    if (c.removed || c.wrecked || c.driver !== this) return this.dismount();
    if (!this.boarded) {
      // Waiting for everyone to get in (anyone who takes too long is left behind).
      this.boardingT += dt;
      if (this.boardingT > 6) this.riders = this.riders.filter((r) => r.state === 'inCar' || (r.boarding = null));
      if (!this.riders.length) return this.dismount();
      c.update(dt, { throttle: 0, steer: 0, handbrake: true }, game.city.colliders);
      return;
    }
    if (this.mode === 'chase') return this.chase(dt);
    if (this.t > 120) return this.dismount();
    // Wedged in somewhere: everyone out, go on foot.
    this.stillT = Math.abs(c.speed) < 0.5 && this.t > 3 ? (this.stillT || 0) + dt : 0;
    if (this.stillT > 6) return this.dismount();
    const b = this.block;
    const d = dist(c.x, c.z, b.cx, b.cz);
    let tx, tz, want;
    if (d < 60 && !segmentBlocked(c.x, c.z, b.cx, b.cz, game.city.los)) {
      tx = b.cx;
      tz = b.cz;
      want = d < 38 ? 0 : 9;
    } else {
      const city = game.city;
      if (!this.to) this.to = city.nearestNode(c.x, c.z);
      if (dist(c.x, c.z, this.to.x, this.to.z) < 10) {
        const opts = this.to.nb.filter((nb) => nb !== this.from).sort((p, q) => dist(p.x, p.z, b.cx, b.cz) - dist(q.x, q.z, b.cx, b.cz));
        this.from = this.to;
        this.to = opts[0] || this.from;
      }
      tx = this.to.x;
      tz = this.to.z;
      want = dist(c.x, c.z, tx, tz) < 22 ? 11 : 20;
    }
    const [fx, fz] = c.forward();
    // Don't plow into the car in front.
    const pullingOut = this.t < 4;
    if (pullingOut) {
      // Pull out of the parking spot into the lane first.
      tx = c.x + fx * 8 + (this.to ? Math.sign(this.to.x - c.x) * 3 : 0);
      tz = c.z + fz * 8 + (this.to ? Math.sign(this.to.z - c.z) * 3 : 0);
      want = Math.min(want, 6);
    }
    for (const o of game.vehicles) {
      if (o === c || o.removed) continue;
      if (pullingOut && o.driver === null) continue; // parked cars: just ease out past them
      const ox = o.x - c.x, oz = o.z - c.z;
      if (Math.abs(ox) > 16 || Math.abs(oz) > 16) continue;
      const fwd = ox * fx + oz * fz;
      if (fwd > 0 && fwd < 14 && Math.abs(ox * fz - oz * fx) < 2.6) want = Math.min(want, Math.max(0, (fwd - 6) * 1.2));
    }
    const ctrl = { throttle: throttleFor(c, want), steer: steerToward(c, tx, tz), handbrake: want === 0 };
    this.stuck.apply(dt, c, want, ctrl);
    c.update(dt, ctrl, game.city.colliders);
    if (want === 0 && d < 40 && Math.abs(c.speed) < 1) this.dismount();
  }

  // Chasing you: follow the streets toward you, drive straight at you when close, and shoot
  // out the windows. If you stop or get out, they pull up and pile out. They give up after a
  // while or once they've lost you, and drive home.
  chase(dt) {
    const c = this.car;
    const game = this.game;
    const [px, pz] = game.player.pos();
    const pv = game.player.vehicle;
    const d = dist(c.x, c.z, px, pz);
    const see = d < 70 && !segmentBlocked(c.x, c.z, px, pz, game.city.los);
    this.lostT = see || d < 120 ? 0 : (this.lostT || 0) + dt;
    if (this.t > 90 || this.lostT > 12 || game.wastedT > 0) {
      // Give up: head back to the home base.
      const home = this.mgr.homeBlock(this.car.stolenFrom || this.riders[0]?.gangId) || this.block;
      this.mode = 'home';
      this.block = home;
      this.t = 0;
      this.to = null;
      return;
    }
    let tx, tz, want;
    if (see) {
      const [vx, vz] = game.player.velocity();
      tx = px + vx * 0.5;
      tz = pz + vz * 0.5;
      want = Math.min(26, 8 + d * 0.8 + Math.hypot(vx, vz));
      this.to = null;
    } else {
      const city = game.city;
      if (!this.to) this.to = city.nearestNode(c.x, c.z);
      if (dist(c.x, c.z, this.to.x, this.to.z) < 10) {
        const opts = this.to.nb.filter((nb) => nb !== this.from).sort((p, q) => dist(p.x, p.z, px, pz) - dist(q.x, q.z, px, pz));
        this.from = this.to;
        this.to = opts[0] || this.from;
      }
      tx = this.to.x;
      tz = this.to.z;
      want = dist(c.x, c.z, tx, tz) < 22 ? 12 : 24;
    }
    // You stopped (or you're on foot nearby): pull up and get out.
    const stopped = (!pv && d < 22) || (pv && Math.abs(pv.speed) < 2 && d < 14);
    if (stopped) want = 0;
    const ctrl = { throttle: throttleFor(c, want), steer: steerToward(c, tx, tz), handbrake: want === 0 };
    this.stuck.apply(dt, c, want, ctrl);
    c.update(dt, ctrl, game.city.colliders);
    if (stopped && Math.abs(c.speed) < 1.5) return this.dismount();
    // Drive-by: the passengers shoot at you out the windows.
    this.fireT -= dt;
    if (see && d < 40 && this.fireT <= 0 && this.riders.length > 1) {
      this.fireT = rand(0.35, 0.7);
      const h = Math.atan2(px - c.x, pz - c.z);
      game.npcShoot({ x: c.x, z: c.z, heading: h, muzzleY: game.city.groundY(c.x, c.z) + 1.3, crouched: false }, 6, 'smg', 0.55);
    }
  }
}

export class TurfManager {
  constructor(game) {
    this.game = game;
    this.soldiers = [];
    this.wars = [];
    this.provoke = {}; // key -> { n, t }
    this.claimHold = 0;
    this.claim = null; // your claim in progress on an unclaimed block
    this.claimCooldown = {};
    this.tagMeshes = {};
    this.blocks = game.city.blocks.filter((b) => b.type !== 'police' && b.type !== 'hospital');
    this.byKey = Object.fromEntries(this.blocks.map((b) => [key(b), b]));
    if (!this.load()) this.reset();
    this.rollT = 0;
    this.version = 0;
    this.groups = []; // gang members hanging out somewhere, with their cars
    this.rides = []; // crews driving to a fight
    this.cars = [];
    this.recruitT = {};
    this.populated = false;
  }

  // --- The gangs on the map -------------------------------------------------------------
  // Each gang has a busy home base (a crowd and several cars), small groups posted on its
  // other blocks, and a crew hanging around elsewhere. Groups of three or more have a car;
  // big groups have two or more.
  populate() {
    this.populated = true;
    for (const g of Object.keys(GANGS)) {
      if (this.underground(g)) continue;
      const hb = this.homeBlock(g);
      if (hb) this.makeGroup(g, hb, g === 'kings' ? 6 : 8, 3, 'home', g === 'kings' ? 1 : 0);
      const posts = this.blocks.filter((b) => this.owner[key(b)] === g && key(b) !== this.home[g]);
      posts.forEach((b, i) => {
        const n = i % 2 ? 3 : 2;
        this.makeGroup(g, b, n, n >= 3 ? 1 : 0, 'post');
      });
      // A crew of four hanging out on an unclaimed block near their turf.
      const mine = this.blocks.filter((b) => this.owner[key(b)] === g);
      const open = this.blocks.filter((b) => !this.owner[key(b)] && b.type !== 'park')
        .sort((p, q) => Math.min(...mine.map((m) => dist(m.cx, m.cz, p.cx, p.cz))) - Math.min(...mine.map((m) => dist(m.cx, m.cz, q.cx, q.cz))));
      if (open.length) this.makeGroup(g, open[Math.floor(Math.random() * Math.min(3, open.length))], 4, 2, 'roam');
    }
  }

  // Spots along one edge of a block: people on the sidewalk, cars at the curb.
  edgeSpots(b, side) {
    const W = b.maxX - b.minX;
    return {
      person: (i) => [[b.minX + 8 + i * 2.6, b.minZ + 2.2], [b.minX + 8 + i * 2.6, b.maxZ - 2.2], [b.minX + 2.2, b.minZ + 8 + i * 2.6], [b.maxX - 2.2, b.minZ + 8 + i * 2.6]][side],
      car: (j) => [[b.minX + 10 + j * 6.5, b.minZ - 1.4, Math.PI / 2], [b.minX + 10 + j * 6.5, b.maxZ + 1.4, -Math.PI / 2], [b.minX - 1.4, b.minZ + 10 + j * 6.5, 0], [b.maxX + 1.4, b.minZ + 10 + j * 6.5, Math.PI]][side],
      W,
    };
  }

  makeGroup(g, b, n, nCars, kind, side = Math.floor(Math.random() * 4)) {
    const game = this.game;
    const group = { gang: g, block: b, kind, side, members: [], cars: [] };
    const E = this.edgeSpots(b, side);
    for (let i = 0; i < n; i++) {
      let [x, z] = E.person(i);
      x += rand(-0.6, 0.6);
      z += rand(-0.6, 0.6);
      const r = pushCircle(x, z, 0.45, game.city.colliders);
      const s = new Soldier(game, this, r.x, r.z, g, null, 'guard');
      s.group = group;
      group.members.push(s);
      this.soldiers.push(s);
    }
    for (let j = 0; j < nCars; j++) this.parkCar(group, ...E.car(j));
    this.groups.push(group);
    return group;
  }

  parkCar(group, x, z, h) {
    const game = this.game;
    if (game.vehicles.some((v) => !v.removed && dist(v.x, v.z, x, z) < 5)) return null;
    const type = group.kind === 'home' && group.cars.length === 2 ? 'van' : 'sedan';
    const v = new Vehicle(game.scene, type, x, z, h, GANGS[group.gang].car);
    v.gangCar = group.gang;
    game.vehicles.push(v);
    group.cars.push(v);
    this.cars.push(v);
    return v;
  }

  // Next street corner on the way to (gx, gz), for someone on foot crossing town.
  streetStep(s, gx, gz) {
    const city = this.game.city;
    if (!s.route || dist(s.x, s.z, s.route.x, s.route.z) < 4) {
      const from = s.route || city.nearestNode(s.x, s.z);
      if (!s.route) s.route = from;
      else {
        const opts = from.nb.filter((n) => n !== s.routePrev).sort((p, q) => dist(p.x, p.z, gx, gz) - dist(q.x, q.z, gx, gz));
        s.routePrev = from;
        s.route = opts[0] || from;
      }
    }
    return [s.route.x, s.route.z];
  }

  // Gang members free to be sent to a fight.
  available(g) {
    return this.soldiers.filter((s) => s.gangId === g && s.alive && s.standing && !s.war && !s.boarding && s.behavior !== 'leave' && s.state !== 'fight');
  }

  // Members far from the fight pile into nearby gang cars (up to four a car) and drive over.
  sendRides(members, block) {
    const left = [...members];
    while (left.length) {
      const s = left[0];
      const car = this.cars.find((v) => !v.removed && !v.wrecked && v.driver === null && Math.abs(v.speed) < 1
        && v.gangCar === s.gangId && dist(v.x, v.z, s.x, s.z) < 30);
      if (!car) {
        left.shift(); // no car handy: run
        continue;
      }
      const riders = left.filter((m) => dist(m.x, m.z, car.x, car.z) < 35).slice(0, 4);
      for (const m of riders) left.splice(left.indexOf(m), 1);
      this.rides.push(new GangRide(this, car, riders, block));
    }
  }

  // You stole one of their cars: angry members near their other cars jump in and come after
  // you (up to two carloads).
  sendChase(g, stolen) {
    const angry = this.soldiers.filter((s) => s.gangId === g && s.alive && s.standing && !s.war && s.aggroUntil > this.game.time && !s.boarding);
    let rides = 0;
    for (const car of this.cars) {
      if (rides >= 2) break;
      if (car === stolen || car.removed || car.wrecked || car.driver !== null || car.gangCar !== g) continue;
      const crew = angry.filter((s) => !s.boarding && dist(s.x, s.z, car.x, car.z) < 30).slice(0, 3);
      if (!crew.length) continue;
      const ride = new GangRide(this, car, crew, null, 'chase');
      this.rides.push(ride);
      rides++;
    }
    if (rides) this.game.hud.news(`${GANGS[g].name} chasing a car thief through ${streetAt(stolen.x, stolen.z)}`, 'crime');
  }

  // The winners of a fight stay posted on the block they hold.
  postGroup(g, block, members) {
    const group = { gang: g, block, kind: 'post', side: 0, members: [], cars: [] };
    for (const s of members) {
      s.war = null;
      s.side = 'guard';
      s.group = group;
      s.homeX = s.x;
      s.homeZ = s.z;
      group.members.push(s);
    }
    for (const r of this.rides) if (r.block === block && r.car.gangCar === g && r.done) group.cars.push(r.car);
    this.groups.push(group);
  }

  // Back to the home base (or wherever the gang hangs out now).
  sendHome(s) {
    const home = this.groups.find((gr) => gr.gang === s.gangId && gr.kind === 'home') || this.groups.find((gr) => gr.gang === s.gangId);
    if (s.state === 'fight') s.endFight();
    if (home) {
      const [x, z] = this.edgeSpots(home.block, home.side).person(home.members.length % 8);
      s.homeX = x;
      s.homeZ = z;
      s.group = home;
      home.members.push(s);
    } else {
      s.homeX = s.x;
      s.homeZ = s.z;
    }
  }

  // Gangs slowly recruit back up to strength; new members walk out at the home base
  // (only while you're not watching it).
  recruit(dt) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    for (const g of Object.keys(GANGS)) {
      const home = this.groups.find((gr) => gr.gang === g && gr.kind === 'home');
      if (!home || this.underground(g)) continue;
      this.recruitT[g] = (this.recruitT[g] || 0) + dt;
      if (this.recruitT[g] < (CFG.TURF_FAST ? 30 : 90)) continue;
      this.recruitT[g] = 0;
      const want = 8 + this.count(g) * 2.5;
      if (this.soldiers.filter((s) => s.gangId === g && s.alive).length >= want) continue;
      if (dist(home.block.cx, home.block.cz, px, pz) < 90) continue;
      const [x, z] = this.edgeSpots(home.block, home.side).person(home.members.length % 8);
      const s = new Soldier(game, this, x, z, g, null, 'guard');
      s.group = home;
      home.members.push(s);
      this.soldiers.push(s);
      // Replace a lost car now and then.
      if (home.cars.filter((v) => !v.removed && !v.wrecked && v.gangCar === g).length < 3) {
        const E = this.edgeSpots(home.block, home.side);
        for (let j = 0; j < 4; j++) if (this.parkCar(home, ...E.car(j))) break;
      }
    }
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
    this.crackdown = {};
    this.tags = {};
    const now = Date.now();
    this.nextRoll = { kings: now + T.roll * rand(0.3, 1), vipers: now + T.roll * rand(0.3, 1) };
    this.save();
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!s || !s.owner) return false;
      Object.assign(this, { owner: s.owner, home: s.home, lock: s.lock || {}, lost: s.lost || { kings: [], vipers: [], crew: [] }, under: s.under || {}, nextRoll: s.nextRoll || {}, crackdown: s.crackdown || {}, tags: s.tags || {} });
      return true;
    } catch {
      return false;
    }
  }

  save() {
    this.version++;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ owner: this.owner, home: this.home, lock: this.lock, lost: this.lost, under: this.under, nextRoll: this.nextRoll, crackdown: this.crackdown, tags: this.tags }));
    } catch {
      // Storage unavailable: turf just won't persist.
    }
  }

  gangName(g) {
    return GANGS[g] ? GANGS[g].name : g;
  }

  // The President's orders: crack down on a gang (police fight its wars) or leave it alone.
  setCrackdown(g, on) {
    if (!!this.crackdown[g] === on) return;
    this.crackdown[g] = on;
    this.save();
    this.game.hud.news(on ? `President orders a police crackdown on ${GANGS[g].name}` : `President calls off the crackdown on ${GANGS[g].name}`, 'info');
    if (on) for (const w of this.wars) if (w.state === 'active' && (w.attacker === g || w.defender === g)) this.game.police.crackdownOn(w);
  }

  // You're fighting in a turf war (so the shooting there isn't a police matter, unless
  // the President is cracking down on your gang).
  playerInWar() {
    const [px, pz] = this.game.player.pos();
    return this.wars.some((w) => w.state === 'active' && (w.attacker === 'crew' || w.defender === 'crew') && w.onBlock(px, pz, 40)) && !this.crackdown.crew;
  }

  // Gang business: shooting it out with a gang on its own turf isn't a police matter unless
  // the President is cracking down on Green Street or on that gang.
  gangBusiness(x, z, victimGang = null) {
    if (this.crackdown.crew) return false;
    if (this.playerInWar()) return true;
    const k = this.ownerKeyAt(x, z);
    const g = k && this.owner[k];
    if (!g || g === 'crew') return false;
    if (victimGang) return victimGang === g && !this.crackdown[g];
    // Shots fired: only if that gang's people are around and you're at odds with them.
    return !this.crackdown[g] && this.soldiers.some((s) => s.standing && s.gangId === g && dist(s.x, s.z, x, z) < 60);
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

  startWar(b, attacker, defender, byPlayer, responder = null) {
    const k = key(b);
    if (this.warOn(k)) return null;
    const w = new War(this, b, attacker, defender, byPlayer, responder);
    this.wars.push(w);
    this.game.police.crackdownOn(w);
    const A = GANGS[attacker].name;
    const D = defender ? GANGS[defender].name : null;
    const game = this.game;
    if (defender === 'crew') {
      game.hud.news(`${A} are hitting your block on ${w.street}!`, 'crime');
      game.hud.toast(`${A} attacking your turf on ${w.street}`, '#ff8080');
    } else if (responder) {
      game.hud.news(`${GANGS[responder].name} roll up on Green Street at ${w.street}`, 'crime');
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
      if (winner !== 'crew') this.clearTags(k);
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
  aggro(g, x, z, radius = 45, secs = 40) {
    const until = this.game.time + secs;
    for (const s of this.soldiers) if (s.gangId === g && s.alive && dist(s.x, s.z, x, z) < radius) s.aggroUntil = until;
  }

  // You took one of their cars: everyone from that gang nearby comes after you.
  carStolen(v) {
    const g = v.gangCar;
    if (!g || g === 'crew') return;
    const game = this.game;
    this.aggro(g, v.x, v.z, 90, 60);
    if (g === 'kings' && dist(v.x, v.z, game.city.gangHome.x, game.city.gangHome.z) < 90) game.gang.anger();
    // It's yours now: they won't use it for rides any more.
    for (const gr of this.groups) gr.cars = gr.cars.filter((c) => c !== v);
    this.cars = this.cars.filter((c) => c !== v);
    v.stolenFrom = g;
    v.gangCar = null;
    this.sendChase(g, v);
    const near = this.soldiers.filter((s) => s.gangId === g && s.alive && dist(s.x, s.z, v.x, v.z) < 90).length;
    const an = /^[AEIOU]/i.test(GANGS[g].name) ? 'an' : 'a';
    game.hud.toast(near ? `You stole ${an} ${GANGS[g].name} car — ${near} of them are coming for you` : `You stole ${an} ${GANGS[g].name} car`, '#ff8080');
    if (near) game.hud.news(`${GANGS[g].name} car stolen on ${streetAt(v.x, v.z)}`, 'crime');
  }

  // A rival gang hears you're carrying: their nearest crews with cars come hunting you
  // (real members from where they are, not out of nowhere).
  sendHunters(g, x, z, maxRides = 2) {
    if (this.underground(g)) return 0;
    const game = this.game;
    const cars = this.cars
      .filter((c) => !c.removed && !c.wrecked && c.driver === null && c.gangCar === g && dist(c.x, c.z, x, z) < 400)
      .sort((p, q) => dist(p.x, p.z, x, z) - dist(q.x, q.z, x, z));
    let rides = 0;
    for (const car of cars) {
      if (rides >= maxRides) break;
      const crew = this.soldiers.filter((s) => s.gangId === g && s.alive && s.standing && !s.war && !s.boarding && dist(s.x, s.z, car.x, car.z) < 35).slice(0, 3);
      if (!crew.length) continue;
      for (const s of crew) s.aggroUntil = game.time + 120;
      this.rides.push(new GangRide(this, car, crew, null, 'chase'));
      rides++;
    }
    return rides;
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

  // Green Street tags on blocks you claimed (drawn on the walls).
  addTags(k, spots) {
    this.tags[k] = spots;
    this.save();
    this.drawTags();
  }

  clearTags(k) {
    if (!this.tags[k]) return;
    delete this.tags[k];
    this.drawTags();
  }

  drawTags() {
    const scene = this.game.scene;
    for (const [k, list] of Object.entries(this.tagMeshes)) {
      if (this.tags[k]) continue;
      for (const m of list) {
        scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
      delete this.tagMeshes[k];
    }
    for (const [k, spots] of Object.entries(this.tags)) {
      if (!this.tagMeshes[k]) this.tagMeshes[k] = spots.map(([x, z, nx, nz]) => makeTag(scene, x, z, nx, nz));
    }
  }

  // A claim with nobody around to answer it: the block is just yours.
  transferClaim(claim) {
    const k = claim.key;
    this.owner[k] = 'crew';
    this.lock[k] = Date.now() + T.lock;
    if (!this.home.crew) this.home.crew = k;
    this.save();
    this.game.newsIncident(`Green Street claim a block on ${claim.street}`, claim.block.cx, claim.block.cz, 'good');
    this.game.hud.toast(`${claim.street} is Green Street now!`);
  }

  // Cred tier you need to claim another block.
  claimNeed() {
    return claimTier(this.count('crew'));
  }

  // Prompt to start claiming an unclaimed block, or the current claim's prompts.
  // Returns true if it showed one.
  interact(a, dt) {
    const game = this.game;
    if (this.claim) return this.claim.interact(a, dt);
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
    if ((this.claimCooldown[k] || 0) > Date.now()) {
      game.prompt = `Unclaimed block · the street's still watching after your last try (${fmt(this.claimCooldown[k] - Date.now())})`;
      return true;
    }
    const need = this.claimNeed();
    if (!CFG.CLAIM_IGNORE_CRED && tierOf(game.cred) < need) {
      game.prompt = `Unclaimed block · you need ${CRED_TIERS[need].name} street cred to claim it (${game.cred.toLocaleString('en-US')}/${CRED_TIERS[need].min.toLocaleString('en-US')})`;
      return true;
    }
    if (a.interactHeld) {
      this.claimHold += dt;
      game.progress = { value: Math.min(1, this.claimHold / 1.5), label: 'Starting a claim…' };
      if (this.claimHold >= 1.5) {
        this.claimHold = 0;
        this.claim = new Claim(this, b);
      }
    } else this.claimHold = 0;
    game.prompt = `Unclaimed block · hold ${label} to claim it: tag it, shake it down, hold it`;
    return true;
  }

  // NPC gangs deciding whether (and where) to attack.
  // NPC gangs start wars rarely: each rolls on its own timer, only one NPC-started war can
  // be going at a time, and the streets stay quiet for a while after one ends.
  rollAttacks() {
    const now = Date.now();
    if (this.wars.some((w) => w.state === 'active' && !w.byPlayer)) return;
    if (now < (this.quietUntil || 0)) return;
    for (const g of ['kings', 'vipers']) {
      if (now < (this.nextRoll[g] || 0)) continue;
      this.nextRoll[g] = now + T.roll;
      this.save();
      if ((this.under[g] || 0) > now) continue;
      if (this.wars.some((w) => w.state === 'active' && (w.attacker === g || w.defender === g))) continue;
      if (Math.random() > 1 / 3) continue;
      const target = this.chooseTarget(g);
      if (target && this.startWar(target, g, this.owner[key(target)] || null, false)) return;
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

  // Radar markers for your claim.
  claimMarks() {
    return this.claim ? this.claim.radar() : [];
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
    if (!this.populated) this.populate();
    this.recruit(dt);
    if (!this.tagsDrawn) {
      this.tagsDrawn = true;
      this.drawTags();
    }
    if (this.claim) {
      this.claim.update(dt);
      if (!this.claim.active) this.claim = null;
    }
    for (const w of this.wars) w.update(dt);
    for (const r of this.rides) r.update(dt);
    this.rides = this.rides.filter((r) => !r.done || r.keep);
    this.wars = this.wars.filter((w) => w.state === 'active');
    // Everyone fights for real, wherever they are; distant soldiers think a bit less often.
    const [px, pz] = game.player.pos();
    this.tick = (this.tick || 0) + 1;
    for (const s of this.soldiers) {
      const d = dist(s.x, s.z, px, pz);
      // Idle members far away just stand there (not drawn, not thinking) until needed.
      const idle = !s.war && s.state !== 'fight' && s.aggroUntil <= game.time && s.alive;
      if (idle && d > 200 && dist(s.x, s.z, s.homeX, s.homeZ) < 2) {
        s.char.group.visible = false;
        continue;
      }
      if (s.state !== 'inCar') s.char.group.visible = true;
      const far = d > 160;
      if (!far) s.update(dt);
      else {
        s.farDt = (s.farDt || 0) + dt;
        if ((this.tick + (s.homeX | 0)) % 3 === 0) {
          s.update(Math.min(s.farDt, 0.1));
          s.farDt = 0;
        }
      }
    }
    // Clear away bodies once you're gone. Members who ran off regroup at home.
    for (const s of this.soldiers) {
      const d = dist(s.x, s.z, px, pz);
      if (s.state === 'dead' && s.t <= 0 && d > 50) s.dispose();
      else if (s.alive && !s.war && s.behavior === 'leave' && d > 70) {
        s.endFight();
        this.sendHome(s);
        const h = s.group;
        if (h) [s.x, s.z] = [s.homeX, s.homeZ];
      }
    }
    this.soldiers = this.soldiers.filter((s) => !s.removed);
    for (const gr of this.groups) gr.members = gr.members.filter((m) => !m.removed && m.alive);
    // Gang cars far away aren't drawn.
    this.cars = this.cars.filter((v) => !v.removed);
    for (const v of this.cars) v.group.visible = dist(v.x, v.z, px, pz) < 300;
    for (const w of this.wars) w.fighters = w.fighters.filter((f) => !f.removed || f.state === 'dead');
  }

  // HUD banner: the war you're in or near.
  banner() {
    if (this.claim && this.claim.stage !== 'response') return this.claim.summary();
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
