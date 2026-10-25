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

## Ideas list (realism and polish, best value first)
1. Car lights: headlights, taillights and brake lights at night; police light bars lighting the street.
2. Daily rhythms: rush hour, a packed Strip at night, quiet streets at 4 AM.
3. Parked cars along the curbs; buses with bus stops, taxis, delivery vans.
4. Street props: hydrants (they spray when hit), trash cans, benches, bus shelters; litter and graffiti in poorer districts.
5. City sounds: background hum, distant sirens, music from the Strip.
6. Traffic enforcement: running reds or speeding in front of a cop leads to a traffic stop or a chase.
7. Emergency services: ambulances, fire trucks, tow trucks.
8. Weather: rain (slick roads, fewer people out), fog.
9. Settings menu: volume, graphics quality, field of view, controls.
10. One save/load system with an autosave indicator.
11. Onboarding: short tutorial missions.
12. Automated tests: turn the headless test scripts into a suite that runs on every change.
