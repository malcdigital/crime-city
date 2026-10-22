// Core tuning values for the city and gameplay.
const BLOCKS = 8;
const BLOCK = 64;
const ROAD = 14;

export const CFG = {
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
  UNITS_PER_STAR: [0, 1, 2, 3, 4, 6],
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

// Street cred ladder from the design doc.
export const CRED_TIERS = [
  { name: 'Nobody', min: 0 },
  { name: 'Hustler', min: 1000 },
  { name: 'Soldier', min: 5000 },
  { name: 'Enforcer', min: 15000 },
  { name: 'Shot Caller', min: 40000 },
  { name: 'Kingpin', min: 100000 },
];
