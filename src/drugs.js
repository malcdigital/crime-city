import * as THREE from 'three';
import { CFG } from './config.js';
import { makeCharacter, SKIN_TONES } from './character.js';
import { Vehicle } from './vehicle.js';
import { Soldier, GangRide, GANGS } from './turf.js';
import { tierOf } from './claim.js';
import { streetAt, districtAt } from './city.js';
import { NEW_PLUGS, PLUG_REPLACE } from './market.js';
import { gpsRoute } from './gps.js';
import { escapePoint } from './nav.js';
import { TurfRisk } from './turfrisk.js';
import { dist, pick, rand, randInt } from './util.js';

// Drug dealing.
// - Plugs: three suppliers around the city, one product each. Call one from your phone
//   (Contacts) to set up a pickup. Solo pickups are small; a gang run (a big load) is only
//   for a Kingpin. The plug fronts it: you owe them, and have 30 minutes of play to pay —
//   in person, with cash on you, at the plug's corner.
// - Load sizes: a small pickup is safest but the plug charges the most per unit (weed most of
//   all); a re-up is bigger, cheaper per unit and riskier; a gang run is the biggest, cheapest
//   and riskiest.
// - Late: the plug gives you one 10-minute extension with interest — 20% if it wasn't your fault
//   (raid, bust, robbed, killed, market crashed), 50% if it was (you had the money, or sat on the
//   product). Trust drops either way. Miss that too and there's a hit on you (+50%). After you
//   die or get busted the shooters fall back for 5 minutes. Short on cash? Ask the plug for
//   work: a delivery or a collection takes a chunk off what you owe.
// - Trust (per plug): paying on time raises it; being late lowers it. Low trust means higher
//   prices, and below 20 the plug wants cash up front. Below 10 there's no extension.
// - Pushing it: in the last quarter of the clock you can sell cheap to move product fast
//   (buyers come quicker and buy more), but never below what you paid for it.
// - The run: drive to the plug and load up. Bigger loads and harder product mean more risk:
//   the cops might raid the spot while you're there, or a rival gang hears about it and
//   chases you down on the way back. Get it to the hangout (with no cops on you) to finish.
// - Gang runs are split: 40% is yours to sell, your homies move the rest and the money goes
//   into the turf stash with each payout.
// - Selling: when you're holding and not busy, people walk (or drive) up wanting to buy.
//   Sell or turn them down. Some are undercover cops; some try to rob you (less often the
//   more street cred you have). Cred also brings more customers who spend more.

const SAVE_KEY = 'crimecity.drugs.v1';
const DEADLINE = 30 * 60; // seconds of play to pay the plug
const EXTENSION = 10 * 60; // one extension when you're late
const BREATHER = 5 * 60; // the plug's shooters fall back this long after you die or get busted
const HIT_EVERY = 150; // seconds between hit squads while you owe past the deadline
const LOAD_TIME = 3;
export const PRODUCTS = {
  weed: { name: 'Weed', unit: 'bag', units: 'bags', cost: 15, street: 40, solo: 20, big: 50, gang: 120, risk: 0.25, color: '#6ab04c' },
  pills: { name: 'Pills', unit: 'pack', units: 'packs', cost: 35, street: 85, solo: 12, big: 30, gang: 70, risk: 0.4, color: '#e056fd' },
  coke: { name: 'Coke', unit: 'gram', units: 'grams', cost: 80, street: 190, solo: 6, big: 15, gang: 40, risk: 0.55, color: '#dfe6e9' },
};
// Load sizes. cost: multiplier on the plug's unit price (small loads cost the most per unit,
// weed most of all); risk: added to the chance something goes wrong on the run.
export const LOADS = {
  solo: { label: 'Small pickup', cost: { weed: 1.5, pills: 1.3, coke: 1.3 }, risk: -0.1 },
  big: { label: 'Re-up', cost: { weed: 1, pills: 1, coke: 1 }, risk: 0.12 },
  gang: { label: 'Gang run', cost: { weed: 0.8, pills: 0.8, coke: 0.8 }, risk: 0.25 },
};
const PLUGS = [
  { id: 'smokey', name: 'Smokey', product: 'weed', block: [1, 9] }, // the Projects
  { id: 'doc', name: 'Doc', product: 'pills', block: [11, 5] }, // the Strip
  { id: 'marco', name: 'Marco', product: 'coke', block: [10, 12] }, // the Docks
];
// Customers by cred tier (Nobody .. Kingpin): seconds between them, robbery chance, spend.
const CUSTOMER_GAP = [90, 70, 55, 45, 35, 25];
const ROB_CHANCE = [0.18, 0.13, 0.09, 0.06, 0.04, 0.02];
const TELLS = ['seems nervous', 'shoes are too clean', 'keeps looking over his shoulder', 'asks a lot of questions', 'fresh haircut, no tattoos'];
// How each plug texts. Voices follow the research notes (reports/AAVE for game dialogue.md):
// the grammar carries it (zero copula, ain't, done/been, negative concord), slang stays light,
// product talk is coded, and threats are short and calm (a trailing period reads cold).
// Smokey: laid back, lowercase. Doc: clipped and cold. Marco: older, plainer, full sentences.
// Reminders go out as the deadline gets closer: keys are seconds left. {owe} {street} {old}.
const VOICES = {
  smokey: {
    call: 'pull up on {street}. come by yourself',
    1200: 'hope that gas moving. {owe} when u got it. dont have me chasing u',
    600: '10 min. {owe}. i fronted u on trust',
    300: 'its 5 now. i aint finna keep asking',
    120: '2 min. u know how this go',
    60: 'my people already know what u drive',
    20: 'clock out.',
    hit: 'u had ur chance. its {owe} now and the money aint even the problem no more',
    squad: 'sent sum folks to come holla at u. {owe} make it stop',
    paid: 'we good. pleasure',
    paidHit: 'money good. i called em off. dont let it happen again',
    takeover: '{old} gone. his book mine now. u owe me {owe}, same terms',
    ext: 'heard what happened. aight, i got u. 10 more min. its {owe} now',
    extFault: 'u had it and still aint pull up? 10 min. {owe}. dont play w me',
    noExt: 'u been bad business. no more time.',
    cashFirst: 'u been bad business. cash up front this time',
    breather: 'my people gon fall back for a min. dont get comfortable',
    job: 'u short? i got sum u can do. {job}',
    jobDone: 'good looks. took {cut} off. u owe {owe}',
    jobFail: 'u fumbled that too. still {owe}',
    took: 'my people grabbed what u had on u. {cut} off. {owe} left',
  },
  doc: {
    call: '{street}. dont text me again til u outside',
    1200: '{owe}. 30 min. dont be late.',
    600: '10.',
    300: '5 min. i dont do excuses.',
    120: '?',
    60: 'u really bout to play w me.',
    20: 'ok.',
    hit: 'its {owe} now. u already know the rest.',
    squad: 'check ur mirrors.',
    paid: 'received.',
    paidHit: 'received. we done. for now.',
    takeover: '{old} out the picture. i got his book. {owe}. same clock.',
    ext: 'heard. 10 min. {owe}.',
    extFault: 'u had it. 10 min. {owe}. last time.',
    noExt: 'no.',
    cashFirst: 'cash first. no more fronts.',
    breather: 'they fallin back. for now.',
    job: 'u cant pay, u work. {job}',
    jobDone: '{cut} off. {owe} left.',
    jobFail: 'useless. {owe}.',
    took: 'took {cut} off ur body. {owe} left.',
  },
  marco: {
    call: "Come see me on {street}. Don't bring nobody.",
    1200: 'Hope everything moving smooth. {owe}. You got thirty.',
    600: 'Ten minutes. I been patient with you.',
    300: 'Five. I done told you how I run my business.',
    120: 'Two minutes. Think real careful about your next move.',
    60: "Last minute. After this it ain't about money.",
    20: "It's done.",
    hit: "Price went up. {owe}. And it ain't me you gotta worry about now.",
    squad: 'Some people coming to see you. {owe} and they go home.',
    paid: 'Good doing business with you.',
    paidHit: "We square. Don't ever make me do that again.",
    takeover: "{old} ain't with us no more. His book is mine. You owe {owe}, same terms.",
    ext: "I heard what happened. That's the game. Ten more minutes. {owe}.",
    extFault: "You had my money and sat on it. Ten minutes. {owe}. Don't test me again.",
    noExt: "I'm done giving you time.",
    cashFirst: 'No more credit. Cash up front from now on.',
    breather: "I told them to fall back. For now.",
    job: "Can't pay? Then you work. {job}",
    jobDone: 'Took {cut} off. You owe {owe}.',
    jobFail: "You couldn't even handle that. Still {owe}.",
    took: 'My people took {cut} off you. You owe {owe}.',
  },
};
const REMINDER_MARKS = [1200, 600, 300, 120, 60, 20];
// What buyers say. {n} = how many, {code} = what they call it. Experienced buyers talk in
// code; an undercover cop sometimes gives himself away by naming it like a cop would.
const CODE = { weed: ['gas', 'za', 'trees'], pills: ['beans', 'pills', 'pressies'], coke: ['white', 'snow', 'work'] };
const ASKS = ['u still got sum? need {n}', 'lemme get {n} of that {code}', 'u holdin? tryna get {n}', 'need {n}. u good?', 'yo, {n} of the {code}. i got cash', 'aye lemme get {n} rn'];
const DRIVER_ASKS = ['get in real quick. {n} of the {code}', 'u good? {n}, i got cash', 'u straight? need {n} of that {code}'];
const COP_ASKS = ['Hey. Could I buy {n} {units} of {name}?', 'How much for {n} {units} of {name}, exactly?', 'Hi there. You selling {name}? I need {n} {units}.'];
const DECLINE = ['aight then', 'damn ok', 'u trippin. ight', 'say less, im gone'];
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const amountText = (kind, n) => `${n} ${n === 1 ? PRODUCTS[kind].unit : PRODUCTS[kind].units} of ${PRODUCTS[kind].name.toLowerCase()}`;

export class Drugs {
  constructor(game) {
    this.game = game;
    const city = game.city;
    // Plugs: a guy on the corner, and a pickup spot in the curb lane in front of him.
    this.plugs = PLUGS.map((p) => {
      const b = city.blocks.find((k) => k.i === p.block[0] && k.j === p.block[1]);
      const x = b.cx;
      const z = b.minZ - 3.6;
      const plug = { ...p, b, x, z, r: 4, street: streetAt(x, z), dead: false, deadT: 0 };
      // A ring around the plug, shown while you're doing a pickup with them.
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.8, 32), new THREE.MeshBasicMaterial({ color: 0xe0b000, transparent: true, opacity: 0.7, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.26, b.minZ + 1.2); // around the plug, on the sidewalk
      ring.visible = false;
      game.scene.add(ring);
      plug.ring = ring;
      this.spawnPlug(plug);
      return plug;
    });
    this.inv = { weed: 0, pills: 0, coke: 0 };
    this.homie = { units: 0, value: 0, per: 0 };
    this.debts = []; // { plug, product, owe, left, stage: due | ext | hit, nextHit, luck, ... }
    this.trust = {}; // plug id -> 0..100 (50 to start)
    this.basis = {}; // product -> what you paid per unit for what you're holding
    this.pushing = false; // selling cheap to beat the clock
    this.job = null; // working off a debt
    this.run = null;
    this.customer = null;
    this.custT = CFG.MARKET_HOT ? 6 : 30;
    this.squads = [];
    this.risk = new TurfRisk(game);
    this.load();
  }

  // The plug himself, on his corner. He can be killed (and gets replaced after a while).
  spawnPlug(plug) {
    const game = this.game;
    const ped = game.peds.addAt(plug.x, plug.b.minZ + 1.2);
    ped.shopkeeper = true; // stays on his corner
    ped.state = 'shop';
    ped.heading = ped.shopHeading = Math.PI;
    ped.name = plug.name;
    ped.isPlug = true;
    plug.ped = ped;
  }

  // A plug's line, in their voice (a new plug in the same spot keeps the spot's voice).
  say(p, key, vars = {}) {
    const t = (VOICES[p.id] || VOICES.smokey)[key] || '';
    return t.replace('{owe}', money(vars.owe || 0)).replace('{street}', p.street).replace('{old}', vars.old || '').replace('{cut}', money(vars.cut || 0)).replace('{job}', vars.job || '');
  }

  // What a plug charges per unit right now (more when supply is short, and when he doesn't
  // trust you). For a load size, the size multiplier too.
  unitCost(product, kind = 'big') {
    const p = this.plugFor(product);
    const trust = p ? this.trustOf(p.id) : 50;
    return PRODUCTS[product].cost * (this.game.market ? this.game.market.costMult(product) : 1) * (1.15 - trust * 0.003) * LOADS[kind].cost[product];
  }

  plugFor(product) {
    return this.plugs.find((p) => p.product === product);
  }

  trustOf(id) {
    return this.trust[id] ?? 50;
  }

  addTrust(id, n) {
    this.trust[id] = Math.max(0, Math.min(100, this.trustOf(id) + n));
  }

  trustLabel(id) {
    const t = this.trustOf(id);
    return t >= 75 ? 'solid' : t >= 50 ? 'good' : t >= 30 ? 'shaky' : t >= 20 ? 'bad' : 'burned';
  }

  // Plugs dying and being replaced.
  updatePlugs(dt) {
    const game = this.game;
    for (const p of this.plugs) {
      if (!p.dead && p.ped && !p.ped.alive) {
        p.dead = true;
        p.deadT = PLUG_REPLACE;
        game.market.plugDied(p);
        if (this.run && this.run.plug === p.id && this.run.stage !== 'toHQ') {
          this.run = null;
          game.mapView.waypoint = null;
          game.hud.toast("Your plug is dead — the deal's off", '#ff8080');
        }
      }
      if (p.dead) {
        p.deadT -= dt;
        const [px, pz] = game.player.pos();
        if (p.deadT <= 0 && dist(p.x, p.z, px, pz) > 60) {
          const old = p.name;
          p.name = pick(NEW_PLUGS[p.product].filter((n) => n !== old)) || old;
          p.dead = false;
          this.spawnPlug(p);
          const d = this.debts.find((x) => x.plug === p.id);
          game.hud.news(`New ${p.product} connect setting up on ${p.street}`, 'info');
          if (d) game.hud.text(p.name, this.say(p, 'takeover', { old, owe: d.owe }));
        }
      }
    }
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      if (s.inv) Object.assign(this.inv, s.inv);
      if (s.homie) this.homie = s.homie;
      if (s.debts) this.debts = s.debts.map((d) => ({ stage: d.hit ? 'hit' : 'due', luck: [], idle: 0, product: this.plug(d.plug)?.product || 'weed', ...d }));
      if (s.trust) this.trust = s.trust;
      if (s.basis) this.basis = s.basis;
      if (s.beef) Object.assign(this.risk.beef, s.beef);
    } catch {
      // Fresh start.
    }
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ inv: this.inv, homie: this.homie, debts: this.debts, beef: this.risk.beef, trust: this.trust, basis: this.basis }));
    } catch {
      // Storage unavailable.
    }
  }

  plug(id) {
    return this.plugs.find((p) => p.id === id);
  }

  tier() {
    return tierOf(this.game.cred);
  }

  canGangRun() {
    return CFG.GANG_RUNS_ANY_RANK || this.tier() >= 5;
  }

  holding() {
    return this.inv.weed + this.inv.pills + this.inv.coke;
  }

  // ---- Phone: contacts ----
  contacts() {
    const game = this.game;
    const list = [];
    for (const d of this.debts) {
      const p = this.plug(d.plug);
      const when = d.stage === 'hit' ? `${p.name} has a hit out on you. Pay up to call it off.` : d.stage === 'ext' ? `Extension: ${fmt(d.left)} left` : `${fmt(d.left)} left`;
      list.push({
        label: `Pay ${p.name} back (in person)`, price: 0, priceText: money(d.owe),
        detail: `${when} Bring ${money(d.owe)} cash to ${p.name} on ${p.street} (you have ${money(game.cash)} on you). Sets a waypoint.`,
        can: p.dead ? `${p.name} is dead · new plug soon` : true,
        buy: () => {
          game.mapView.waypoint = [p.x, p.z];
          game.hud.toast(`Take ${money(d.owe)} to ${p.name} on ${p.street}`, '#e0b000');
          return 'close';
        },
      });
      if (!this.job) {
        list.push({
          label: `Ask ${p.name} for work`, price: 0, priceText: '',
          detail: `Can't pay? Do a job for ${p.name} (a delivery or a collection) to take about 40% off what you owe. The shooters hold off while you're on it.`,
          can: p.dead ? 'No plug to ask' : game.stars > 0 ? 'Lose the cops first' : true,
          buy: () => {
            this.startJob(d);
            return 'close';
          },
        });
      }
    }
    if (this.job) list.push({ label: 'Drop the job', price: 0, priceText: '', detail: `Give up on ${this.plug(this.job.plug).name}'s job (you still owe it all).`, can: true, buy: () => this.failJob('You dropped the job') });
    if (this.pushAvailable()) {
      list.push({
        label: this.pushing ? 'Stop pushing it' : 'Push it (sell cheap)', price: 0, priceText: this.pushing ? 'ON' : '',
        detail: this.pushing ? 'Back to normal prices.' : "The clock's running out: sell cheap to move it fast. Buyers come quicker and buy more. Never below what you paid.",
        can: true, buy: () => {
          this.pushing = !this.pushing;
          game.hud.toast(this.pushing ? 'Pushing it: cheap prices, more buyers' : 'Back to normal prices');
          if (this.pushing) this.custT = Math.min(this.custT, 3);
        },
      });
    }
    if (this.run && this.run.stage === 'toPlug') {
      list.push({ label: 'Call off the pickup', price: 0, priceText: '', detail: `${this.plug(this.run.plug).name} won't be happy, but you don't owe anything yet`, can: true, buy: () => this.cancelRun() });
    }
    const why = this.run ? "You're already on a run" : this.debts.length ? 'Pay what you owe first' : this.job ? 'Finish the job first' : game.stars > 0 ? 'Lose the cops first' : true;
    for (const p of this.plugs) {
      const P = PRODUCTS[p.product];
      const cashUp = this.trustOf(p.id) < 20;
      const terms = cashUp ? 'cash up front' : 'fronted, pay within 30 min';
      const trust = `Trust: ${this.trustLabel(p.id)}.`;
      for (const kind of ['solo', 'big', 'gang']) {
        const unit = this.unitCost(p.product, kind);
        const n = P[kind];
        const total = n * unit;
        const margin = Math.round((1 - unit / P.street) * 100);
        const ok = p.dead ? `Dead · new plug in ${Math.ceil(p.deadT / 60)} min` : kind === 'gang' && !this.canGangRun() ? 'Kingpin only' : why;
        const risk = kind === 'solo' ? 'Lowest risk.' : kind === 'big' ? 'Riskier: raids and robbers like a big load.' : 'Much riskier. You keep 40% to sell, your homies move the rest into the stash.';
        list.push({
          label: `${p.name} · ${LOADS[kind].label} · ${n} ${P.units}`, price: 0, priceText: cashUp ? `pay ${money(total)}` : `owe ${money(total)}`,
          detail: `${money(unit)} a ${P.unit} (~${margin}% margin at normal prices), ${terms}. ${risk} ${trust}`,
          can: ok, buy: () => this.startRun(p, kind),
        });
      }
    }
    return list;
  }

  startRun(p, kind) {
    const game = this.game;
    const P = PRODUCTS[p.product];
    const amount = P[kind];
    // Risk: the product, the size of the load, and the President's war on drugs.
    const war = game.market.war || 0;
    const risk = Math.max(0.05, Math.min(0.95, P.risk + LOADS[kind].risk + 0.12 * war));
    let incident = null;
    if (Math.random() < risk) {
      const r = Math.random();
      const raidW = (p.product === 'coke' ? 0.5 : p.product === 'pills' ? 0.4 : 0.3) + 0.15 * war;
      incident = r < raidW ? 'raid' : 'chase';
      if (kind === 'gang' && Math.random() < 0.35) incident = 'both';
    }
    if (CFG.TEST_INCIDENT) incident = CFG.TEST_INCIDENT === 'clean' ? null : CFG.TEST_INCIDENT; // testing
    const unit = this.unitCost(p.product, kind);
    const cashUp = this.trustOf(p.id) < 20; // burned: no more fronts
    this.run = { plug: p.id, kind, product: p.product, amount, unit, owe: Math.round(amount * unit), cashUp, stage: 'toPlug', incident, loadT: 0, chased: false, luck: [] };
    game.mapView.waypoint = [p.x, p.z];
    game.shops.close();
    game.hud.text(p.name, this.say(p, cashUp ? 'cashFirst' : 'call'));
    game.hud.toast(`Pickup set: ${p.name} on ${p.street}${cashUp ? ` · bring ${money(this.run.owe)} cash` : ''}`, '#e0b000');
  }

  cancelRun() {
    this.run = null;
    this.game.mapView.waypoint = null;
    this.game.hud.toast('Pickup called off');
  }

  // Paid in person, cash in hand.
  pay(d) {
    const game = this.game;
    const p = this.plug(d.plug);
    game.cash -= d.owe;
    this.debts = this.debts.filter((x) => x !== d);
    for (const sq of this.squads) if (sq.plug === d.plug) sq.called = true;
    if (d.stage === 'due') this.addTrust(p.id, 8); // on time
    if (this.job && this.job.plug === d.plug) this.endJob();
    if (game.mapView.waypoint && dist(game.mapView.waypoint[0], game.mapView.waypoint[1], p.x, p.z) < 1) game.mapView.waypoint = null;
    if (!this.pushAvailable()) this.pushing = false;
    game.hud.toast(`Paid ${p.name} ${money(d.owe)}. You're square.`);
    game.hud.text(p.name, this.say(p, d.stage === 'hit' ? 'paidHit' : 'paid'));
    game.sfx.cash?.();
    game.save();
    this.save();
  }

  // Something went wrong that wasn't your fault: the plug hears about it.
  luck(what) {
    for (const d of this.debts) if (!d.luck.includes(what)) d.luck.push(what);
    if (this.run && !this.run.luck.includes(what)) this.run.luck.push(what);
  }

  // Late because of you? You had the money (on you or in the stash), or sat on the product.
  fault(d) {
    const game = this.game;
    // Money in the bank only counts if the bank was open at some point while the clock ran.
    if (game.cash + game.shops.stash + game.bank.stashTotal() + (d.bankSeen ? game.bank.balance : 0) >= d.owe) return 'money';
    if (this.inv[d.product] > 0 && (d.idle || 0) > 600) return 'sat';
    return null;
  }

  // Selling cheap is allowed in the last quarter of the clock (or once you're late).
  pushAvailable() {
    return this.holding() > 0 && this.debts.some((d) => d.stage !== 'due' || d.left < DEADLINE / 4);
  }

  // How far prices drop while pushing it: 10% off at first, down to 35% off as time runs out.
  pushFactor() {
    let k = 1;
    for (const d of this.debts) if (d.stage === 'due') k = Math.min(k, Math.max(0, 1 - d.left / (DEADLINE / 4)));
    if (this.debts.some((d) => d.stage !== 'due')) k = 1;
    return 0.9 - 0.25 * k;
  }

  // ---- Working off a debt ----
  startJob(d) {
    const game = this.game;
    const p = this.plug(d.plug);
    const [px, pz] = game.player.pos();
    // Somewhere across town, on a sidewalk.
    const far = game.city.blocks.filter((b) => dist(b.cx, b.cz, px, pz) > 220 && dist(b.cx, b.cz, px, pz) < 450 && b.type !== 'police');
    const b = pick(far.length ? far : game.city.blocks);
    const x = b.cx;
    const z = b.minZ + 1.6;
    const street = streetAt(x, b.minZ - 3);
    const kind = Math.random() < 0.5 ? 'drop' : 'collect';
    const cut = Math.max(100, Math.round((d.owe * 0.4) / 10) * 10);
    this.job = { plug: d.plug, kind, x, z, street, cut, left: kind === 'drop' ? 240 : 300, target: null };
    if (kind === 'collect') {
      // Someone who owes the plug. He runs when he sees you coming.
      const ped = game.peds.addAt(x, z);
      ped.shopkeeper = true;
      ped.state = 'shop';
      ped.heading = ped.shopHeading = Math.PI;
      ped.name = pick(['Lil Tony', 'Dre', 'Skinny', 'Pooh', 'Man-Man']);
      this.job.target = ped;
    }
    d.pauseUntil = game.time + this.job.left; // the shooters hold off while you work
    for (const sq of this.squads) if (sq.plug === d.plug) sq.called = true;
    const what = kind === 'drop' ? `take this pack to ${street}. 4 min` : `${this.job.target.name} owe me. go get it. ${street}`;
    game.hud.text(p.name, this.say(p, 'job', { job: what }));
    game.hud.toast(kind === 'drop' ? `Job: deliver a package to ${street} (4 min)` : `Job: collect from ${this.job.target.name} on ${street} (5 min)`, '#e0b000');
    game.mapView.waypoint = [x, z];
  }

  updateJob(dt, a) {
    const j = this.job;
    if (!j) return;
    const game = this.game;
    const d = this.debts.find((x) => x.plug === j.plug);
    if (!d) return this.endJob();
    j.left -= dt;
    if (j.left <= 0) return this.failJob('Out of time');
    const [px, pz] = game.player.pos();
    const t = j.target;
    if (j.kind === 'collect') {
      if (!t || t.removed) return this.failJob('He got away');
      if (t.state === 'shop' && dist(px, pz, t.x, t.z) < 12) {
        // Sees you coming: runs.
        t.shopkeeper = false;
        t.scare(px, pz);
        t.t = 25;
        game.hud.toast(`${t.name} is running! Knock him down`, '#ffd36b');
      }
      if (t.state !== 'shop' && dist(px, pz, t.x, t.z) > 25) game.mapView.waypoint = [t.x, t.z]; // follow him (not when he's right there)
      if (!t.standing) {
        this.finishJob(d, t.alive ? `Got it out of ${t.name}` : `Took it off ${t.name}`);
        return;
      }
      return;
    }
    // Delivery: walk the pack up to the spot.
    const close = dist(px, pz, j.x, j.z);
    if (game.player.vehicle) {
      if (close < 18) this.prompt = 'Get out and walk the package over';
      return;
    }
    if (close < 2.5) {
      this.prompt = `Press ${game.input.label('interact')} to drop off the package`;
      if (a.interactHeld && !game.interactWasHeld) this.finishJob(d, 'Package delivered');
    }
  }

  finishJob(d, msg) {
    const game = this.game;
    const p = this.plug(d.plug);
    const cut = Math.min(d.owe, this.job.cut);
    d.owe -= cut;
    this.endJob();
    game.hud.toast(`${msg}: -${money(cut)} off what you owe`);
    game.cred += 5;
    if (d.owe <= 0) {
      this.debts = this.debts.filter((x) => x !== d);
      game.hud.text(p.name, this.say(p, 'paid'));
    } else game.hud.text(p.name, this.say(p, 'jobDone', { cut, owe: d.owe }));
    this.save();
  }

  failJob(msg) {
    const j = this.job;
    if (!j) return;
    const game = this.game;
    const p = this.plug(j.plug);
    const d = this.debts.find((x) => x.plug === j.plug);
    this.endJob();
    if (d) {
      d.pauseUntil = 0;
      this.addTrust(p.id, -5);
      game.hud.text(p.name, this.say(p, 'jobFail', { owe: d.owe }));
    }
    game.hud.toast(`Job failed: ${msg}`, '#ff8080');
    this.save();
  }

  endJob() {
    const j = this.job;
    this.job = null;
    if (!j) return;
    if (j.target && !j.target.removed && j.target.state === 'shop') j.target.dispose();
    else if (j.target) j.target.shopkeeper = false;
    const w = this.game.mapView.waypoint;
    if (w) this.game.mapView.waypoint = null;
  }

  // At the plug's corner with what you owe: pay up (cash in hand).
  updatePayment(a) {
    const game = this.game;
    if (this.run && this.run.stage !== 'toHQ') return;
    const [px, pz] = game.player.pos();
    for (const d of this.debts) {
      const p = this.plug(d.plug);
      if (p.dead || !p.ped || !p.ped.alive) continue;
      const dd = dist(px, pz, p.ped.x, p.ped.z);
      if (game.player.vehicle) {
        if (dd < 18) this.prompt = `Get out and walk up to ${p.name} to pay`;
        continue;
      }
      if (dd > 2.6) continue;
      if (game.cash < d.owe) {
        this.prompt = `${p.name} wants ${money(d.owe)} · you've only got ${money(game.cash)} on you`;
        continue;
      }
      this.prompt = `Press ${game.input.label('interact')} to pay ${p.name} ${money(d.owe)}`;
      if (a.interactHeld && !game.interactWasHeld) this.pay(d);
      return;
    }
  }

  // ---- Updates ----
  update(dt, a) {
    // Prompts and progress for the HUD (shown after the other interactions run).
    this.prompt = '';
    this.progress = null;
    for (const p of this.plugs) {
      p.ring.visible = !!(this.run && this.run.plug === p.id && this.run.stage !== 'toHQ');
      if (p.ring.visible) p.ring.material.opacity = 0.5 + 0.3 * Math.sin(this.game.time * 5);
    }
    this.updatePlugs(dt);
    const taxPrompt = this.risk.update(dt, a);
    if (taxPrompt) this.prompt = taxPrompt;
    this.updateRun(dt, a);
    this.updatePayment(a);
    this.updateJob(dt, a);
    this.updateDebts(dt);
    if (this.pushing && !this.pushAvailable()) this.pushing = false;
    this.updateSquads(dt);
    this.updateCustomer(dt, a);
    this.updateRobbers(dt);
  }

  // Interact button at the plug / the hangout during a run. Returns true if it used it.
  updateRun(dt, a) {
    const game = this.game;
    const r = this.run;
    if (!r) return;
    const p = this.plug(r.plug);
    const pl = game.player;
    const [px, pz] = pl.pos();
    const v = pl.vehicle;
    if (r.stage === 'toPlug' || r.stage === 'loading') {
      // Park up, get out, and walk up to the plug on foot.
      const [qx, qz] = p.ped && p.ped.alive ? [p.ped.x, p.ped.z] : [p.x, p.b.minZ + 1.2];
      const d = dist(px, pz, qx, qz);
      if (r.stage === 'loading' && d > 16) {
        // Walked (or drove) off before you had it: no product, no debt.
        game.hud.toast('You left without the product', '#ff8080');
        this.run = null;
        game.mapView.waypoint = null;
        return;
      }
      if (v) {
        if (dist(v.x, v.z, qx, qz) < 18) this.prompt = `Get out and walk up to ${p.name}`;
        return;
      }
      if (d > 2.4) {
        if (r.stage === 'loading') this.prompt = `Get back to ${p.name} to finish the pickup`;
        else if (d < 10) this.prompt = `Walk up to ${p.name}`;
        return;
      }
      if (r.stage === 'toPlug') {
        if (r.cashUp && game.cash < r.owe) {
          this.prompt = `${p.name} wants ${money(r.owe)} cash up front · you've got ${money(game.cash)} on you`;
          return;
        }
        this.prompt = r.cashUp ? `Press ${game.input.label('interact')} to pay ${p.name} ${money(r.owe)} and pick up` : `Press ${game.input.label('interact')} to pick up from ${p.name}`;
        if (!(a.interactHeld && !game.interactWasHeld)) return;
      }
      if (r.stage === 'toPlug') {
        r.stage = 'loading';
        r.loadT = 0;
        if (r.incident === 'raid' || r.incident === 'both') {
          // The spot gets raided while you're there.
          game.crime(r.product === 'coke' || r.kind === 'gang' ? 'drugRaidBig' : 'drugRaid', p.x, p.z);
          game.market.raided(r.product);
          // They were waiting for this: cars come in from every side right away.
          game.police.raid(p.x, p.z, r.product === 'coke' || r.kind === 'gang' ? 4 : 3);
          game.startCinematic(p.x, p.b.minZ + 1.2, 'RAID', 4.5);
          game.hud.toast('RAID! Grab the stuff and get out!', '#ff8080');
          game.storyEvent(null, p.x, p.z, `Police raid a drug spot on ${p.street}`);
          r.luck.push('raid');
        }
      }
      r.loadT += dt;
      this.progress = { value: Math.min(1, r.loadT / LOAD_TIME), label: `Getting ${amountText(r.product, r.amount)} from ${p.name}…` };
      if (r.loadT >= LOAD_TIME) {
        r.stage = 'toHQ';
        const hq = game.city.crewHome;
        game.mapView.waypoint = [hq.x, hq.z];
        if (r.cashUp) {
          game.cash -= r.owe; // paid cash, owe nothing
          game.hud.toast(`Paid ${money(r.owe)} cash. Get it back to the hangout.`, '#e0b000');
          game.save();
        } else {
          this.debts.push({ plug: p.id, product: r.product, owe: r.owe, left: DEADLINE, stage: 'due', nextHit: 0, warned: 0, luck: [...r.luck], idle: 0 });
          game.hud.toast(`Loaded. Get it back to the hangout. You owe ${p.name} ${money(r.owe)} — pay in person.`, '#e0b000');
        }
        this.save();
      }
      return;
    }
    // On the way back.
    if ((r.incident === 'chase' || r.incident === 'both') && !r.chased && dist(px, pz, p.x, p.z) > 70) {
      r.chased = true;
      const T = game.turfWars;
      const rivals = ['kings', 'vipers'].filter((g) => !T.underground(g));
      rivals.sort((g1, g2) => this.gangDist(g1, px, pz) - this.gangDist(g2, px, pz));
      for (const g of rivals) {
        if (T.sendHunters(g, px, pz, r.kind === 'gang' ? 3 : 2)) {
          game.hud.toast(`${GANGS[g].name} heard you're carrying — they're coming for it!`, '#ff8080');
          game.hud.news(`${GANGS[g].name} hunting a Green Street drug run through ${streetAt(px, pz)}`, 'crime');
          break;
        }
      }
    }
    const hq = game.city.crewHome;
    if (dist(px, pz, hq.x, hq.z) < (v ? 9 : 4)) {
      if (game.stars > 0) {
        this.prompt = "Don't lead the cops to the hangout — lose them first";
        return;
      }
      this.deliver();
    }
  }

  gangDist(g, x, z) {
    const b = this.game.turfWars.homeBlock(g);
    return b ? dist(b.cx, b.cz, x, z) : 1e9;
  }

  deliver() {
    const game = this.game;
    const r = this.run;
    const P = PRODUCTS[r.product];
    this.run = null;
    game.mapView.waypoint = null;
    game.market.landed(r.product, r.amount, game.city.crewHome.x, game.city.crewHome.z);
    // What you paid per unit (selling cheap never goes below this). Mixed with what you had.
    const had = this.inv[r.product];
    const mine = r.kind === 'gang' ? Math.round(r.amount * 0.4) : r.amount;
    this.basis[r.product] = had > 0 ? ((this.basis[r.product] || r.unit) * had + r.unit * mine) / (had + mine) : r.unit;
    if (r.kind === 'gang') {
      const mine = Math.round(r.amount * 0.4);
      const theirs = r.amount - mine;
      this.inv[r.product] += mine;
      this.homie.units += theirs;
      this.homie.value += theirs * P.street * 0.8 * game.market.mult(districtAt(game.city.crewHome.x, game.city.crewHome.z), r.product);
      this.homie.per = Math.ceil(this.homie.units / 3);
      game.hud.toast(`Run complete: ${amountText(r.product, mine)} for you, the rest to your homies`);
      game.cred += 60;
    } else {
      this.inv[r.product] += r.amount;
      game.hud.toast(`Run complete: you're holding ${amountText(r.product, r.amount)}`);
      game.cred += 15;
    }
    game.save();
    this.save();
  }

  // Your homies' sales, collected with each turf payout: about a third of their stock each time.
  homieSales() {
    const h = this.homie;
    if (h.units <= 0) return 0;
    const n = Math.min(h.units, h.per || h.units);
    const take = (h.value / h.units) * n;
    h.units -= n;
    h.value -= take;
    if (h.units <= 0) this.homie = { units: 0, value: 0, per: 0 };
    this.save();
    return Math.round(take);
  }

  updateDebts(dt) {
    const game = this.game;
    for (const d of this.debts) {
      const p = this.plug(d.plug);
      // Sitting on the product (holding it and not selling) counts against you.
      d.idle = this.inv[d.product] > 0 ? (d.idle || 0) + dt : 0;
      if (d.stage === 'due' || d.stage === 'ext') {
        d.left -= dt;
        // Texts from the plug, getting colder as time runs out.
        for (const mark of REMINDER_MARKS) {
          if (d.stage === 'ext' && mark > 300) continue;
          if (d.left <= mark && (d.warned || 1e9) > mark) {
            d.warned = mark;
            game.hud.text(p.name, this.say(p, mark, { owe: d.owe }));
          }
        }
        if (d.left > 0) continue;
        if (d.stage === 'due' && this.trustOf(p.id) >= 10) {
          // Late: one extension, with interest. Worse if it's on you.
          if (game.market.mult(districtAt(game.player.x, game.player.z), d.product) < 0.75 && !d.luck.includes('market crashed')) d.luck.push('market crashed');
          const f = this.fault(d);
          d.fault = f;
          d.owe = Math.round(d.owe * (f ? 1.5 : 1.2));
          d.stage = 'ext';
          d.left = EXTENSION;
          d.warned = 0;
          this.addTrust(p.id, f ? -25 : -12);
          game.hud.text(p.name, this.say(p, f ? 'extFault' : 'ext', { owe: d.owe }));
          const why = f === 'money' ? 'you had the money' : f === 'sat' ? 'you sat on the product' : d.luck.length ? `${d.luck.join(', ')} — not your fault` : 'bad luck';
          game.hud.toast(`Late: ${p.name} gave you 10 more minutes at ${f ? '+50%' : '+20%'} (${why}). Owe ${money(d.owe)}`, '#ffd36b');
        } else {
          if (d.stage === 'due') game.hud.text(p.name, this.say(p, 'noExt'));
          d.stage = 'hit';
          d.owe = Math.round(d.owe * 1.5);
          d.nextHit = 5;
          this.addTrust(p.id, -20);
          game.hud.text(p.name, this.say(p, 'hit', { owe: d.owe }));
          game.hud.toast(`${p.name} put a hit out on you!`, '#ff8080');
        }
        this.save();
      } else {
        if (game.time < (d.pauseUntil || 0)) continue; // fell back for now
        d.nextHit -= dt;
        if (d.nextHit <= 0 && !this.squads.some((sq) => !sq.called && sq.plug === d.plug) && game.wastedT <= 0) {
          d.nextHit = HIT_EVERY;
          this.sendSquad(p);
        }
      }
    }
  }

  // You just died or got busted: the plug's shooters fall back for a while.
  breather() {
    const game = this.game;
    for (const d of this.debts) {
      if (d.stage !== 'hit') continue;
      d.pauseUntil = game.time + BREATHER;
      d.nextHit = Math.max(d.nextHit, 5);
      for (const sq of this.squads) if (sq.plug === d.plug) sq.called = true;
      game.hud.text(this.plug(d.plug).name, this.say(this.plug(d.plug), 'breather'));
    }
  }

  // Shooters from the plug: a black car leaves the plug's corner and hunts you down.
  sendSquad(p) {
    const game = this.game;
    const T = game.turfWars;
    const car = new Vehicle(game.scene, 'sedan', p.x, p.z, -Math.PI / 2, GANGS.plug.car);
    game.vehicles.push(car);
    const riders = [];
    for (let i = 0; i < 3; i++) {
      const s = new Soldier(game, T, p.x + 2 + i, p.b.minZ + 1.5, 'plug', null, 'guard');
      s.aggroUntil = game.time + 1e6;
      s.baseHeart = s.heart = 1;
      T.soldiers.push(s);
      riders.push(s);
    }
    const ride = new GangRide(T, car, riders, p.b, 'chase');
    T.rides.push(ride);
    this.squads.push({ plug: p.id, car, riders, called: false });
    game.hud.toast(`${p.name}'s shooters are coming for you`, '#ff8080');
    game.hud.text(p.name, this.say(p, 'squad', { owe: this.debts.find((x) => x.plug === p.id)?.owe || 0 }));
  }

  updateSquads() {
    const game = this.game;
    const [px, pz] = game.player.pos();
    for (const sq of this.squads) {
      for (const s of sq.riders) {
        // Keep hunting you while the hit is on; when it's called off they stand down.
        if (!s.alive) continue;
        if (sq.called) s.aggroUntil = 0;
        else s.aggroUntil = Math.max(s.aggroUntil, game.time + 60);
        if (sq.called && dist(s.x, s.z, px, pz) > 80 && s.state !== 'inCar') s.dispose();
      }
      sq.riders = sq.riders.filter((s) => !s.removed && s.alive);
    }
    this.squads = this.squads.filter((sq) => sq.riders.length);
  }

  // ---- Street customers ----
  busy() {
    const game = this.game;
    const v = game.player.vehicle;
    return game.stars > 0 || game.time - (game.lastLoudT ?? -99) < 20 || (this.run && this.run.stage !== 'toPlug') || game.wastedT > 0 || game.bustedT > 0 || game.player.busy
      || game.turfWars.playerInWar() || game.turfWars.claim || this.risk.busy() || (v && Math.abs(v.speed) > 1) || game.shops.menu;
  }

  updateCustomer(dt, a) {
    const game = this.game;
    const c = this.customer;
    if (!c) {
      if (!this.holding() || this.busy()) return;
      this.custT -= dt;
      if (this.custT > 0) return;
      // More buyers where demand for what you're holding is high.
      const d = districtAt(game.player.x, game.player.z);
      const held = Object.keys(this.inv).filter((k) => this.inv[k] > 0);
      const dem = held.reduce((n, k) => n + game.market.demand[d][k], 0) / Math.max(1, held.length);
      this.custT = this.risk.loyalty(game.player.x, game.player.z)[1] * (CUSTOMER_GAP[this.tier()] / Math.min(1.8 * (CFG.MARKET_HOT ? 1.8 : 1), Math.max(0.6, dem))) * rand(0.7, 1.3) / (CFG.MARKET_HOT ? 3 : 1);
      if (this.pushing) this.custT *= 0.4; // word gets around: cheap
      this.findCustomer();
      return;
    }
    const [px, pz] = game.player.pos();
    c.t += dt;
    // Walk-up: they come to you. Drive-up: a car pulls over next to you.
    const ped = c.ped;
    let there = false;
    if (ped) {
      if (ped.removed || !ped.standing || ped.state !== 'buyer') return this.dropCustomer(false);
      there = dist(ped.x, ped.z, px, pz) < (game.player.vehicle ? 3.2 : 1.9);
    } else {
      const car = c.car;
      if (car.removed || car.wrecked || !car.driver || car.driver.stopAt !== c.stop) return this.dropCustomer(false);
      there = dist(car.x, car.z, px, pz) < 10 && Math.abs(car.speed) < 0.6;
      // Stuck in traffic: close enough, they hop out and walk over; too far, they give up.
      c.stuckT = !there && Math.abs(car.speed) < 0.5 ? (c.stuckT || 0) + dt : 0;
      if (c.stuckT > 2.5 && !c.offer && dist(car.x, car.z, px, pz) < 45) {
        const [fx, fz] = car.forward();
        const ped = game.peds.addAt(car.x + fz * 2, car.z - fx * 2);
        ped.state = 'buyer';
        ped.jaywalk = true; // already out in the street
        // The car waits, parked, for them to come back.
        car.driver.driveTo([[car.x, car.z], [car.x, car.z]]);
        ped.homeCar = car;
        c.ped = ped;
        c.car = null;
        c.t = 0;
        return;
      }
      if (c.stuckT > 8 && !c.offer) return this.dropCustomer(false);
    }
    // Across the street, waving you down: say the word and they come over.
    if (ped && ped.flagging && !c.offer) {
      c.flagT = (c.flagT || 0) + dt;
      c.t = Math.min(c.t, 5);
      const pad = game.input.mode === 'pad';
      this.prompt = `Someone across the street is waving you down — ${pad ? '✕' : 'E'} wave them over · ${pad ? '○' : 'Q'} ignore`;
      if (a.dealYes) {
        ped.jaywalk = true; // they cross wherever they are
        ped.flagging = false;
        c.t = 0;
      } else if (a.dealNo || c.flagT > 12 || this.busy() || dist(ped.x, ped.z, px, pz) > 60) return this.dropCustomer(false);
      a.melee = false;
      a.sprint = false;
      a.interactHeld = false;
      return;
    }
    if (!c.offer) {
      if (c.t > (c.car ? 45 : 25) || (this.busy() && !there)) return this.dropCustomer(false);
      if (!there) return;
      this.makeOffer(c);
    }
    // Offer on the table.
    c.wait += dt;
    const k = game.input.mode === 'pad';
    const tell = (c.tell ? ` · ${c.tell}` : '') + (c.pushed ? ' · pushing it' : '');
    this.prompt = `"${c.line}" — ${amountText(c.kind, c.units)} · ${money(c.price)}${tell} — ${k ? '✕' : 'E'} sell · ${k ? '○' : 'Q'} no`;
    if (a.dealYes) this.sell(c);
    else if (a.dealNo || c.wait > 10 || this.busy()) {
      game.hud.toast(`"${pick(DECLINE)}"`);
      this.dropCustomer(false);
    }
    // The buttons are for the deal right now.
    a.melee = false;
    a.sprint = false;
    a.interactHeld = false;
  }

  findCustomer() {
    const game = this.game;
    const pl = game.player;
    const [px, pz] = pl.pos();
    // On foot near the curb: sometimes a car pulls up instead.
    if (!pl.vehicle && Math.random() < 0.4) {
      const near = [...game.vehicles].sort((p1, p2) => dist(p1.x, p1.z, px, pz) - dist(p2.x, p2.z, px, pz));
      for (const car of near) {
        const d = car.driver;
        if (!d || !d.cruise || !d.active || car.removed || car.wrecked || d.stopAt || Math.abs(car.speed) < 3) continue;
        const dd = dist(car.x, car.z, px, pz);
        if (dd < 30 || dd > 160) continue;
        // It drives over through the streets and pulls up at the curb next to you.
        const route = gpsRoute(game.city, car.x, car.z, px, pz);
        if (route.length < 3) continue;
        const [rx, rz] = route[route.length - 2]; // middle of your street
        const k = dist(rx, rz, px, pz) || 1;
        route[route.length - 1] = [rx + ((px - rx) / k) * Math.min(k, 4.6), rz + ((pz - rz) / k) * Math.min(k, 4.6)];
        route[0] = [car.x, car.z];
        const stop = [px, pz];
        d.stopAt = stop;
        d.driveTo(route);
        this.customer = { car, stop, t: 0, wait: 0, offer: false };
        return;
      }
    }
    const peds = game.peds.peds.filter((p) => p.state === 'walk' && !p.shopkeeper && !p.served && !(p.askedT && game.time - p.askedT < 300) && dist(p.x, p.z, px, pz) > 10 && dist(p.x, p.z, px, pz) < 45);
    if (!peds.length) {
      this.custT = 8;
      return;
    }
    // One of the closer ones.
    peds.sort((p1, p2) => dist(p1.x, p1.z, px, pz) - dist(p2.x, p2.z, px, pz));
    const ped = pick(peds.slice(0, 4));
    ped.state = 'buyer';
    ped.cameFrom = [ped.x, ped.z]; // they head back this way after
    this.customer = { ped, t: 0, wait: 0, offer: false };
  }

  makeOffer(c) {
    const game = this.game;
    const tier = this.tier();
    // What they want depends on what's in demand around here.
    const M = game.market;
    const d = districtAt(game.player.x, game.player.z);
    const kinds = Object.keys(this.inv).filter((k) => this.inv[k] > 0);
    let r = Math.random() * kinds.reduce((n, k) => n + M.demand[d][k], 0);
    c.kind = kinds.find((k) => (r -= M.demand[d][k]) <= 0) || kinds[0];
    c.district = d;
    const P = PRODUCTS[c.kind];
    c.units = Math.min(this.inv[c.kind], randInt(1, 2 + tier));
    const [loyal] = this.risk.loyalty(game.player.x, game.player.z); // rival turf: their buyers pay less
    c.price = Math.max(5, Math.round((c.units * P.street * M.mult(d, c.kind) * loyal * (1 + 0.08 * tier) * rand(0.9, 1.1)) / 5) * 5);
    if (this.pushing) {
      // Selling cheap: they buy more, for less (never below what you paid).
      c.units = Math.min(this.inv[c.kind], c.units + randInt(1, 2));
      const normal = c.units * P.street * M.mult(d, c.kind) * loyal * (1 + 0.08 * tier);
      const floor = c.units * (this.basis[c.kind] || P.cost);
      c.price = Math.max(Math.ceil(floor / 5) * 5, Math.round((normal * this.pushFactor()) / 5) * 5);
      c.pushed = true;
    }
    // Is it a setup? More likely on a big buy, less on your own turf.
    const turf = game.turfWars.turfAt(game.player.x, game.player.z);
    let uc = 0.05 + 0.015 * c.units + (c.kind === 'coke' ? 0.04 : 0);
    if (turf && turf.id === 'crew') uc *= 0.6;
    uc *= 1 + 0.75 * (game.market.war || 0); // more undercover cops in a war on drugs
    c.undercover = Math.random() < uc;
    if (CFG.TEST_STING && !this.testStung) {
      c.undercover = true; // testing: this one's a cop
      this.testStung = true;
    }
    c.rob = !c.undercover && Math.random() < ROB_CHANCE[tier];
    // Sometimes you can read them.
    c.tell = (c.undercover ? Math.random() < 0.65 : Math.random() < 0.12) ? pick(TELLS) : '';
    // What they say. An undercover cop sometimes talks like one (names it outright).
    const fill = (t) => t.replace('{n}', c.units).replace('{code}', pick(CODE[c.kind])).replace('{units}', c.units === 1 ? P.unit : P.units).replace('{name}', P.name.toLowerCase());
    if (c.undercover && Math.random() < 0.5) {
      c.line = fill(pick(COP_ASKS));
      c.tell = '';
    } else c.line = fill(pick(c.ped ? ASKS : DRIVER_ASKS));
    c.offer = true;
  }

  sell(c) {
    const game = this.game;
    const where = c.ped || c.car;
    this.inv[c.kind] -= c.units;
    if (c.undercover) {
      this.sting(c);
    } else if (c.rob) {
      game.hud.toast(c.ped ? 'He snatched it and ran! Get it back!' : 'They grabbed it and took off!', '#ff8080');
      this.luck('robbed');
      if (c.ped) {
        c.ped.loot = { kind: c.kind, units: c.units };
        c.ped.state = 'walk';
        c.ped.scare(game.player.x, game.player.z);
        c.ped.t = 14; // keeps running
        this.robbers = [...(this.robbers || []), { ped: c.ped, t: 30 }];
      }
      this.dropCustomer(true);
    } else {
      game.cash += c.price;
      for (const d of this.debts) if (d.product === c.kind) d.idle = 0;
      game.market.sold(c.district, c.kind, c.units);
      this.risk.afterSale(where.x, where.z, c.price, c.units);
      game.cred += 1 + Math.floor(c.units / 3);
      game.sfx.cash?.();
      game.hud.toast(`+${money(c.price)}`);
      this.dropCustomer(true);
    }
    game.save();
    this.save();
  }

  // Sold to an undercover cop: badge out, gun on you, and backup already rolling in.
  sting(c) {
    const game = this.game;
    let cop = c.ped;
    if (!cop) {
      // A drive-up: he gets out of the car.
      const car = c.car;
      const [fx, fz] = car.forward();
      cop = game.peds.addAt(car.x + fz * (car.radius + 0.8), car.z - fx * (car.radius + 0.8));
      if (car.driver && car.driver.route) car.driver.driveTo([[car.x, car.z], [car.x, car.z]]);
    }
    this.customer = null;
    cop.state = 'sting';
    cop.isCop = true; // shooting him is shooting a cop
    cop.served = true;
    cop.fireT = 8; // holds you at gunpoint; fires if you resist (see Ped 'sting')
    if (!cop.badgeGun) {
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.32), new THREE.MeshLambertMaterial({ color: 0x151515 }));
      gun.position.set(0, -0.64, 0.05);
      gun.rotation.x = Math.PI / 2;
      cop.char.armR.add(gun);
      const badge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.03), new THREE.MeshBasicMaterial({ color: 0xf1c40f }));
      badge.position.set(0, -0.66, 0.06);
      cop.char.armL.add(badge);
      cop.badgeGun = true;
    }
    game.crime('drugDeal', cop.x, cop.z);
    const [px, pz] = game.player.pos();
    game.police.raid(px, pz, 3, true); // backup was already waiting around the corner
    game.startCinematic(px, pz, 'POLICE', 4.5);
    game.hud.toast('"Police! Hands where I can see em!"', '#ff8080');
    game.save();
  }

  // Robbers who got away with your stuff: knock them down or kill them to get it back.
  updateRobbers(dt) {
    if (!this.robbers) return;
    const game = this.game;
    for (const r of this.robbers) {
      r.t -= dt;
      const p = r.ped;
      if (!p.loot) continue;
      if (!p.standing) {
        this.inv[p.loot.kind] += p.loot.units;
        game.hud.toast(`Got your ${PRODUCTS[p.loot.kind].name.toLowerCase()} back`);
        p.loot = null;
        this.save();
      }
    }
    this.robbers = this.robbers.filter((r) => r.ped.loot && r.t > 0 && !r.ped.removed);
  }

  dropCustomer(dealt) {
    const c = this.customer;
    this.customer = null;
    if (!c) return;
    if (c.ped) c.ped.askedT = this.game.time; // they don't come straight back
    if (c.ped && c.ped.state === 'buyer') {
      const ped = c.ped;
      const game = this.game;
      ped.served = true;
      ped.state = 'leave';
      ped.navFails = 0;
      const car = ped.homeCar;
      if (car && !car.removed && !car.wrecked && car.driver && car.driver.route) {
        // Back to the car they got out of, and off they drive.
        const [fx, fz] = car.forward();
        ped.door = [car.x + fz * (car.radius + 0.6), car.z - fx * (car.radius + 0.6)];
        ped.onArrive = () => {
          if (car.removed || !car.driver || !car.driver.release) return;
          car.driver.release(game);
          car.driver.cruise = rand(10, 13);
        };
      } else {
        // Back the way they came, and around the corner out of sight.
        const [px, pz] = game.player.pos();
        const back = ped.cameFrom && dist(ped.cameFrom[0], ped.cameFrom[1], px, pz) > 8 ? ped.cameFrom : null;
        ped.door = back || escapePoint(game, ped, px, pz);
        ped.leaveAway = true;
      }
    }
    if (c.homeCar && c.homeCar.driver && c.homeCar.driver.route && !(c.ped && c.ped.onArrive)) c.homeCar.driver.release(this.game);
    if (c.car && c.car.driver && c.car.driver.stopAt === c.stop) {
      c.car.driver.release(this.game);
      if (dealt && (c.rob || c.undercover)) c.car.driver.cruise = 20; // peel off
    }
    if (!dealt) this.custT = Math.min(this.custT, CFG.MARKET_HOT ? 4 : 20); // they never showed: someone else soon
  }

  // Busted: the cops take everything you're holding (and the load, if you're on a run).
  onBusted() {
    const had = this.holding() + (this.run && this.run.stage === 'toHQ' ? this.run.amount : 0);
    if (had) this.game.hud.news(`Police seize drugs from an arrested Green Street member`, 'info');
    this.inv = { weed: 0, pills: 0, coke: 0 };
    this.luck('busted');
    if (this.job) this.failJob('You got locked up');
    this.lostRun();
    this.breather();
  }

  // Killed. Who did it decides what happens to what you had on you:
  // - opps (a rival gang): they run your pockets — all your cash and all your product.
  // - the plug's shooters: they take all your cash (it comes off what you owe) and the product.
  // - the cops: they seize the product.
  // - anything else (a crash, a fire): the product hits the ground where you went down.
  onWasted(by, gangName) {
    this.risk.onWasted();
    const game = this.game;
    const [x, z] = game.player.pos();
    const held = this.holding();
    this.luck('killed');
    if (by === 'opps' || by === 'plug') {
      const cash = game.cash;
      game.cash = 0;
      this.inv = { weed: 0, pills: 0, coke: 0 };
      if (by === 'plug') {
        const d = this.debts.find((q) => q.stage === 'hit') || this.debts[0];
        if (d) gangName = `${this.plug(d.plug).name}'s shooters`;
        if (d && cash > 0) {
          const p = this.plug(d.plug);
          const cut = Math.min(d.owe, cash);
          d.owe -= cut;
          if (d.owe <= 0) this.debts = this.debts.filter((q) => q !== d);
          game.hud.text(p.name, d.owe > 0 ? this.say(p, 'took', { cut, owe: d.owe }) : this.say(p, 'paidHit'));
        }
      }
      if (cash > 0 || held) game.hud.toast(`${gangName || 'They'} ran your pockets: ${cash > 0 ? `-${money(cash)}` : ''}${cash > 0 && held ? ' and ' : ''}${held ? 'all your product' : ''}`, '#ff8080');
    } else if (by === 'cops') {
      if (held) game.hud.toast('The cops seized your product', '#ff8080');
      this.inv = { weed: 0, pills: 0, coke: 0 };
    } else {
      let dropped = 0;
      for (const [k, n] of Object.entries(this.inv)) {
        if (n <= 0) continue;
        game.inventory.dropDrug(x + rand(-1.2, 1.2), z + rand(-1.2, 1.2), k, n);
        game.pickups.at(-1).t = 90;
        dropped += n;
        this.inv[k] = 0;
      }
      if (dropped) game.hud.toast('Your product hit the ground where you went down', '#ff8080');
    }
    if (this.job) this.failJob('You went down');
    this.lostRun();
    this.breather();
  }

  lostRun() {
    if (this.run) {
      if (this.run.stage === 'toHQ') this.game.hud.toast(`The load is gone — you still owe ${this.plug(this.run.plug).name}`, '#ff8080');
      this.run = null;
      this.game.mapView.waypoint = null;
    }
    this.dropCustomer(false);
    this.save();
  }

  // ---- HUD ----
  banner() {
    const game = this.game;
    const r = this.run;
    const j = this.job;
    if (j && !r) {
      const p = this.plug(j.plug);
      return j.kind === 'drop' ? `JOB FOR ${p.name.toUpperCase()} · deliver the package to ${j.street} · ${fmt(j.left)}` : `JOB FOR ${p.name.toUpperCase()} · collect from ${j.target ? j.target.name : 'him'} on ${j.street} · ${fmt(j.left)}`;
    }
    if (r) {
      const p = this.plug(r.plug);
      if (r.stage === 'toPlug') return `DRUG RUN · pick up ${amountText(r.product, r.amount)} from ${p.name} on ${p.street}`;
      if (r.stage === 'loading') return `DRUG RUN · loading up at ${p.name}'s`;
      return `DRUG RUN · get ${amountText(r.product, r.amount)} back to the hangout`;
    }
    const d = this.debts[0];
    if (d) {
      const p = this.plug(d.plug);
      const push = this.pushing ? ' · PUSHING IT' : '';
      if (d.stage === 'hit') return game.time < (d.pauseUntil || 0) ? `HIT ON YOU · shooters fell back ${fmt(d.pauseUntil - game.time)} · pay ${p.name} ${money(d.owe)} in person` : `HIT ON YOU · ${p.name}'s shooters · pay ${money(d.owe)} in person on ${p.street}`;
      return `${d.stage === 'ext' ? 'LATE · ' : ''}OWE ${p.name.toUpperCase()} ${money(d.owe)} · ${fmt(d.left)} left · pay in person${push}`;
    }
    return '';
  }

  hudLine() {
    const parts = Object.entries(this.inv).filter(([, n]) => n > 0).map(([k, n]) => `${PRODUCTS[k].name} ${n}`);
    if (this.run && this.run.stage === 'toHQ') parts.unshift(`Carrying ${this.run.amount}`);
    return parts.join(' · ');
  }

  blips() {
    return this.plugs.map((p) => [p.x, p.z, this.run && this.run.plug === p.id ? '#e0b000' : '#6c3483', 'D']);
  }
}

