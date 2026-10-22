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
- Third-person on foot (walk, sprint, punch) and driving (4 car types, handbrake)
- NPC traffic that follows lanes and stops for cars and people
- NPC pedestrians who walk the sidewalks, cross streets, and flee from violence
- Crimes: assault, carjacking, hit-and-run, store robbery, assaulting officers, stealing police cars
- Wanted level (1–5 stars) with police cruisers that chase on the road grid, officers who chase on foot, and arrests
- Escaping: break line of sight and police search where you were last seen
- Getting busted: fine, lost street cred, respawn at the police station
- Chop shop: sell stolen cars for cash once the police lose you
- Street cred ladder from the design doc (Nobody → Kingpin)
- HUD: cash, wanted stars, minimap, city news feed

## Controls

| Key | Action |
| --- | --- |
| WASD | Move / drive |
| Mouse (or arrow keys) | Look |
| Shift | Sprint |
| Click or J | Punch |
| F | Enter, exit or carjack |
| Space | Handbrake |
| E | Hold to rob a store, press to sell a car at the chop shop |
| M | Hide the news feed |

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
| `src/config.js` | Tuning values, crimes and the cred ladder |

## Next steps

1. Multiplayer server so several players share one city
2. Playable police and bounty hunter roles
3. Businesses, territory and turf wars
4. The report → warrant → manhunt → jury system
