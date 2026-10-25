# Crime City roadmap

Things we've decided to do later. Check here before planning new work.

## Don't forget
- **Easter eggs around the city.** Hidden secrets to find (requested; details to plan when we get to it).
- **Turn off the testing switches** in `src/config.js` before release: `INFINITE_AMMO`, `START_IN_CAR`, `CAR_SPAWN_KEY`, `TURF_FAST`, `GANG_RUNS_ANY_RANK`, `MARKET_HOT`, `TEST_INCIDENT`, `TEST_STING`, `TEST_DIRTY_COP`.

## Later (agreed, not started)
- **Multiplayer**: other players in your crew answer "Call a player for backup" (the phone row is already there), shared economy, player-owned companies.
- **Player Presidents**: players run for office and set the budget, taxes and orders (NPC Presidents stand in until then).
- **Interiors**: gang bases (meetings inside), stores, homes.
- **Money sinks**: clothes and character customization, buying cars (garage, insurance), crew wages, lawyers and bail.
- **Rival gangs spend their money**: they bank cash at their bases (bases.js) but don't use it yet — recruiting, guns, starting turf wars.
- **Your crew's base moving**: it upgrades in place at the hangout for now.
- **Dirty-cop tells in the 3D scene**: they're text-only in the stop prompt right now.
- **Traffic stops in the 3D scene**: the officer stays in the car for now (the stop is a prompt); have one walk up to your window.
- **Taxis you can ride** (hail one, pay the fare) and **riding the bus**.
- **Touch controls on a real phone**: tested only in a simulated phone browser so far; tune button sizes, look speed and the joystick after real play. Possible extras: button layout editor, gyro aiming, haptics.
- **Shooting hydrants** (they only break when hit by a car right now).

## Ideas list (realism and polish, best value first)
Done: car lights, daily rhythms, parked cars / buses / taxis / delivery trucks, street props (hydrants, trash cans, benches, bus shelters, litter, graffiti), traffic enforcement.

5. City sounds: background hum, distant sirens, music from the Strip.
7. Emergency services: ambulances, fire trucks, tow trucks.
8. Weather: rain (slick roads, fewer people out), fog.
9. Settings menu: volume, graphics quality (a Phone/Full switch is in the pause menu now), field of view, controls.
10. One save/load system with an autosave indicator.
11. Onboarding: short tutorial missions.
12. Automated tests: turn the headless test scripts into a suite that runs on every change.
