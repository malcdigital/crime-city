# Crime City: standing rules

- Every feature works on all three: a phone (iPhone, touch controls), a PS5 controller and keyboard/mouse.
- Every piece of UI fits every display. Check it with screenshots before shipping, at least:
  - phones in landscape, touch mode on: 667x375 (iPhone SE), 844x390 (iPhone 14), 932x430 (Pro Max)
  - a tablet: 1024x768 with touch
  - desktop: 1280x720, plus a narrow window (640x480)

  On a phone, keep clear of the top-left info, the pause/QUIT buttons, the top-right cash/clock (or hide it while your board is up) and the touch buttons. Size boards to the room they have; don't use a fixed scale.
- Your player and the opponents always change together: a new animation, rule or tweak applies to both.
- Every game quits without pausing: add it to `activeGame()` in src/main.js (hold M / touchpad; QUIT on a phone).
- Testing switches in src/config.js (START_ON_FOOT, START_NEAR_DICE, CAR_SPAWN_KEY...) are listed in ROADMAP to turn off before release.
- Test harness: tools/tests/launch.mjs and `window.__game`. Smoke test: `node tools/tests/smoke.mjs`.
- After every change: build, commit, push to main, republish the artifact.
