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
- Two weapon slots, Fortnite-style: you carry at most two guns (fists when a slot is empty). Tap L1 / Tab (or 1 / 2, or the mouse wheel) to swap between them. Buying a third gun replaces the one in your hand. Ammo is kept per gun type. Hold L1 / Tab to show the inventory strip: both weapons (with mag / reserve), all your ammo, cash and armor, and your drugs. The strip's top row is your two weapons, an Ammo tab, cash and a Drugs tab; ✕ / ↑ on a tab opens it (its contents show in a row above) and ↓ / ○ closes it. While the strip is open, D-pad ← → (arrow keys) picks a tile, ✕ (E) gives it, □ (G) drops it: a press moves a set amount (one mag of ammo, $100, one unit of product), holding moves all of it, guns go whole. Dropped things land in front of you and can be picked back up (step away first); a dropped gun with both slots full asks to swap. Giving goes to a homie following you (they use the gun, or sell the product into the stash); cash and ammo will go to other players once there's multiplayer
- Getting out of a moving car: 30 mph or less, you brake hard (about 1 g) to a stop and step out; faster, you dive head-first out the driver's door, take impact damage scaled to speed, tumble along the ground (about 0.95 g of friction; walls hurt) and get back up, while the car rolls on without you
- Driving (your car): a tire model after GTA V's handling.meta — per-car traction curves (peak grip at ~9° of slip easing to a lower sliding grip), front/rear grip bias, weight transfer, friction circles, traction control, speed-sensitive steering lock and stability damping. Drift: hold gas + brake while turning; the rear steps out and the stick sets the drift angle (~15° light, ~35° full lock); let go and it eases back to grip in about half a second. Burnouts with gas + brake from a stop (steer for donuts)
- Helicopter footage: when the police helicopter is up and near a big incident (shootings, police killings, explosions, arrests), the phone news story gets a 640×360 clip from its belly camera. Scroll stories with the mouse wheel or right stick; tap a story (D-pad → opens the phone; D-pad ↑/↓ to pick, ✕ to play)
- Gang turf: three gangs (Southside Kings, Green Street, East Side Vipers) hold blocks, tinted and outlined on the radar; contested blocks flash. The location line shows whose turf you're on
- Gang members carry different guns: pistols (most common), SMGs, pump shotguns (close in, hit hard up close) and assault rifles (long range); they drop matching ammo
- Bodies sink away about 25 seconds after death
- Cash on bodies: dead civilians often drop a little ($5–60, about 6 in 10), gang members usually drop more ($40–300, about 9 in 10); get out and walk over the wad to grab it (running someone over at ~20 mph+ kills them; their cash drops on the road). Cops and your own crew drop nothing
- Stealing a gang's car sets off its members within ~90 m: they open fire, and up to two carloads run to their other cars and chase you (drive-by shooting from the windows; they pull up and pile out if you stop; they give up after ~90 s or once they lose you, and drive home). Chasers show on the radar in the gang's color. Your own gang's cars are free to take
- Gangs on the map: each gang has a home base (a crowd of members and several cars in its colors), small groups posted on its other blocks (groups of 3 have a car), and a crew of 4 with two cars hanging out nearby. Gangs recruit back up to strength at their home base over time
- Turf wars (src/turf.js): kill 3 of a gang's members on their block to start a war, then wipe out every wave of defenders to take it. Waves are the gang's real members — whoever is nearby first, then crews from posts and the home base, driving over in gang cars when it's far (no one spawns out of nowhere; a gang that runs out of members runs out of waves). Waves scale with the defending gang's strength; home blocks get extra, bigger waves and taking one takes all that gang's turf (the gang goes underground for 24 h). Unclaimed blocks have to be earned (src/claim.js): you need enough street cred (Hustler for your first new block, then a tier up every few blocks held), then hold E on the block to start a 12-minute claim: 1) spray Green Street tags on 3 marked walls (hold E 3 s each), 2) shake down the 2 shop owners out front (hold E to lean on them; some refuse — punch them and they pay but call the cops, or aim a gun at them and they pay quietly), 3) survive the nearest rival gang's response (2–3 waves of their real members). Go down, get busted, or stay off the block 20 s and it fails (that block cools off 3 min). Your tags stay on the walls while you hold the block. `CFG.CLAIM_IGNORE_CRED` skips the cred check for testing. Blocks lock for 2 h after changing hands. NPC gangs roll to attack every 45 min (1 in 3), only one NPC-started war at a time with 30 quiet minutes after each, going after lost blocks first, otherwise by leader personality; every war is fought out live wherever it is. Leave the block for 20 s or die and your attack fails. Turf and timers are saved. `CFG.TURF_FAST` (on while testing) shortens the timers to minutes
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
- HUD: cash, wanted stars, a round radar that rotates with the player, and an in-game phone with a home screen of apps — Messages (texts from your homies: turf payouts, product sales, stash warnings; and from the plugs: payment reminders that get more threatening as the deadline nears), Contacts (plugs: pickups and paying back), City News, and Missions (what you're in the middle of plus jobs to go do; ✕ sets a waypoint) — and City News (one story per incident: a shootout or rampage gets one headline when it starts and one wrap-up with the death toll when you escape, get busted or go down — not a story per kill; roadblock, spike, helicopter and SWAT news once per chase); a full-screen map (touchpad / M) that pauses the game, shows turf, landmarks, cops and the block under the cursor, and lets you drop a waypoint that shows on the radar with a yellow GPS route along the streets (fewest turns), also drawn on the road in 3D as a see-through strip floating just above it, with sliding chevrons and a light beam on the waypoint; the city stays centered when zoomed out. The map's legend lists everything on it (you, the waypoint, each gang's territory, unclaimed blocks, turf wars, hangouts, police, hospital, chop shop, gun shop, garage, safehouse, stash, plugs, stores, claim spots, police units, the helicopter); D-pad ↑↓ / arrow keys step through it (or click a row) and the cursor jumps to that place
- PS5 / standard gamepad support, with button prompts that switch to the controller
- Guns: fists, pistol and SMG with ammo, reloading, aim mode and controller aim assist that locks to the torso (flick up for the head; flick the right stick left or right to snap to the next opp or civilian that way on screen; hold it to one side to break the lock)
- Testing switches in `src/config.js`: `INFINITE_AMMO`, `START_IN_CAR`, `CAR_SPAWN_KEY`
- Rival gang (Southside Kings) on a Southgate corner who shoot back
- Gang AI with "heart": low-heart fighters run, mid-heart fighters take cover (building corners, crates, parked cars) and pop out to shoot, reckless ones charge in the open; nerve drops when friends go down, and police in the fight make everyone likelier to run
- Your crew: recruit up to 3 homies at the park hangout (G on the radar); they follow you, ride in your car and fight with the same personality system
- Police open fire at 3+ stars or once you shoot at them, taking cover behind their open car doors, the far side of the cruiser or the hood depending on where you are; a few flank
- Health, damage, "wasted" and hospital respawn
- Turf income (src/shops.js): every block Green Street holds pays every 10 minutes of play, scaled by your street cred tier ($100 a block as Nobody, $150 Hustler, $200 Soldier, $275 Enforcer, $375 Shot Caller, $500 Kingpin; home block pays double; 2 min with `CFG.TURF_FAST`) into a stash on the bench at the hangout ($ on the radar). Walk up and press E to grab it. Two payouts sitting there brings a warning; the third gets the stash hit by the biggest rival gang (they take half)
- Gun shop, Iron Mike's Guns (A on the radar): body armor ($500), ammo, SMG / Pump Shotgun / Assault Rifle, and crew gear (SMGs & shotguns, then rifles for every homie; vests so they take 40% less damage). Won't serve you with stars. You start with fists and a pistol (`CFG.START_ALL_GUNS` gives everything for testing); what you buy is saved
- Body armor: a blue bar next to health that soaks up 70% of each hit until it's worn through
- Mod garage, Lou's Mod Garage (M on the radar): stop the car in the ring and press E. Repair, engine / brakes / armor in three levels each, and respray (with stars: drops one; at 1 star the cops lose you). Mods stay on that car
- Drug dealing (src/drugs.js): three plugs (D on the radar) — Smokey (weed), Doc (pills), Marco (coke). Open the phone and press R / □ for Contacts to set up a pickup: a solo pickup (small load) or, at Kingpin, a gang run (big load; `CFG.GANG_RUNS_ANY_RANK` unlocks it for testing). Drive to the plug, get out and walk up to them (a ring marks them), press E / D-pad ↑ and wait a few seconds for the handoff, then get it back to the hangout with no cops on you. Risk grows with the product and the load: the cops can raid the spot while you load (2–3 stars), or the nearest rival gang sends real crews in their cars to chase you down on the way back (gang runs can get both). The plug fronts it: pay them back from Contacts within 30 minutes of play or they put a hit out on you (owed amount +50%, shooters in a black car from the plug's corner every 2.5 minutes until you pay). Gang runs split 40% to you, 60% to your homies, who sell it off into the turf stash over the next three payouts. Busted: the cops take everything you're holding
- Drug market (src/market.js): supply and demand per district (Downtown, Hillcrest, Southgate, Eastside, Harbor) and per drug. Each district has its own taste (Downtown pays for coke, Southgate smokes weed, Eastside likes pills). Price = base × demand ÷ supply (0.5×–2.2×). Selling a lot in one place taps buyers out; random events shift demand (party weekend, clinic shut down, dispensary opens). Supply is citywide per drug (the plugs) plus local (rival gangs dealing on their turf): raids cut a drug's supply and make plugs charge more; plugs can be killed (that drug dries up until a new plug takes over, inheriting your tab); each rival gang has a kingpin (♛) at its home base, and killing one dries up their corners; your big runs flood the area and push prices down. Everything drifts back to normal over several minutes. `CFG.MARKET_HOT` (on while testing) makes the market hot: demand 1.5× everywhere, demand events every ~45 s, buyers 3× as often A drive-up buyer stuck in traffic nearby gets out and walks over. Buyers come more often where demand for what you hold is high and want what's popular there. Phone → Market app shows every district's price for each drug with ▲▼ trends and why (✕ sets a waypoint); on the full map, H / □ cycles a price heat map (blue cheap → red high) with district prices
- President's approval rating (src/president.js, pause menu → President's orders): driven by a crime level that every crime raises (weighted: a cop killed counts far more than a carjacking; NPC turf wars count by their body count; drug killings count) and that fades over ~10 minutes. Approval drifts toward 65% in a quiet city and falls as crime climbs; arrests, drug raids and street sweeps help, suspects escaping hurts. Crackdowns and the war on drugs read as strong when crime is high and heavy-handed when it's quiet. Big swings make City News; the panel shows the rating, the crime level and what's driving it
- War on drugs (pause menu → President's orders): Hands off / Tough on drugs / All-out war. Each step scares off buyers (demand −15%), seizes supply (−20%, so prices and plug costs climb), makes raids on pickups likelier and puts more undercover cops among buyers; all-out war adds street sweeps that clear a district's corners every few minutes
- Selling on rival turf (src/turfrisk.js): their buyers are loyal (pay 25% less, come less often) unless that gang's kingpin is dead (then their buyers come to you and pay 25% more). Each sale can get you noticed — more near their people, on their home block, and the more you sell on one block: first a warning text, then (within 3 minutes) their crew opens fire or drives over to find you. Sometimes one of their soldiers walks up for a 30% cut of what you made there: pay (E / ✕) and you can sell there for 5 minutes, refuse (Q / ○) and they come at you — drop and they take everything you're holding. Selling there builds beef with that gang (cools off over time): a warning text at 50, and at 100 they hit your stash (or one of your blocks if it's empty)
- Selling: while you're holding and not on a run or wanted, buyers walk up (or drive up and pull over at the curb). E / ✕ sells, Q / ○ turns them down. Some are undercover cops (2 stars; sometimes you get a tell, like "shoes are too clean"); some snatch it and run (knock them down to get it back). Higher street cred brings buyers more often (every 90 s as a Nobody down to 25 s as Kingpin), bigger buys, better prices and fewer robberies
- Safehouse (S on the radar): $5,000. You respawn there after being wasted or busted, start there, and can rest to heal and save
- Cars take damage, catch fire and explode; ammo drops from downed enemies

- Dialogue voice: homies, plugs and street buyers talk in African American Vernacular English, written from research (kept outside the repo) — grammar over respelling, light slang, coded product talk, short calm threats; each plug has their own voice (Smokey laid back, Doc clipped and cold, Marco an older OG), homies text warm, buyers sound anxious, and undercover cops sometimes give themselves away by naming the drug like a cop would. Lines live in `VOICES` / `ASKS` in src/drugs.js and the homie texts in src/shops.js. No slurs and no real-gang vocabulary

## Controls

| Action | Keyboard / mouse | PS5 controller |
| --- | --- | --- |
| Move / steer | WASD | Left stick |
| Look | Mouse / arrow keys | Right stick |
| Sprint | Shift | ✕ (hold) |
| Crouch / take cover | C | L3 |
| Swap your two weapons | tap Tab (or 1 / 2, mouse wheel) | tap L1 |
| Inventory strip (weapons, ammo, cash, drugs) | hold Tab | hold L1 |
| Burnout (stopped) | W + S | R2 + L2 |
| Aim | Right mouse | L2 (sticks to targets near the crosshair) |
| Shoot | Left mouse | R2 |
| Punch | J (or click with fists) | ○ |
| Reload | R | □ |
| Phone (Contacts, City News, Missions) | T | D-pad → |
| Full map (pauses; move cursor, zoom, set waypoint, block info) | M | Touchpad |
| Phone: move / open / back / put away | arrows / Enter / Backspace / T | D-pad / ✕ / ○ / Create |
| Inventory: choose / give / drop (hold = all) | hold Tab + ← → / E / G | hold L1 + D-pad ← → / ✕ / □ |
| Sell / turn down a buyer | E / Q | ✕ / ○ |
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
| `src/traffic.js` | NPC traffic drivers (pass stopped cars in the other lane when it's clear, or turn back if stuck) |
| `src/peds.js` | NPC pedestrians |
| `src/police.js` | Police units and officers |
| `src/player.js` | Player on foot and in cars |
| `src/hud.js` | HUD, news feed and minimap |
| `src/input.js` | Keyboard, mouse and gamepad input |
| `src/weapons.js` | Weapons, ammo and bullet hit tests |
| `src/gang.js` | Gang fighter AI (heart, cover, morale), rival gang and your crew |
| `src/nav.js` | On-foot navigation: steering around buildings, cars, you and each other (personal space), getting unstuck, following streets |
| `src/effects.js` | Muzzle flashes, tracers, smoke, fire, explosions |
| `src/audio.js` | Synthesized sound effects |
| `src/president.js` | The President's approval rating, from crime and policy |
| `src/turfrisk.js` | Risks of selling on rival turf: getting caught, the tax, beef, loyal buyers |
| `src/drugs.js` | Plugs, drug runs and their complications, debts and hits, street buyers |
| `src/shops.js` | Turf income stash, gun shop, mod garage, safehouse, crew gear, shop menus |
| `src/claim.js` | Earning unclaimed blocks: tags, shakedowns, the rival response |
| `src/mapview.js` | Full-screen map |
| `src/gps.js` | GPS routes on the street grid and the 3D route line |
| `src/config.js` | Tuning values, crimes and the cred ladder |

## Next steps

1. Multiplayer server so several players share one city
2. Playable police and bounty hunter roles
3. Businesses, territory and turf wars
4. The report → warrant → manhunt → jury system
