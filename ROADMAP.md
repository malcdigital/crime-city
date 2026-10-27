# Crime City roadmap

Things we've decided to do later. Check here before planning new work.

## Don't forget
- **Easter eggs around the city.** Hidden secrets to find (requested; details to plan when we get to it).
- **Turn off the testing switches** in `src/config.js` before release: `INFINITE_AMMO`, `START_IN_CAR`, `START_AT`, `START_ON_FOOT`, `RAMP_EDITOR`, `CAR_SPAWN_KEY`, `TURF_FAST`, `GANG_RUNS_ANY_RANK`, `MARKET_HOT`, `SHOT_TYPE_DEBUG`, `TEST_INCIDENT`, `TEST_STING`, `TEST_DIRTY_COP`.

## Later (agreed, not started)
- **Multiplayer**: other players in your crew answer "Call a player for backup" (the phone row is already there), shared economy, player-owned companies, betting another player on a pickup game (one-on-one at the courts, a drive at Harbor Field: the bet is already held the same way against NPCs).
- **Player Presidents**: players run for office and set the budget, taxes and orders (NPC Presidents stand in until then).
- **Interiors**: gang bases (meetings inside), stores, homes.
- **Money sinks**: clothes and character customization, buying cars (garage, insurance), crew wages, lawyers and bail.
- **Rival gangs spend their money**: they bank cash at their bases (bases.js) but don't use it yet — recruiting, guns, starting turf wars.
- **Your crew's base moving**: it upgrades in place at the hangout for now.
- **Freeways, more**: freeways out to new areas if the map grows; nobody but you walks on the freeway, and police stay in their cars up there; AI cars only use the ramps when their random route takes them there (they don't plan freeway trips yet, and they don't signal or plan lane changes before an exit). Cars don't tilt on slopes (the hills and ramps): they stay level.
- **Touch controls on a real phone**: tested only in a simulated phone browser so far; tune button sizes, look speed and the joystick after real play. Possible extras: button layout editor, gyro aiming, haptics.
- **Shooting hydrants** (they only break when hit by a car right now).

## New places (agreed order; each works single-player first, real players added once multiplayer exists)
Tie each one back to the crime side: owned businesses can launder drug money, gangs want protection money, rivals can start trouble at events, big nights draw police.

1. **Hunting land**: a wilderness area outside the city. Ordinary game (deer, boar, birds) that flees, plus big predators that hunt you: tigers and lions loose from an exotic-animal ranch or a gang boss's private zoo. Bigfoot as a rare legend you track down (like GTA V's Sasquatch hunt). Unicorns only show up when you're high on something from the drug system (keeps the world grounded). Open questions: where it goes on the map, selling meat and hides, hunting licenses and poaching.
2. **Arena** (strongest idea): an ownable venue. The owner books acts (NPC concerts, magicians, sporting events) by reading demand (by district, like the drug market) and sets ticket prices and promotion. Event nights matter more than the show itself: crowds, scalpers, security, a box-office robbery. First events: streetball tournaments (and football) with crowds and prize money, reusing the courts' games. Later: booking real players as performers (needs multiplayer).
3. **Recording studio**: pay for studio time and make beats with an in-browser beat-maker (drums, bass, samples on a grid). Your songs play on your car radio. Popularity comes from things the game can count (money spent on promotion, radio plays, cred in each district; real players' likes later), not from judging the music. Enough fans gets you a booking at the arena. Vocals left out at first: once songs are shared between players they bring storage, moderation and copyright problems.
4. **Amusement park**: an ownable business with 2–3 rides first, a rollercoaster as the centerpiece (more rides later if they're used). Later: a simple piece-by-piece coaster builder for the owner (the track can reuse the freeway curve code; the hard part is a build tool that works on a controller and a phone). It's worth most once other players can ride what you build.
5. **Multiplayer parts of the above**: player performers at the arena, sharing songs, riding other players' coasters.

## Ideas list (realism and polish, best value first)
Done: car lights, daily rhythms, parked cars / buses / taxis / delivery trucks, street props (hydrants, trash cans, benches, bus shelters, litter, graffiti), traffic enforcement.

5. City sounds: background hum, distant sirens, music from the Strip.
7. Emergency services: ambulances, fire trucks, tow trucks.
8. Weather: rain (slick roads, fewer people out), fog.
9. Settings menu: volume, graphics quality (a Phone/Full switch is in the pause menu now), field of view, controls.
10. One save/load system with an autosave indicator.
11. Onboarding: short tutorial missions.
12. Automated tests: turn the headless test scripts into a suite that runs on every change.
