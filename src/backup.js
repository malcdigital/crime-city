import { CFG } from './config.js';
import { Vehicle } from './vehicle.js';
import { TrafficDriver, laneOff } from './traffic.js';
import { CrewMember, GANG_GUNS } from './gang.js';
import { GANGS } from './turf.js';
import { tierOf } from './claim.js';
import { gpsRoute } from './gps.js';
import { dist, pick } from './util.js';

// Calling for backup (phone → Contacts). Your people pile into a car, drive over through the
// streets (fast, re-routing if you move), jump out and fight whoever you're fighting — rival
// gangs, or the cops once it's a shootout. When things go quiet they walk back to the car and
// drive off.
// - Homies: free, every 3 minutes. 2 of them, more as your crew's base grows (tier 2-3: 3,
//   tier 4: 4). They carry whatever crew guns you've bought.
// - Heavy squad: 4 shooters with rifles and vests in a van. $1,500 (bank, then cash), every 5
//   minutes, from Hustler street cred up.
// - Players: other players will be able to answer the call once there's multiplayer.
const KINDS = {
  homies: { cost: 0, cooldown: 180, minTier: 0 },
  heavy: { cost: 1500, cooldown: 300, minTier: 1 }, // Hustler and up
};
const STAY = 120; // seconds they stick around after the last fight near you
const NAMES = ['Lil Mike', 'Tre', 'Dub', 'Smoke', 'Juju', 'Peanut', 'Black', 'Tiny', 'Ghost', 'Bam', 'Nook', 'Rell'];
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Backup {
  constructor(game) {
    this.game = game;
    this.calls = []; // { kind, car, driver, n, stage: 'coming' | 'here' | 'leaving', members, t, quietT }
    this.ready = { homies: 0, heavy: 0 }; // game time when each can be called again
  }

  // ---- Phone rows (Contacts) ----
  rows() {
    const game = this.game;
    const out = [];
    const tier = tierOf(game.cred);
    const coming = this.calls.find((c) => c.stage === 'coming');
    const nHomies = this.homiesCount();
    const add = (kind, label, detail) => {
      const K = KINDS[kind];
      const wait = this.ready[kind] - game.time;
      let can = true;
      if (tier < K.minTier) can = 'Need more street cred';
      else if (game.turfWars.underground('crew')) can = 'Your crew is underground';
      else if (wait > 0) can = `Again in ${fmt(wait)}`;
      else if (coming) can = 'Backup already on the way';
      out.push({ label, price: 0, priceText: K.cost ? money(K.cost) : 'free', detail, can, buy: () => (this.call(kind) ? 'close' : null) });
    };
    add('homies', `Call for backup · ${nHomies} homies`, `${nHomies} of your crew drive over fast and fight with you, then head home when it's quiet. Free, every 3 minutes. More come as your base grows.`);
    add('heavy', 'Call a heavy squad · 4 shooters', `Four shooters with rifles and vests in a van. ${money(KINDS.heavy.cost)} (bank, then cash). Every 5 minutes, from Hustler street cred up.`);
    out.push({ label: 'Call a player for backup', price: 0, priceText: '', detail: 'Once multiplayer is in, the players in your crew will be able to answer your call and come help.', can: 'Coming with multiplayer', buy: () => {} });
    return out;
  }

  homiesCount() {
    const t = this.game.bases?.state.crew.tier || 1;
    return t >= 4 ? 4 : t >= 2 ? 3 : 2;
  }

  // ---- Making the call ----
  call(kind) {
    const game = this.game;
    const K = KINDS[kind];
    if (K.cost && !game.bank.pay(K.cost)) {
      game.hud.toast(`You need ${money(K.cost)} (bank + cash)`, '#ff8080');
      return false;
    }
    const n = kind === 'heavy' ? 4 : this.homiesCount();
    const [px, pz] = game.player.pos();
    // Set off from a street corner a couple of blocks away, toward your hangout if possible.
    const home = game.city.crewHome;
    const nodes = game.city.nodes.filter((q) => {
      if (q.rampEnd || q.edges.length < 3) return false; // a proper street corner
      const d = dist(q.x, q.z, px, pz);
      return d > 80 && d < 190;
    }).sort((p, q) => Math.abs(dist(p.x, p.z, px, pz) - 130) + dist(p.x, p.z, home.x, home.z) * 0.15 - (Math.abs(dist(q.x, q.z, px, pz) - 130) + dist(q.x, q.z, home.x, home.z) * 0.15));
    const from = nodes.find((q) => !game.vehicles.some((v) => !v.removed && dist(v.x, v.z, q.x, q.z) < 9)) || nodes[0];
    if (!from) {
      game.hud.toast("Nobody can get to you right now", '#ff8080');
      return false;
    }
    // Face the way the route goes from that corner (no U-turns onto the curb).
    const r0 = gpsRoute(game.city, from.x, from.z, px, pz);
    const nxt = r0.find((q) => dist(q[0], q[1], from.x, from.z) > 3) || [px, pz];
    const L = dist(from.x, from.z, nxt[0], nxt[1]) || 1;
    const ux = (nxt[0] - from.x) / L;
    const uz = (nxt[1] - from.z) / L;
    const to = [...from.nb].filter((m) => m.street).sort((p1, p2) => ((p2.x - from.x) * ux + (p2.z - from.z) * uz) - ((p1.x - from.x) * ux + (p1.z - from.z) * uz))[0] || from.nb[0];
    const off = laneOff(from, to);
    const x = from.x + ux * 9 - uz * off;
    const z = from.z + uz * 9 + ux * off;
    const car = new Vehicle(game.scene, n > 3 ? 'van' : 'sedan', x, z, Math.atan2(ux, uz), GANGS.crew.car);
    car.isCrew = true;
    const driver = new TrafficDriver(car, from, to);
    driver.hurry = true;
    car.driver = driver;
    car.speed = 8;
    game.traffic.drivers.push(driver);
    game.vehicles.push(car);
    const c = { kind, car, driver, n, stage: 'coming', members: [], t: 0, quietT: 0, stuckT: 0 };
    this.route(c);
    this.calls.push(c);
    this.ready[kind] = game.time + K.cooldown;
    const who = game.shops.homie();
    game.hud.text(who, kind === 'heavy' ? 'say less. the shooters on the way. dont die before we get there' : pick(['on the way. hold on', 'pullin up rn', 'say less. we comin', 'omw. keep ya head down']));
    game.hud.toast(`Backup on the way: ${n} ${kind === 'heavy' ? 'shooters' : 'homies'}`, '#7ee081');
    return true;
  }

  // Drive to wherever you are now (pulling up at the curb next to you).
  route(c) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    const car = c.car;
    const r = gpsRoute(game.city, car.x, car.z, px, pz);
    if (r.length >= 2) {
      const [rx, rz] = r[r.length - 2];
      const k = dist(rx, rz, px, pz) || 1;
      r[r.length - 1] = [rx + ((px - rx) / k) * Math.max(0, k - 6), rz + ((pz - rz) / k) * Math.max(0, k - 6)];
    }
    r[0] = [car.x, car.z];
    c.driver.driveTo(r);
    c.goal = [px, pz];
  }

  // ---- Each frame ----
  update(dt) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    for (const c of this.calls) {
      c.t += dt;
      const car = c.car;
      const carGone = car.removed || car.wrecked || car.exploded;
      if (c.stage === 'coming') {
        if (carGone) {
          game.hud.toast('Your backup got stopped on the way', '#ff8080');
          c.stage = 'done';
          continue;
        }
        // You moved a lot: re-route.
        if (dist(c.goal[0], c.goal[1], px, pz) > 25 && c.t > 2) this.route(c);
        const d = dist(car.x, car.z, px, pz);
        c.stuckT = Math.abs(car.speed) < 0.6 ? c.stuckT + dt : 0;
        if ((d < 18 && Math.abs(car.speed) < 1.5) || (d < 45 && c.stuckT > 3) || (c.stuckT > 8)) this.arrive(c);
        continue;
      }
      if (c.stage === 'here') {
        // Stay while there's a fight near you; head home after a quiet couple of minutes.
        const fighting = game.crewEnemies().some((e) => dist(e.x, e.z, px, pz) < 60);
        c.quietT = fighting ? 0 : c.quietT + dt;
        c.members = c.members.filter((m) => !m.removed);
        if (c.quietT > STAY || !c.members.some((m) => m.alive)) this.leave(c);
        continue;
      }
      if (c.stage === 'leaving') {
        // Walk back to the car and get in; then it drives off.
        for (const m of c.members) {
          if (m.removed) continue;
          const atCar = !carGone && dist(m.x, m.z, car.x, car.z) < 3.2;
          const goneFar = dist(m.x, m.z, px, pz) > 70;
          if (atCar || (carGone && goneFar) || !m.alive) {
            if (m.alive) m.dispose();
          }
        }
        c.members = c.members.filter((m) => !m.removed && m.alive);
        if (!c.members.length) {
          if (!carGone && car.driver === c.driver) {
            c.driver.release(game);
            c.driver.cruise = 13;
            c.driver.hurry = false;
          }
          c.stage = 'done';
        }
      }
    }
    this.calls = this.calls.filter((c) => c.stage !== 'done');
  }

  arrive(c) {
    const game = this.game;
    const car = c.car;
    c.stage = 'here';
    c.driver.driveTo([[car.x, car.z], [car.x, car.z]]); // park
    c.driver.stopAt = [car.x, car.z]; // (so it isn't towed while they're out)
    c.driver.hurry = false;
    car.speed = 0;
    const [fx, fz] = car.forward();
    for (let i = 0; i < c.n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const back = Math.floor(i / 2) * 1.6;
      const x = car.x - fz * side * 2 - fx * back;
      const z = car.z + fx * side * 2 - fz * back;
      const m = new CrewMember(game, x, z, pick(NAMES));
      m.backup = c;
      m.homeX = car.x - fz * side * 2.2;
      m.homeZ = car.z + fx * side * 2.2;
      m.recruited = true;
      m.state = 'follow';
      if (c.kind === 'heavy') {
        m.setWeapon(GANG_GUNS.rifle);
        m.dmgK = 0.6;
        m.baseHeart = m.heart = 0.85;
      } else game.shops.equip(m);
      game.crew.members.push(m);
      c.members.push(m);
    }
    car.openDoor && car.openDoor(1, 0.9);
    game.crew.reslot();
    game.hud.toast(`Backup's here: ${c.n} ${c.kind === 'heavy' ? 'shooters' : 'homies'}`, '#7ee081');
  }

  leave(c) {
    const game = this.game;
    c.stage = 'leaving';
    for (const m of c.members) {
      if (!m.alive) continue;
      m.recruited = false; // walks back to its spot by the car (CrewMember idle behavior)
      m.endFight();
      m.state = 'idle';
    }
    game.crew.reslot();
    game.hud.text(game.shops.homie(), pick(['we out. hit us if u need us', 'aight we gone. stay safe', 'thats light. we out']));
  }

  // HUD banner while they're on the way.
  banner() {
    const c = this.calls.find((q) => q.stage === 'coming' && !q.car.removed);
    if (!c) return '';
    const [px, pz] = this.game.player.pos();
    return `BACKUP · ${c.n} ${c.kind === 'heavy' ? 'shooters' : 'homies'} on the way · ${Math.round(dist(c.car.x, c.car.z, px, pz))} m`;
  }

  // Backup cars on the way, for the radar and the map.
  cars() {
    return this.calls.filter((c) => c.stage === 'coming' && !c.car.removed).map((c) => c.car);
  }
}
