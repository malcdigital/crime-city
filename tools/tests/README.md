# Test scripts

Scripts that load the game in a headless browser and check it. They're for development only;
the game doesn't use them.

## Setup (once)

```
npm install
npx playwright install chromium
```

## Run

Start the game in one terminal: `npx vite --port 5174`. Then, in another:

```
node tools/tests/<script>.mjs [args]
```

Set `GAME_URL` to point somewhere else, or `PW_CHROMIUM` to use another Chromium.
Screenshots land in `tools/tests/shots/` (not kept in git).

## The main checks

| Script | Checks |
|---|---|
| `smoke.mjs` | General gameplay: starts, map, GPS, no page errors |
| `fwy.mjs` | Every on-ramp reaches the freeway, every off-ramp gets back down to a street |
| `links.mjs` | Freeway-to-freeway links (ring and crosstown) drive end to end |
| `soak2.mjs` | Traffic soak in each district: frame time, stuck cars and people |
| `stuck.mjs` | Lists cars that stay stuck, and why |
| `audit.mjs` | Signs, signal poles, street lights, props and road markings in the right places |
| `signpost.mjs` | Freeway sign posts stand clear of every lane, ramp and street |
| `sink.mjs` | Nowhere a car would sink into the ground: compares where a car sits with what's drawn, all over the map. Args: `[spacing m] [spots to list] [tolerance m] [out.json]` |
| `rampside.mjs` | Drives at every ramp from the side; a car must climb on or be stopped, never end up inside it |
| `sinktilt.mjs` | A whole car (tilted to the ground) at points all over the map, four ways: where the ground would come up through the body |
| `lines.mjs` | Every painted line (street dashes, lane lines, freeway and ramp lines): on its road, at its height, center dashes on the center line |
| `drivehills.mjs` | Cars driven off-road flat out on the hills: the body never goes into the ground. Args: `[runs] [seconds]` |
| `conn.mjs` | The street network is all connected |
| `gpschk.mjs` | GPS routes between sample points |
| `rampblk.mjs` | Ramp points inside city blocks that aren't ramp land |
| `heights.mjs` | Heights streets and the ramp land around them |

## Pictures

| Script | Does |
|---|---|
| `startshot.mjs` | Screenshot from the start position (`START_AT` in `src/config.js`) |
| `gshot2.mjs` | Ground-level screenshots: `'[[x, z, headingDeg, "name", hour], ...]'` |
| `gshotf.mjs` | The same, up on the freeway deck |
| `ic.mjs` | Aerial screenshot: `x z height name` |

## Digging into one spot

| Script | Shows |
|---|---|
| `ptinfo.mjs` | Ground height, blocks and roads at points: `'[[x, z], ...]'` |
| `rinfo.mjs` | Freeway/ramp surfaces and roads at points |
| `tridbg.mjs` | Drawn triangles above the ground at one point: `'[x, z]'` |
| `blkq.mjs` | Block type and bounds at points |
| `offs.mjs` | Each interchange's exit ramp shape and where it starts |
| `findspot.mjs` | Spots beside each entrance ramp's low end (for testing) |
