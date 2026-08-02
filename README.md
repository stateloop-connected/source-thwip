# THWIP

A first-person web-swinging flow-state game in a procedurally generated
comic-book city. Ninety-second runs, instant retry, and a mastery system where
**the game's own framerate is the reward**.

Every mesh, texture, sound and letterform is generated in code at runtime.
There is not a single image, font, model or audio file in this repository.

**[▶ Play it](https://ianmolagarwal.github.io/thwip/)** — desktop browser with a
mouse; swinging needs pointer lock and two buttons.

---

## Run it

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

Requires a desktop browser with WebGL2 and a mouse — swinging needs pointer
lock and two mouse buttons, so touch devices get a polite notice instead of a
broken game.

```bash
npm run build      # typecheck + production build into dist/
npm run preview    # serve the built dist/
npm run typecheck  # tsc --noEmit on its own
```

The build is ~181 KB gzipped and makes **zero network requests after the
initial load**.

---

## Controls

| | |
|---|---|
| `MOUSE` | look |
| `LMB` / `RMB` | left web / right web — hold to stay tethered |
| `SHIFT` | reel in |
| `SPACE` | jump, or web-zip while tethered *(rank 5)* |
| `W` against a wall | wall-run *(rank 3)* |
| `E` | arc dash *(rank 7)* |
| `Q` | camo glide *(rank 9)* |
| `R` | restart the run instantly |
| `ESC` | pause / options |
| `` ` `` | tuning panel |

**How to actually go fast:** web something *ahead* of you and a little above,
ride it down through the low point, and hold `SHIFT` on the way down. Reeling
conserves angular momentum, so shortening the rope while the tension is high
is what accelerates you — exactly like pumping a playground swing. Let go as
your momentum turns upward and throw the next web immediately.

---

## The loop

A run is 90 seconds. Flow always drains — 12/s airborne, 25/s on the ground —
so you can never coast. You refill it by playing well: near-misses,
wall-runs, point-launches, tokens, crime beacons, dual-web slingshots.

Flow reaching zero is the **only** fail state. Touching the ground costs flow
and shatters your combo, but it never kills you. That distinction is the whole
addiction mechanism: a death screen breaks the "one more run" spell, a
shattered multiplier makes you desperate to get it back.

---

## Progression: the framerate is the reward

Twelve ranks. As rank rises, the world resolves into focus around you:

| | Rank 1 | Rank 12 |
|---|---|---|
| Animation step rate | 12 fps | 24 fps |
| Glitch intensity | 1.0 | 0.0 |
| Colour saturation | 0.62 | 1.0 |
| Halftone dot scale | 6.5 px | 2.4 px |
| Outline boil | 1.0 | 0.35 |

**Only animation pose sampling and certain VFX are stepped.** Camera,
mouse-look, physics and post-processing always run at full framerate. In the
film, characters animate on twos while the camera moves on ones; stepping the
camera would make the game feel broken and make people ill. `Loop` owns both
clocks and the split is deliberate — see the comment at the top of
`src/core/Loop.ts`.

---

## Tuning

Press `` ` `` in game. Every constant that defines how the game feels is a
labelled slider that takes effect on the next frame — no reload. Values
persist to `localStorage`, so tuning survives a refresh.

- **Copy as TypeScript** dumps the current state as a paste-ready constants
  block for `src/core/Tuning.ts`.
- **Reset to defaults** restores the shipped values.
- The header shows live fps, render time, draw calls, triangles, active
  tethers, speed, flow, combo and the current quality tier.

This is a shipped feature, not debug scaffolding: it is how the game gets
tuned after hand-off without another build pass.

### Constants worth knowing about

`src/core/Tuning.ts` documents the deviations from the original design
targets and why they were made. The three that matter:

- `reelSpeed` was raised from 9 to 26. Reeling conserves angular momentum, so
  it is the player's throttle; at 9 the swing never reached the 1.2–2.0s
  apex-to-apex cadence the feel test asks for.
- `minTetherLength` was raised from 4 to 10. A 4 m radius at swing speed is a
  13 rad/s orbit — over a revolution per second, and about 70 g.
- FOV values are **horizontal** degrees, the convention players expect.
  Three.js wants vertical; `CameraRig` converts.

---

## Deploy

Static output, no server, no configuration:

```bash
npm run build
# then serve dist/ anywhere, or:
npx vercel deploy --prod
```

Vercel auto-detects Vite. `vite.config.ts` sets `base: './'` so the same build
works from a subdirectory, from a plain file server, and from Electron's
`file://` protocol without changes.

---

## Desktop (Electron)

```bash
npm run build          # dist/ must exist first
cd desktop
npm install
npm start
```

`desktop/main.js` is a ~40-line wrapper that loads the built `dist/`. It has
no game logic, no Node integration, and no preload script — the game is
entirely self-contained.

---

## Architecture

```
src/
  core/      Game (state machine + frame order), Loop (dt clamp + the stepped
             animation clock), Input, Save, Rng, Tuning
  world/     CityGenerator, Districts, BuildingFactory, FacadeTextures,
             GroundPlane, Landmarks, AnchorGrid, Collision
  player/    PlayerBody, WebSystem, Moves, FirstPersonRig, CameraRig
  game/      FlowMeter, Scoring, Progression, Challenges, Beacons, Tokens
  render/    Renderer, PostChain, Sky, ToonMaterial, glsl, passes/
  audio/     AudioEngine, Sfx, Music
  ui/        Hud, ComicText, Panels, StartScreen, Options
  debug/     TuningPanel, FlyCamera, TestScenarios
```

**Everything is seeded.** `Rng` is a `mulberry32` stream; nothing in the world
generator may call `Math.random()`. The same seed produces a byte-identical
city on every machine, which is what makes the daily challenge work.

**Physics is hand-rolled** — one point mass, one distance constraint, AABB
collision against a spatial grid. No physics engine. The web is a hard
constraint with velocity projection, not a spring: a spring oscillates and
reads as swinging on a bungee cord.

**Draw calls stay under 80.** Every rectilinear thing in the city — towers,
cornices, setbacks, girders, crane jibs, water tanks, bridge cables — shares
one unit box in an `InstancedMesh`, bucketed into spatial sectors so the
frustum can throw most of the city away. Facades are a single
`DataArrayTexture`; array layers wrap independently, so a 10 m tile repeats
across a 160 m tower with no atlas bleed.

---

## Debug surface

`window.__game` is exposed in **dev builds only**. It is a cheat menu — live
physics constants, `setRank()`, and an autopilot that plays the game for you —
so `src/main.ts` gates it behind `import.meta.env.DEV` and it is absent from
`dist/`:

| | |
|---|---|
| `.stats` | fps, render ms, draw calls, triangles, anim frame index |
| `.player` | position, velocity, speed, grounded, tethers, aim validity |
| `.tuning` | the live constants object — mutate and see it next frame |
| `.setRank(n)` | jump to a rank and apply its style values |
| `.teleport(x,y,z)` | move the body |
| `.forceSwing(side)` | fire a web at the best anchor |
| `.simulate(sec, dt, trace)` | run the play loop **headless** with a scripted autopilot at a fixed timestep, returning a full report (chained swings, apex cadence, ground contacts, NaN frames). A 90-second run takes well under a second. |

URL parameters: `?seed=<n or string>` pins the city, `?test=fly` enables the
free-fly inspection camera.

---

## Known limitations

Stated plainly rather than left for you to find:

- **Apex-to-apex cadence is bimodal.** A scripted 90-second run puts the median
  at 2.1s but only ~30% of intervals inside the 1.2–2.0s window the feel test
  asks for — short ballistic hops and long arcs, not a tight centre. The
  measurement comes from the autopilot, not a human, which is exactly why it
  has not been "fixed": tuning swing physics against a bot is how you make a
  game that satisfies a script and nobody else.
- **Tokens, beacons, point-launches and slingshots** are verified to fire,
  score and award flow, but the autopilot ignores them, so they have never been
  exercised across a full human run.
- **The Electron wrapper is a convenience, not a product.** No packaging, no
  signing, no auto-update.

---

## Licence

[MIT](LICENSE) — do what you like with the code.

### Attribution

An original stylistic homage to comic-book animation. Not affiliated with,
endorsed by, or licensed from any comics publisher or film studio. No
trademarked names, logos or marks appear anywhere in the code, the UI or the
metadata. The hero is an original character.

`PROMPT.md` is the authoring spec the game was built from, committed verbatim.
It names the film it takes its art direction from, because that is what a
design brief does; the shipped game does not.
