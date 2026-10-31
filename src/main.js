import * as THREE from 'three';
import { CFG, CRIMES, GANG_NAME } from './config.js';
import { CourtMenu } from './courtmenu.js';
import { METER_STYLES } from './throwmeter.js';
import { ResultsCard } from './contest.js';
import { Leaderboard } from './leaderboard.js';
import { DiceManager } from './dice.js';
import { PostGame } from './postgame.js';
import { buildCity, districtAt, streetAt } from './city.js';
import { buildSidewalks } from './sidewalk.js';
import { Streets } from './streets.js';
import { DayNight } from './daynight.js';
import { Rhythm } from './rhythm.js';
import { TouchControls } from './touch.js';
import { GFX, PHONE, QUALITY, setQuality } from './quality.js';
import { Transit } from './transit.js';
import { Hoops } from './hoops.js';
import { Football } from './football.js';
import { Streetball } from './streetball.js';
import { Gridiron } from './gridiron.js';
import { Playground } from './playground.js';
import { noteCrime } from './safety.js';
import { Pursuit, LOW_RANGE } from './pursuit.js';
import { StopScene } from './stopscene.js';
import { Justice } from './jail.js';
import { Parking } from './parking.js';
import { Props } from './props.js';
import { Enforcement } from './enforcement.js';
import { Travel } from './travel.js';
import { Highway } from './highway.js';
import { RampEditor, takeStartAt } from './rampeditor.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Vehicle, resolveCarCollisions } from './vehicle.js';
import { TrafficManager } from './traffic.js';
import { PedManager } from './peds.js';
import { PoliceManager } from './police.js';
import { GangManager, CrewManager, MAX_CREW } from './gang.js';
import { Hud } from './hud.js';
import { Effects } from './effects.js';
import { Sfx } from './audio.js';
import { AirCam, ClipPlayer } from './aircam.js';
import { TurfManager, GANGS } from './turf.js';
import { Arsenal, WEAPONS, raycast, rayBox, rayHitBox } from './weapons.js';
import { lam } from './character.js';
import { segmentBlocked, pushCircle } from './collision.js';
import { MapView } from './mapview.js';
import { MovesList } from './moveslist.js';
import { Matchup } from './matchup.js';
import { ContestCine } from './contestcine.js';
import { QbcCine } from './qbccine.js';
import { DriveCine } from './drivecine.js';
import { AnimViewer } from './animviewer.js';
import { markRecoil, markFlinch, PUNCH_T, FIGHT_STYLES, PISTOL_STYLES } from './combatpose.js';
import { stepFalls } from './character.js';
import { Shops } from './shops.js';
import { Drugs } from './drugs.js';
import { Bank } from './bank.js';
import { PropertyMarket } from './property.js';
import { Economy } from './economy.js';
import { CityBudget } from './budget.js';
import { EconDebug } from './econdebug.js';
import { Bases } from './bases.js';
import { Backup } from './backup.js';
import { Market } from './market.js';
import { President } from './president.js';
import { Phone } from './phone.js';
import { Inventory } from './inventory.js';
import { gpsRoute, GpsLine } from './gps.js';
import { clamp, dist, lerp, lerpAngle, rand, randInt, wrapAngle } from './util.js';

// Dirty cop tells (1-2 show on a stop; 'name' means it's an officer from the misconduct stories).
const DIRTY_TELLS = ['came alone, no partner', 'no siren, never called it in', 'unmarked car', 'asks "what you got on you?"', 'waves you around the corner', "hasn't cuffed you", 'name'];
const CLEAN_TELLS = ['partner watching from the car', 'calls it in on the radio', 'reads you your rights', 'cuffs out', 'body cam light blinking', 'lights flashing'];
const DIRTY_NAMES = ['Kessler', 'Ortega', 'Mallory', 'Brandt'];
const CLEAN_NAMES = ['Nguyen', 'Harris', 'Cole', 'Delgado', 'Price', 'Watts', 'Kim', 'Barnes'];

const SAVE_KEY = 'crimecity.v1';
const tmpV = new THREE.Vector3();

class Game {
  constructor() {
    const canvas = document.getElementById('game');
    // Graphics quality: phones get lighter settings (quality.js).
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: GFX.antialias });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, GFX.pixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = GFX.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    CFG.PEDS = Math.round(CFG.PEDS * GFX.crowd);
    CFG.TRAFFIC_CARS = Math.round(CFG.TRAFFIC_CARS * GFX.traffic);
    this.scene = new THREE.Scene();
    const sky = new THREE.Color(0x9fc3e0);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, GFX.fogNear, GFX.fogFar);
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.3, GFX.far); // (near 0.3 m: sharper depth far off, no flicker where surfaces nearly touch) // nothing past the fog

    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x4a4a40, 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(GFX.shadowMap, GFX.shadowMap);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -GFX.shadowRange;
    sc.right = sc.top = GFX.shadowRange;
    sc.near = 10;
    sc.far = 320;
    this.scene.add(this.sun, this.sun.target);

    this.city = buildCity(this.scene);
    this.scene.userData.groundY = this.city.groundY;
    this.highway = new Highway(this); // the ring and crosstown freeways (before the radar is drawn)
    this.city.highway = this.highway;
    if (CFG.RAMP_EDITOR) this.rampEditor = new RampEditor(this); // (testing: reshape the interchange ramps)
    this.streets = new Streets(this); // traffic lights, stop signs, street lights
    this.city.streetsRef = this.streets;
    this.city.walk = buildSidewalks(this.city, this.scene); // sidewalks and crosswalks for people on foot
    this.dayNight = new DayNight(this);
    this.input = new Input(canvas);
    // Touch controls (phones and tablets): a virtual controller, on at the first touch.
    this.input.touch = new TouchControls(this.input, { spawnButton: CFG.CAR_SPAWN_KEY, force: new URLSearchParams(location.search).has('touch') });
    this.hud = new Hud(this.city);
    this.mapView = new MapView(this);
    this.moves = new MovesList(this); // (how to play the pickup game you're in: pauses it)
    this.matchup = new Matchup(this); // (the cinematic before a one-on-one)
    this.contestCine = new ContestCine(this); // (the 3-point contest's intro, record and finish)
    this.qbcCine = new QbcCine(this); // (the QB Challenge's intro and finish)
    this.driveCine = new DriveCine(this); // (the drive's intro)
    this.animViewer = new AnimViewer(this); // (every pose and move, one at a time: from the pause menu)
    // Your style (the pause menu): how you hold a pistol, how you stand with your fists up.
    this.style = { grip: 'two', fight: 'orthodox', meter: 'arc' };
    try {
      Object.assign(this.style, JSON.parse(localStorage.getItem('crimecity.style.v1') || '{}'));
    } catch {}
    if (!PISTOL_STYLES[this.style.grip]) this.style.grip = 'two';
    if (!FIGHT_STYLES[this.style.fight]) this.style.fight = 'orthodox';
    if (!METER_STYLES[this.style.meter] || this.style.meterV !== 2) Object.assign(this.style, { meter: 'arc', meterV: 2 }); // (the arc is the default now)
    this.gpsLine = new GpsLine(THREE, this.scene);
    this.aircam = new AirCam(this);
    this.clipPlayer = new ClipPlayer();
    this.effects = new Effects(this.scene);
    this.sfx = new Sfx();
    this.arsenal = new Arsenal();

    const sp = this.city.spawn;
    this.player = new Player(this, sp.x, sp.z);
    this.vehicles = [];
    this.walkers = [];
    this.pickups = [];
    this.rhythm = new Rhythm(this); // how busy the streets are by time of day and district
    this.rhythm.update(0, true);
    this.traffic = new TrafficManager(this);
    this.peds = new PedManager(this);
    this.hoops = this.city.courts.map((site) => new Hoops(this, site)); // (people shooting hoops at each court)
    this.football = new Football(this); // (football practice at Harbor Field)
    this.sport = new Streetball(this); // (one-on-one with somebody at the courts)
    this.gridiron = new Gridiron(this); // (quarterback a drive at Harbor Field)
    this.courtMenu = new CourtMenu(this); // (what we playing? courts and the field)
    this.leaderboard = new Leaderboard(); // (the 3-point contest's: shared in the published game)
    this.card = new ResultsCard(this); // (a contest run's results)
    this.postGame = new PostGame(this); // (after a game: dap, hug... or heated)
    this.dice = new DiceManager(this); // (street dice on the corners)
    this.playground = new Playground(this); // (kids at the Market St playground, people by the statue)
    this.pursuit = new Pursuit(this); // (police tactics, lying low, the radio)
    this.justice = new Justice(this); // (charges, booking, bail, jail time, your record)
    this.police = new PoliceManager(this);

    // Parked cars at the curb near the start point.
    const [c1, c2] = sp.cars;
    this.vehicles.push(new Vehicle(this.scene, 'sports', c1[0], c1[1], c1[2]));
    this.vehicles.push(new Vehicle(this.scene, 'sedan', c2[0], c2[1], c2[2]));

    this.traffic.init();
    this.peds.init();

    this.cash = 0;
    this.cred = 0;
    this.load();
    this.heat = 0;
    this.stars = 0;
    this.lastSeen = 0;
    this.lastKnown = null;
    this.searching = false;
    this.lethalFlag = false;
    this.health = 100;
    this.lastHurt = -99;
    this.lastShot = -99;
    this.lastGunfireCrime = -99;
    this.newsTimes = {};
    this.time = 0;
    this.camYaw = Math.PI;
    this.camPitch = 0.25;
    this.camIdle = 0;
    this.bustPressure = 0;
    this.bustedT = 0;
    this.wastedT = 0;
    this.robbing = null;
    this.lockTarget = null;
    this.lockScreen = null;
    this.showCrosshair = false;
    this.district = 'Downtown';
    this.prompt = '';
    this.progress = null;
    this.saveT = 0;
    this.started = false;
    this.paused = false;

    // Created after the player and city exist.
    this.gang = new GangManager(this);
    this.crew = new CrewManager(this);
    this.turfWars = new TurfManager(this);
    this.armor = 0;
    this.shops = new Shops(this);
    this.drugs = new Drugs(this);
    this.bank = new Bank(this);
    if (this.shops.refundSafehouse) {
      // The city was rebuilt: the old safehouse is refunded (it's back on the market).
      this.shops.refundSafehouse = false;
      this.bank.balance += 5000;
      this.bank.save();
      this.shops.save();
      this.cityRebuiltNote = true;
    }
    this.property = new PropertyMarket(this);
    this.economy = new Economy(this);
    this.budget = new CityBudget(this);
    this.econDebug = new EconDebug(this); // ` toggles the economy debug panel
    this.bases = new Bases(this);
    this.backup = new Backup(this); // calling for backup (phone → Contacts)
    this.transit = new Transit(this); // buses, routes and bus stops
    this.parking = new Parking(this); // cars parked along the curbs
    this.props = new Props(this); // hydrants, trash cans, benches, litter, graffiti
    this.enforce = new Enforcement(this); // red lights, speeding and traffic stops
    this.travel = new Travel(this); // taxis and buses (fast travel)
    this.market = new Market(this);
    this.president = new President(this);
    this.phone = new Phone(this);
    this.inventory = new Inventory(this);

    addEventListener('resize', () => this.resize());
    this.resize();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  get lethal() {
    return this.lethalFlag || this.stars >= 3;
  }

  start() {
    if (this.started) return;
    this.started = true;
    document.getElementById('intro').classList.add('hidden');
    this.hud.show();
    this.hud.clock = () => this.clockText();
    if (CFG.START_ON_FOOT) {
      // (testing: on foot at a set spot)
      const [x, z, deg] = CFG.START_ON_FOOT;
      this.player.x = x;
      this.player.z = z;
      this.player.heading = this.camYaw = (deg * Math.PI) / 180;
      this.player.sync?.();
    } else if (CFG.START_IN_CAR && !this.player.vehicle) {
      this.testCar = this.vehicles[0];
      const startAt = takeStartAt() || CFG.START_AT; // (just saved in the interchange editor: start there)
      if (startAt) {
        // (testing: start at a set spot)
        const [x, z, deg] = startAt;
        const v = this.testCar;
        v.x = x;
        v.z = z;
        v.heading = (deg * Math.PI) / 180;
        v.speed = 0;
        // (a 4th number: up on the freeway at that height)
        v.high = startAt[3] > 0;
        v.y = v.groundY = v.high ? startAt[3] : this.city.groundY(x, z);
        this.camYaw = v.heading;
      }
      this.player.enter(this.testCar);
    }
    // Own a safehouse? You wake up there.
    const home = this.shops.respawnPoint();
    if (home && !this.player.vehicle && !CFG.START_ON_FOOT) {
      this.player.x = home.x;
      this.player.z = home.z + 3;
      this.player.sync?.();
    }
    this.hud.news('Welcome to Crime City. Stay out of trouble.', 'info');
    this.sfx.unlock();
    if (this.input.touch.enabled) {
      // Phone: go full screen and sideways where the browser allows it (Android; iPhone
      // Safari doesn't, so add the page to the home screen there for full screen).
      try {
        const el = document.documentElement;
        const p = el.requestFullscreen?.({ navigationUI: 'hide' });
        if (p && p.then) p.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
      } catch {
        // (not allowed here)
      }
    } else if (this.input.mode !== 'pad') this.input.lock();
  }

  // In-game clock: a full day is 48 real minutes (one real second is half a game minute),
  // starting at 9:00 AM.
  gameMinutes() {
    return 9 * 60 + this.time * 0.5;
  }

  // Minutes past midnight right now.
  clockMinutes() {
    return Math.floor(this.gameMinutes()) % 1440;
  }

  // "Tue 9:42 PM · Day 3": the saved day count (bank.js counts days played; day 1 is a Monday).
  clockLong() {
    const day = (this.bank?.days || 0) + 1;
    const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(day - 1) % 7];
    return `${wd} ${this.clockText()} · Day ${day}`;
  }

  clockText() {
    const m = this.clockMinutes();
    const h = Math.floor(m / 60);
    return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }

  setPaused(p) {
    this.paused = p;
    this.hud.pause(p, this);
    document.body.classList.toggle('paused', !!p); // (the scoreboards hide under the pause menu)
    if (p) this.showStyle();
    // (a controller starts on RESUME; closing clears the highlight)
    this.setPauseFocus(p && this.input.mode === 'pad' ? document.getElementById('resume') : null);
    // (in a pickup game: a button to quit it)
    const q = document.getElementById('quit-game');
    const g = this.pickupGame();
    q.classList.toggle('hidden', !(p && g));
    if (p && g) {
      const key = this.input.touchMode ? '' : this.input.mode === 'pad' ? ' · △' : ' · F';
      const fresh = this.pickupFresh();
      q.textContent = g === this.sport && this.sport.solo && !this.sport.t33
        ? `Stop shooting around${key}`
        : `Quit the game${fresh ? (g === this.sport ? ' (no score yet: your money back)' : ' (no snap yet: your money back)') : g.bet ? ` (forfeit: -$${g.bet})` : ' (forfeit)'}${key}`;
    }
    if (p) this.input.unlock();
    else if (this.input.mode !== 'pad' && !this.input.touch.enabled) this.input.lock();
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      this.cash = s.cash || 0;
      this.cred = s.cred || 0;
    } catch {
      // Storage unavailable: start fresh.
    }
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ cash: this.cash, cred: this.cred }));
      this.shops?.save();
    } catch {
      // Ignore storage errors.
    }
  }

  // Everyone who can be shot, hit or run over. (Not the children at the playground: they can't
  // be hurt. They still run from trouble - see Ped.scare.)
  characters() {
    return [...this.peds.peds.filter((p) => !p.kid), ...this.police.officers().filter((o) => o.visibleOnStreet), ...this.gang.members, ...this.crew.visible(), ...this.turfWars.soldiers];
  }

  // You and your crew, as targets for enemies.
  playerFaction() {
    const [px, pz] = this.player.pos();
    const list = this.wastedT > 0 ? [] : [{ x: px, z: pz, ref: 'player' }];
    for (const m of this.crew.following) if (m.standing) list.push({ x: m.x, z: m.z, ref: m });
    return list;
  }

  // Who your crew shoots at: the rival gang when they're at war with you, and police in a gunfight.
  crewEnemies() {
    const list = [];
    if (this.gang.angry) for (const r of this.gang.members) if (r.standing) list.push({ x: r.x, z: r.z, ref: r });
    if (this.lethal) for (const o of this.police.officers()) if (o.standing) list.push({ x: o.x, z: o.z, ref: o });
    // Other gangs' soldiers fighting Green Street, or coming after you.
    for (const s of this.turfWars.soldiers) {
      if (!s.standing || s.gangId === 'crew') continue;
      const w = s.war && s.war.state === 'active' ? s.war : null;
      if (s.aggroUntil > this.time || (w && (w.attacker === 'crew' || w.defender === 'crew'))) list.push({ x: s.x, z: s.z, ref: s });
    }
    return list;
  }

  // Are police in a gunfight near this spot?
  copsNear(x, z) {
    if (!this.lethal) return false;
    return this.police.officers().some((o) => o.standing && dist(o.x, o.z, x, z) < 60)
      || this.police.units.some((u) => !u.leaving && dist(u.car.x, u.car.z, x, z) < 60);
  }

  // A civilian finished a 911 call about trouble at `threat`.
  civilianCall(ped, threat) {
    if (this.stars === 0) return;
    const [px, pz] = this.player.pos();
    // They can only report where you are if you're still around the scene.
    if (dist(px, pz, threat[0], threat[1]) > 70) return;
    this.lastKnown = [px, pz];
    this.lastSeen = Math.max(this.lastSeen, this.time - 2);
    this.unseenT = 0;
    if (this.time - (this.lastCallNews ?? -99) > 60) {
      this.lastCallNews = this.time;
      this.hud.news(`911 caller reports the suspect near ${streetAt(px, pz)}`);
    }
  }

  // Nearest target in range, preferring ones in line of sight.
  pickTarget(self, list, range) {
    let best = null;
    let bestScore = Infinity;
    for (const t of list) {
      const d = dist(self.x, self.z, t.x, t.z);
      if (d > range) continue;
      const score = d + (segmentBlocked(self.x, self.z, t.x, t.z, this.city.los) ? 40 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  // ---- Wanted level ----

  starsFor(heat) {
    let s = 0;
    for (const t of CFG.STAR_HEAT) if (heat >= t) s++;
    return s;
  }

  crime(type, x, z, extra = '') {
    const c = CRIMES[type];
    noteCrime(this, type, x, z); // (people stay away from the parks for a while)
    this.justice?.note(type); // (on your charge sheet)
    this.president.crime(type, c.label);
    this.property?.crimeType(type, x, z); // crime drags down property values there
    this.heat += c.heat;
    if (c.min && this.starsFor(this.heat) < c.min) this.heat = CFG.STAR_HEAT[c.min - 1];
    const before = this.stars;
    this.stars = Math.min(5, Math.max(this.stars, this.starsFor(this.heat)));
    this.lastSeen = this.time;
    this.lastKnown = [x, z];
    this.unseenT = 0;
    this.cred += c.cred;
    const where = `${streetAt(x, z)}, ${districtAt(x, z)}`;
    // One story per incident: only the first crime makes the news.
    if (type !== 'robbery') this.storyEvent(null, x, z, `${c.label}${extra ? ` ${extra}` : ''} on ${where}`, false);
    if (this.stars > before && before === 0) this.hud.news(`Police dispatched from Central Precinct to ${districtAt(x, z)}`);
  }

  arrestPressure(dt) {
    this.bustPressure += dt * 2;
  }

  clearWanted() {
    this.justice?.clear(); // (clear of the police: the charges go too, unless you're being booked)
    this.stars = 0;
    this.heat = 0;
    this.lethalFlag = false;
    this.bustPressure = 0;
  }

  // The cops have you. A lone patrol stop (1-2 stars, not a raid or a sting) can turn out to be
  // a dirty cop: you get a moment to read him first (see updateStop).
  bust(opts = {}) {
    if (this.stop) return;
    if (!opts.final && this.canStop()) return this.startStop();
    this.president.win(3, 'Arrests');
    const [bx, bz] = this.player.pos();
    this.endStory(`Suspect arrested on ${streetAt(bx, bz)}`, bx, bz, 'info', true);
    // Cuffed, then booked at the precinct (jail.js): bail, a lawyer, or the time.
    this.justice.start(opts);
    if (opts.bribery) this.hud.news(`Suspect charged with trying to bribe an officer on ${streetAt(bx, bz)}`, 'info');
    if (opts.resisting) this.hud.news(`Suspect charged with resisting arrest after scuffle with officer on ${streetAt(bx, bz)}`, 'info');
    this.bustedT = 3.2;
    this.drugs.onBusted();
    this.clearWanted();
    this.robbing = null;
    this.save();
  }

  afterBust() {
    if (this.justice.book()) return; // (booking: the menu takes it from here)
    this.hud.busted(false);
    this.respawnAt(this.shops.respawnPoint() || this.city.station);
  }

  wasted() {
    if (this.wastedT > 0 || this.bustedT > 0) return;
    const [x, z] = this.player.pos();
    if (this.stars > 0) this.endStory(`Suspect killed in shootout with police on ${streetAt(x, z)}`, x, z, 'crime', true);
    else if (!this.endStory(`Suspect shot dead on ${streetAt(x, z)}`, x, z)) this.hud.news(`Shooting victim rushed to Harbor General from ${districtAt(x, z)}`, 'info');
    this.health = 0;
    this.armor = 0;
    const recent = this.time - (this.lastHitT ?? -99) < 4;
    this.drugs.onWasted(recent ? this.lastHitBy : null, recent ? this.lastHitGang : null);
    const bill = Math.min(this.cash, 500);
    this.cash -= bill;
    this.hud.wasted(true, `Hospital bill $${bill.toLocaleString('en-US')}`);
    this.wastedT = 4;
    if (this.player.vehicle) this.player.exit();
    this.player.setDown(true);
    this.clearWanted();
    this.lockTarget = null;
    this.save();
  }

  afterWasted() {
    this.hud.wasted(false);
    this.player.setDown(false);
    this.health = 100;
    this.gang.calm();
    this.respawnAt(this.shops.respawnPoint() || this.city.hospital);
  }

  respawnAt(place) {
    if (this.player.vehicle) this.player.exit();
    this.player.stopRolling();
    this.crew.sendHome();
    this.police.clearAll();
    this.vehicles = this.vehicles.filter((v) => !v.removed);
    this.player.x = place.x;
    this.player.z = place.z + 3;
    this.player.heading = Math.PI;
    this.camYaw = Math.PI;
    this.player.sync();
  }

  updateWanted(dt) {
    if (this.stars === 0) {
      this.searching = false;
      this.lethalFlag = false;
      return;
    }
    const [px, pz] = this.player.pos();
    let seen = false;
    for (const u of this.police.units) {
      if (u.leaving) continue;
      if (!u.carLost && !u.allDead && u.mounted && this.spots(u.car, 1.4, 60, false)) seen = true;
      for (const o of u.officers) {
        if (o.standing && this.spots(o, 1.7, 38, true)) seen = true;
      }
    }
    // The helicopter's crew.
    const heli = this.police.heli;
    if (heli && heli.sees) seen = true;
    this.seenNow = seen;
    if (seen) {
      this.lastSeen = this.time;
      this.lastKnown = [px, pz];
      this.unseenT = 0;
    } else {
      // The escape clock only runs once police have reached the area they're searching.
      const [kx, kz] = this.lastKnown || [px, pz];
      const near = (heli && heli.state === 'pursuit' && dist(heli.x, heli.z, kx, kz) < 150) || this.police.units.some((u) =>
        dist(u.car.x, u.car.z, kx, kz) < 150 || u.officers.some((o) => o.standing && dist(o.x, o.z, kx, kz) < 150));
      if (near) this.unseenT = (this.unseenT || 0) + dt;
    }
    this.searching = this.time - this.lastSeen > 1.5;
    // Escaping: get out of the search area and stay unseen, or stay hidden for a long time
    // while they search.
    const since = this.unseenT || 0;
    const [kx, kz] = this.lastKnown || [px, pz];
    const outside = dist(px, pz, kx, kz) > this.searchRadius;
    if ((outside && since > 5 + this.stars * 1.5) || since > 30 + this.stars * 8) {
      const bonus = 10 * this.stars;
      this.cred += bonus;
      this.endStory(`Suspect escaped police in ${districtAt(px, pz)}`, px, pz, 'good', true);
      this.president.loss(2, 'Suspects getting away');
      this.hud.toast(`ESCAPED  +${bonus} cred`);
      this.clearWanted();
      this.police.standDown();
    }

    // Busted while stuck in a car with police right next to you (not in a gunfight).
    const v = this.player.vehicle;
    if (v && Math.abs(v.speed) < 1.5 && !this.lethal) {
      const close = this.police.units.some((u) => !u.carLost && dist(u.car.x, u.car.z, v.x, v.z) < 5.5);
      if (close) this.bustPressure += dt;
    }
    this.bustPressure = Math.max(0, this.bustPressure - dt * 0.8);
    if (this.bustPressure > 2.2) this.bust();
  }

  // ---- Combat ----

  // Something the player hit or killed.
  onPlayerHit(c, killed) {
    if (c.isCrew) return; // friendly fire
    if (c.isSoldier) c.onPlayerAttack();
    if (killed) {
      const st = streetAt(c.x, c.z);
      if (c.isCop) this.storyEvent('cops', c.x, c.z, `Officer shot dead on ${st}`);
      else if (c.isGang) this.storyEvent('gang', c.x, c.z, `${GANG_NAME} member gunned down on ${st}`);
      else if (c.isSoldier) this.storyEvent('gang', c.x, c.z, `${GANGS[c.gangId].name} member gunned down on ${st}`);
      if (c.isGang || c.isSoldier) this.turfWars.onPlayerKill(c);
      else if (!c.isCop) this.storyEvent('civ', c.x, c.z, `Bystander killed on ${st}`);
    }
    if (c.isCop) {
      this.lethalFlag = true;
      this.crime(killed ? 'copKilled' : 'assaultCop', c.x, c.z);
    } else if (c.isSoldier) {
      if (killed) {
        if (!this.turfWars.gangBusiness(c.x, c.z, c.gangId)) this.crime('gangKill', c.x, c.z);
        this.dropAmmo(c.x, c.z, c.weapon ? c.weapon.id : 'smg', c.weapon ? c.weapon.ammo * 2 : 30);
      }
    } else if (c.isGang) {
      this.gang.anger();
      if (killed) {
        if (!this.turfWars.gangBusiness(c.x, c.z, 'kings')) this.crime('gangKill', c.x, c.z);
        this.dropAmmo(c.x, c.z, c.weapon ? c.weapon.id : 'smg', c.weapon ? c.weapon.ammo * 2 : 30);
      }
    } else if (killed) {
      this.crime('murder', c.x, c.z);
      if (this.police.units.length) this.lethalFlag = true;
    } else this.crime('assault', c.x, c.z);
    if (killed && c.isCop) this.dropAmmo(c.x, c.z, 'pistol', 12);
  }

  muzzlePoint() {
    const p = this.player;
    const m = p.muzzle(this.arsenal.current().id);
    if (m) return [m.x, m.y, m.z];
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    return [p.x + fx * 0.9 - fz * 0.37, p.gy() + 1.5, p.z + fz * 0.9 + fx * 0.37];
  }

  // Where a locked-on shot goes: torso by default, head after a flick up on the right stick.
  lockAimPoint(t) {
    const y = this.city.groundY(t.x, t.z) + (t.standing ? (this.lockHead ? 1.8 : 1.3) : 0.3);
    return [t.x, y, t.z];
  }

  tryFire(a) {
    const w = this.arsenal.current();
    if (w.melee || this.arsenal.reloadT > 0 || this.arsenal.cool > 0) return;
    const want = w.auto ? a.fire : a.firePressed;
    if (!want) return;
    // A gun only fires while you're aiming it (right-click / L2 / AIM).
    if (!this.aimingNow) {
      if (a.firePressed && this.time - (this.aimTipT ?? -99) > 6) {
        this.aimTipT = this.time;
        this.hud.toast(this.input.touch?.enabled ? 'Tap AIM first to shoot' : this.input.mode === 'pad' ? 'Hold L2 to aim, then shoot' : 'Hold right-click to aim, then shoot', '#ffd479');
      }
      return;
    }
    const am = this.arsenal.ammo[w.id];
    if (am.mag <= 0) {
      if (!this.arsenal.startReload()) {
        this.sfx.empty();
        this.arsenal.cool = 0.3;
        if (am.reserve <= 0) this.hud.toast('Out of ammo. Switch weapons or find ammo.', '#ff8080');
      }
      return;
    }
    if (!CFG.INFINITE_AMMO) am.mag--;
    this.arsenal.cool = w.rate;
    this.lastShot = this.time;

    const [mx, my, mz] = this.muzzlePoint();
    const aiming = a.aim;
    const spread = (aiming ? w.aimSpread : w.spread) + this.player.speed * 0.004;
    let ox, oy, oz, dx, dy, dz;
    if (this.lockTarget && this.lockTarget.alive) {
      const [tx, ty, tz] = this.lockAimPoint(this.lockTarget);
      [ox, oy, oz] = [mx, my, mz];
      dx = tx - mx;
      dy = ty - my;
      dz = tz - mz;
    } else {
      this.camera.getWorldDirection(tmpV);
      [dx, dy, dz] = [tmpV.x, tmpV.y, tmpV.z];
      // Start the ray level with the player so nothing behind them gets hit.
      const cp = this.camera.position;
      const t0 = (this.player.x - cp.x) * dx + (my - cp.y) * dy + (this.player.z - cp.z) * dz;
      ox = cp.x + dx * Math.max(0, t0 - 0.2);
      oy = cp.y + dy * Math.max(0, t0 - 0.2);
      oz = cp.z + dz * Math.max(0, t0 - 0.2);
    }
    const l = Math.hypot(dx, dy, dz) || 1;
    const bx = dx / l, by = dy / l, bz = dz / l;
    this.effects.muzzle(mx, my, mz);
    markRecoil(this.player.char, this.time); // (the kick)
    this.sfx.shot(w.sound, 1);
    // Shotguns fire a spread of pellets; everything else one bullet.
    let anyKill = false;
    let anyHit = false;
    for (let k = 0; k < (w.pellets || 1); k++) {
      dx = bx + (Math.random() - 0.5) * spread * 2;
      dy = by + (Math.random() - 0.5) * spread * 2;
      dz = bz + (Math.random() - 0.5) * spread * 2;
      const l2 = Math.hypot(dx, dy, dz);
      dx /= l2;
      dy /= l2;
      dz /= l2;
      const hit = raycast(this, ox, oy, oz, dx, dy, dz, w.range, this.player.vehicle);
      if (k < 4) this.effects.tracer(mx, my, mz, hit.x, hit.y, hit.z);
      if (hit.type === 'char') {
        const c = hit.target;
        if (!c.alive) continue;
        const killed = c.takeHit(w.dmg * (hit.head ? 2 : 1), this.player.x, this.player.z);
        this.effects.hitPuff(hit.x, hit.y, hit.z);
        anyHit = true;
        anyKill = anyKill || killed;
        this.onPlayerHit(c, killed);
      } else if (hit.type === 'car') {
        const car = hit.target;
        car.damage(w.dmg * 0.5, true);
        // Hit near a wheel: pop that tire.
        car.wheels.forEach((wh, i) => {
          const [wx, wy, wz] = car.wheelPos(i);
          if (Math.hypot(hit.x - wx, hit.y - wy, hit.z - wz) < 0.55) car.popTire(i);
        });
        this.effects.impact(hit.x, hit.y, hit.z);
      } else if (hit.type === 'heli') {
        const down = hit.target.takeHit(w.dmg, this.player.x, this.player.z);
        this.effects.impact(hit.x, hit.y, hit.z);
        anyHit = true;
        anyKill = anyKill || down;
      } else if (hit.type !== 'none') {
        this.effects.impact(hit.x, hit.y, hit.z);
      }
    }
    if (anyHit) this.hud.hitmarker(anyKill);

    // Gunfire draws attention.
    const [px, pz] = this.player.pos();
    this.scareNearby(px, pz, 45, true);
    this.heardShot(px, pz);
    this.gunshot(px, pz, 'player');
    if (dist(px, pz, this.city.gangHome.x, this.city.gangHome.z) < 30) this.gang.anger();
    else if (this.gang.angry && this.gang.members.some((r) => r.alive && dist(r.x, r.z, px, pz) < 50)) this.gang.anger();
    // (a cop who can see where the shots came from, up to 70 m, is a witness too)
    const sees = (x, z) => !segmentBlocked(x, z, px, pz, this.city.los);
    const witnesses = this.peds.peds.some((p) => p.standing && dist(p.x, p.z, px, pz) < 30)
      || this.police.officers().some((o) => o.standing && (dist(o.x, o.z, px, pz) < 45 || (dist(o.x, o.z, px, pz) < 70 && sees(o.x, o.z))))
      || this.police.units.some((u) => !u.carLost && (dist(u.car.x, u.car.z, px, pz) < 45 || (dist(u.car.x, u.car.z, px, pz) < 70 && sees(u.car.x, u.car.z))));
    if (witnesses && this.time - this.lastGunfireCrime > 5 && !this.turfWars.gangBusiness(px, pz)) {
      this.lastGunfireCrime = this.time;
      this.storyEvent(null, px, pz, `Armed shooter on the loose on ${streetAt(px, pz)}`);
      this.crime('gunfire', px, pz);
    }
  }

  // An NPC (cop or gang member) shoots at the player.
  // An NPC shoots at a target: 'player' or another character.
  npcShootAt(shooter, ref, dmg, kind, acc = 1) {
    markRecoil(shooter.char, this.time); // (their kick, the same as yours)
    // Any shooting involving the rival gang keeps them at war.
    if (shooter.isGang || ref?.isGang) this.gang.anger();
    if (ref === 'player') return this.npcShoot(shooter, dmg, kind, acc);
    if (!ref || !ref.alive) return;
    dmg *= 2; // NPCs don't regenerate like you do, so fights between them need to resolve faster
    const d = dist(shooter.x, shooter.z, ref.x, ref.z);
    const h = shooter.heading;
    const y0 = this.city.groundY(shooter.x, shooter.z) + (shooter.crouched ? 1.0 : 1.5);
    const m = [shooter.x + Math.sin(h) * 0.9 - Math.cos(h) * 0.37, y0, shooter.z + Math.cos(h) * 0.9 + Math.sin(h) * 0.37];
    let p = clamp(0.62 - d * 0.013, 0.1, 0.62) * acc;
    if (ref.crouched) p *= 0.3;
    const hit = Math.random() < p;
    const miss = hit ? 0 : 1.4;
    const ty = this.city.groundY(ref.x, ref.z) + (ref.crouched ? 0.8 : 1.3) + (Math.random() - 0.5) * miss;
    const tx = ref.x + (Math.random() - 0.5) * miss * 2;
    const tz = ref.z + (Math.random() - 0.5) * miss * 2;
    this.effects.muzzle(m[0], m[1], m[2]);
    this.effects.tracer(m[0], m[1], m[2], tx, ty, tz, 0xffd28a);
    const [px, pz] = this.player.pos();
    this.sfx.shotAt(kind, dist(shooter.x, shooter.z, px, pz));
    this.scareNearby(shooter.x, shooter.z, 40, true);
    this.gunshot(shooter.x, shooter.z, shooter);
    if (!hit) {
      this.effects.impact(tx, ty, tz);
      return;
    }
    this.effects.hitPuff(tx, ty, tz);
    const killed = ref.takeHit(dmg, shooter.x, shooter.z);
    if (killed && shooter.isCop && ref.isGang) this.newsIncident(`${GANG_NAME} member killed by police on ${streetAt(ref.x, ref.z)}`, ref.x, ref.z);
    if (killed && shooter.isCrew) {
      if (ref.isGang) {
        this.cred += 10;
        this.dropAmmo(ref.x, ref.z, ref.weapon ? ref.weapon.id : 'smg', ref.weapon ? ref.weapon.ammo * 2 : 30);
      } else if (ref.isCop) this.crime('copKilled', ref.x, ref.z);
    }
  }

  npcShoot(shooter, dmg, kind, acc = 1) {
    if (this.wastedT > 0 || this.bustedT > 0) return;
    if (shooter.x !== undefined) this.gunshot(shooter.x, shooter.z, shooter);
    const [px, pz] = this.player.pos();
    const d = dist(shooter.x, shooter.z, px, pz);
    const h = shooter.heading;
    const y0 = shooter.muzzleY ?? this.city.groundY(shooter.x, shooter.z) + 1.45 * (shooter.char?.group.scale.y ?? 1); // (their gun's height: by their size)
    // Gun is in the right hand: forward and to the shooter's right.
    const m = [shooter.x + Math.sin(h) * 0.9 - Math.cos(h) * 0.37, y0 + 0.05, shooter.z + Math.cos(h) * 0.9 + Math.sin(h) * 0.37];
    const pv = this.player.vehicle;
    let p = clamp(0.62 - d * 0.013, 0.1, 0.62) * acc;
    if (!pv && this.player.speed > 5) p *= 0.6;
    if (!pv && this.aimingNow) p *= 0.85;
    if (!pv && this.player.lowProfile) p *= 0.7; // smaller target
    // On foot behind cover: the shot hits whatever is in the way.
    if (!pv) {
      const [cx, cy, cz] = this.playerTargetPoint();
      const block = this.coverBetween(m[0], m[1], m[2], cx + (Math.random() - 0.5) * 0.4, cy + (Math.random() - 0.5) * 0.4, cz + (Math.random() - 0.5) * 0.4);
      if (block) {
        this.effects.muzzle(m[0], m[1], m[2]);
        this.effects.tracer(m[0], m[1], m[2], block.x, block.y, block.z, 0xffd28a);
        this.effects.impact(block.x, block.y, block.z);
        if (block.type === 'car' && block.target) block.target.damage(dmg * 0.3, false);
        this.sfx.shotAt(kind, d);
        return;
      }
    }
    const hit = Math.random() < p;
    const ty = (pv ? this.highway.groundFor(pv) : this.player.gy()) + (pv ? 1.0 : this.player.lowProfile ? 0.85 : 1.3);
    const miss = hit ? 0 : 1.6;
    const tx = px + (Math.random() - 0.5) * miss * 2;
    const tz = pz + (Math.random() - 0.5) * miss * 2;
    const tyy = ty + (Math.random() - 0.5) * miss;
    this.effects.muzzle(m[0], m[1], m[2]);
    this.effects.tracer(m[0], m[1], m[2], tx, tyy, tz, 0xffd28a);
    this.sfx.shotAt(kind, d);
    if (hit) {
      // Remember who's shooting you: if they finish you, it decides who takes what you had.
      this.lastHitBy = shooter.isCop ? 'cops' : shooter.gangId === 'plug' ? 'plug' : shooter.isGang || (shooter.gangId && shooter.gangId !== 'crew') ? 'opps' : null;
      this.lastHitGang = shooter.isGang ? GANG_NAME : shooter.gangId && GANGS[shooter.gangId] ? GANGS[shooter.gangId].name : null;
      this.lastHitT = this.time;
      this.hurtPlayer(dmg);
    } else this.effects.impact(tx, tyy, tz);
  }

  // Where on the player an NPC aims (chest, lower when crouched).
  playerTargetPoint() {
    const [px, pz] = this.player.pos();
    const y = (this.player.vehicle ? this.highway.groundFor(this.player.vehicle) : this.player.gy()) + (this.player.vehicle ? 1.0 : (this.player.lowProfile ? 0.85 : 1.3) * this.player.char.group.scale.y);
    return [px, y, pz];
  }

  // First solid thing (wall, crate, car) on the line from a to b, or null if it's clear.
  coverBetween(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.5) return null;
    const hit = raycast(this, ax, ay, az, dx / len, dy / len, dz / len, len - 0.3, this.player.vehicle, true);
    return hit.type === 'world' || hit.type === 'car' ? hit : null;
  }

  // Can this police officer (or a cruiser's crew) see you?
  // Walls always block. Crouching behind low cover (crates, cars) hides you from a distance,
  // and a cop on foot only spots you within his field of view.
  canSeePlayer(viewer, eyeY, range, useFov) {
    const [px, pz] = this.player.pos();
    // Lying low (pursuit.js): only spotted from close up.
    if (this.pursuit?.lyingLow) range = Math.min(range, useFov ? LOW_RANGE.foot : LOW_RANGE.car);
    const d = dist(viewer.x, viewer.z, px, pz);
    if (d > range) return false;
    if (segmentBlocked(viewer.x, viewer.z, px, pz, this.city.los)) return false;
    if (useFov && d > 8 && viewer.heading !== undefined) {
      const ang = Math.abs(wrapAngle(Math.atan2(px - viewer.x, pz - viewer.z) - viewer.heading));
      if (ang > 1.9) return false; // looking the other way
    }
    if (!this.player.vehicle && this.player.lowProfile && d > 5) {
      const [tx, ty, tz] = this.playerTargetPoint();
      const ey = this.city.groundY(viewer.x, viewer.z) + eyeY;
      if (this.coverBetween(viewer.x, ey, viewer.z, tx, ty + 0.25, tz)) return false;
    }
    return true;
  }

  // A cop who watched you duck behind cover knows you're still there. You only shake him by
  // sneaking a few meters away along the cover, or putting a wall between you.
  spots(viewer, eyeY, range, useFov) {
    const [px, pz] = this.player.pos();
    if (this.canSeePlayer(viewer, eyeY, range, useFov)) {
      viewer.sawAt = [px, pz];
      viewer.sawT = this.time;
      return true;
    }
    if (!viewer.sawAt || this.time - viewer.sawT > 45 || this.player.vehicle) return false;
    if (dist(px, pz, viewer.sawAt[0], viewer.sawAt[1]) > 3.5) return false;
    if (dist(viewer.x, viewer.z, px, pz) > range * 1.2) return false;
    return !segmentBlocked(viewer.x, viewer.z, px, pz, this.city.los);
  }

  // Shots fired at (x, z) - by you ('player') or anyone else. Everyone who hears them reacts,
  // hit or not:
  // - gang members (and the Kings at their corner) go on alert: gun up, facing the sound, the
  //   jumpy ones crouched; rivals who can see you were the shooter come for you.
  // - officers on foot draw and turn toward it.
  // - patrol cars that hear it (up to ~170 m) drive over with their lights on to look around;
  //   if they find you there soon after, they know it was you. (Gang wars are left to the gangs,
  //   and cops' own shots don't send anyone.)
  gunshot(x, z, shooter) {
    const byYou = shooter === 'player';
    const R = byYou ? 55 : 45;
    const [px, pz] = this.player.pos();
    const clear = (ax, az, bx, bz) => !segmentBlocked(ax, az, bx, bz, this.city.los);
    for (const s of this.turfWars.soldiers) {
      if (s === shooter || !s.alive || !s.standing) continue;
      const d = dist(s.x, s.z, x, z);
      if (d > R) continue;
      s.hear(x, z);
      if (byYou && s.gangId !== 'crew' && !s.war && dist(s.x, s.z, px, pz) < 45 && clear(s.x, s.z, px, pz)) this.turfWars.aggro(s.gangId, s.x, s.z, 30);
    }
    for (const m of this.gang.members) {
      if (m === shooter || !m.alive || !m.standing) continue;
      const d = dist(m.x, m.z, x, z);
      if (d > R) continue;
      m.hear(x, z);
      if (byYou && dist(m.x, m.z, px, pz) < 45 && clear(m.x, m.z, px, pz)) this.gang.anger();
    }
    for (const o of this.police.officers()) {
      if (!o.standing || o === shooter || dist(o.x, o.z, x, z) > R) continue;
      o.alertUntil = this.time + 10;
      o.alertAt = [x, z];
    }
    // Patrol cars come to check it out.
    if (shooter?.isCop || (byYou && this.stars > 0)) return;
    if (!byYou && this.turfWars.gangBusiness(x, z)) return;
    let sent = null;
    for (const u of this.police.units) {
      if (!u.patrol || u.pull || u.check || u.carLost || u.allDead) continue;
      if (dist(u.car.x, u.car.z, x, z) > 170) continue;
      u.check = { x, z, t: 35 };
      if (!sent) sent = u;
      else break; // (two at most)
    }
    if (sent) this.pursuit?.radio(`Dispatch: shots fired near ${streetAt(x, z) || districtAt(x, z)}. Unit ${sent.callsign} responding.`);
  }

  // Police nearby hear gunfire and know roughly where it came from.
  heardShot(x, z) {
    if (this.stars === 0) return;
    const near = this.police.units.some((u) => !u.leaving && (dist(u.car.x, u.car.z, x, z) < 80
      || u.officers.some((o) => o.standing && dist(o.x, o.z, x, z) < 80)));
    if (!near) return;
    this.lastKnown = [x, z];
    this.lastSeen = Math.max(this.lastSeen, this.time - 3);
    this.unseenT = 0;
  }

  // The area they're combing: it widens slowly the longer they search.
  get searchRadius() {
    const since = this.searching ? this.time - this.lastSeen : 0;
    return 35 + this.stars * 8 + Math.min(30, since * 0.4);
  }

  // An officer shoots at a car's tires (front tires first).
  shootTire(shooter, v) {
    const order = [...v.wheels.keys()].filter((i) => !v.wheels[i].userData.flat)
      .sort((a, b) => (v.wheels[b].userData.front ? 1 : 0) - (v.wheels[a].userData.front ? 1 : 0));
    if (!order.length) return;
    const i = Math.random() < 0.75 ? order[0] : order[Math.floor(Math.random() * order.length)];
    const [wx, wy, wz] = v.wheelPos(i);
    const d = dist(shooter.x, shooter.z, wx, wz);
    const h = shooter.heading;
    const y0 = this.city.groundY(shooter.x, shooter.z) + 1.45;
    const m = [shooter.x + Math.sin(h) * 0.9 - Math.cos(h) * 0.37, y0, shooter.z + Math.cos(h) * 0.9 + Math.sin(h) * 0.37];
    // Harder to hit far away or at speed.
    const p = clamp(0.55 - d * 0.008, 0.15, 0.5) * (1 - Math.min(0.5, Math.abs(v.speed) / 60));
    const hit = Math.random() < p;
    const miss = hit ? 0 : 1.2;
    const tx = wx + (Math.random() - 0.5) * miss * 2;
    const tz = wz + (Math.random() - 0.5) * miss * 2;
    this.effects.muzzle(m[0], m[1], m[2]);
    this.effects.tracer(m[0], m[1], m[2], tx, wy, tz, 0xffd28a);
    const [px, pz] = this.player.pos();
    this.sfx.shotAt('pistol', dist(shooter.x, shooter.z, px, pz));
    this.scareNearby(shooter.x, shooter.z, 40, true);
    this.effects.impact(tx, wy, tz);
    if (hit && v.popTire(i)) {
      this.effects.smoke(wx, (v?.y || 0) + 0.5, wz);
      if (v.driver === 'player') this.hud.toast(v.flatCount >= 2 ? 'Tires shot out!' : 'Tire shot out!', '#ff8080');
    }
  }

  hurtPlayer(dmg, blow = null) {
    if (this.wastedT > 0 || this.bustedT > 0) return;
    const v = this.player.vehicle;
    if (v) {
      v.damage(dmg * 0.7, false);
      dmg *= 0.35;
    }
    // Body armor soaks up 70% of each hit until it's worn through.
    if (this.armor > 0) {
      const soak = Math.min(this.armor, dmg * 0.7);
      this.armor -= soak;
      dmg -= soak;
    }
    this.health -= dmg;
    this.lastHurt = this.time;
    this.hud.hurt();
    // (hit: a jolt; aiming, just a kick so you stay on target)
    if (!v) {
      if (this.aimingNow) markRecoil(this.player.char, this.time);
      else markFlinch(this.player.char, this.time, blow ? 'hit' : dmg > 12 ? 'shot' : 'hit', blow || 'jab');
    }
    if (this.health <= 0) this.wasted();
  }

  explode(v) {
    const { x, z } = v;
    v.burnOut();
    this.effects.explosion(x, z);
    const [px, pz] = this.player.pos();
    this.sfx.explosionAt(dist(x, z, px, pz));
    if (v.driver && v.driver !== 'player' && v.driver.active !== undefined) v.driver.active = false;
    this.crew.carDestroyed(v);
    if (this.player.vehicle === v) {
      this.player.exit();
      this.hurtPlayer(95);
    } else if (!this.player.vehicle) {
      const d = dist(x, z, this.player.x, this.player.z);
      if (d < 7) this.hurtPlayer(90 * (1 - d / 7));
    }
    for (const c of this.characters()) {
      if (!c.alive) continue;
      const d = dist(x, z, c.x, c.z);
      if (d < 4.5) {
        const killed = c.takeHit(999, x, z);
        if (v.byPlayer && !v.playerUsed && killed) this.onPlayerHit(c, true);
      } else if (d < 8) c.knockDown(x, z, 2);
    }
    for (const o of this.vehicles) {
      if (o === v || o.removed) continue;
      const d = dist(x, z, o.x, o.z);
      if (d < 8) o.damage(70 * (1 - d / 8), v.byPlayer);
    }
    this.scareNearby(x, z, 50, true);
    // Only blowing up someone else's car is a crime (and news); your own wreck isn't.
    const yours = v.playerUsed || v === this.player.vehicle;
    if (v.byPlayer && !yours) this.crime('explosion', x, z);
    if (v.isHeliWreck) this.newsIncident(`Police helicopter shot down over ${streetAt(x, z)}`, x, z);
  }

  updateVehicleDamage(dt) {
    for (const v of this.vehicles) {
      if (v.removed || v.exploded) continue;
      if (v.health < 40 && Math.random() < dt * 8) this.effects.smoke(v.x, 1.4, v.z, v.health < 15);
      // Driving on a rim throws sparks.
      if (v.flatCount && Math.abs(v.speed) > 6) {
        v.wheels.forEach((wh, i) => {
          if (wh.userData.flat && Math.random() < dt * 12) {
            const [wx, , wz] = v.wheelPos(i);
            this.effects.sprite(wx, 0.1, wz, { color: 0xffc070, size: 0.12, life: 0.2, additive: true, vx: (Math.random() - 0.5) * 4, vy: 1.5, vz: (Math.random() - 0.5) * 4 });
          }
        });
      }
      if (v.wrecked) {
        // NPC occupants bail out of a burning car.
        const d = v.driver;
        if (d && d !== 'player') {
          if (d.officers) {
            for (const o of d.officers) o.dismount(1);
          } else {
            d.active = false;
            v.driver = null;
            const [fx, fz] = v.forward();
            this.peds.addAt(v.x + fz * 2.2, v.z - fx * 2.2).scare(v.x, v.z);
          }
        }
        if (Math.random() < dt * 25) this.effects.fire(v.x, (v.y || 0) + 1.3, v.z);
        v.burnT -= dt;
        if (v.burnT <= 0) this.explode(v);
      }
    }
  }

  dropAmmo(x, z, weapon, amount) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.4), lam(weapon === 'smg' ? 0x4b5320 : 0x5d4037));
    mesh.position.set(x, this.city.groundY(x, z) + 0.4, z);
    this.scene.add(mesh);
    this.pickups.push({ x, z, weapon, amount, mesh, t: 60 });
  }

  // Cash on a body: a spinning wad of bills next to it. Walk (or drive) over it to grab it.
  dropCash(x, z, amount) {
    const g = new THREE.Group();
    const wad = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.24), lam(0x2e8b3a));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.25), lam(0xf2e9b8));
    g.add(wad, band);
    g.position.set(x, this.city.groundY(x, z) + 0.3, z);
    this.scene.add(g);
    this.pickups.push({ x, z, cash: amount, mesh: g, t: 90 });
  }

  // Bodies drop what they were carrying. Civilians often have a little; gang members
  // usually have a lot more. (Your crew and cops: nothing.)
  checkBodies() {
    const [px, pz] = this.player.pos();
    for (const c of this.characters()) {
      if (c.alive || c.cashChecked) continue;
      c.cashChecked = true;
      if (c.isCop || c.isCrew || dist(c.x, c.z, px, pz) > 160) continue;
      const r = Math.random();
      let amount = 0;
      if (c.isGang || c.isSoldier) {
        if (Math.random() < 0.9) amount = Math.round(40 + 260 * Math.pow(r, 1.5));
      } else if (Math.random() < 0.65) amount = Math.round(5 + 55 * r * r);
      if (amount > 0) this.dropCash(c.x + rand(-0.6, 0.6), c.z + rand(-0.6, 0.6), amount);
    }
  }

  // Bodies sink away after a little while (wherever you are).
  clearBodies(dt) {
    for (const c of this.characters()) {
      if (c.alive || c.bodyGone) continue;
      c.deadT = (c.deadT || 0) + dt;
      if (c.deadT < 25) continue;
      c.char.group.position.y -= (c.deadT - 25) * 0.35; // sink into the ground over 3 s
      if (c.deadT > 28) {
        c.bodyGone = true;
        if (c.isCop) c.char.group.visible = false; // stays on the unit's roster, just gone from view
        else c.dispose();
      }
    }
  }

  updatePickups(dt, a = {}) {
    this.checkBodies();
    this.clearBodies(dt);
    const [qx, qz] = this.player.pos();
    const onFoot = !this.player.vehicle;
    for (const p of this.pickups) {
      p.t -= dt;
      // Something you just dropped: not until you've stepped away from it.
      if (p.armed === false) {
        if (dist(p.x, p.z, qx, qz) > 2.2) p.armed = true;
        else {
          p.mesh.rotation.y += dt * 2;
          continue;
        }
      }
      if (p.drug || p.gun) {
        p.mesh.rotation.y += dt * 2;
        p.mesh.position.y = this.city.groundY(p.x, p.z) + 0.45 + Math.sin(this.time * 3) * 0.08;
        if (onFoot && dist(p.x, p.z, qx, qz) < 1.4) {
          if (p.drug) {
            this.drugs.inv[p.drug] += p.amount;
            this.drugs.save();
            this.hud.toast(`+${p.amount} ${p.drug}`);
            p.t = 0;
          } else {
            const ar = this.arsenal;
            const name = WEAPONS.find((w) => w.id === p.gun).name;
            if (ar.has(p.gun) || ar.slots.includes(null)) {
              ar.give(p.gun);
              this.hud.toast(`Picked up a ${name}`);
              p.t = 0;
            } else {
              const out = ar.slots[ar.active];
              const outName = WEAPONS.find((w) => w.id === out).name;
              this.prompt = `Press ${this.input.label('interact')} to swap your ${outName} for the ${name}`;
              if (a.interactHeld && !this.interactWasHeld) {
                ar.give(p.gun);
                p.t = 0;
                this.inventory.dropGun(p.x, p.z, out);
                this.hud.toast(`Swapped your ${outName} for the ${name}`);
              }
            }
          }
        }
        if (p.t <= 0) this.scene.remove(p.mesh);
        continue;
      }
      p.mesh.rotation.y += dt * 2;
      p.mesh.position.y = this.city.groundY(p.x, p.z) + (p.cash ? 0.3 : 0.55) + Math.sin(this.time * 3) * 0.1;
      if (p.cash) {
        const v = this.player.vehicle;
        const [px, pz] = this.player.pos();
        // On foot only: you have to get out and pick it up.
        const grab = !v && dist(p.x, p.z, px, pz) < 1.4;
        if (grab) {
          this.cash += p.cash;
          this.hud.toast(`+$${p.cash}`);
          this.sfx.cash?.();
          this.save();
          p.t = 0;
        }
      } else if (!this.player.vehicle && dist(p.x, p.z, this.player.x, this.player.z) < 1.4) {
        this.arsenal.ammo[p.weapon].reserve += p.amount;
        const name = WEAPONS.find((w) => w.id === p.weapon).name;
        this.hud.toast(`+${p.amount} ${name} ammo`);
        p.t = 0;
      }
      if (p.t <= 0) this.scene.remove(p.mesh);
    }
    this.pickups = this.pickups.filter((p) => p.t > 0);
  }

  // Screen offset of a character's chest from the crosshair, as a fraction of screen height.
  crosshairOffset(c) {
    tmpV.set(c.x, this.city.groundY(c.x, c.z) + 1.3, c.z).project(this.camera);
    if (tmpV.z > 1) return Infinity;
    const sx = (tmpV.x * innerWidth) / 2;
    const sy = (tmpV.y * innerHeight) / 2;
    return Math.hypot(sx, sy) / innerHeight;
  }

  // Aim assist on the phone. Tapping AIM snaps to the nearest threat in front of you (a
  // gang member or cop first, anyone else only if they're close to the crosshair); the camera
  // stays on them. A short swipe left or right jumps to the next target that way, a swipe up
  // goes for the head (down for the body), and a long drag breaks the lock to aim freely.
  updateTouchAimAssist(dt, a) {
    const p = this.player;
    const valid = (c) =>
      c.alive && c.standing && !c.isCrew && dist(c.x, c.z, p.x, p.z) < 45 && !segmentBlocked(p.x, p.z, c.x, c.z, this.city.los);
    const threat = (c) => c.isGang || c.isCop || c.shopkeeper;
    const started = !this.touchAimWas;
    this.touchAimWas = true;
    this.lockIgnoreT = (this.lockIgnoreT || 0) - dt;
    let t = this.lockTarget;
    if (t && (!valid(t) || this.crosshairOffset(t) > 1.2)) t = this.lockTarget = null; // (gone, or right off the screen)
    if (!t) {
      // (just aimed: a wide look round; after that, a target drifting near the crosshair)
      let best = null;
      let bestS = Infinity;
      for (const c of this.characters()) {
        if (!valid(c) || (c === this.lockIgnore && this.lockIgnoreT > 0)) continue;
        const off = this.crosshairOffset(c);
        const reach = started ? (threat(c) ? 0.45 : 0.15) : threat(c) ? 0.12 : 0.06;
        if (off > reach) continue;
        const score = off + (threat(c) ? 0 : 0.3) + dist(c.x, c.z, p.x, p.z) * 0.002;
        if (score < bestS) {
          bestS = score;
          best = c;
        }
      }
      t = this.lockTarget = best;
      this.lockHead = false;
      this.swipeX = this.swipeY = 0;
    }
    if (!t) return;
    // Swipes (a finger drag arrives as look movement).
    const dragging = a.lookX !== 0 || a.lookY !== 0;
    if (!dragging) {
      this.swipeX = this.swipeY = 0;
      this.swipeDone = false;
    } else {
      this.swipeX = (this.swipeX || 0) + a.lookX;
      this.swipeY = (this.swipeY || 0) + a.lookY;
    }
    if (!this.swipeDone && Math.abs(this.swipeX) > 0.12) {
      const next = this.nextTarget(t, this.swipeX < 0 ? 1 : -1, valid);
      if (next) {
        this.lockTarget = t = next;
        this.lockHead = false;
        this.swipeDone = true; // (one jump per swipe)
      } else if (Math.abs(this.swipeX) > 0.35) {
        // nobody that way: dragging on frees the aim
        this.lockIgnore = t;
        this.lockIgnoreT = 0.8;
        this.lockTarget = null;
        return;
      }
    }
    if (this.swipeY < -0.08) this.lockHead = true;
    else if (this.swipeY > 0.08) this.lockHead = false;
    a.lookX = 0;
    a.lookY = 0;
    // Keep the crosshair on them.
    tmpV.set(...this.lockAimPoint(t)).project(this.camera);
    if (tmpV.z < 1) {
      const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
      const ex = Math.atan(tmpV.x * tanV * this.camera.aspect);
      const ey = Math.atan(tmpV.y * tanV);
      const k = Math.min(1, dt * 12);
      this.camYaw -= ex * k;
      this.camPitch = clamp(this.camPitch - ey * k, -0.3, 1.0);
    }
  }

  updateAimAssist(dt, a) {
    const p = this.player;
    const valid = (c) =>
      c.alive && c.standing && !c.isCrew && dist(c.x, c.z, p.x, p.z) < 40 && !segmentBlocked(p.x, p.z, c.x, c.z, this.city.los);
    this.lockIgnoreT = (this.lockIgnoreT || 0) - dt;

    // Pushing the stick away far enough breaks the lock.
    let t = this.lockTarget;
    if (t && (!valid(t) || this.crosshairOffset(t) > 0.25)) {
      this.lockIgnore = t;
      this.lockIgnoreT = 0.5;
      t = this.lockTarget = null;
    }
    if (!t) {
      let best = null;
      let bestOff = Infinity;
      for (const c of this.characters()) {
        if (!valid(c)) continue;
        if (c === this.lockIgnore && this.lockIgnoreT > 0) continue;
        const off = this.crosshairOffset(c);
        const grab = c.isGang || c.isCop || c.shopkeeper ? 0.07 : 0.04; // bystanders are harder to lock
        if (off < grab && off < bestOff) {
          bestOff = off;
          best = c;
        }
      }
      t = this.lockTarget = best;
      this.lockHead = false;
    }
    if (t) {
      // Flick the right stick to one side: snap to the next opp or civilian that way on screen.
      // Keep holding it there (with nobody that way) to break the lock and aim freely.
      const fullX = Math.abs(a.lookX) > dt * 2.3;
      if (!fullX) this.flickUsed = false;
      if (fullX && !this.flickHeld && !this.flickUsed) {
        const next = this.nextTarget(t, a.lookX < 0 ? 1 : -1, valid);
        if (next) {
          this.lockTarget = next;
          this.lockHead = false;
          this.flickUsed = true; // let go of the stick before the next flick
          this.breakT = 0;
          this.flickHeld = fullX;
          a.lookX = a.lookY = 0;
          return;
        }
      }
      this.flickHeld = fullX;
      this.breakT = fullX && !this.flickUsed ? (this.breakT || 0) + dt : 0;
      if (this.breakT > 0.15) {
        this.lockIgnore = t;
        this.lockIgnoreT = 0.6;
        this.lockTarget = null;
        this.breakT = 0;
        return;
      }
      // Flick up for the head, down for the torso.
      if (a.lookY < -dt * 0.6) this.lockHead = true;
      else if (a.lookY > dt * 0.6) this.lockHead = false;
      a.lookX *= 0.35;
      a.lookY = 0;
      // Turn the camera so the crosshair lands on the aim point (using last frame's view).
      tmpV.set(...this.lockAimPoint(t)).project(this.camera);
      if (tmpV.z < 1) {
        const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
        const ex = Math.atan(tmpV.x * tanV * this.camera.aspect);
        const ey = Math.atan(tmpV.y * tanV);
        const k = Math.min(1, dt * 14);
        this.camYaw -= ex * k;
        this.camPitch = clamp(this.camPitch - ey * k, -0.3, 1.0);
      }
    }
  }

  // The closest target to the right (dir 1) or left (dir -1) of the current one on screen.
  nextTarget(cur, dir, valid) {
    const asp = this.camera.aspect;
    tmpV.set(cur.x, this.city.groundY(cur.x, cur.z) + 1.3, cur.z).project(this.camera);
    const x0 = tmpV.x * asp;
    const y0 = tmpV.y;
    let best = null;
    let bestS = Infinity;
    for (const c of this.characters()) {
      if (c === cur || !valid(c)) continue;
      tmpV.set(c.x, this.city.groundY(c.x, c.z) + 1.3, c.z).project(this.camera);
      if (tmpV.z > 1 || Math.abs(tmpV.x) > 0.95 || Math.abs(tmpV.y) > 0.95) continue; // must be in view
      const dx = (tmpV.x * asp - x0) * dir;
      if (dx < 0.02) continue;
      const s = dx + Math.abs(tmpV.y - y0) * 1.5 - (c.isGang || c.isSoldier || c.isCop ? 0.1 : 0); // opps first when close
      if (s < bestS) {
        bestS = s;
        best = c;
      }
    }
    return best;
  }

  // ---- Player actions ----

  nearestVehicle(maxD) {
    let best = null;
    let bd = maxD;
    for (const v of this.vehicles) {
      if (v.exploded) continue;
      const d = dist(v.x, v.z, this.player.x, this.player.z);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  enterVehicle(v) {
    const d = v.driver;
    if (v.gangCar) this.turfWars.carStolen(v);
    if (d && d !== 'player') {
      if (d.riders) {
        d.dismount(); // a gang crew on its way to a fight: they jump out (and they're angry)
      } else if (d.officers) {
        for (const o of d.officers) o.dismount(-1);
        this.crime('stealCopCar', v.x, v.z);
      } else {
        d.active = false;
        const [fx, fz] = v.forward();
        const ped = this.peds.addAt(v.x + fz * 2.8, v.z - fx * 2.8); // thrown out the driver door
        ped.scare(this.player.x, this.player.z);
        this.crime('carjack', v.x, v.z);
      }
    } else if ((v.typeName === 'police' || v.typeName === 'swat') && !v.exploded) {
      this.crime('stealCopCar', v.x, v.z);
    }
    // Breaking into a parked car: sometimes the alarm goes off.
    if (v.parkSpot && !d && Math.random() < 0.35) {
      this.hud.toast('Car alarm!', '#ff8080');
      this.crime('carTheft', v.x, v.z);
    }
    v.siren = false;
    this.lockTarget = null;
    this.player.enter(v);
  }

  // The pause menu on a controller: the D-pad moves the highlight to the nearest button that
  // way (rows and columns as laid out on screen, whatever the layout), ✕ presses it. Returns
  // true if it used the input.
  pauseNav(a) {
    const pad = this.input.mode === 'pad';
    const up = a.menuUp;
    const down = a.menuDown;
    const left = pad && a.phoneLeft;
    const right = pad && a.phoneRight;
    const ok = a.menuOk && (pad || !!this.pauseFocus); // (keyboard: Enter once the arrows have picked one)
    if (!(up || down || left || right || ok)) return false;
    const btns = [...document.querySelectorAll('#pause button')].filter((b) => b.offsetParent && !b.classList.contains('hidden'));
    if (!btns.length) return false;
    let cur = btns.indexOf(this.pauseFocus);
    if (cur < 0) {
      // (nothing picked yet: RESUME)
      this.setPauseFocus(btns.find((b) => b.id === 'resume') || btns[0]);
      if (!ok) return true;
      cur = btns.indexOf(this.pauseFocus);
    }
    const f = btns[cur];
    if (ok) {
      f.click();
      return true;
    }
    const r0 = f.getBoundingClientRect();
    const cx = r0.left + r0.width / 2;
    const cy = r0.top + r0.height / 2;
    const [dx, dy] = up ? [0, -1] : down ? [0, 1] : left ? [-1, 0] : [1, 0];
    // (the nearest row (or column) that way, then the one in it most in line)
    const cand = [];
    for (const b of btns) {
      if (b === f) continue;
      const r = b.getBoundingClientRect();
      const x = r.left + r.width / 2 - cx;
      const y = r.top + r.height / 2 - cy;
      const along = x * dx + y * dy;
      // (in line: overlapping it across the way we're going, a button in the same row or column)
      const inLine = dx ? r.top < r0.bottom - 4 && r.bottom > r0.top + 4 : r.left < r0.right - 4 && r.right > r0.left + 4;
      if (along > 4) cand.push({ b, along, inLine, across: Math.abs(x * dy - y * dx) });
    }
    let best = null;
    const line = cand.filter((c) => c.inLine);
    if (line.length) best = line.sort((p, q) => p.along - q.along)[0].b;
    else if (cand.length) {
      const near = Math.min(...cand.map((c) => c.along));
      best = cand.filter((c) => c.along <= near + 12).sort((p, q) => p.across - q.across)[0].b;
    }
    if (best) this.setPauseFocus(best);
    return true;
  }

  setPauseFocus(b) {
    this.pauseFocus?.classList.remove('pad-focus');
    this.pauseFocus = b;
    if (!b) return;
    b.classList.add('pad-focus');
    b.scrollIntoView({ block: 'nearest' });
  }

  // Your pistol grip or fight style, the next one along (saved).
  cycleStyle(which, step = 1) {
    const list = Object.keys(which === 'grip' ? PISTOL_STYLES : which === 'meter' ? METER_STYLES : FIGHT_STYLES);
    this.style[which] = list[(list.indexOf(this.style[which]) + step + list.length) % list.length];
    try {
      localStorage.setItem('crimecity.style.v1', JSON.stringify(this.style));
    } catch {}
    this.showStyle();
  }

  showStyle() {
    const g = document.getElementById('grip-btn');
    const f = document.getElementById('fight-btn');
    const pad = this.input.mode === 'pad';
    if (g) g.textContent = `Pistol grip: ${PISTOL_STYLES[this.style.grip]} ▸ ${pad || this.input.touchMode ? '' : '(G)'}`;
    if (f) f.textContent = `Fight style: ${FIGHT_STYLES[this.style.fight].name} ▸ ${pad || this.input.touchMode ? '' : '(B)'}`;
  }

  punch() {
    const p = this.player;
    if (p.punchT > 0.08) return; // (the next one can start as this one comes back)
    const kind = p.throwPunch();
    p.punchT = PUNCH_T[kind];
    const reach = kind === 'kick' ? 2.0 : 1.7;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    for (const t of this.characters()) {
      if (!t.standing || t.isCrew) continue;
      const dx = t.x - p.x;
      const dz = t.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > reach || (dx * fx + dz * fz) / (d || 1) < 0.4) continue;
      markFlinch(t.char, this.time, 'hit', kind);
      if (kind === 'jab') {
        // (a jab staggers them back a step; the cross, hook, uppercut and kick put them down,
        // the kick furthest)
        const k = 0.35 / (d || 1);
        t.x += dx * k;
        t.z += dz * k;
      } else t.knockDown(p.x, p.z, { hook: 0.9, uppercut: 0.75, kick: 1.3 }[kind] || 0.6);
      if (t.isCop) this.crime('assaultCop', t.x, t.z);
      else if (t.isGang) this.gang.anger();
      else {
        const fighting = t.state === 'brawl';
        this.crime('assault', t.x, t.z);
        this.scareNearby(t.x, t.z, 14);
        // (some of them won't take it: they square up and fight you; already fighting, they keep at it)
        t.tough ??= !t.shopkeeper && !t.kid && Math.random() < 0.35;
        if (fighting && t.state !== 'down') t.state = 'brawl';
        else if (t.tough && t.standing && t.state !== 'down' && t.startBrawl && (t.rounds || 0) < 2) t.startBrawl();
      }
      return;
    }
  }

  // gun: shots or explosions, which make people dive, duck and hide instead of just running.
  scareNearby(x, z, r, gun = false) {
    if (gun) this.lastLoudT = this.time;
    for (const ped of this.peds.peds) if (dist(ped.x, ped.z, x, z) < r) ped.scare(x, z, gun);
  }

  // A news story with helicopter footage of what just happened.
  // --- News stories ---
  // A shootout or rampage is one story: the first thing that happens makes the news, the rest
  // is just counted, and when it's over (escaped, arrested, killed, or things go quiet) one
  // wrap-up story gives the toll.
  storyEvent(kind, x, z, headline, clip = true) {
    let st = this.story;
    if (!st) {
      st = this.story = { cops: 0, gang: 0, civ: 0, street: streetAt(x, z), x, z, lastT: this.time };
      if (clip) this.newsIncident(headline, x, z);
      else this.hud.news(headline);
    }
    st.lastT = this.time;
    if (kind) st[kind]++;
  }

  storyToll(st) {
    const n = (k, one, many) => (st[k] ? `${st[k]} ${st[k] === 1 ? one : many}` : null);
    const parts = [n('cops', 'officer', 'officers'), n('gang', 'gang member', 'gang members'), n('civ', 'bystander', 'bystanders')].filter(Boolean);
    if (!parts.length) return '';
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
    return `${list} dead`;
  }

  // Close the current story with a headline (plus the toll). Returns true if it posted one.
  endStory(headline, x, z, kind = 'crime', always = false) {
    const st = this.story;
    this.story = null;
    const toll = st ? this.storyToll(st) : '';
    if (!st && !always) return false;
    if (!headline) {
      if (!toll || st.cops + st.gang + st.civ < 2) return false; // one body was already the story
      this.hud.news(`Violence on ${st.street} leaves ${toll}`);
      return true;
    }
    this.newsIncident(toll ? `${headline} after a rampage that left ${toll}` : headline, x, z, kind);
    return true;
  }

  newsIncident(headline, x, z, kind = 'crime') {
    const clip = this.aircam.incident(headline, x, z);
    const item = this.hud.news(headline, kind);
    if (clip && item) this.hud.attachClip(item, clip, () => this.clipPlayer.play(clip));
  }

  // Tire smoke and skid marks from burnouts and drifts.
  tireFx(v, dt) {
    const burn = v.burnout;
    const slide = v.drift > 2.5 || (v.grip < 0.6 && Math.abs(v.speed) > 8);
    if (!burn && !slide) return;
    this.tireFxT = (this.tireFxT || 0) - dt;
    const rear = v.wheels.map((w, i) => i).filter((i) => !v.wheels[i].userData.front);
    for (const i of rear) {
      const [wx, , wz] = v.wheelPos(i);
      if (slide || Math.random() < 0.3) this.effects.skid(wx, wz, v.heading);
    }
    if (this.tireFxT > 0) return;
    this.tireFxT = burn ? 0.05 : 0.08;
    for (const i of rear) {
      const [wx, , wz] = v.wheelPos(i);
      this.effects.tireSmoke(wx, wz, burn ? 1 : Math.min(1, v.drift / 8));
    }
  }

  // Cars hitting people.
  checkRunOver() {
    for (const v of this.vehicles) {
      if (Math.abs(v.speed) < 4) continue;
      for (const t of this.characters()) {
        if (!t.standing || !!t.high !== !!v.high) continue; // (one up on the highway)
        if (Math.abs(t.x - v.x) > 4 || Math.abs(t.z - v.z) > 4) continue;
        let hit = false;
        for (const [cx, cz] of v.circles()) if (dist(cx, cz, t.x, t.z) < v.radius + 0.35) hit = true;
        if (!hit) continue;
        // Only your driving kills outright; computer-driven cars knock people over.
        const fast = Math.abs(v.speed) > 9 && v.driver === 'player'; // ~20 mph and up is deadly
        const killed = fast ? t.takeHit(999, v.x, v.z) : false;
        if (!killed) t.knockDown(v.x, v.z, 2);
        v.speed *= 0.85;
        if (v.driver === 'player') {
          if (t.isCop) this.crime(killed ? 'copKilled' : 'runOverCop', t.x, t.z);
          else if (t.isGang || t.isCrew || t.isSoldier) this.onPlayerHit(t, killed);
          else this.crime(killed ? 'murder' : 'hitAndRun', t.x, t.z);
          this.scareNearby(t.x, t.z, 16);
        }
      }
    }
  }

  // Quit the pickup game you're in (from the pause menu): shooting around just stops; a game
  // with no score (or no snap) yet is called off (your money back); otherwise you forfeit it.
  quitPickup() {
    const g = this.pickupGame();
    if (!g) return;
    if (g === this.sport && this.sport.solo && !this.sport.t33) g.end('done');
    else g.end(this.pickupFresh() ? 'off' : 'forfeit');
    this.setPaused(false);
  }

  // Whatever game you're in right now (a pickup game, the 3-point contest, a dice circle):
  // what quitting it means and how. Any new game adds itself here, so it quits the same way.
  activeGame() {
    const g = this.pickupGame();
    if (g) {
      const sb = this.sport;
      const label = g === this.gridiron && g.mode === 'qbc' ? 'quit the QB Challenge' : g === this.gridiron && g.mode === 'catch' ? 'stop playing catch' : g === sb && sb.t3 ? 'quit the contest' : g === sb && sb.solo && !sb.t33 ? 'stop shooting around' : this.pickupFresh() ? 'call it off (money back)' : `forfeit${g.bet ? ` (-$${g.bet})` : ''}`;
      return { label, quit: () => this.quitPickup() };
    }
    if (this.dice.playing) return { label: 'get up from the dice game', quit: () => this.dice.leave() };
    return null;
  }

  // In any game the map button (touchpad / M) is quit: hold it a second (a bar fills) and
  // you're out, no pausing. A small hint in the corner says so. (A phone has its QUIT button.)
  quitHoldStep(dt, a) {
    const G = this.activeGame();
    const hint = this.quitHint || (this.quitHint = Object.assign(document.createElement('div'), { id: 'quit-hint' }));
    if (!hint.isConnected) document.body.appendChild(hint);
    if (!G || this.input.touchMode) {
      hint.classList.add('hidden');
      this.quitHold = 0;
      this.quitProg = null;
      return;
    }
    const key = this.input.mode !== 'pad' ? 'M' : 'touchpad';
    const text = `Hold ${key} to quit`;
    if (hint.textContent !== text) hint.textContent = text;
    hint.classList.remove('hidden');
    if (a.mapHeld) {
      this.quitHold = (this.quitHold || 0) + dt;
      this.quitProg = { value: Math.min(1, this.quitHold), label: `Keep holding to ${G.label}` };
      if (this.quitHold >= 1) {
        this.quitHold = 0;
        this.quitProg = null;
        G.quit();
      }
    } else {
      this.quitHold = 0;
      this.quitProg = null;
    }
  }

  // Nothing's happened yet in the pickup game (no score in a one-on-one, no snap in football):
  // quitting calls it off and you get your money back.
  pickupFresh() {
    const g = this.pickupGame();
    if (g === this.sport && this.sport.t33) return !this.sport.t33.shots; // (33: nobody's shot yet)
    if (g === this.sport) return !this.sport.solo && this.sport.score.you + this.sport.score.opp === 0;
    return !!g && !(g.snaps > 0);
  }

  // The pickup game you're in, if any (basketball at the courts, football at Harbor Field).
  pickupGame() {
    return this.sport.active ? this.sport : this.gridiron.active ? this.gridiron : null;
  }

  // Bad news that can wait (your stash got hit): while you're in a pickup game (or its
  // cinematics) it's held, and you get it once you're out.
  afterGame(fn) {
    if (this.pickupGame() || this.contestCine?.open || this.qbcCine?.open || this.driveCine?.open) (this.heldNews ||= []).push(fn);
    else fn();
  }
  flushHeldNews() {
    if (!this.heldNews?.length || this.pickupGame() || this.contestCine?.open || this.qbcCine?.open || this.driveCine?.open) return;
    const q = this.heldNews;
    this.heldNews = [];
    for (const fn of q) fn();
  }

  handleInteractions(dt, a) {
    const p = this.player;
    const input = this.input;
    this.prompt = '';
    this.progress = this.quitProg || null; // (holding to quit a pickup game)
    const city = this.city;
    // A drug deal or a pickup in progress has the interact button right now (its prompt wins),
    // but getting in and out of cars and your weapons still work.
    const drugsBusy = !!(this.drugs.prompt || this.drugs.progress);
    if (drugsBusy) {
      this.prompt = this.drugs.prompt;
      this.progress = this.drugs.progress;
    }

    if (p.busy) return; // tumbling / getting up
    if (p.vehicle) {
      const v = p.vehicle;
      // Getting out: stopped -> step out; 30 mph or less -> brake hard to a stop first;
      // faster -> bail out and tumble.
      if (a.enter && !p.exitStop) {
        const mph = Math.abs(v.speed) * 2.237;
        if (mph < 2) {
          p.exit();
          return;
        }
        if (mph <= 30) p.exitStop = true;
        else {
          p.bail();
          return;
        }
      }
      if (p.exitStop) {
        this.prompt = 'Stopping…';
        return;
      }
      if (v.wrecked) {
        this.prompt = `Your car is on fire! Press ${input.label('enter')} to get out`;
        return;
      }
      if (drugsBusy) return;
      if (this.shops.interact(a, dt)) return;
      const chop = city.chop;
      if (dist(v.x, v.z, chop.x, chop.z) < chop.r) {
        if (this.stars > 0) this.prompt = 'Lose the cops before the chop shop will take this car';
        else {
          const price = Math.round((v.type.value * (v.health / 100) * 0.6 + v.type.value * 0.4) / 10) * 10;
          this.prompt = `Press ${input.label('interact')} to sell this ${v.type.label.toLowerCase()} for $${price}`;
          if (a.interactHeld && !this.interactWasHeld && Math.abs(v.speed) < 4) {
            p.exit();
            v.dispose();
            this.cash += price;
            const cred = v.typeName === 'police' || v.typeName === 'swat' ? 25 : 6;
            this.cred += cred;
            this.hud.toast(`+$${price}  +${cred} cred`);
            this.save();
          }
        }
      }
      return;
    }

    if (a.enter) {
      const v = this.nearestVehicle(3.8);
      if (v) {
        this.enterVehicle(v);
        return;
      }
    }

    // A pickup game at the courts: no weapons while you're playing.
    if (this.pickupGame()) return;
    this.sport.offer(a);
    this.gridiron.offer(a);
    this.dice.offer(a); // (a dice game on the corner)
    if (this.dice.playing) return; // (no weapons while you're rolling)

    // Weapons.
    if (a.slot === 0 || a.slot === 1) this.arsenal.selectSlot(a.slot);
    if (a.nextWeapon || a.prevWeapon) this.arsenal.swap();
    if (a.reload) this.arsenal.startReload();
    const w = this.arsenal.current();
    p.showWeapon(w.id);
    if (a.melee || (w.melee && a.firePressed)) this.punch();
    else this.tryFire(a);

    if (drugsBusy) return; // the drug prompt has the interact button

    // Store robberies.
    const store = city.stores.find((s) => dist(s.x, s.z, p.x, p.z) < s.r);
    if (store) {
      if (store.cooldown > 0) this.prompt = `${store.name} was robbed recently. Come back later.`;
      else if (a.interactHeld) {
        if (this.robbing !== store) {
          this.robbing = store;
          store.robT = 0;
          this.crime('robberyAlarm', store.x, store.z, `at ${store.name}`);
        }
        store.robT += dt;
        this.progress = { value: store.robT / 4, label: `Emptying the register at ${store.name}` };
        if (store.robT >= 4) {
          const take = randInt(4, 12) * 100;
          this.cash += take;
          this.crime('robbery', store.x, store.z);
          this.hud.news(`${store.name} robbed. Suspect took $${take}.`);
          this.hud.toast(`+$${take}  +${CRIMES.robbery.cred} cred`);
          store.cooldown = 150;
          store.signMesh.material.color.setHex(0x555555);
          this.robbing = null;
          this.save();
        }
      } else {
        this.robbing = null;
        this.prompt = `Hold ${input.label('interact')} to rob ${store.name}`;
      }
    } else if (this.shops.interact(a, dt)) {
      this.robbing = null;
    } else if (this.crewInteraction(a)) {
      this.robbing = null;
    } else if (this.travel.interact(a)) {
      this.robbing = null; // hail a taxi, take the bus
    } else if (this.turfWars.interact(a, dt)) {
      this.robbing = null;
    } else {
      this.robbing = null;
      const v = this.nearestVehicle(3.8);
      if (v) {
        const occupied = v.driver && v.driver !== 'player';
        this.prompt = occupied
          ? `Press ${input.label('enter')} to carjack this ${v.type.label.toLowerCase()}`
          : `Press ${input.label('enter')} to get in`;
      }
    }
  }

  // Recruit homies at the hangout, or send your crew home there. Returns true if it showed a prompt.
  crewInteraction(a) {
    const p = this.player;
    const press = a.interactHeld && !this.interactWasHeld;
    const key = this.input.label('interact');
    const crew = this.crew;
    const near = crew.members.find((m) => !m.recruited && m.standing && dist(m.x, m.z, p.x, p.z) < 2.6);
    if (near) {
      const n = crew.following.length;
      if (n >= MAX_CREW) this.prompt = `Your crew is full (${n}/${MAX_CREW})`;
      else {
        this.prompt = `Press ${key} to recruit ${near.name} · ${near.heartLabel} (crew ${n}/${MAX_CREW})`;
        if (press) crew.recruit(near);
      }
      return true;
    }
    const atHome = dist(p.x, p.z, crew.home.x, crew.home.z) < 14;
    const mine = atHome && crew.following.find((m) => m.standing && dist(m.x, m.z, p.x, p.z) < 2.6);
    if (mine) {
      this.prompt = `Press ${key} to send ${mine.name} home`;
      if (press) crew.dismiss(mine);
      return true;
    }
    return false;
  }

  // ---- Camera ----

  // A short camera shake (amount in meters, fading out over dur seconds).
  shakeCamera(amt, dur) {
    this.camShakeAmt = amt;
    this.camShakeDur = this.camShakeT = dur;
  }

  updateCamera(dt, a) {
    this.camLook = null;
    this.camYaw += a.lookX;
    this.camPitch = clamp(this.camPitch + a.lookY, this.player.vehicle ? -0.5 : -1.3, 1.0);
    if (a.looking) this.camIdle = 0;
    else this.camIdle += dt;

    const v = this.player.vehicle;
    const down = this.wastedT > 0;
    let tx, tz, ty, distBack, height, shoulder = 0, fov = 65, fovNow = false;
    if (v) {
      // Swing behind the car when the camera stick/mouse is idle.
      if (this.camIdle > (this.input.touchMode ? 0.6 : 1) && Math.abs(v.speed) > 2) { // (sooner on a phone)
        const behind = v.speed >= 0 ? v.heading : v.heading + Math.PI;
        this.camYaw = lerpAngle(this.camYaw, behind, Math.min(1, dt * 2.5));
      }
      tx = v.x;
      tz = v.z;
      ty = 1.6 + (v.y || 0); // (on the hills or up on the freeway too)
      distBack = 9.5 + Math.abs(v.speed) * 0.08;
      height = 2.2;
    } else {
      tx = this.player.x;
      tz = this.player.z;
      ty = (this.player.lowProfile ? 1.15 : 1.7) + this.player.gy();
      distBack = down ? 7 : 5.5;
      height = 1.2;
      // A pickup game's check-up (streetball.js): framed on the two of them, pulled back.
      const F = this.camFocus;
      if (F) {
        tx = F.x;
        tz = F.z;
        distBack += F.back;
        height += F.up;
      }
      // Playing catch at Harbor Field (fieldmodes.js): in close over your throwing shoulder.
      const S = this.gridiron?.active && this.gridiron.camShot?.();
      this.camLook = S?.look || null; // (a point to look toward as well as you: the ball coming in)
      if (S) {
        distBack = S.back;
        height = S.up;
        shoulder = S.shoulder;
        fov = S.fov;
        if (S.snapFov) fovNow = fov; // (a move on its own curve: no extra easing)
      }
      // In cover: a wider view so you can see around you.
      if (this.player.cover) {
        fov = 82;
        distBack = 4.8;
      }
      if (this.aimingNow) {
        distBack = 3.6;
        height = 0.45;
        shoulder = 0.45;
        fov = 56;
      }
      // Camera over the shoulder of the gun hand (left when peeking left out of cover).
      if (this.player.gunHand === 'L') shoulder = -Math.max(shoulder, 0.35);
      else if (this.player.cover && !this.aimingNow) shoulder = 0.35;
    }
    // Looking up: instead of sinking into the ground, the camera tucks in close behind your
    // head so you can still aim steeply upward (e.g. at the helicopter).
    if (this.camPitch < 0) {
      const room = ty + height - 0.5 - (v ? v.y || 0 : this.player.gy());
      distBack = Math.min(distBack, room / Math.max(0.01, -Math.sin(this.camPitch)));
      distBack = Math.max(distBack, 1.2);
    }
    const cp = Math.cos(this.camPitch);
    const rx = -Math.cos(this.camYaw), rz = Math.sin(this.camYaw);
    let cx = tx - Math.sin(this.camYaw) * distBack * cp + rx * shoulder;
    let cz = tz - Math.cos(this.camYaw) * distBack * cp + rz * shoulder;
    let cy = ty + height + Math.sin(this.camPitch) * distBack;
    // Don't let the camera go inside buildings (e.g. when you're in cover against a wall):
    // pull it in to just in front of the wall.
    const ox = tx + rx * shoulder * 0.5, oy = ty + 0.6, oz = tz + rz * shoulder * 0.5;
    const ddx = cx - ox, ddy = cy - oy, ddz = cz - oz;
    const len = Math.hypot(ddx, ddy, ddz) || 1;
    let free = len;
    for (const b of this.city.los) {
      if (Math.abs((b.minX + b.maxX) / 2 - ox) > 60 || Math.abs((b.minZ + b.maxZ) / 2 - oz) > 60) continue;
      const t = rayHitBox(ox, oy, oz, ddx / len, ddy / len, ddz / len, b, 0.25);
      if (t !== null && t < free) free = t;
    }
    const want = Math.max(0.8, free - 0.1);
    this.camFree = want < (this.camFree ?? len) ? want : lerp(this.camFree ?? len, want, Math.min(1, dt * 4));
    if (this.camFree < len) {
      const k = this.camFree / len;
      cx = ox + ddx * k;
      cy = oy + ddy * k;
      cz = oz + ddz * k;
    }
    // Under the freeway: keep the camera below the deck (it would be inside the slab, or
    // looking at the underside). It eases down a little before you drive under, using the
    // decks along the camera line and just ahead of you, and back up once you're clear.
    {
      const baseY = v ? v.y || 0 : this.player.gy();
      let ceil = Infinity;
      const pts = [[cx, cz], [(cx + tx) / 2, (cz + tz) / 2], [tx, tz]];
      if (v && Math.abs(v.speed) > 2) {
        const [fx, fz] = v.forward();
        const ahead = Math.sign(v.speed) * Math.min(25, Math.abs(v.speed) * 1.2);
        pts.push([tx + fx * ahead * 0.5, tz + fz * ahead * 0.5], [tx + fx * ahead, tz + fz * ahead]);
      }
      let hard = Infinity; // (right where the camera is: no easing, it must not go through)
      for (const [k, [px, pz]] of pts.entries()) {
        const c = this.highway.ceilingAbove(px, pz, baseY);
        if (c === null) continue;
        ceil = Math.min(ceil, c - 0.5);
        if (k === 0) hard = c - 0.3;
      }
      // camTop: the highest the camera may sit; eases down toward the deck, back up after.
      let top = this.camTop ?? Infinity;
      if (ceil < Infinity) {
        const want = Math.max(baseY + 1.2, ceil);
        if (top === Infinity) top = Math.max(cy, want);
        top = lerp(top, want, Math.min(1, dt * 5));
      } else if (top < Infinity) {
        top = lerp(top, cy + 0.5, Math.min(1, dt * 1.5));
        if (top >= cy) top = Infinity;
      }
      this.camTop = top;
      top = Math.max(baseY + 1.2, Math.min(top, hard));
      if (cy > top) cy = top;
    }
    // (a car crash, or a dunk: shakeCamera)
    let shake = v ? v.crash * 0.01 : 0;
    if (this.camShakeT > 0) {
      this.camShakeT -= dt;
      shake += this.camShakeAmt * Math.max(0, this.camShakeT / this.camShakeDur);
      cy += rand(-shake, shake) * 0.6;
    }
    // (never under the ground, or under the freeway deck you're up on)
    const floor = Math.max(this.city.groundY(cx, cz), this.highway.floorBelow(cx, cz, ty) ?? -1e9);
    this.camera.position.set(cx + rand(-shake, shake), Math.max(floor + 0.6, cy), cz + rand(-shake, shake));
    if (this.camLook && !v) {
      // (between you and that point, so both stay in the picture)
      const L = this.camLook;
      const hx = tx + rx * shoulder, hy = ty + 0.6, hz = tz + rz * shoulder;
      this.camera.lookAt(hx + (L.x - hx) * L.k, hy + (L.y - hy) * L.k, hz + (L.z - hz) * L.k);
    } else this.camera.lookAt(tx + rx * shoulder, ty + 0.6, tz + rz * shoulder);
    // (the QB Challenge's hit cam riding a deep ball in)
    const O = (this.gridiron?.active || this.gridiron?.endFollow) && this.gridiron.camOverride?.(dt);
    if (O) {
      this.camera.position.copy(O.pos);
      this.camera.lookAt(O.look);
    }
    if (Math.abs(this.camera.fov - fov) > 0.1) {
      this.camera.fov = fovNow ? fov : lerp(this.camera.fov, fov, Math.min(1, dt * 10));
      this.camera.updateProjectionMatrix();
    }

    // Keep the sun's shadow box around the player.
    this.sun.position.set(tx + 60, 120, tz + 40);
    this.sun.target.position.set(tx, ty, tz);
    if (this.cine) this.cineCamera(dt);
    if (this.travel.active) this.travel.camera(); // riding a taxi or bus: the cut scene's shots
  }

  // Police holding you at gunpoint: they won't fire for a while unless you shoot. Stand
  // still (no aiming) and you're arrested; run or shoot and it's on.
  holdFire(secs) {
    this.holdFireFrom = this.time;
    this.holdFireUntil = this.time + secs;
    this.surrenderT = 0;
    this.holdPos = this.player.pos();
  }

  updateSurrender(dt, a) {
    const p = this.player;
    if (this.time >= (this.holdFireUntil || 0) || this.stars === 0 || this.lastShot >= this.holdFireFrom || this.cine) return;
    const [px, pz] = p.pos();
    const close = this.police.officers().some((o) => o.standing && dist(o.x, o.z, px, pz) < 16)
      || this.peds.peds.some((q) => q.state === 'sting' && dist(q.x, q.z, px, pz) < 16);
    if (!close) return;
    // Running off or pulling a gun on them counts as resisting: then they open fire.
    const [hx, hz] = this.holdPos || [px, pz];
    if (dist(px, pz, hx, hz) > 7 || (this.aimingNow && !p.vehicle)) {
      this.holdFireUntil = 0;
      this.hud.toast('Resisting arrest!', '#ff8080');
      return;
    }
    const still = !p.vehicle ? Math.hypot(a.moveX, a.moveY) < 0.2 && !a.aim : Math.abs(p.vehicle.speed) < 1;
    this.surrenderT = still ? (this.surrenderT || 0) + dt : 0;
    if (!this.prompt) this.prompt = 'Police! Stay still to give up · run or shoot to resist';
    if (this.surrenderT > 3) {
      this.holdFireUntil = 0;
      this.bust();
    }
  }

  // ---- Dirty cops ----
  // A lone patrol stop can be a dirty cop. Every stop shows one or two details about the officer;
  // dirty ones give themselves away in small ways. Go quietly, offer a bribe, or fight:
  // - fight, on foot: you swing on him. About 2 in 3 you drop him and run (a straight cop calls
  //   it in: assaulting an officer, and they shoot now; a dirty one won't report it - he'd have
  //   to explain himself). Lose and a straight cop arrests you for resisting too (a bigger
  //   fine); a dirty one gives you a beating and takes everything.
  // - fight, in a car: you floor it (fleeing the stop: the chase is on).
  // - straight cop: going quietly is a normal arrest; a bribe gets you a bribery charge on top.
  // - dirty cop: going quietly, he takes everything you've got (cash and product) and lets you
  //   walk, wanted level cleared; a bribe costs your product and half your cash instead.
  canStop() {
    if (this.stars === 0 || this.stars > 2) return false;
    if (this.police.units.some((u) => u.raid)) return false; // a raid or a sting: by the book
    if (this.peds.peds.some((q) => q.state === 'sting')) return false;
    return true;
  }

  dirtyChance() {
    const [x, z] = this.player.pos();
    const m = this.clockMinutes();
    const night = m >= 22 * 60 || m < 4 * 60;
    const d = districtAt(x, z);
    return (0.2 + (night && (d === 'The Projects' || d === 'The Docks') ? 0.2 : night ? 0.08 : 0)) * (this.budget ? this.budget.dirtyMult() : 1); // better-paid police: fewer dirty cops
  }

  startStop() {
    const dirty = CFG.TEST_DIRTY_COP ? CFG.TEST_DIRTY_COP === 'dirty' : Math.random() < this.dirtyChance();
    const n = Math.random() < 0.5 ? 1 : 2;
    const tells = [];
    const pool = [...(dirty ? DIRTY_TELLS : CLEAN_TELLS)];
    while (tells.length < n && pool.length) tells.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    // Not every detail means something: straight cops sometimes work alone, and a dirty one
    // can look by the book.
    if (!dirty && Math.random() < 0.2) tells[tells.length - 1] = 'came alone';
    if (dirty && Math.random() < 0.25) tells[tells.length - 1] = CLEAN_TELLS[Math.floor(Math.random() * CLEAN_TELLS.length)];
    let name = null;
    if (dirty && tells.includes('name')) name = DIRTY_NAMES[Math.floor(Math.random() * DIRTY_NAMES.length)];
    else if (!dirty && Math.random() < 0.5) name = CLEAN_NAMES[Math.floor(Math.random() * CLEAN_NAMES.length)];
    const shown = tells.filter((t) => t !== 'name');
    this.stop = { dirty, tells: shown, name, t: 0 };
    // He walks up to your window (or to you) first: see stopscene.js.
    const scene = new StopScene(this, { tells: shown, dirty });
    if (scene.officer) this.stop.scene = scene;
    this.holdFire(45);
    this.bustPressure = 0;
    if (this.player.vehicle) this.player.vehicle.speed *= 0.3;
    this.hud.toast(`Pulled over${name ? ` by Officer ${name}` : ''}`, '#9fc3ff');
  }

  updateStop(dt, a) {
    const s = this.stop;
    if (!s) return;
    const pad = this.input.mode === 'pad';
    const who = s.name ? `Officer ${s.name}` : 'The officer';
    if (s.scene) {
      const r = s.scene.update(dt);
      if (r === 'fled') {
        // Took off while he was walking up.
        this.stop = null;
        this.holdFireUntil = 0;
        s.scene.end();
        const [px, pz] = this.player.pos();
        if (!s.dirty) this.fled(px, pz);
        this.hud.toast(this.player.vehicle ? 'You pulled off on him!' : 'You ran!', '#ff8080');
        return;
      }
      if (!s.scene.ready) {
        this.prompt = `${who} is walking up${this.player.vehicle ? ' to your window' : ''}… stay put · ${pad ? '□' : 'R'} ${this.player.vehicle ? 'floor it' : 'jump him'}`;
        if (a.dealFight) this.fightStop(s, who); // (you don't have to wait for him)
        return;
      }
    }
    s.t += dt;
    const details = s.tells.length ? ` (${s.tells.join(' · ')})` : '';
    const inCar = !!this.player.vehicle;
    this.prompt = `${who}${details}: "Hands where I can see em." — ${pad ? '✕' : 'E'} go quietly · ${pad ? '○' : 'Q'} offer a bribe · ${pad ? '□' : 'R'} ${inCar ? 'floor it' : 'fight'}`;
    if (s.t < 0.6) return; // a beat before you can answer
    if (a.dealFight && !a.dealYes && !a.dealNo) return this.fightStop(s, who);
    const quiet = a.dealYes || s.t > 15;
    const bribe = a.dealNo && !quiet;
    if (!quiet && !bribe) return;
    this.stop = null;
    s.scene?.end();
    this.holdFireUntil = 0;
    if (!s.dirty) {
      if (bribe) this.hud.toast(`"You just made it worse."`, '#ff8080');
      this.bust({ final: true, bribery: bribe });
      return;
    }
    // Dirty: he takes his cut and you walk.
    const cash = this.cash;
    const took = bribe ? Math.floor(cash * 0.5) : cash;
    const held = this.drugs.holding();
    this.cash -= took;
    this.drugs.inv = { weed: 0, pills: 0, coke: 0 };
    this.drugs.luck('busted');
    this.drugs.lostRun();
    this.clearWanted();
    this.police.standDown();
    const what = [took > 0 ? `-$${took.toLocaleString('en-US')}` : '', held ? 'your product' : ''].filter(Boolean).join(' and ');
    this.hud.toast(bribe ? `${who} took the bribe${what ? `: ${what}` : ''}. "Get outta here."` : `${who} took everything${what ? `: ${what}` : ''}. "We never met."`, '#ffd36b');
    this.save();
    this.drugs.save();
  }

  // Running from a stop: at least two stars, and the chase is on.
  fled(x, z) {
    this.crime('fleeStop', x, z);
    if (this.heat < CFG.STAR_HEAT[1]) this.heat = CFG.STAR_HEAT[1];
    this.stars = Math.max(this.stars, 2);
  }

  // Fighting your way out of a stop (see above).
  fightStop(s, who) {
    this.stop = null;
    s.scene?.end();
    this.holdFireUntil = 0;
    const p = this.player;
    const [px, pz] = p.pos();
    // In a car: you floor it.
    if (p.vehicle) {
      const v = p.vehicle;
      v.speed = Math.max(v.speed, 6);
      if (!s.dirty) this.fled(px, pz);
      this.hud.toast(s.dirty ? `You floor it. ${who} doesn't call it in.` : 'You floor it!', '#ff8080');
      this.save();
      return;
    }
    // On foot: the officer closest to you (out of his car, or getting out).
    let cop = null;
    for (const o of this.police.officers()) {
      if (!o.standing || o.state === 'inCar') continue;
      if (!cop || dist(o.x, o.z, px, pz) < dist(cop.x, cop.z, px, pz)) cop = o;
    }
    if (!cop || dist(cop.x, cop.z, px, pz) > 9) {
      // Nobody in reach: you run for it.
      if (!s.dirty) this.fled(px, pz);
      this.hud.toast('You make a run for it!', '#ff8080');
      return;
    }
    p.heading = Math.atan2(cop.x - p.x, cop.z - p.z);
    this.sfx.punch?.();
    // Odds: about 2 in 3, a little better with more street cred.
    const win = Math.random() < Math.min(0.8, 0.62 + this.cred / 4000);
    if (win) {
      cop.knockDown(px, pz, 1.5);
      if (s.dirty) {
        this.hud.toast(`You drop ${who.replace('The officer', 'the officer')}. He won't be reporting this. Go!`, '#ffd36b');
        this.cred += 6;
        this.police.standDown();
      } else {
        this.crime('assaultCop', cop.x, cop.z);
        this.hud.toast(`You drop ${who.replace('The officer', 'the officer')}. Run!`, '#ff8080');
      }
      this.save();
      return;
    }
    // He gets the better of you.
    if (s.dirty) {
      const took = this.cash;
      this.cash = 0;
      this.drugs.inv = { weed: 0, pills: 0, coke: 0 };
      this.drugs.lostRun();
      this.health = Math.max(15, this.health - 35);
      this.clearWanted();
      this.police.standDown();
      this.hud.toast(`${who} beats you down and takes everything${took ? ` (-$${took.toLocaleString('en-US')})` : ''}. "Should've paid."`, '#ff8080');
      this.save();
      this.drugs.save();
      return;
    }
    this.health = Math.max(15, this.health - 15);
    this.hud.toast(`${who} takes you down. "Stop resisting!"`, '#ff8080');
    this.bust({ final: true, resisting: true });
  }

  // City News now and then: Internal Affairs looking at a dirty officer (remember the names).
  updateIA(dt) {
    this.iaT = (this.iaT ?? 240 + Math.random() * 180) - dt;
    if (this.iaT > 0) return;
    this.iaT = 360 + Math.random() * 240;
    const n = DIRTY_NAMES[Math.floor(Math.random() * DIRTY_NAMES.length)];
    const lines = [`Internal Affairs reviewing complaints against Officer ${n}`, `Officer ${n} cleared again despite missing evidence reports`, `Lawsuit says Officer ${n} took cash during a traffic stop`];
    this.hud.news(lines[Math.floor(Math.random() * lines.length)], 'info');
  }

  // ---- Cinematics ----
  // A short scripted shot: letterbox bars, a title, and the camera sweeping around a spot
  // while the action plays out. The game keeps running; you just can't move until it ends.
  startCinematic(x, z, title, dur = 4) {
    const [px, pz] = this.player.pos();
    // End up across the street from the spot, looking at it with the road running left to
    // right, so you can see cars come in from both ends. Never more than half a lap.
    // The nearest road: end up out over it (on the far side from the spot).
    let end = Math.atan2(px - x, pz - z);
    const hit = this.city.edgeAt(x, z);
    if (hit) {
      let dx = hit.x - x;
      let dz = hit.z - z;
      if (Math.hypot(dx, dz) < 1) {
        // Right on the road: off to one side of it.
        const e = hit.e;
        dx = -(e.b.z - e.a.z);
        dz = e.b.x - e.a.x;
      }
      end = Math.atan2(dx, dz);
    }
    const a0 = Math.atan2(px - x, pz - z);
    this.cine = { x, z, t: 0, dur, a0, sweep: wrapAngle(end - a0) };
    const el = document.getElementById('cine');
    el.querySelector('.cine-title').textContent = title;
    el.classList.remove('hidden');
    document.getElementById('hud').classList.add('cine');
    requestAnimationFrame(() => el.classList.add('on'));
  }

  endCinematic() {
    this.cine = null;
    const el = document.getElementById('cine');
    el.classList.remove('on');
    document.getElementById('hud').classList.remove('cine');
    setTimeout(() => el.classList.add('hidden'), 400);
  }

  cineCamera(dt) {
    const c = this.cine;
    c.t += dt;
    if (c.t >= c.dur) {
      // Hand the camera back pointing at the scene.
      const [px, pz] = this.player.pos();
      this.camYaw = Math.atan2(c.x - px, c.z - pz) + Math.PI;
      this.endCinematic();
      return;
    }
    const k = c.t / c.dur;
    const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    const ang = c.a0 + ease * c.sweep;
    // Swing around and up into a high, wide shot over the street.
    const r = 14 - 4 * ease;
    const gy = this.city.groundY(c.x, c.z);
    const y = gy + 6 + 22 * ease;
    this.camera.position.set(c.x + Math.sin(ang) * r, y, c.z + Math.cos(ang) * r);
    this.camera.lookAt(c.x, gy + 0.5, c.z);
    const fov = 65 + 20 * ease;
    if (Math.abs(this.camera.fov - fov) > 0.1) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // ---- Main loop ----

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.input.touch.update(this);
    this.input.poll();
    const a = this.input.actions(dt);
    if (!this.started) {
      document.getElementById('pad-note').textContent = this.input.touch.enabled && !this.input.padConnected
        ? 'Touch controls on. Turn your phone sideways and tap PLAY.'
        : this.input.padConnected
        ? 'Controller connected. Press ✕ to play.'
        : this.input.padBlocked
          ? 'This page blocks controllers. Run the game locally (npm run dev) to use a PS5 controller.'
          : 'Plug in or pair a PS5 controller and press any button, then ✕ to play.';
      if (a.start) this.start();
    } else if (this.card?.open) {
      // The 3-point contest's results (contest.js): the game waits.
      this.card.update(a);
    } else if (this.courtMenu?.open) {
      // A court's menu of games (courtmenu.js): the game waits.
      this.courtMenu.update(a);
    } else if (this.shops.menu) {
      // Shop menu: the game is paused underneath.
      this.shops.updateMenu(a);
    } else if (this.animViewer.open) {
      // The animation viewer: the game's paused under it (it draws its own little set).
      this.animViewer.update(dt, a);
    } else if (this.paused && (this.input.hit?.('KeyV') || (this.input.mode === 'pad' && a.reload))) {
      this.animViewer.show(); // (V / □ in the pause menu)
    } else if (this.paused && this.input.hit?.('KeyG')) {
      this.cycleStyle('grip'); // (G in the pause menu)
    } else if (this.paused && this.input.hit?.('KeyB')) {
      this.cycleStyle('fight'); // (B in the pause menu)
    } else if (this.paused && this.pauseNav(a)) {
      // (the controller in the pause menu: the D-pad picks a button, ✕ presses it)
    } else if (this.matchup.open) {
      // The matchup cinematic before a one-on-one: the game waits.
      this.matchup.update(dt, a);
    } else if (this.contestCine.open) {
      // The 3-point contest's intro or finish: the game waits.
      this.contestCine.update(dt, a);
    } else if (this.qbcCine.open) {
      // The QB Challenge's intro or finish: the game waits.
      this.qbcCine.update(dt, a);
    } else if (this.driveCine.open) {
      // The drive's intro: the game keeps going under it (the huddle, breaking it) with your
      // hands off the controls, the cinematic's camera on top.
      this.driveCine.update(dt, a);
      if (this.driveCine.open) {
        const q = {};
        for (const [k, v] of Object.entries(a)) q[k] = typeof v === 'boolean' ? false : typeof v === 'number' ? 0 : v;
        q.qbR = [false, false, false, false, false];
        q.slot = -1;
        this.update(dt, q);
        this.driveCine.camera(this.driveCine.t);
        this.driveCine.afterUpdate(); // (you dancing or gutted: posed after the game's frame)
      }
    } else if (this.moves.open) {
      // The moves list: the game is paused underneath.
      if (a.moves || a.menuBack || a.pause || !this.pickupGame()) this.moves.hide();
      else if (this.moves.hasSetting() && (a.phoneLeft || a.phoneRight || this.input.hit?.("KeyH"))) {
        // (playing catch: ◀ ▶ / H picks the throw meter, right there in the list)
        this.cycleStyle("meter", a.phoneLeft ? -1 : 1);
        this.moves.show();
      }
    } else if (a.moves && !this.paused && this.pickupGame()) {
      this.moves.show();
    } else if (this.mapView.open) {
      // Full map: the game is paused underneath.
      if (a.map || a.closeClip || a.pause) this.mapView.hide();
      else this.mapView.update(dt, a);
    } else if (a.map && !this.paused && !this.activeGame()) {
      this.mapView.show();
    } else if (a.pause) {
      this.setPaused(!this.paused);
    } else if (this.paused && a.enter && this.pickupGame()) {
      this.quitPickup(); // (△ / F in the pause menu)
    } else if (!this.paused) {
      // (a beat of slow motion: breaking the 3-point record)
      this.slowT = Math.max(0, (this.slowT || 0) - dt);
      // (and while you wind up a throw playing catch: fieldmodes.js eases timeScale to half)
      this.update(dt * (this.slowT > 0 ? 0.3 : this.timeScale || 1), a);
      this.quitHoldStep(dt, a);
    }
    stepFalls(); // (anyone tipping over: character.js)
    if (this.animViewer.open) this.animViewer.render(this.renderer);
    else this.renderer.render(this.scene, this.camera);
    this.interactWasHeld = a.interactHeld;
    this.input.endFrame();
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt, a) {
    this.time += dt;
    this.flushHeldNews(); // (stash news held through a game)
    if (this.cine || this.stop || this.travel.active) {
      // Watching a cinematic (or stopped by a cop): hands off the controls (the car brakes).
      a.moveX = a.moveY = a.throttle = a.steer = 0;
      a.fire = a.firePressed = a.aim = a.aimPressed = a.melee = a.enter = a.sprint = a.crouch = false;
      a.interactHeld = a.gas = a.brakeHeld = false;
      a.handbrake = true;
      a.lookX = a.lookY = 0;
    }
    // A story with no police after it goes quiet after a while.
    if (this.story && this.stars === 0 && this.time - this.story.lastT > 45) this.endStory(null);
    const wp = this.mapView.waypoint;
    if (wp && dist(...this.player.pos(), ...wp) < 14) {
      this.mapView.waypoint = null;
      this.hud.toast('Waypoint reached');
    }
    // GPS route to the waypoint, refreshed as you move.
    this.gpsT = (this.gpsT || 0) - dt;
    const w = this.mapView.waypoint;
    if (!w) this.gps = null;
    else if (this.gpsT <= 0 || !this.gps || this.gpsFor !== w) {
      this.gpsT = 0.3;
      this.gpsFor = w;
      this.gps = gpsRoute(this.city, ...this.player.pos(), ...w);
    }
    this.gpsLine.update(dt, this.gps, w);
    // Inventory strip (hold L1 / Tab) gets the D-pad and face buttons while it's open.
    // No inventory strip or weapon swaps in a pickup game (it closes if it was open).
    if (this.pickupGame()) {
      this.inventory.holdT = 0;
      this.inventory.open = false;
      a.stripHeld = a.giveHeld = a.dropHeld = a.nextWeapon = a.prevWeapon = false;
      a.slot = -1;
    }
    if (this.wastedT <= 0 && this.bustedT <= 0 && !this.hud.phoneOpen) this.inventory.update(dt, a);
    // Phone: D-pad → (or T) takes it out. While it's out the D-pad, ✕ and ○ work the phone
    // (see phone.js); T / Create puts it away.
    if (this.hud.phoneOpen) {
      if (a.phoneToggle) this.phone.close();
      else this.phone.update(a);
      // Scroll the news: mouse wheel or right stick.
      if (a.wheelDelta) this.hud.scrollPhone(a.wheelDelta * 60);
      if (Math.abs(a.rsY) > 0.2) {
        this.hud.scrollPhone(a.rsY * dt * 600);
        a.lookX = a.lookY = 0;
        a.looking = false;
      }
      a.nextWeapon = a.prevWeapon = false;
      a.interactHeld = a.interactKey; // the D-pad is for the phone right now
      a.sprint = a.melee = a.reload = a.dealYes = a.dealNo = a.stripHeld = false;
    } else if (a.phone && !this.pickupGame()) this.phone.show(); // (not in a pickup game: ◀ ▶ are the game's there)
    if (this.pickupGame() && this.phone.isOpen) this.phone.close(); // (a game started with it open: put away)
    if (this.clipPlayer.open && a.closeClip) this.clipPlayer.close();
    // In a pickup game the sticks are for playing: no crouching (L3) or test car (R3).
    if (this.pickupGame()) {
      a.crouch = a.spawnCar = false;
      this.player.crouched = false;
    }
    if (a.spawnCar && CFG.CAR_SPAWN_KEY) this.spawnTestCar();
    this.effects.update(dt);
    this.aircam.update(dt);
    this.clipPlayer.update(dt);

    if (this.bustedT > 0 || this.wastedT > 0) {
      if (this.bustedT > 0) {
        this.bustedT -= dt;
        if (this.bustedT <= 0) this.afterBust();
      } else {
        this.wastedT -= dt;
        if (this.wastedT <= 0) this.afterWasted();
      }
      this.aimingNow = false;
      this.inventory.open = false;
      this.hud.inventoryStrip(this, this.inventory);
      this.showCrosshair = false;
      this.lockScreen = null;
      this.updateCamera(dt, a);
      this.hud.update(this, dt);
      return;
    }

    // Who traffic should stop for.
    this.walkers.length = 0;
    if (!this.player.vehicle) this.walkers.push(this.player);
    for (const p of this.peds.peds) if (p.standing) this.walkers.push(p);
    // Who's standing where (a 3 m grid), so people on foot can give each other room.
    const grid = (this.crowd = new Map());
    for (const c of this.characters()) {
      if (!c.standing || c.state === 'inCar' || c.removed) continue;
      const k = `${Math.floor(c.x / 3)},${Math.floor(c.z / 3)}`;
      let cell = grid.get(k);
      if (!cell) grid.set(k, (cell = []));
      cell.push(c);
    }

    const p = this.player;
    this.drugs.update(dt, a);
    this.market.update(dt);
    this.president.update(dt);
    this.arsenal.update(dt);
    const pickup = this.pickupGame();
    if (pickup && !p.vehicle) pickup.input(dt, a); // (a pickup game: FIRE shoots or throws, no guns)
    else if (this.postGame.active) this.postGame.input(a); // (after it: walk away or fight)
    else if (this.dice.playing && !p.vehicle) this.dice.input(dt, a); // (crouched in a dice game)
    const gun = !this.arsenal.current().melee && !pickup;
    this.aimingNow = !p.vehicle && !p.busy && gun && a.aim;
    // Crouch: toggle with C / L3; sprinting stands you up; aiming pops you up out of cover.
    // One button (C / L3): next to a wall, crate or car it puts you in cover (and you stay
    // there until you press it again or push away); out in the open it toggles crouch.
    if (a.crouch && !p.vehicle) {
      if (p.cover) {
        p.leaveCover();
        p.crouched = false;
      } else if (!p.tryCover(this.camYaw, a)) p.crouched = !p.crouched;
    }
    if (a.sprint && Math.hypot(a.moveX, a.moveY) > 0.3) p.crouched = false;
    p.lowProfile = !p.vehicle && (p.crouched || !!(p.cover && p.cover.low)) && !this.aimingNow;

    // Controller aim assist: aim freely with the right stick; the reticle sticks
    // to a target when the crosshair passes close to it.
    // On the phone: its own version, tuned for a finger (see updateTouchAimAssist).
    if (this.input.touchMode && this.aimingNow) this.updateTouchAimAssist(dt, a);
    else if (this.input.mode === 'pad' && this.aimingNow) this.updateAimAssist(dt, a);
    else this.lockTarget = null;
    if (!this.aimingNow) this.touchAimWas = false;

    if (p.vehicle) {
      const v = p.vehicle;
      if (p.exitStop) {
        // Braking hard to a stop so you can get out.
        // Stomp the brakes: about 2.5 g, so at low speed it's a quick, abrupt stop
        // (30 mph stops in about half a second, 10 mph almost instantly).
        v.update(dt, { throttle: 0, steer: a.steer * 0.3, handbrake: true }, this.city.colliders);
        const sp = Math.abs(v.speed);
        v.speed -= Math.sign(v.speed) * Math.min(sp, 25 * dt);
        v.lat = (v.lat || 0) * Math.max(0, 1 - dt * 8);
        if (Math.abs(v.speed) < 1.2) {
          v.speed = 0;
          v.lat = 0;
          p.exitStop = false;
          p.exit();
        }
      } else v.update(dt, { throttle: a.throttle, steer: a.steer, handbrake: a.handbrake, burnout: a.gas && a.brakeHeld, gas: a.gas, brake: a.brakeHeld }, this.city.colliders);
      if (p.vehicle) this.tireFx(v, dt);
    } else if (p.busy) {
      p.updateRolling(dt);
    } else {
      const combat = gun && (this.aimingNow || this.time - this.lastShot < 0.8 || a.fire);
      // (fists out and aiming: hands up, squared to where you're looking)
      p.fistsUp = !gun && !pickup && !!a.aim && !this.dice.playing;
      let faceYaw = combat || p.fistsUp ? this.camYaw : null;
      if (combat && this.lockTarget) faceYaw = Math.atan2(this.lockTarget.x - p.x, this.lockTarget.z - p.z);
      p.updateOnFoot(dt, a, this.camYaw, faceYaw);
      if (pickup) pickup.late(dt);
      else if (this.postGame.active) this.postGame.late(dt, a);
      else if (this.dice.playing) this.dice.late(dt);
    }

    this.traffic.update(dt);
    this.police.update(dt);
    this.pursuit.update(dt);
    this.justice.update();
    this.gang.update(dt);
    this.crew.update(dt);
    this.turfWars.update(dt);
    this.shops.update(dt);
    this.bank.update(dt);
    this.property.update(dt);
    for (const v of this.vehicles) {
      if (v.driver === null && !v.removed) {
        // A car you bailed out of keeps rolling until it slows down on its own.
        v.update(dt, { throttle: 0, steer: 0, handbrake: !v.runaway }, this.city.colliders);
        if (v.runaway && Math.abs(v.speed) < 0.5) {
          v.runaway = false;
          this.crew.carStopped(v);
        }
      }
    }
    resolveCarCollisions(this.vehicles.filter((v) => !v.removed));
    for (const v of this.vehicles) {
      this.highway.updateLayer(v); // up a ramp onto the highway, or back down
      v.groundY = this.highway.groundFor(v);
      v.groundAt ||= (x, z) => (v.high ? this.highway.heightAt(x, z, v.y) ?? v.groundY : this.city.groundY(x, z));
      v.sync(dt);
    }
    if (!this.player.vehicle) this.highway.updateLayer(this.player); // walking up or down a ramp
    this.peds.update(dt);
    for (const h of this.hoops) h.update(dt);
    this.dice.update(dt);
    if (this.sport.solo) this.sport.step(dt); // (shooting around on your own)
    this.football.update(dt);
    this.playground.update(dt);
    this.checkRunOver();
    this.handleInteractions(dt, a);
    this.updateSurrender(dt, a);
    this.bases.update(dt, a);
    this.streets.update(dt);
    this.dayNight.update();
    this.rhythm.update(dt);
    this.backup.update(dt);
    this.transit.update(dt);
    this.parking.update(dt);
    this.props.update(dt);
    this.updateStop(dt, a);
    this.enforce.update(dt, a);
    this.travel.update(dt);
    this.updateIA(dt);
    this.updateVehicleDamage(dt);
    this.updatePickups(dt, a);
    this.vehicles = this.vehicles.filter((v) => !v.removed);
    this.cleanupVehicles();

    for (const s of this.city.stores) {
      if (s.cooldown > 0) {
        s.cooldown -= dt;
        if (s.cooldown <= 0) s.signMesh.material.color.setHex(0xffffff);
      }
    }

    // Health slowly comes back when you stay out of trouble.
    if (this.time - this.lastHurt > 6) this.health = Math.min(100, this.health + dt * 6);

    this.updateWanted(dt);
    const [px, pz] = p.pos();
    this.district = districtAt(px, pz);
    this.turf = this.turfWars.turfAt(px, pz);
    this.updateCamera(dt, a);

    this.showCrosshair = !p.vehicle && gun && (this.aimingNow || this.input.mode === 'kb');
    this.lockScreen = null;
    if (this.lockTarget) {
      const t = this.lockTarget;
      tmpV.set(...this.lockAimPoint(t)).project(this.camera);
      if (tmpV.z < 1) this.lockScreen = [((tmpV.x + 1) / 2) * innerWidth, ((1 - tmpV.y) / 2) * innerHeight];
    }
    this.updateCarMarker(dt);
    this.hud.update(this, dt);

    this.saveT += dt;
    if (this.saveT > 5) {
      this.saveT = 0;
      this.save();
    }
  }

  // Testing: R3 / V gives you one test car. If yours is still around, it points you to it instead.
  spawnTestCar() {
    const p = this.player;
    const [x, z] = p.pos();
    const old = this.testCar;
    if (old && !old.removed && !old.exploded && !old.wrecked) {
      if (p.vehicle === old) {
        this.hud.toast("You're already in your test car");
        return;
      }
      const d = dist(old.x, old.z, x, z);
      if (d < 200) {
        this.carPingT = 6;
        this.hud.toast(`Your test car is ${Math.round(d)} m away`);
        return;
      }
      if (old.driver === null) old.dispose();
    }
    const h = p.vehicle ? p.vehicle.heading : p.heading;
    const side = p.vehicle ? 3.5 : 3;
    const car = new Vehicle(this.scene, 'sports', x - Math.cos(h) * side, z + Math.sin(h) * side, h);
    // (not into a fence, a wall or a building: if that spot's blocked, the first clear one
    // around you: either side, ahead or behind, a few meters further out, turned either way)
    const clear = () => car.circles().every(([cx, cz]) => !pushCircle(cx, cz, car.radius + 0.35, this.city.colliders).hit);
    if (!clear()) {
      const rx = -Math.cos(h);
      const rz = Math.sin(h);
      const fx = Math.sin(h);
      const fz = Math.cos(h);
      let found = false;
      for (const d of [3, 4.5, 6, 8, 10]) {
        for (const [ox, oz] of [[rx, rz], [-rx, -rz], [fx, fz], [-fx, -fz], [rx + fx, rz + fz], [-rx + fx, -rz + fz], [rx - fx, rz - fz], [-rx - fx, -rz - fz]]) {
          const l = Math.hypot(ox, oz);
          for (const hh of [h, h + Math.PI / 2, h - Math.PI / 2, h + Math.PI]) {
            car.x = x + (ox / l) * d;
            car.z = z + (oz / l) * d;
            car.heading = hh;
            if (clear()) {
              found = true;
              break;
            }
          }
          if (found) break;
        }
        if (found) break;
      }
      if (!found) {
        car.x = x;
        car.z = z;
        car.heading = h;
      }
    }
    this.vehicles.push(car);
    this.testCar = car;
    if (p.vehicle) p.exit();
    p.x = car.x;
    p.z = car.z;
    p.enter(car);
    this.hud.toast('Test car delivered');
  }

  // Screen marker pointing at your test car after you ask for it.
  updateCarMarker(dt) {
    this.carMarker = null;
    this.carPingT = Math.max(0, (this.carPingT || 0) - dt);
    const c = this.testCar;
    if (!this.carPingT || !c || c.removed || c.exploded || this.player.vehicle === c) return;
    tmpV.set(c.x, 2.6, c.z).project(this.camera);
    const behind = tmpV.z > 1;
    let sx = tmpV.x;
    let sy = tmpV.y;
    if (behind) {
      sx = -sx;
      sy = -1;
    }
    const edge = behind || Math.abs(sx) > 0.92 || Math.abs(sy) > 0.88;
    sx = clamp(sx, -0.92, 0.92);
    sy = clamp(sy, -0.88, 0.88);
    const [px, pz] = this.player.pos();
    this.carMarker = {
      x: ((sx + 1) / 2) * innerWidth,
      y: ((1 - sy) / 2) * innerHeight,
      edge,
      d: Math.round(dist(px, pz, c.x, c.z)),
    };
  }

  // Remove abandoned and burnt-out cars far from the player so the city doesn't fill up.
  cleanupVehicles() {
    const [px, pz] = this.player.pos();
    const abandoned = this.vehicles.filter((v) => v.driver === null && !v.gangCar && !v.parkSpot);
    const far = abandoned.find((v) => dist(v.x, v.z, px, pz) > 150 && (v.exploded || abandoned.length > 10));
    if (far) far.dispose();
  }
}

const game = new Game();
window.__game = game;
game.__raycast = raycast; // handy for debugging shots from the console
document.getElementById('play').addEventListener('click', () => game.start());
document.getElementById('resume').addEventListener('click', () => game.setPaused(false));
document.getElementById('quit-game').addEventListener('click', () => game.quitPickup());
document.getElementById('anim-btn').addEventListener('click', () => game.animViewer.show());
document.getElementById('grip-btn').addEventListener('click', () => game.cycleStyle('grip'));
document.getElementById('fight-btn').addEventListener('click', () => game.cycleStyle('fight'));
game.showStyle();
// Interchange editor (testing) in the pause menu.
if (game.rampEditor) {
  const b = document.getElementById('rampedit-btn');
  b.classList.remove('hidden');
  b.addEventListener('click', () => game.rampEditor.show());
}
// Graphics quality switch in the pause menu (reloads the page).
{
  const q = document.getElementById('quality');
  const show = () => { q.textContent = `Graphics: ${QUALITY === 'phone' ? 'Phone (faster)' : 'Full'} · tap to switch`; };
  show();
  q.addEventListener('click', () => setQuality(QUALITY === 'phone' ? 'full' : 'phone'));
}
document.getElementById('game').addEventListener('click', () => {
  game.sfx.unlock();
  if (game.started && !game.paused && !game.input.locked) game.input.lock();
});
addEventListener('keydown', () => game.sfx.unlock(), { once: false });
