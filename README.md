# Crime City

A GTA-style online city where every player lives a role: president, police, bounty hunter, gang member, business owner or entertainer. See the game design document for the full vision.

This repo holds **prototype 0.1**: a single-player 3D browser build of the core gang member vs. police loop.

## Play it locally

```bash
npm install
npm run dev
```

Then open the address Vite prints (usually http://localhost:5173). Desktop browser with keyboard and mouse.

## What's in 0.1

- Procedural 8×8-block city: buildings, parks, stores, a police station and a chop shop
- Third-person on foot (walk, sprint, crouch, punch) and driving (4 car types, handbrake)
- Cover: press C / L3 next to a wall, crate or car to snap to it, crate or car and stay there; slide along it, lean out at corners or pop up over low cover to aim; push away or press again to leave
- Crouching bends at the knees; crouch behind low cover to block bullets and break line of sight
- Weapon wheel: hold L1 / Tab (real time, no slow-mo) with 8 slots — melee, pistol, SMG, rifle, shotgun, heavy, throwable, special; one weapon per slot; tap to swap back to your last weapon. Weapons: fists, pistol, SMG, assault rifle, pump shotgun
- Getting out of a moving car: 30 mph or less, you brake hard (about 1 g) to a stop and step out; faster, you dive head-first out the driver's door, take impact damage scaled to speed, tumble along the ground (about 0.95 g of friction; walls hurt) and get back up, while the car rolls on without you
- Driving (your car): a tire model after GTA V's handling.meta — per-car traction curves (peak grip at ~9° of slip easing to a lower sliding grip), front/rear grip bias, weight transfer, friction circles, traction control, speed-sensitive steering lock and stability damping. Drift: hold gas + brake while turning; the rear steps out and the stick sets the drift angle (~15° light, ~35° full lock); let go and it eases back to grip in about half a second. Burnouts with gas + brake from a stop (steer for donuts)
- Helicopter footage: when the police helicopter is up and near a big incident (shootings, police killings, explosions, arrests), the phone news story gets a 640×360 clip from its belly camera. Scroll stories with the mouse wheel or right stick; tap a story (D-pad → opens the phone; D-pad ↑/↓ to pick, ✕ to play)
- Gang turf: three gangs (Southside Kings, Green Street, East Side Vipers) hold blocks, tinted and outlined on the radar; contested blocks flash. The location line shows whose turf you're on
- Stealing a gang's car sets off its members within ~90 m (they open fire for a minute); your own gang's cars are free to take
- Gangs on the map: each gang has a home base (a crowd of members and several cars in its colors), small groups posted on its other blocks (groups of 3 have a car), and a crew of 4 with two cars hanging out nearby. Gangs recruit back up to strength at their home base over time
- Turf wars (src/turf.js): kill 3 of a gang's members on their block to start a war, then wipe out every wave of defenders to take it. Waves are the gang's real members — whoever is nearby first, then crews from posts and the home base, driving over in gang cars when it's far (no one spawns out of nowhere; a gang that runs out of members runs out of waves). Waves scale with the defending gang's strength; home blocks get extra, bigger waves and taking one takes all that gang's turf (the gang goes underground for 24 h). Unclaimed blocks: hold E / D-pad ↑ to claim, then hold 60 s. Blocks lock for 2 h after changing hands. NPC gangs roll to attack every 45 min (1 in 3), going after lost blocks first, otherwise by leader personality; every war is fought out live wherever it is. Leave the block for 20 s or die and your attack fails. Turf and timers are saved. `CFG.TURF_FAST` (on while testing) shortens the timers to minutes
- Police and gang wars: police stay out of gang wars (gang-on-gang shooting on gang turf isn't a police matter) and send a unit to investigate afterwards. If the President orders a crackdown on a gang (pause menu stand-in until the President role exists), police and SWAT roll in during that gang's wars and fight its soldiers, and your own turf-war shooting counts as crime if the crackdown is on Green Street. NPC attacking waves are about 40% smaller than defending waves
- Police search: they comb the area where they last saw you (behind cover, around corners), hear gunshots and running footsteps, and keep tracking you if they watched you duck. Escape by leaving the search circle unseen or staying hidden long enough
- 4+ stars: more cruisers, SWAT vans with four-man teams in body armor, and a police helicopter that takes off from the precinct roof, tracks you with a searchlight (buildings block its view) and can be shot down; at 5 stars its door gunner opens fire
- Roadblocks at 4+ stars: police cars drive ahead of you and park across the road (spike strips at 5 stars)
- Civilians react to gunfire: some dive flat, some duck in place, some run to cover and hide, the rest run
- NPC traffic that follows lanes and stops for cars and people
- NPC pedestrians who walk the sidewalks, cross streets, and flee from violence
- Crimes: assault, carjacking, hit-and-run, store robbery, assaulting officers, stealing police cars
- Wanted level (1–5 stars) with police cruisers dispatched from the station that chase on the road grid, officers who chase on foot, and arrests
- Roadblocks at 2+ stars: two cruisers park across the road ahead of where you're driving, officers guard them, and ramming them is a real crash
- Tires can be shot out: cops at roadblocks aim for your tires as you drive at them; flats sag, spark, slow the car and pull it to that side. You can shoot out other cars' tires too
- Every car has hinged doors that open when people get in and out
- Escaping: break line of sight and police search where you were last seen
- Getting busted: fine, lost street cred, respawn at the police station
- Chop shop: sell stolen cars for cash once the police lose you
- Street cred ladder from the design doc (Nobody → Kingpin)
- HUD: cash, wanted stars, a round radar that rotates with the player, and an in-game phone with City News
- PS5 / standard gamepad support, with button prompts that switch to the controller
- Guns: fists, pistol and SMG with ammo, reloading, aim mode and controller aim assist that locks to the torso (flick up for the head)
- Testing switches in `src/config.js`: `INFINITE_AMMO`, `START_IN_CAR`, `CAR_SPAWN_KEY`
- Rival gang (Southside Kings) on a Southgate corner who shoot back
- Gang AI with "heart": low-heart fighters run, mid-heart fighters take cover (building corners, crates, parked cars) and pop out to shoot, reckless ones charge in the open; nerve drops when friends go down, and police in the fight make everyone likelier to run
- Your crew: recruit up to 3 homies at the park hangout (G on the radar); they follow you, ride in your car and fight with the same personality system
- Police open fire at 3+ stars or once you shoot at them, taking cover behind their open car doors, the far side of the cruiser or the hood depending on where you are; a few flank
- Health, damage, "wasted" and hospital respawn
- Cars take damage, catch fire and explode; ammo drops from downed enemies

## Controls

| Action | Keyboard / mouse | PS5 controller |
| --- | --- | --- |
| Move / steer | WASD | Left stick |
| Look | Mouse / arrow keys | Right stick |
| Sprint | Shift | ✕ (hold) |
| Crouch / take cover | C | L3 |
| Weapon wheel (tap = last weapon) | hold Tab | hold L1 |
| Switch weapon | 1–8 / mouse wheel | D-pad ↓ ← |
| Burnout (stopped) | W + S | R2 + L2 |
| Aim | Right mouse | L2 (sticks to targets near the crosshair) |
| Shoot | Left mouse | R2 |
| Punch | J (or click with fists) | ○ |
| Reload | R | □ |
| Phone (City News) | T | D-pad → |
| Enter, exit or carjack | F | △ |
| Accelerate / brake | W / S | R2 / L2 |
| Handbrake | Space | R1 |
| Rob store (hold) / sell car / recruit homie | E | D-pad ↑ |
| Pause and controls | P | Options |
| Test car (one at a time; points to it if nearby) | V | R3 (click right stick) |


## Code layout

| File | What it does |
| --- | --- |
| `src/main.js` | Game loop, crimes, wanted level, interactions, camera |
| `src/city.js` | City generation, road graph, minimap |
| `src/vehicle.js` | Car models and arcade driving physics |
| `src/traffic.js` | NPC traffic drivers |
| `src/peds.js` | NPC pedestrians |
| `src/police.js` | Police units and officers |
| `src/player.js` | Player on foot and in cars |
| `src/hud.js` | HUD, news feed and minimap |
| `src/input.js` | Keyboard, mouse and gamepad input |
| `src/weapons.js` | Weapons, ammo and bullet hit tests |
| `src/gang.js` | Gang fighter AI (heart, cover, morale), rival gang and your crew |
| `src/nav.js` | On-foot navigation: steering around buildings, getting unstuck, following streets |
| `src/effects.js` | Muzzle flashes, tracers, smoke, fire, explosions |
| `src/audio.js` | Synthesized sound effects |
| `src/config.js` | Tuning values, crimes and the cred ladder |

## Next steps

1. Multiplayer server so several players share one city
2. Playable police and bounty hunter roles
3. Businesses, territory and turf wars
4. The report → warrant → manhunt → jury system
