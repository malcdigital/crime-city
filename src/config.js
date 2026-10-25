// Core tuning values for the city and gameplay.
const BLOCKS = 14;
const BLOCK = 64;
const ROAD = 16; // two lanes plus a parking shoulder each side

export const CFG = {
  // Testing switch: guns never run out of ammo. Set to false for normal play.
  INFINITE_AMMO: true,
  // Testing switch: start with every gun. Off: fists and a pistol; buy the rest at the gun shop.
  START_ALL_GUNS: false,
  // Testing switches: start in a car, and V / R3 spawns a car next to you.
  START_IN_CAR: true,
  CAR_SPAWN_KEY: true,
  // Testing switch: where you start (in the car): [x, z, heading in degrees], or null. Right now:
  // on Park Ave heading west toward the interchange on the west side of the ring.
  START_AT: [215, 486.4, 270],

  BLOCKS,
  BLOCK,
  ROAD,
  SIDEWALK: 4,
  PITCH: BLOCK + ROAD,
  SIZE: BLOCKS * (BLOCK + ROAD),
  LANE: 3.4, // distance from road center to lane center

  // Cops pull you over for running red lights and speeding (off: drive however you like).
  TRAFFIC_TICKETS: false,

  TRAFFIC_CARS: 55,
  PEDS: 100,

  WALK_SPEED: 4.2,
  SPRINT_SPEED: 7.5,
  OFFICER_SPEED: 6.2,

  // Heat needed for each wanted star (1 to 5).
  STAR_HEAT: [1, 3, 6, 10, 15],
  // Police units chasing at each star level (index = stars).
  UNITS_PER_STAR: [0, 1, 2, 3, 5, 6],
  SWAT_PER_STAR: [0, 0, 0, 0, 2, 3], // SWAT vans
  // Bank: open 9 AM to 6 PM (game clock), 2% to deposit, a monthly fee (an in-game month is
  // 30 game days = 24 real hours of play), and ATMs that pay out up to a limit per game day.
  BANK_OPEN: 9 * 60,
  BANK_CLOSE: 18 * 60,
  BANK_DEPOSIT_FEE: 0.02,
  BANK_MONTHLY_FEE: 250,
  ATM_DAILY_LIMIT: 2000,
  HELI_STARS: 4, // police helicopter from this many stars
  TURF_FAST: true,
  CLAIM_IGNORE_CRED: false,
  GANG_RUNS_ANY_RANK: true,
  // Testing switch: a hot drug market. Demand 1.5x everywhere (prices up), demand events every
  // ~45 s, and buyers come 3x as often. Off for the finished game.
  MARKET_HOT: true,
  // Testing switch: force what happens on drug runs ('raid', 'chase', 'both', 'clean'), or null
  // for the normal random roll.
  TEST_INCIDENT: 'raid',
  // Testing switch: the next street sale is to an undercover cop (once, then it switches itself off).
  TEST_STING: true,
  // Testing switch: force the next patrol stop to be a 'dirty' or 'clean' cop (null: random).
  TEST_DIRTY_COP: null,
};

// Crimes the player can commit. heat raises the wanted level, cred is street cred earned.
export const CRIMES = {
  assault: { heat: 1, cred: 3, label: 'Assault' },
  hitAndRun: { heat: 1.2, cred: 4, label: 'Hit-and-run' },
  carjack: { heat: 1.5, cred: 8, label: 'Carjacking' },
  assaultCop: { heat: 3, cred: 12, min: 2, label: 'Officer assaulted' },
  runOverCop: { heat: 4, cred: 15, min: 3, label: 'Officer run over' },
  stealCopCar: { heat: 3, cred: 20, min: 2, label: 'Police cruiser stolen' },
  robberyAlarm: { heat: 2, cred: 0, label: 'Store alarm' },
  robbery: { heat: 2, cred: 35, label: 'Armed robbery' },
  gunfire: { heat: 0.8, cred: 0, label: 'Shots fired' },
  murder: { heat: 2, cred: 10, label: 'Homicide' },
  copKilled: { heat: 4, cred: 30, min: 3, label: 'Officer killed' },
  gangKill: { heat: 0.5, cred: 25, label: 'Gang shooting' },
  explosion: { heat: 1.5, cred: 5, label: 'Explosion' },
  drugRaid: { heat: 3, cred: 5, min: 2, label: 'Drug raid' },
  drugRaidBig: { heat: 6, cred: 10, min: 3, label: 'Drug raid' },
  drugDeal: { heat: 4, cred: 0, min: 2, label: 'Drug sale to an undercover officer' },
  possession: { heat: 1, cred: 0, min: 1, label: 'Drug possession' },
  fleeStop: { heat: 1.2, cred: 4, min: 1, label: 'Fleeing a traffic stop' },
  carTheft: { heat: 0.5, cred: 2, label: 'Car theft' },
};

export const GANG_NAME = 'Southside Kings';
export const CREW_NAME = 'Green Street';

// Street cred ladder from the design doc.
export const CRED_TIERS = [
  { name: 'Nobody', min: 0 },
  { name: 'Hustler', min: 1000 },
  { name: 'Soldier', min: 5000 },
  { name: 'Enforcer', min: 15000 },
  { name: 'Shot Caller', min: 40000 },
  { name: 'Kingpin', min: 100000 },
];
