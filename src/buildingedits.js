// Changes to the city's buildings, by id. Every building city.js puts up has a stable id:
// "<block key>#<n>" (its n-th building, in the order it's built; the city is built the same way
// every time). Find one in the game: stand next to it and run `__game.city.buildingAt()` in the
// console (or pass x, z): it gives the id and where it is. To try a change live first:
// `__game.city.editBuilding(id, { dx: 4 })`, `__game.city.removeBuilding(id)`.
//
// An edit here is applied as the city is built, before anything is placed against it (shop
// signs and doors, trees, graffiti, turf tags), so they all follow it, and it costs nothing
// while you play. What an edit can say (all optional):
//   remove: true            gone (the space it stood in stays empty)
//   x, z                    its center, absolute
//   dx, dz                  moved by this much
//   w, d                    its width (along its front) and depth
//   h                       its height above the ground
//   ang / turn              its angle (radians, absolute) / turned by this much
// e.g. 'b412#2': { remove: true }, 'b88#0': { dx: -6, h: 30 }
export const BUILDING_EDITS = {};
