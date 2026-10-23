// Core tuning values for the city and gameplay.
const BLOCKS = 8;
const BLOCK = 64;
const ROAD = 14;

export const CFG = {
  // Testing switch: guns never run out of ammo. Set to false for normal play.
  INFINITE_AMMO: true,
  // Testing switch: start with every gun. Off: fists and a pistol; buy the rest at the gun shop.
  START_ALL_GUNS: false,
  // Testing switches: start in a car, and V / R3 spawns a car next to you.
  START_IN_CAR: true,
  CAR_SPAWN_KEY: true,

  BLOCKS,
  BLOCK,
  ROAD,
  SIDEWALK: 4,
  PITCH: BLOCK + ROAD,
  SIZE: BLOCKS * (BLOCK + ROAD),
  LANE: 3.4, // distance from road center to lane center

  TRAFFIC_CARS: 30,
  PEDS: 70,

  WALK_SPEED: 4.2,
  SPRINT_SPEED: 7.5,
  OFFICER_SPEED: 6.2,

  // Heat needed for each wanted star (1 to 5).
  STAR_HEAT: [1, 3, 6, 10, 15],
  // Police units chasing at each star level (index = stars).
  UNITS_PER_STAR: [0, 1, 2, 3, 5, 6],
  SWAT_PER_STAR: [0, 0, 0, 0, 2, 3], // SWAT vans
  HELI_STARS: 4, // police helicopter from this many stars
  TURF_FAST: true,
  CLAIM_IGNORE_CRED: false, // testing: claim unclaimed blocks without the street cred tier // testing: turf locks 2 min, NPC attack rolls every 15 min (10 quiet min after a war), underground 5 min
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
