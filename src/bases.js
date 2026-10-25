import * as THREE from 'three';
import { GANGS, Soldier } from './turf.js';
import { storefront, signTexture } from './shops.js';
import { streetAt } from './city.js';
import { dist } from './util.js';

// Gang home bases. A gang's base is its home block, and how big a base it runs depends on how
// strong the gang is:
//   Tier 1 Trap house · Tier 2 Apartment spot / duplex · Tier 3 Warehouse / nightclub ·
//   Tier 4 Penthouse / mansion.
// - Strength: blocks held, members on the street, the kingpin alive, money in the base, and (for
//   your crew) street cred. Shown on the map and in the legend.
// - Sites: any block on the gang's own turf can be its base, but what it can be depends on the
//   district (the Projects and Midtown top out at an apartment spot, the Docks at a warehouse,
//   the Strip at a nightclub, Downtown and the Financial District at a penthouse, the Heights at
//   a mansion). A gang moves to the best site its strength allows once that's held for a while —
//   only while you're well away. The kingpin and the home crew move with it.
// - Bigger bases: more guards, more cars, and a bigger show on the building (a flag, a banner,
//   neon, a rooftop flag).
// - Money: rival bases keep cash from their blocks and protection money. Rob it at the door
//   (hold E / ✕) — the whole gang comes for you. Taking the base block in a turf war still wipes
//   the gang off the map.
// - Your crew's base upgrades in place at your hangout (it doesn't move).
const TIERS = [0, 50, 85, 120]; // strength needed for tiers 1-4
const SITE = {
  'The Projects': [2, 'Apartment spot'],
  Midtown: [2, 'Duplex'],
  'Government District': [2, 'Apartment spot'],
  'The Docks': [3, 'Warehouse'],
  'The Strip': [3, 'Nightclub'],
  Downtown: [4, 'Penthouse'],
  'Financial District': [4, 'Penthouse'],
  'The Heights': [4, 'Mansion'],
};
const GUARDS = [0, 4, 7, 10, 13];
const CARS = [0, 1, 2, 3, 4];
const HOLD = 120; // seconds a new tier has to hold before the gang moves
const ROB_TIME = 3;
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

export class Bases {
  constructor(game) {
    this.game = game;
    this.state = {}; // gang -> { tier, key, name, money, pending, pendingT, deco }
    for (const g of ['kings', 'vipers', 'crew']) this.state[g] = { tier: 1, key: null, money: g === 'crew' ? 0 : 2000, pending: null, pendingT: 0, deco: null };
    this.checkT = 2;
    this.load();
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem('crimecity.bases.v2') || 'null');
      if (s) {
        for (const g of Object.keys(this.state)) if (s[g]) Object.assign(this.state[g], { tier: s[g].tier || 1, money: s[g].money ?? this.state[g].money });
        this.loaded = true;
      }
    } catch {
      // Fresh start.
    }
  }

  save() {
    try {
      const out = {};
      for (const [g, st] of Object.entries(this.state)) out[g] = { tier: st.tier, money: st.money };
      localStorage.setItem('crimecity.bases.v2', JSON.stringify(out));
    } catch {
      // Storage unavailable.
    }
  }

  // ---- Strength ----
  strength(g) {
    const game = this.game;
    const T = game.turfWars;
    if (T.underground(g)) return 0;
    let s = T.count(g) * 6;
    if (g === 'crew') {
      s += game.crew.members.filter((m) => m.alive).length * 3;
      s += Math.min(20, game.shops.stash / 1500);
      s += Math.min(25, game.cred / 80);
    } else {
      s += T.soldiers.filter((q) => q.gangId === g && q.alive).length * 1.5;
      if (game.market.kingpinAlive(g)) s += 8;
      s += Math.min(25, this.state[g].money / 1500);
    }
    return Math.round(s);
  }

  tierFor(strength) {
    let t = 1;
    TIERS.forEach((need, i) => {
      if (strength >= need) t = i + 1;
    });
    return t;
  }

  // What a block can be: [max tier, kind of place].
  site(b) {
    if (!b || ['park', 'police', 'hospital', 'chop', 'cityhall', 'store'].includes(b.type)) return [1, 'Trap house'];
    return SITE[b.district] || [2, 'Apartment spot'];
  }

  nameFor(tier, b) {
    const [, kind] = this.site(b);
    if (tier <= 1) return 'Trap house';
    if (tier === 2) return kind === 'Duplex' ? 'Duplex' : 'Apartment spot';
    if (tier === 3) return kind === 'Nightclub' ? 'Nightclub' : 'Warehouse';
    return kind === 'Mansion' ? 'Mansion' : 'Penthouse';
  }

  // The best place the gang can run its base from: on its own turf, as big as its strength allows.
  bestSite(g, tier) {
    const T = this.game.turfWars;
    if (g === 'crew') return [T.home.crew, tier];
    const cur = T.home[g];
    let best = cur;
    let bestTier = Math.min(tier, this.site(T.byKey[cur])[0]);
    for (const b of T.blocks) {
      const k = b.key;
      if (T.owner[k] !== g) continue;
      const t = Math.min(tier, this.site(b)[0]);
      if (t > bestTier) {
        best = k;
        bestTier = t;
      }
    }
    return [best, bestTier];
  }

  // ---- Each frame ----
  update(dt, a) {
    const game = this.game;
    const T = game.turfWars;
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 5;
      for (const g of Object.keys(this.state)) this.check(g, 5);
    }
    // Decorations follow the base (and come down when a gang goes underground).
    for (const [g, st] of Object.entries(this.state)) {
      const key = T.underground(g) ? null : T.home[g];
      if (key !== st.key || (st.deco && st.deco.tier !== st.tier)) this.decorate(g, key);
    }
    this.updateRobbery(dt, a);
  }

  check(g, dt) {
    const game = this.game;
    const T = game.turfWars;
    const st = this.state[g];
    if (T.underground(g) || !T.home[g]) return;
    const tier = this.tierFor(this.strength(g));
    const [key, siteTier] = this.bestSite(g, tier);
    const want = `${key}|${siteTier}`;
    // First look at the city: the base is whatever its current block allows, no waiting.
    if (!st.ready) {
      st.ready = true;
      if (!this.loaded) st.tier = Math.min(tier, g === 'crew' ? tier : this.site(T.byKey[T.home[g]])[0]);
      this.topUp(g);
    }
    if (want === `${T.home[g]}|${st.tier}`) {
      st.pending = null;
      return;
    }
    if (st.pending !== want) {
      st.pending = want;
      st.pendingT = HOLD;
      return;
    }
    st.pendingT -= dt;
    if (st.pendingT > 0) return;
    // Only while you're well away from both places (nobody sees a building change hands).
    const [px, pz] = game.player.pos();
    const from = T.byKey[T.home[g]];
    const to = T.byKey[key];
    if (dist(from.cx, from.cz, px, pz) < 140 || dist(to.cx, to.cz, px, pz) < 140) return;
    this.move(g, key, siteTier);
  }

  move(g, key, tier) {
    const game = this.game;
    const T = game.turfWars;
    const st = this.state[g];
    const up = tier > st.tier;
    const moved = key !== T.home[g];
    st.tier = tier;
    st.pending = null;
    if (moved) {
      T.home[g] = key;
      T.save();
    }
    // The home crew: the old one breaks up (out of sight), a new one forms at the base.
    const old = T.groups.find((gr) => gr.gang === g && gr.kind === 'home');
    if (old && g !== 'crew') {
      for (const s of old.members) if (s.alive && !s.war && s.state !== 'inCar' && !(s.aggroUntil > game.time)) s.dispose();
      for (const v of old.cars) if (!v.removed && !v.driver) v.dispose();
      T.groups = T.groups.filter((gr) => gr !== old);
    }
    if (g !== 'crew') T.makeGroup(g, T.byKey[key], GUARDS[tier], CARS[tier], 'home');
    // The kingpin moves too.
    const k = game.market.kingpins[g];
    if (k && k.s && k.s.alive && moved) {
      k.s.dispose();
      delete game.market.kingpins[g];
    }
    const b = T.byKey[key];
    const name = this.nameFor(tier, b);
    if (g === 'crew') game.hud.text(game.shops.homie(), up ? `we movin up. the spot a ${name.toLowerCase()} now` : `money tight. we back to a ${name.toLowerCase()}`);
    this.save();
  }

  // Bring a home crew up to its tier's size (out of your sight).
  topUp(g) {
    if (g === 'crew') return;
    const game = this.game;
    const T = game.turfWars;
    const home = T.groups.find((gr) => gr.gang === g && gr.kind === 'home');
    if (!home) return;
    const [px, pz] = game.player.pos();
    if (dist(home.block.cx, home.block.cz, px, pz) < 90) return;
    const want = GUARDS[this.state[g].tier];
    const E = T.edgeSpots(home.block, home.side);
    for (let i = home.members.filter((m) => m.alive).length; i < want; i++) {
      const [x, z] = E.person(i % 8);
      const s = new Soldier(game, T, x + (Math.random() - 0.5), z + (Math.random() - 0.5), g, null, 'guard');
      s.group = home;
      home.members.push(s);
      T.soldiers.push(s);
    }
  }

  // Guards at a fresh home crew (TurfManager.populate asks for this).
  homeSize(g) {
    const t = this.state[g]?.tier || 2;
    return [GUARDS[t], CARS[t]];
  }

  // A game day: rival bases bank money from their blocks and their protection rackets.
  newDay() {
    const game = this.game;
    const T = game.turfWars;
    const E = game.economy;
    for (const g of ['kings', 'vipers']) {
      const st = this.state[g];
      const prot = E ? (E.gangIncome[g] || 0) - (st.lastProt || 0) : 0;
      st.lastProt = E ? E.gangIncome[g] || 0 : 0;
      st.money = Math.min(60000, st.money + T.count(g) * 150 + Math.max(0, prot));
    }
    this.save();
  }

  // ---- The building ----
  decorate(g, key) {
    const game = this.game;
    const st = this.state[g];
    if (st.deco) {
      game.scene.remove(st.deco.group);
      st.deco = null;
    }
    st.key = key;
    if (!key) return;
    const T = game.turfWars;
    const b = T.byKey[key];
    const G = GANGS[g];
    const col = new THREE.Color(G.color);
    const f = storefront(game.city, b);
    const grp = f.group(game.scene);
    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      grp.add(m);
      return m;
    };
    const flagMat = new THREE.MeshLambertMaterial({ color: col, side: THREE.DoubleSide });
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    // (built in the storefront's own frame: x along the wall, -z out in front)
    const x = 0;
    const wz = -0.1;
    // Tier 1: a flag by the door and boarded-up windows.
    add(new THREE.CylinderGeometry(0.05, 0.05, 3.2), poleMat, x - 3.5, 1.8, wz - 0.4);
    add(new THREE.PlaneGeometry(1.4, 0.9), flagMat, x - 2.8, 2.9, wz - 0.4);
    if (st.tier <= 1) {
      const plank = new THREE.MeshLambertMaterial({ color: 0x7a5a32 });
      for (const dx of [-2, 2]) add(new THREE.BoxGeometry(1.6, 0.25, 0.05), plank, x + dx, 2.4, wz).rotation.z = 0.2;
    }
    // Tier 2+: a banner with the gang's name.
    if (st.tier >= 2) {
      const banner = add(new THREE.PlaneGeometry(7, 1.3), new THREE.MeshBasicMaterial({ map: signTexture(G.name.toUpperCase(), '#111111', G.color) }), x, Math.min(f.h - 1.2, 4), wz - 0.02);
      banner.rotation.y = Math.PI;
    }
    // Tier 3+: neon around the front.
    if (st.tier >= 3) {
      const neon = new THREE.MeshBasicMaterial({ color: col });
      add(new THREE.BoxGeometry(10, 0.18, 0.12), neon, x, Math.min(f.h - 0.4, 5.2), wz - 0.05);
      add(new THREE.BoxGeometry(0.18, 4, 0.12), neon, x - 5, 3, wz - 0.05);
      add(new THREE.BoxGeometry(0.18, 4, 0.12), neon, x + 5, 3, wz - 0.05);
    }
    // Tier 4: a big flag on the roof.
    if (st.tier >= 4) {
      add(new THREE.CylinderGeometry(0.12, 0.12, 8), poleMat, x, f.h + 4, 4);
      add(new THREE.PlaneGeometry(4, 2.4), flagMat, x + 2, f.h + 6.6, 4);
    }
    grp.children.forEach((m) => (m.castShadow = true));
    st.deco = { group: grp, tier: st.tier, x: f.x, z: f.z, block: b };
  }

  // ---- Robbing a rival base ----
  updateRobbery(dt, a) {
    const game = this.game;
    const p = game.player;
    if (p.vehicle) {
      this.robT = 0;
      return;
    }
    const [px, pz] = p.pos();
    for (const g of ['kings', 'vipers']) {
      const st = this.state[g];
      if (!st.deco || st.money < 100) continue;
      if (dist(px, pz, st.deco.x, st.deco.z) > 2) continue;
      const key = game.input.label('interact');
      if (!a.interactHeld) {
        this.robT = 0;
        game.prompt = `Hold ${key} to rob the ${GANGS[g].name} stash (${money(st.money)})`;
        return;
      }
      if (!this.robT) game.turfWars.aggro(g, px, pz, 80, 90); // they see you going for it
      this.robT = (this.robT || 0) + dt;
      game.progress = { value: Math.min(1, this.robT / ROB_TIME), label: `Grabbing the ${GANGS[g].name} stash…` };
      game.prompt = '';
      if (this.robT >= ROB_TIME) {
        const took = Math.round(st.money);
        st.money = 0;
        game.cash += took;
        this.robT = 0;
        game.hud.toast(`+${money(took)} from the ${GANGS[g].name} stash. Get out of there!`);
        game.hud.news(`${GANGS[g].name} base robbed on ${streetAt(st.deco.x, st.deco.z)}`, 'crime');
        game.crime('robbery', px, pz);
        game.cred += 40;
        if (game.drugs.risk.beef[g] !== undefined) game.drugs.risk.beef[g] += 40;
        game.save();
        this.save();
      }
      return;
    }
  }

  // ---- Map ----
  legend(add) {
    const T = this.game.turfWars;
    for (const [g, st] of Object.entries(this.state)) {
      const b = T.homeBlock(g);
      if (!b || T.underground(g)) continue;
      const strength = this.strength(g);
      add('blip', GANGS[g].color, String(st.tier), `${GANGS[g].name}${g === 'crew' ? ' (you)' : ''} base: ${this.nameFor(st.tier, b)} (tier ${st.tier}, strength ${strength})${g !== 'crew' ? ` · stash ${money(st.money)}` : ''}`, st.deco ? st.deco.x + 22 : b.cx, st.deco ? st.deco.z + 8 : b.cz);
    }
  }

  blips() {
    const T = this.game.turfWars;
    // Beside the building (so it doesn't sit on the hangout and kingpin markers).
    return Object.entries(this.state).filter(([g, st]) => st.deco && !T.underground(g)).map(([g, st]) => [st.deco.x + 22, st.deco.z + 8, GANGS[g].color, String(st.tier)]);
  }
}
