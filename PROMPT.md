# BUILD: **THWIP** — a first-person Spider-Verse flow-state game

You are building a complete, polished, shippable browser game in one pass. Read this entire document before writing a single line of code. Then build it in the phases defined at the bottom, and **do not advance past a phase gate until its checklist verifiably passes.**

This is not a prototype. This is a finished thing someone plays for an hour and then sends to a friend.

---

## 0. THE MISSION

A **first-person** web-swinging game through a procedurally generated comic-book city, rendered in the visual language of *Spider-Man: Into the Spider-Verse*. 90-second flow runs. Instant retry. A mastery system where **the game's own framerate is the reward**.

**The single most important thing:** the swing must feel incredible. Everything else is decoration on top of that. If you have to choose between another feature and better swing feel, choose swing feel every time.

**Title:** THWIP
**Hero:** an original Spider-Verse-inspired character — black suit, red accents, bio-electric venom blast, active camouflage. Do not use Marvel names, logos, or trademarked marks anywhere in shipped UI, code, or metadata. This is a stylistic homage, not a licensed product.

---

## 1. TECH CONSTRAINTS — NON-NEGOTIABLE

| Constraint | Value |
|---|---|
| Framework | Vite (vanilla TS) + Three.js `^0.185` |
| Renderer | `WebGLRenderer`, WebGL2. **Do not use WebGPURenderer** — compatibility over novelty. |
| Physics | Hand-rolled. Do NOT pull in Rapier/cannon/ammo. You need one verlet point mass + one distance constraint + AABB collision. A physics engine is a liability here. |
| External assets | **ZERO.** No CDN imports, no `fetch()`, no `.glb`, no `.png`, no fonts, no HDRI, no audio files. Every mesh, texture, sound and glyph is generated in code at runtime. |
| Dependencies | `three` and `vite` only. Nothing else. |
| Persistence | `localStorage` only |
| Deploy target | Static build → Vercel. Must work from `vite build` with no server. |
| Secondary target | Thin Electron wrapper in `desktop/` loading the built `dist/` |
| Bundle | Under 1.5 MB gzipped. Time-to-playable under 3 seconds. |

**Why zero assets matters:** it makes the build deterministic, the bundle tiny, the deploy trivial, and — critically — it makes **seeded cities** possible, which is what the daily challenge is built on.

### Browser realities you must handle
- Pointer lock requires a user gesture → **click-to-start overlay**, always.
- `AudioContext` requires a user gesture → initialize audio on that same click.
- Touch devices can't pointer-lock → detect and show a clean "Desktop + mouse required" comic panel instead of a broken game.
- Tab blur → pause immediately, release pointer lock, don't let `deltaTime` explode. **Clamp `dt` to 1/30s maximum, always.**

---

## 2. THE LOOK — Spider-Verse, implemented

Sony Imageworks built this look out of ~7 stackable tricks. Implement all of them. Each one is cheap. Together they are unmistakable.

### 2.1 Lighting: "Thresher" — hard-stepped bands, never smooth

Do not use smooth diffuse falloff anywhere. Quantize `N·L` into exactly 3 bands.

```glsl
float ndl = dot(normal, lightDir) * 0.5 + 0.5;
float band = ndl < 0.35 ? 0.30 : (ndl < 0.72 ? 0.68 : 1.0);
vec3 lit = baseColor * band;
```

Apply via a custom `ShaderMaterial` or `onBeforeCompile`. One key directional light (warm, low sun), one cool ambient fill. No shadow maps — bake a cheap ambient-occlusion darkening into building bases procedurally instead. Shadow maps cost more than they add in a flat-shaded comic world.

### 2.2 Halftone — Ben-Day dots at misaligned print angles

The signature. Screen-space, in post. Critically: **each channel gets a different rotation** — that misalignment is what produces the authentic off-register moiré. Classic print angles: C=15°, M=75°, Y=0°.

```glsl
float halftone(vec2 uv, float angle, float intensity, float scale, vec2 res) {
  float s = sin(angle), c = cos(angle);
  vec2 p = uv * res / scale;
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  vec2 cell = fract(p) - 0.5;
  float radius = sqrt(1.0 - clamp(intensity, 0.0, 1.0)) * 0.55;
  return smoothstep(radius + 0.03, radius - 0.03, length(cell));
}
```

Drive dot size from *luminance* so dots are large and crude in shadow, vanishing in light. `scale` is rank-dependent (coarse at low rank, fine at high rank — see §5).

### 2.3 CMYK misprint depth-of-field — the one that sells it

The film has **no lens blur**. Out-of-focus objects split into offset cyan/magenta/yellow ghosts, mimicking a misregistered printing press. This reads as "Spider-Verse" faster than anything else on this list.

```glsl
float depth = texture2D(tDepth, uv).r;
float coc = clamp(abs(linearDepth(depth) - focusDist) / focusRange, 0.0, 1.0);
float amt = coc * maxOffset;              // maxOffset ~6px in UV units
vec3 col;
col.r = texture2D(tDiffuse, uv + vec2( amt,  amt * 0.5)).r;
col.g = texture2D(tDiffuse, uv).g;
col.b = texture2D(tDiffuse, uv + vec2(-amt, -amt * 0.5)).b;
```

Focus distance follows what the player is looking at (raycast, smoothed over ~0.3s). Near buildings crisp, distant skyline splitting into colour ghosts. **Never use a Gaussian blur DoF.**

### 2.4 Outlines with "line boil"

Sobel edge detection on depth + normal buffers. Then the crucial part: **jitter the sample UVs with noise that only updates at the stepped framerate** (§5). Static outlines look like a filter. Boiling outlines look hand-drawn.

```glsl
vec2 boil = (hash2(floor(uv * 40.0) + vec2(animFrameIndex)) - 0.5) * 0.0018;
// sample the sobel neighborhood at uv + boil
```

Line thickness should scale slightly with proximity — closer geometry gets heavier lines, like a comic artist inking foreground.

### 2.5 Hatching

In the darkest lighting band only, multiply by procedural screen-space hatch lines at ~45°, plus a second cross-hatch layer at ~135° in the very darkest regions.

```glsl
float hatch(vec2 uv, float angle, float freq) {
  float s = sin(angle), c = cos(angle);
  vec2 p = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
  return smoothstep(0.35, 0.5, abs(fract(p.y * freq) - 0.5));
}
```

### 2.6 Speed lines instead of motion blur

There is no motion blur in this film and there is none in this game. Above ~28 m/s, additively composite radial speed lines emanating from the screen-space velocity vector. Density and length scale with speed. This is your primary sensation of velocity — get it right and 40 m/s feels like 100.

### 2.7 Paper, grain, and whole-frame misregistration

Final pass: subtle paper-fibre noise, a soft vignette, and a 1px whole-frame RGB misregistration that drifts slowly. Never let the frame look digitally clean.

### 2.8 Glitch

Rank-dependent (§5) plus triggered on hard impacts: RGB channel tearing, horizontal block displacement, and a brief audio stutter. At rank 1 this fires constantly and reads as *intentional style* — which conveniently means early-game jank looks deliberate.

### Post-process chain order
```
scene (MRT: colour + depth + normal)
  → outline (sobel + boil)
  → halftone
  → CMYK misprint DoF
  → speed lines
  → glitch
  → paper grain + vignette + misregistration
  → output
```

---

## 3. THE FEEL — physics, with real numbers

These constants are tuned starting points. All must be live-adjustable in the tuning panel (§10). **Feel beats simulation** — if physical accuracy fights fun, fun wins.

### 3.1 Core body
```
gravity                 -24.0 m/s²
maxSpeed                 55.0 m/s   (hard clamp, ~123 mph)
airControlAccel           7.0 m/s²  (lateral, while airborne)
terminalFallSpeed        -60.0 m/s
playerRadius              0.45 m    (capsule for collision)
eyeHeight                 1.7 m
```

### 3.2 Web / tether — the heart of the game
```
maxAttachRange           95.0 m
attachConeAngle          14°        (auto-aim search cone from crosshair)
steerAssist               0.35      (0 = pure physics, 1 = heavy assist; DEFAULT 0.35)
reelSpeed                 9.0 m/s   (while holding Shift)
minTetherLength           4.0 m
tetherStiffness           0.85      (position-correction factor per substep)
releaseBoostFactor        0.28      (upward impulse = speed * this, on release)
releaseBoostMax          11.0 m/s
apexBoostWindow           0.18 s    (release near apex → point-launch bonus)
substeps                  4         (physics substeps per frame — non-negotiable for stability)
```

**Implementation:** point mass + distance constraint. Each substep: integrate gravity → apply air control → for each active tether, if `distance > tetherLength`, project position back onto the sphere and remove the radial velocity component. Do NOT model a spring with a stiffness force — it oscillates and feels mushy. Hard constraint + velocity projection is what feels crisp.

**Auto-aim:** search the cone for candidate anchor points, score by `angleFromCrosshair * 2.0 + distance * 0.01`, pick the best. Blend the final anchor toward the raw raycast hit by `(1 - steerAssist)`. Show a subtle crosshair state change when a valid anchor is available — the player must always know if a thwip will connect.

**Dual webs:** LMB = left web, RMB = right web. Both can be active simultaneously. Two anchors at once produces a slingshot effect that is the highest skill expression in the game. This is essential, not optional.

### 3.3 Camera — and the motion-sickness contract

Non-negotiable, all defaults must be comfortable:
```
baseFOV                  78°
speedFOVBoost           +26°        (lerp toward at 4.0/s, driven by speed/maxSpeed)
cameraRoll                OFF by default (option to enable, max 6°)
headBob                   OFF while airborne; subtle while grounded; toggleable
speedVignette             ON above 35 m/s, gentle
```
Provide an options panel with FOV slider (70–110), head-bob toggle, camera-roll toggle, speed-line intensity, and a global "reduce motion" switch that softens all of it at once.

**Never** apply screen shake during normal swinging. Reserve it for impacts and venom blasts only.

### 3.4 First-person body
Render code-built hands/forearms in the black-and-red suit, with a simple two-bone IK reaching toward each active web anchor. When a web is attached, that hand visibly points at its anchor. The web line itself is a slightly-sagging catenary tube, not a straight line, with a subtle thickness taper.

You should see legs on the fall-down look. Do not render a full body from the inside — it looks broken and costs more than it returns.

### The feel test
A good swing: you thwip a building ahead-left, arc down and through the low point picking up speed, rise on the far side, and release at the apex with your momentum carrying you forward and up into the next thwip. Apex-to-apex should take **1.2–2.0 seconds**. If it takes 4 seconds it's floaty and boring. If it takes 0.6 it's frantic and unreadable. Tune until it lands in that window.

---

## 4. THE LOOP — 90-second flow runs

```
Click → 3-2-1 comic panel countdown → 90 seconds of swinging → score page → [R] instantly again
```

### 4.1 The flow meter
100 units. **Always draining.** You can never coast.
```
drain, airborne          12.0 /s
drain, grounded          25.0 /s
```
Refill by playing well:

| Action | Flow | Combo | Points |
|---|---|---|---|
| Near-miss (within 3m of geometry at >25 m/s) | +8 | +2x | 250 |
| Wall-run (per second sustained) | +6 | +1x | 150/s |
| Point-launch (release inside apex window) | +12 | +3x | 600 |
| Spider-token collected | +15 | +1x | 400 |
| Crime beacon resolved | +25 | +5x | 1500 |
| Perfect save (resolve beacon without touching ground) | +10 | +3x | 1000 |
| Dual-web slingshot | +14 | +4x | 900 |
| **Ground contact** | **−20** | **combo → 1** | — |

**Flow hits zero → run ends early.** That is the only fail state.

**Ground contact must NEVER kill you.** A death screen breaks the "one more run" spell. A shattered multiplier makes you desperate to get it back. This distinction is the entire addiction mechanism — do not get it wrong.

Combo multiplier caps at **x30**. It decays by 1 every 2.5 seconds with no scoring event, so it's a pressure gauge, not a bank.

Points = `basePoints × comboMultiplier`.

### 4.2 Run end
A comic-book page: score in big halftoned numerals, run stats, **three rotating challenge cards** drawn from a pool of ~20 (e.g. "chain 15 swings without touching ground", "hit 90 mph", "resolve 3 beacons", "60s airborne", "x20 combo"). Completed cards award rank XP. New cards every run — this is your variable reward.

Then: **`R` restarts instantly.** No menu, no fade, no load. Under 400ms from keypress to swinging. This single number is the most important UX metric in the game.

---

## 5. PROGRESSION — the framerate *is* the reward

The best idea in this design. In the film, the hero is animated on twos (12fps) until he masters his powers, then steps up to 24fps. Here, **the player earns that transition**.

12 ranks. As rank rises:

| | Rank 1 | Rank 12 |
|---|---|---|
| Animation step rate | 12 fps | 24 fps (smooth) |
| Glitch intensity | 1.0 | 0.0 |
| Colour saturation | 0.62 | 1.0 |
| Halftone dot scale | 6.5 px | 2.4 px |
| Outline boil amplitude | 1.0 | 0.35 |

Interpolate every value linearly across ranks. The player *feels* themselves getting better because the world literally resolves into focus around them.

### ⚠️ THE CRITICAL IMPLEMENTATION DETAIL

**Only animation pose sampling and certain VFX are stepped. Camera, mouse-look, physics, and post-processing ALWAYS run at full framerate.**

In the film, characters animate on twos while the camera moves on ones. If you step the camera or input, the game feels broken and laggy and will make people ill. Implement a single `animFrameIndex` that increments at the current step rate; hand IK poses, web-line geometry updates, and line-boil noise sample against that index. Everything else runs free.

Get this wrong and the whole idea collapses. Get it right and it's magic.

### Unlockable moves
Each unlock opens lines through the city that were previously impossible, so old ground plays new:

```
RANK  1  THWIP          left/right web, the foundation
RANK  3  WALL-RUN       hold W on wall contact, ~2.5s, refills flow
RANK  5  WEB-ZIP        Space while tethered → yank yourself hard toward the anchor
RANK  7  VENOM DASH     E → bio-electric burst, brief gravity immunity + AoE
RANK  9  CAMO GLIDE     Q → invisible slow-fall, drains flow slower, resets nothing
RANK 12  POINT LAUNCH   dual-web slingshot at 2x power — the mastery move
```

Rank-up must be a **moment**: freeze-frame, comic panel slams in, onomatopoeia, the new framerate visibly kicks in, the new move demonstrated in one line of text. Sell it.

---

## 6. THE CITY — seeded, instanced, five districts

Fully procedural from a numeric seed via `mulberry32`. Same seed → identical city, every time, on every machine. This is what makes the daily challenge work.

### Districts
| District | Character | Swing feel |
|---|---|---|
| **Brownstones** | Low blocks, 10–25m, dense grid | Fast rhythm, tight, low anchors |
| **Canyons** | Towers 60–160m, wide avenues | Huge arcs, vertigo, long commits |
| **The Bridge** | Suspension cables, towers | Cables as rails, crosswind gusts |
| **Construction** | Skeletal frames, cranes | **Moving anchor points** |
| **The Park** | Open green, sparse tall trees | Anchor drought — a deliberate risk zone |

Lay them out in sectors around a ~1.2km × 1.2km playfield with visible transitions. A run naturally passes through 2–3 of them.

### Performance — this is where it lives or dies
- **`InstancedMesh` per building archetype per district.** Target **under 80 draw calls total**. A thousand individual meshes will destroy you.
- Facade textures: canvas-painted window-grid atlases (4–6 variants), generated once at load. Emissive windows lit at random for depth.
- **Raycast against building AABBs, not meshes.** Maintain a uniform spatial grid for anchor queries. Mesh raycasting at 60fps across a city will not work.
- Frustum-cull aggressively; fade distant districts into the halftone haze rather than popping.
- Ground plane with procedural street grid, crosswalks, and centre lines painted into a canvas texture.

### Quality tiers
Auto-detect by sampling frame time over the first 3 seconds, then set `low` / `medium` / `high`. Tiers scale: post-process buffer resolution (0.6x → 1.0x), outline pass on/off, speed-line density, draw distance, halftone resolution. Player can override in options. **The game must hit 60fps on integrated graphics at `low`.**

---

## 7. AUDIO — 100% Web Audio, zero files

All synthesized. Initialize on the start click.

| Sound | Synthesis |
|---|---|
| **THWIP** | Filtered noise burst, 40ms, bandpass sweeping 3kHz→800Hz, sharp attack |
| **Web tension** | Low sine, pitch tracking tether load, subtle |
| **Wind** | Brown noise → lowpass; cutoff + gain mapped to speed. Your primary velocity cue. |
| **Venom blast** | FM sine (carrier 180Hz, mod 40Hz) + noise crackle + fast decay |
| **Impact** | Click transient + lowpassed thump |
| **Rank up** | Rising arpeggio, major, four notes |
| **Music** | Procedural 4-bar hip-hop-leaning loop: kick, snare (noise burst + envelope), hats, sub-bass. **Tempo rises with rank** — 86bpm at rank 1, 102bpm at rank 12. |

Master gain slider + mute in options. Duck music during rank-up.

---

## 8. HUD & UI — comic book, always

Everything drawn in a comic idiom. Bold black borders, halftone fills, hand-lettered feel, slight rotation on elements — nothing perfectly axis-aligned.

- **Crosshair:** small spider glyph. Changes state clearly when a valid anchor is in range.
- **Flow meter:** halftone-filled bar, pulses red under 25.
- **Combo:** large comic numerals, canted a few degrees, scaling punch on increase.
- **Speed:** mph readout, bottom-right, small.
- **Timer:** top-centre.
- **Onomatopoeia sprites:** canvas-rendered text with heavy outline, spawned in screen space with a pop-and-fade. `THWIP` on attach, `KRAKK` on venom, `SHOOM` on point-launch, `WHUMP` on ground contact, `SNAP` on combo break. Randomize rotation and scale slightly. Do not overuse — cap at 3 concurrent.
- **Panel transitions:** run start and run end wipe in as comic panels sliding across the screen.
- **Ghost:** your best run replays as a translucent halftoned silhouette you race. Store positions at 10Hz in localStorage.
- **Daily seed:** derived from `YYYY-MM-DD`, with a persisted local top-10.

### Controls (show on the start screen, and in pause)
```
MOUSE        look
LMB / RMB    left web / right web  (hold to stay tethered)
SHIFT        reel in
SPACE        jump  /  web-zip while tethered
W (on wall)  wall-run
E            venom dash          [rank 7]
Q            camo glide          [rank 9]
R            restart run instantly
`            tuning panel
ESC          pause
```

---

## 9. FILE LAYOUT

Keep files focused. No file over ~400 lines — if one grows past that, it's doing too much, split it.

```
/
├─ index.html
├─ package.json                 three + vite only
├─ vite.config.ts
├─ vercel.json                  (only if needed — Vite is auto-detected)
├─ README.md                    how to run, deploy, and tune
├─ src/
│  ├─ main.ts                   bootstrap, start overlay, main loop, dt clamp
│  ├─ core/
│  │  ├─ Game.ts                state machine: MENU RUN SCORE PAUSED
│  │  ├─ Loop.ts                fixed-step accumulator, animFrameIndex
│  │  ├─ Input.ts               pointer lock, keybinds, gamepad-ready
│  │  ├─ Save.ts                localStorage: rank, xp, bests, ghost, settings
│  │  └─ Rng.ts                 mulberry32 + seeded helpers
│  ├─ world/
│  │  ├─ CityGenerator.ts       seeded district layout
│  │  ├─ Districts.ts           the five district rulesets
│  │  ├─ BuildingFactory.ts     archetypes → InstancedMesh
│  │  ├─ FacadeTextures.ts      canvas-painted window atlases
│  │  ├─ AnchorGrid.ts          spatial hash for anchor queries
│  │  └─ Collision.ts           AABB grid, capsule resolution
│  ├─ player/
│  │  ├─ PlayerBody.ts          verlet integration, air control
│  │  ├─ WebSystem.ts           attach, constraint, reel, release, dual-web
│  │  ├─ Moves.ts               wall-run, web-zip, venom dash, camo glide
│  │  ├─ FirstPersonRig.ts      hands, two-bone IK, web line geometry
│  │  └─ CameraRig.ts           FOV kick, bob, vignette, comfort options
│  ├─ game/
│  │  ├─ FlowMeter.ts
│  │  ├─ Scoring.ts             combo, events, point table
│  │  ├─ Progression.ts         ranks, XP, unlocks, style interpolation
│  │  ├─ Challenges.ts          the ~20-card pool
│  │  ├─ Beacons.ts             crime beacons (no AI — see §11)
│  │  ├─ Tokens.ts              spider-token placement + collection
│  │  └─ Ghost.ts               record + replay
│  ├─ render/
│  │  ├─ Renderer.ts            MRT setup, composer chain, quality tiers
│  │  ├─ ToonMaterial.ts        thresher bands + hatching
│  │  └─ passes/
│  │     ├─ OutlinePass.ts      sobel + line boil
│  │     ├─ HalftonePass.ts     per-channel rotated dot grids
│  │     ├─ CmykDofPass.ts      misprint depth-of-field
│  │     ├─ SpeedLinesPass.ts
│  │     ├─ GlitchPass.ts
│  │     └─ PaperPass.ts        grain, vignette, misregistration
│  ├─ audio/
│  │  ├─ AudioEngine.ts
│  │  ├─ Sfx.ts
│  │  └─ Music.ts               procedural loop, rank-driven tempo
│  ├─ ui/
│  │  ├─ Hud.ts
│  │  ├─ ComicText.ts           canvas → sprite onomatopoeia
│  │  ├─ Panels.ts              transitions, score page, rank-up
│  │  ├─ StartScreen.ts
│  │  └─ Options.ts
│  └─ debug/
│     └─ TuningPanel.ts
└─ desktop/
   ├─ main.js                   ~40-line Electron wrapper over dist/
   └─ package.json
```

---

## 10. THE TUNING PANEL

Backtick toggles a live panel. Every constant in §3, §4 and §5 is a labelled slider that updates **immediately, with no reload**. Group by section. Include:

- A **"Copy values as TypeScript"** button that dumps the current state to clipboard as a paste-ready constants block.
- A **"Reset to defaults"** button.
- A live readout: FPS, draw calls, triangles, active tethers, current speed, flow, combo.
- Persist the panel's values to localStorage so tuning survives a reload.

This is how the game gets tuned after you hand it over, without another build pass. Treat it as a shipped feature, not debug scaffolding.

---

## 11. CRIME BEACONS — deliberately scoped

Street-level beacons pulse below you. Dive in, venom-blast the cluster, launch back out.

**Explicitly do NOT build:** enemy AI, pathfinding, navmesh, melee combat, health bars, enemy animation, ragdolls.

**Do build:** a glowing marker at street level with a comic "!" indicator, a proximity trigger, a single satisfying resolution burst (venom AoE + screen flash + KRAKK + chunky particle spray), a score/flow award, and a "PERFECT SAVE" bonus if you never touched the ground.

This delivers the descent, the risk, the venom-blast payoff, and a reason to look down — at maybe 5% of the cost of real combat. Resist the urge to expand it.

---

## 12. BUILD PHASES & GATES

Build in this order. **After each phase: run the game, verify the gate, and only then continue.**

### How to verify
You have Chrome DevTools MCP tools available — use them at every gate:
1. `npm run dev`, then `new_page` / `navigate_page` to the local URL
2. `take_screenshot` and **actually look at the image** — does it match the intent?
3. `list_console_messages` — zero errors, zero warnings you introduced
4. `evaluate_script` against a `window.__game` debug handle you expose from the start

Expose `window.__game` in dev with: `state`, `player` (position, velocity, tethers), `stats` (fps, drawCalls), and helper methods `teleport(x,y,z)`, `setRank(n)`, `forceSwing()`. Also support a `?test=<name>` URL param for deterministic scripted scenarios so you can verify physics without a human at the keyboard.

---

**PHASE 0 — Scaffold**
Vite + TS + Three, render loop, dt clamp, FPS counter, `window.__game`, click-to-start with pointer lock and audio init.
> **GATE:** Page loads. Pointer lock engages on click. 60fps. Console clean.

**PHASE 1 — City**
Seeded generator, five districts, instanced buildings, canvas facades, AABB grid, anchor grid. Free-fly camera for inspection.
> **GATE:** Screenshot shows a coherent city with distinct districts. **Draw calls < 80.** 60fps while flying. Same seed twice → pixel-identical screenshots.

**PHASE 2 — Swinging** ← *the phase that matters most*
Player body, web system, dual webs, auto-aim, reel, release boost, collision.
> **GATE:** Chain 8+ swings without touching ground. **Measure apex-to-apex — it must land in 1.2–2.0s.** No NaN in any position or velocity over a 60s scripted run. Dual-web slingshot produces a visible speed spike. Ground collision resolves without jitter or tunnelling.
> **Do not move on until this is genuinely fun.** Play it. Adjust. Play it again. This is the game.

**PHASE 3 — The look**
Toon materials, all six post passes, the full chain.
> **GATE:** Screenshot review — halftone dots clearly visible in shadow. CMYK colour split obvious on distant buildings. Outlines present and boiling. Speed lines appear above 28 m/s. Still 60fps at `high`. Compare your screenshot against the film's look and be honest about the gap.

**PHASE 4 — The loop**
Flow meter, scoring, combo, near-miss detection, tokens, timer, HUD, score page, instant retry.
> **GATE:** A full 90s run completes and scores. **`R` → swinging again in under 400ms.** Ground contact breaks combo but does NOT end the run. Flow hitting zero DOES end the run.

**PHASE 5 — Progression**
Ranks, XP, unlocks, challenge cards, and the stepped-framerate style interpolation.
> **GATE:** `__game.setRank(1)` vs `setRank(12)` produce visibly different screenshots — framerate, glitch, saturation, dot scale all shift. **Verify the camera and mouse-look are NOT stepped at rank 1.** Rank-up moment plays.

**PHASE 6 — Content**
Wall-run, web-zip, venom dash, camo glide, point-launch, crime beacons, ghost replay, daily seed.
> **GATE:** Every move works and is bound. All five districts reachable in a single run. Ghost records and replays. Daily seed is stable across reloads.

**PHASE 7 — Audio & juice**
Full synthesis, onomatopoeia, panel transitions, rank-up fanfare, procedural music.
> **GATE:** Every scoring event has a sound. Music loops seamlessly. Tempo shifts with rank. No clicks, pops, or audio-node leaks over a 5-minute session.

**PHASE 8 — Ship**
Quality tiers, options panel, tuning panel, mobile notice, README, Electron wrapper.
> **GATE:** `npm run build` clean, zero TS errors. Built `dist/` runs from a static file server. `low` tier holds 60fps with post at 0.6x. Options persist across reload. Electron wrapper opens the game.

---

## 13. DEFINITION OF DONE

- [ ] `npm i && npm run dev` works from a clean clone
- [ ] `npm run build` produces a working static `dist/`, **under 1.5MB gzipped**
- [ ] Deploys to Vercel with no configuration beyond framework detection
- [ ] Zero network requests after initial load — verify in the network panel
- [ ] Zero console errors across a full 5-minute session
- [ ] 60fps on `high` on Apple Silicon; 60fps on `low` on integrated graphics
- [ ] A stranger can click, understand the controls, and be swinging within 15 seconds
- [ ] Ten consecutive runs without a crash, softlock, NaN, or fall-through-world
- [ ] Restart is under 400ms
- [ ] Every constant in §3–§5 is live-tunable
- [ ] README covers running, deploying, tuning, and the Electron build

---

## 14. ANTI-PATTERNS — do not do these

- ❌ Any external asset, CDN import, font load, or runtime `fetch()`
- ❌ A physics engine dependency
- ❌ `OrbitControls`, `PointerLockControls`, or any Three.js example controls — write your own camera rig
- ❌ Gaussian-blur depth of field (it must be the CMYK misprint)
- ❌ Motion blur (speed lines instead — the film has none)
- ❌ Smooth diffuse lighting anywhere (bands only)
- ❌ Stepping the camera or input framerate (**animation and VFX only**)
- ❌ Killing the player on ground contact
- ❌ A loading screen longer than 3 seconds
- ❌ Shadow maps
- ❌ Per-building meshes instead of `InstancedMesh`
- ❌ Mesh raycasting for anchor search
- ❌ `TODO`, `FIXME`, placeholder art, stub functions, or "left as an exercise"
- ❌ `alert()`, `console.log` spam in the shipped build
- ❌ Marvel names, logos, or trademarked marks anywhere

---

## 15. THE BAR

When someone loads this, the first ten seconds should make them say *"holy shit."* The next ninety should make them press `R` before the score page finishes animating.

If you find yourself choosing between more features and a better swing — **choose the swing.**

Build it.
