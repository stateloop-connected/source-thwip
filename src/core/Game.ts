/**
 * The hub. Owns every subsystem, runs the state machine, and drives one
 * frame's worth of work in the correct order.
 *
 * Frame order is deliberate and must not be shuffled:
 *   look -> aim -> web input -> physics (substepped) -> camera -> animation
 *   (stepped) -> render
 *
 * Look, aim, physics and camera all run at the display rate. Only the
 * first-person rig samples the stepped animation clock.
 */

import * as THREE from 'three';
import { Renderer, tierForFrameMs } from '../render/Renderer';
import { PostChain } from '../render/PostChain';
import { Sky } from '../render/Sky';
import { Input } from './Input';
import { Save } from './Save';
import { T } from './Tuning';
import type { Loop } from './Loop';
import { FlyCamera } from '../debug/FlyCamera';
import { dailySeed, randomSeed, todayKey } from './Rng';
import { generateCity, type City } from '../world/CityGenerator';
import { PlayerBody } from '../player/PlayerBody';
import { CameraRig } from '../player/CameraRig';
import { FirstPersonRig } from '../player/FirstPersonRig';
import { makeReleaseResult, WebSystem, type Side } from '../player/WebSystem';
import { Moves } from '../player/Moves';
import { Hud } from '../ui/Hud';
import { Panels, type ScorePageData } from '../ui/Panels';
import { ComicText } from '../ui/ComicText';
import { TuningPanel } from '../debug/TuningPanel';
import { Options } from '../ui/Options';
import { AudioEngine } from '../audio/AudioEngine';
import { Sfx } from '../audio/Sfx';
import { Music } from '../audio/Music';
import { FlowMeter } from '../game/FlowMeter';
import { Scoring } from '../game/Scoring';
import { Tokens } from '../game/Tokens';
import { Ghost } from '../game/Ghost';
import { drawChallenges, evaluate, xpEarned, type Challenge } from '../game/Challenges';
import {
  hasMove,
  MAX_RANK,
  rankForXp,
  styleForRank,
  unlockAt,
  type MoveId,
} from '../game/Progression';
import { districtOf } from '../world/CityGenerator';
import { Rng } from './Rng';
import { SwingBot, SwingRecorder, type SwingReport } from '../debug/TestScenarios';

export type GameState = 'menu' | 'countdown' | 'run' | 'score' | 'paused' | 'rankup';
export type GameMode = 'play' | 'fly';

const eye = new THREE.Vector3();
const projected = new THREE.Vector3();
const axes = { x: 0, y: 0 };

function round(v: number, places = 1): number {
  const m = 10 ** places;
  return Math.round(v * m) / m;
}

export class Game {
  readonly renderer: Renderer;
  readonly post: PostChain;
  readonly sky = new Sky();
  readonly input: Input;
  readonly save: Save;
  readonly flyCam = new FlyCamera();

  readonly body = new PlayerBody();
  readonly rig = new CameraRig();
  readonly fpRig = new FirstPersonRig();
  readonly web = new WebSystem();
  readonly moves = new Moves();
  readonly hud: Hud;
  readonly panels: Panels;
  readonly shouts: ComicText;
  readonly tuner: TuningPanel;
  readonly options: Options;
  /** Created on the start click — AudioContext needs a user gesture. */
  audio: AudioEngine | null = null;
  sfx: Sfx | null = null;
  music: Music | null = null;
  readonly flow = new FlowMeter();
  readonly scoring = new Scoring();
  readonly ghost = new Ghost();
  tokens: Tokens | null = null;

  /** Seconds left in the current run. */
  runTime = 0;
  challenges: Challenge[] = [];

  /** Style values interpolated from rank; consumed by the shaders. */
  readonly style = { saturation: 0.62, glitch: 1, dotScale: 6.5, boil: 1, stepRate: 12 };

  city: City | null = null;
  state: GameState = 'menu';
  mode: GameMode = 'play';

  seed = 0;
  seedLabel = 'random';
  started = false;

  onStateChange: ((s: GameState) => void) | null = null;

  /** Scripted-scenario hooks. Null in normal play. */
  autoPilot: SwingBot | null = null;
  recorder: SwingRecorder | null = null;

  private release = makeReleaseResult();
  private clock = 0;
  private focusDist = 140;
  private impactGlitch = 0;
  private qualitySettled = false;
  private qualityClock = 0;
  private qualitySamples: number[] = [];
  /** Smoothed CPU-side render time in ms. Drives quality auto-detect. */
  lastRenderMs = 8;
  private nearMissCooldown = 0;
  private countdown = -1;
  private countdownClock = 0;
  /** Scales flow drain; the camo glide lowers it. */
  flowDrainScale = 1;
  /** Seconds of drain-free grace remaining at the start of a run. */
  private flowGrace = 0;
  /** Date key when the seed is a daily; drives the local leaderboard. */
  dateKeyForSeed: string | null = null;
  private rankUpTimer = 0;
  private hasCountedDown = false;
  private pendingScore: ScorePageData | null = null;
  private focusHit = {
    distance: 0,
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    index: -1,
  };

  /** Scenario-visible clock, so tests do not depend on wall time. */
  get elapsedForTests(): number {
    return this.clock;
  }

  get releaseScratch() {
    return this.release;
  }

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.renderer = new Renderer(canvas);
    this.post = new PostChain(this.renderer);
    this.renderer.scene.add(this.sky.mesh);
    this.input = new Input(canvas);
    this.save = new Save();
    this.hud = new Hud(ui);
    this.panels = new Panels(ui);
    this.shouts = new ComicText(ui);
    this.tuner = new TuningPanel(ui, this);
    this.options = new Options(ui, this.save, {
      onResume: () => this.resume(),
      onMenu: () => this.setState('menu'),
      onChange: () => {
        this.applyAudioSettings();
        if (this.save.settings.quality !== 'auto') {
          this.renderer.setQuality(this.save.settings.quality);
          this.qualitySettled = true;
        }
      },
    });
    this.post.buildDefaultChain();
    this.fpRig.attachTo(this.renderer.camera, this.renderer.scene);
    // The ghost outlives any one city: it is loaded per run, from the seed.
    this.renderer.scene.add(this.ghost.mesh);

    this.web.events = {
      onAttach: () => {
        this.recorder?.countAttach();
        this.scoring.countSwing();
        this.sfx?.thwip();
        if (this.state === 'run') this.shouts.pop('THWIP');
      },
      onRelease: (_side, result) => {
        this.recorder?.countRelease(result.pointLaunch);
        if (this.state !== 'run') return;
        if (result.pointLaunch) this.award('pointLaunch');
        if (result.slingshot) this.award('slingshot');
      },
    };

    this.scoring.onEvent = (type, result) => {
      if (result.points > 0) this.hud.pushFeed(result.label, result.points);
      if (this.state !== 'run') return;
      switch (type) {
        case 'groundContact':
          this.shouts.pop('WHUMP', { big: true });
          this.sfx?.impact(1);
          this.sfx?.comboBreak();
          break;
        case 'token':
          this.sfx?.token();
          break;
        case 'beacon':
          this.shouts.pop('KRAKK', { big: true });
          break;
        case 'pointLaunch':
        case 'slingshot':
          this.shouts.pop(result.shout);
          break;
        default:
          break;
      }
    };

    this.moves.onEvent = (e, at) => {
      if (e === 'arc') {
        this.sfx?.arc();
        this.shouts.pop('KRAKK', { big: true });
        void at;
      } else if (e === 'wallRunStart') {
        this.shouts.pop('SKRTT');
      }
    };

    // Any click on the canvas during play re-acquires pointer lock. Losing
    // it silently is the worst failure this game has: mouse-look dies, the
    // cursor escapes to the edge of the window, and the player cannot aim at
    // anything to their left or right. A click must always fix it.
    canvas.addEventListener('mousedown', () => {
      if (this.input.locked) return;
      if (this.state === 'run' || this.state === 'countdown') this.input.requestLock();
    });

    this.input.onLockChange = (locked) => {
      document.body.classList.toggle('unlocked', !locked);
      if (!locked && this.state === 'run') this.pause();
    };

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'run') this.pause();
        this.audio?.suspend();
      } else {
        this.audio?.resume();
      }
    });

    this.useSeed(dailySeed(), `daily ${todayKey()}`);
    this.applyRankStyle();
  }

  useSeed(seed: number, label: string): void {
    this.seed = seed >>> 0;
    this.seedLabel = label;
  }

  /**
   * Push the rank's style values into the renderer.
   *
   * This is the reward loop made visible: step rate, glitch, saturation, dot
   * scale and line boil all interpolate across the twelve ranks, so the world
   * resolves into focus as the player gets better at it.
   */
  applyRankStyle(): void {
    const s = styleForRank(this.save.data.rank);
    this.style.stepRate = s.stepRate;
    this.style.glitch = s.glitch;
    this.style.saturation = s.saturation;
    this.style.dotScale = s.dotScale;
    this.style.boil = s.boil;
  }

  /** Debug + progression entry point. Clamped to the twelve real ranks. */
  setRank(rank: number): void {
    this.save.data.rank = Math.max(1, Math.min(MAX_RANK, Math.round(rank)));
    this.applyRankStyle();
    this.save.save();
  }

  can(move: MoveId): boolean {
    return hasMove(this.save.data.rank, move);
  }

  /** Build the audio graph. Safe to call more than once. */
  initAudio(): void {
    if (this.audio) {
      this.audio.resume();
      return;
    }
    try {
      const engine = new AudioEngine();
      this.audio = engine;
      this.sfx = new Sfx(engine);
      this.music = new Music(engine);
      this.applyAudioSettings();
      this.music.setRank(this.save.data.rank);
      this.music.start();
    } catch {
      // No audio is survivable; a crash on the start click is not.
      this.audio = null;
    }
  }

  applyAudioSettings(): void {
    const s = this.save.settings;
    this.audio?.setMuted(s.muted, s.masterVolume);
    this.audio?.setMusicVolume(s.muted ? 0 : s.musicVolume);
  }

  /**
   * Award XP and, if it crosses a threshold, stop the world for the rank-up.
   * It has to be a moment: the panel slams in, the onomatopoeia lands, and
   * the new framerate visibly kicks in behind it.
   */
  grantXp(amount: number): boolean {
    const save = this.save.data;
    const before = save.rank;
    save.xp += amount;
    const after = rankForXp(save.xp);
    if (after <= before) {
      this.save.save();
      return false;
    }
    save.rank = after;
    this.applyRankStyle();
    this.save.save();

    this.sfx?.rankUp();
    this.audio?.duck(0.12, 1.6, this.save.settings.muted ? 0 : this.save.settings.musicVolume);
    this.music?.setRank(after);
    const unlock = unlockAt(after);
    this.shouts.pop(unlockAt(after)?.shout ?? 'SHARPER!', { big: true });
    this.panels.showRankUp(
      after,
      unlock?.shout ?? 'SHARPER!',
      unlock?.name ?? '',
      unlock?.detail ?? 'The world resolves a little further into focus.',
      this.style.stepRate
    );
    this.rankUpTimer = 3.6;
    this.setState('rankup');
    return true;
  }

  useRandomSeed(): void {
    this.useSeed(randomSeed(), 'random');
  }

  /** Generate (or regenerate) the world. Safe to call between runs. */
  buildCity(): City {
    if (this.city) {
      this.renderer.scene.remove(this.city.group);
      this.city.dispose();
    }
    const city = generateCity(this.seed);
    this.renderer.scene.add(city.group);
    this.city = city;

    this.tokens?.dispose();
    this.tokens = new Tokens(new Rng(this.seed ^ 0x5bf03635), city.collision);
    this.renderer.scene.add(this.tokens.mesh);

    this.flyCam.position.copy(city.spawn);
    this.renderer.camera.position.copy(city.spawn);
    return city;
  }

  setState(next: GameState): void {
    if (this.state === next) return;
    this.state = next;
    this.onStateChange?.(next);
    if (next === 'run' || next === 'countdown') this.hud.show();
    else if (next === 'menu' || next === 'score') this.hud.hide();
    // Retiring the 3-2-1 card belongs here, not in updateCountdown. Three
    // paths reach 'run' without ever ticking the countdown — startAutoDemo,
    // simulate, and begin() outside play mode — and each one used to leave
    // the card parked over the viewport for the rest of the session.
    if (next === 'run') this.panels.hideCount();
    if (next === 'menu') {
      this.panels.hideAll();
      this.options.hide();
      this.shouts.clear();
    }
    if (next !== 'paused') this.options.hide();
  }

  /** Called from the start overlay's click — the one real user gesture. */
  begin(): void {
    this.started = true;
    // The one real user gesture: both pointer lock and the AudioContext need
    // to be created from inside it.
    this.initAudio();
    this.input.requestLock();
    if (this.mode === 'play') this.startRun();
    else this.setState('run');
  }

  /**
   * Reset everything and drop straight into the countdown.
   *
   * This is the path `R` takes, so it must stay cheap — the city is NOT
   * rebuilt, because regenerating 1400 buildings is what would blow the
   * 400ms restart budget.
   */
  startRun(): void {
    const city = this.city ?? this.buildCity();
    this.web.releaseAll();
    this.body.reset(city.spawn);
    // Face the heart of downtown, then sweep for a heading that actually has
    // something webbable under the crosshair. A first-timer who opens on an
    // empty sky reads "this is broken", and they are falling while they work
    // it out.
    this.rig.reset(Math.atan2(city.spawn.x, city.spawn.z) + Math.PI, -0.16);
    this.aimAtSomethingWebbable(city);
    this.body.velocity.set(0, -4, 0);
    this.body.velocity.addScaledVector(this.rig.forward, 13);
    this.body.velocity.y = -4;

    this.flow.reset();
    this.scoring.reset();
    this.moves.reset();
    this.tokens?.reset();
    this.ghost.begin(this.save.data, this.seed);
    city.beaconSystem.reset();
    this.hud.clearFeed();
    this.panels.hideAll();
    this.runTime = T.runDuration;
    // Long enough to cover the opening drop, so a player who takes a beat to
    // read the controls still arrives with a full meter and a way back up.
    this.flowGrace = 3.2;
    this.challenges = drawChallenges(new Rng((this.seed ^ Date.now()) >>> 0));
    this.nearMissCooldown = 0;
    // The 3-2-1 panel is an opening flourish, not a tax on every retry.
    // Running it on `R` put restart at ~2.5s against a 400ms budget, in a
    // loop explicitly designed around dozens of retries.
    if (this.hasCountedDown) {
      this.countdown = -1;
      this.countdownClock = 0;
      this.setState('run');
      return;
    }
    this.hasCountedDown = true;
    this.countdown = 3;
    this.countdownClock = 0;
    this.panels.showCount('3');
    this.setState('countdown');
  }

  /**
   * Rotate the opening view until a thwip would connect.
   *
   * Cheap brute force over a handful of headings and pitches, run once per
   * run start. Guarantees the very first thing the player sees is a valid
   * target with the crosshair already lit.
   */
  private aimAtSomethingWebbable(city: City): void {
    const baseYaw = this.rig.yaw;
    let bestYaw = baseYaw;
    let bestPitch = -0.16;
    let bestDist = Infinity;

    for (let y = 0; y < 12; y++) {
      for (const pitch of [-0.05, -0.18, -0.32, -0.48]) {
        this.rig.yaw = baseYaw + (y / 12) * Math.PI * 2;
        this.rig.pitch = pitch;
        this.rig.applyOrientation();
        this.body.eye(eye);
        this.web.updateAim(eye, this.rig.forward, city);
        // Prefer a mid-range target: too close is a jolt, too far is a
        // slow first arc.
        if (this.web.aimValid && this.web.aimDistance > 18) {
          const score = Math.abs(this.web.aimDistance - 46);
          if (score < bestDist) {
            bestDist = score;
            bestYaw = this.rig.yaw;
            bestPitch = pitch;
          }
        }
      }
    }
    this.rig.yaw = bestYaw;
    this.rig.pitch = bestPitch;
    this.rig.applyOrientation();
  }

  /** 3-2-1-GO, then the run. Physics is frozen until GO. */
  private updateCountdown(loop: Loop): void {
    this.countdownClock += loop.dt;
    const step = 0.62;
    const index = Math.floor(this.countdownClock / step);
    const label = index === 0 ? '3' : index === 1 ? '2' : index === 2 ? '1' : 'GO!';
    if (index !== this.countdown) {
      this.countdown = index;
      this.panels.showCount(label);
    }
    if (this.countdownClock >= step * 4) this.setState('run');
    // Keep looking around during the countdown: it reads as alive, and it
    // lets the player pick their first web before the clock starts.
    this.rig.look(this.input, this.save.settings);
    this.rig.update(loop.dt, this.body, this.save.settings, this.renderer.camera);
  }

  endRun(reason: 'time' | 'flow'): void {
    if (this.state !== 'run') return;
    this.web.releaseAll();
    this.hud.hide();

    const stats = this.scoring.stats;
    const results = evaluate(this.challenges, stats);
    const xp = xpEarned(results);
    const save = this.save.data;

    const isBest = stats.score > save.bestScore;
    if (isBest) save.bestScore = stats.score;
    if (stats.bestCombo > save.bestCombo) save.bestCombo = stats.bestCombo;
    if (stats.topSpeedMs > save.bestSpeedMs) save.bestSpeedMs = stats.topSpeedMs;
    if (stats.longestChain > save.bestChain) save.bestChain = stats.longestChain;
    save.runs++;
    save.totalDistance += stats.distance;
    for (const r of results) {
      if (r.done && !save.challengesDone.includes(r.challenge.id)) {
        save.challengesDone.push(r.challenge.id);
      }
    }
    this.ghost.commit(save, this.seed, stats.score);
    const place = this.dateKeyForSeed
      ? this.save.recordDaily(this.dateKeyForSeed, stats.score, save.rank)
      : 0;
    this.save.save();

    this.pendingScore = {
      stats,
      challenges: results,
      xpEarned: xp,
      isBest,
      bestScore: save.bestScore,
      rank: save.rank,
      seedLabel: this.seedLabel,
      dailyPlace: place,
    };

    // Rank-up takes the stage first; the score page waits behind it.
    if (!this.grantXp(xp)) this.showScorePage();
    void reason;
  }

  private showScorePage(): void {
    if (!this.pendingScore) return;
    this.pendingScore.rank = this.save.data.rank;
    this.panels.showScore(
      this.pendingScore,
      () => this.startRun(),
      () => this.setState('menu')
    );
    this.setState('score');
  }

  pause(): void {
    if (this.state !== 'run') return;
    this.setState('paused');
    this.options.show();
    this.input.releaseLock();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.options.hide();
    this.setState('run');
    this.input.requestLock();
  }

  update(loop: Loop): void {
    this.input.pollGamepad();
    loop.animStepRate = this.style.stepRate;
    this.autoDetectQuality(loop);

    // Backtick toggles the tuning panel from any state.
    if (this.input.justPressed('tuning')) {
      this.tuner.toggle();
      if (this.tuner.isOpen) this.input.releaseLock();
    }
    this.tuner.update(loop.fps);

    if (this.state === 'paused') {
      if (this.input.justPressed('pause') && !this.input.lockCoolingDown) this.resume();
    } else if (this.state === 'countdown') {
      this.updateCountdown(loop);
    } else if (this.state === 'score') {
      // R restarts from the score page with no menu, no fade, no reload.
      if (this.input.justPressed('restart')) this.startRun();
    } else if (this.state === 'rankup') {
      this.rankUpTimer -= loop.dt;
      if (this.rankUpTimer <= 0 || this.input.justPressed('jump')) {
        this.panels.hideRankUp();
        this.showScorePage();
      }
    } else if (this.state === 'run') {
      if (this.input.justPressed('pause')) this.pause();
      else if (this.mode === 'fly') this.flyCam.update(loop.dt, this.input, this.renderer.camera);
      else this.updatePlay(loop);
    }

    this.render(loop);
    this.input.endFrame();
  }

  private updatePlay(loop: Loop): void {
    const city = this.city;
    if (!city) return;
    const dt = loop.dt;
    const body = this.body;
    const web = this.web;

    this.clock += dt;

    // 1. Look. Full display rate, always, no exceptions.
    this.rig.look(this.input, this.save.settings);

    if (this.autoPilot) {
      // Scripted scenario: the bot supplies look, movement and web actions.
      this.autoPilot.drive(this, dt);
    } else {
      // 2. Movement intent in the camera's horizontal frame.
      this.input.moveAxes(axes);
      body.moveInput.set(axes.x, axes.y);
      this.rig.flatForward(body.forward);
      body.right.copy(this.rig.right);

      // 3. Where would a web land right now?
      body.eye(eye);
      web.updateAim(eye, this.rig.forward, city);

      // 4. Web input.
      if (this.input.mouseLeftPressed) this.thwip('left');
      if (this.input.mouseLeftReleased) web.release('left', body, this.clock, this.release);
      if (this.input.mouseRightPressed) this.thwip('right');
      if (this.input.mouseRightReleased) web.release('right', body, this.clock, this.release);

      if (this.input.justPressed('jump')) {
        // Web-zip is rank 5. Below that, Space is just a jump.
        if (web.anyActive && this.can('webZip')) web.zip(body);
        else if (body.grounded) {
          // A standing jump from a 9.5 m/s impulse peaks at 1.9m and buys
          // 0.8s of air, which is not enough to find and reach a rooftop
          // before the grounded drain finishes you. The escape jump is
          // deliberately superhuman: getting off the street is the recovery,
          // not the reward.
          body.velocity.y = T.jumpImpulse * 1.9;
          this.sfx?.impact(0.5);
        }
      }
      if (this.input.justPressed('arc')) {
        if (this.moves.arcDash(body, this.rig.forward, this.can('arcDash'))) {
          this.rig.shake(0.9, 0.3);
          this.punchGlitch(0.9);
          this.resolveBeaconsNear(body.position);
        }
      }
      this.moves.setCamo(this.input.down('camo'), this.can('camoGlide'));
      if (this.input.justPressed('restart')) this.startRun();
    }

    // Wall-run wants the raw forward key, not the blended movement axes.
    this.moves.updateWallRun(dt, body, this.input.down('forward'), this.can('wallRun'));
    this.moves.update(dt, body);
    this.flowDrainScale = this.moves.flowDrainScale;
    this.fpRig.camo = this.moves.camoActive ? 1 : 0;

    // 5. Physics. Substepped: the constraint needs it to stay stable.
    const steps = Math.max(1, Math.min(12, Math.round(T.substeps)));
    const h = dt / steps;
    const reeling = this.input.down('reel') || (this.autoPilot?.reeling ?? false);
    web.bindBody(body);
    body.beginFrame();
    for (let i = 0; i < steps; i++) {
      body.integrate(h, web.anyActive);
      if (reeling) web.reel(h);
      web.constrain(body, h, city);
      body.collide(city.collision, h);
      // Reel and the constraint's energy recovery both run AFTER integrate's
      // clamp, so the cap has to be re-applied at the end of the substep or
      // it is not a hard clamp at all.
      body.clampSpeed();
    }

    // 6. Camera follows the resolved body position.
    this.rig.update(dt, body, this.save.settings, this.renderer.camera);

    // 7. Animation, on the stepped clock.
    this.fpRig.setStyle(this.style.saturation);
    this.fpRig.update(
      dt,
      loop.animFrameIndex,
      this.renderer.camera,
      body,
      [web.left, web.right],
      true
    );

    // 8. The ghost of your best run on this city, recorded and raced on the
    // real clock; only its pose steps.
    this.ghost.record(dt, body.position);
    this.ghost.setStyle(
      this.style.saturation,
      // Printed at the same dot cell the post chain prints the rest of the
      // frame at, so the ghost stays on the same page at every quality tier.
      this.style.dotScale * this.renderer.pixelRatio * this.renderer.preset.postScale
    );
    this.ghost.update(dt, loop.animFrameIndex, this.save.settings.showGhost);

    // 9. The loop: clock, flow, scoring, pickups.
    //
    // This runs for the autopilot too. Skipping it meant every scripted
    // verification ran with the flow meter, the timer and all scoring
    // switched off — so the harness reported a healthy game while a real
    // player was dying six seconds into a run. A rig that does not exercise
    // the thing it is measuring is worse than no rig.
    this.updateRunState(dt, city);

    this.hud.setSpeed(body.speedMph);
    this.hud.setCrosshair(web.anyActive ? 'attached' : web.aimValid ? 'ready' : 'none');

    // Wind is the primary velocity cue; tension tracks how hard the rope is
    // actually working, which is the distance overshoot on the constraint.
    if (this.sfx) {
      let tension = 0;
      for (const t of [web.left, web.right]) {
        if (!t.active) continue;
        const over = body.position.distanceTo(t.anchor) - t.length;
        tension = Math.max(tension, Math.min(1, Math.max(0, over) * 0.9 + body.speed / 90));
      }
      this.sfx.updateContinuous(body.speed / Math.max(1, T.maxSpeed), tension);
    }

    this.recorder?.sample(this, dt, this.clock);
  }

  /**
   * Everything that turns swinging into a run: the clock, the draining flow
   * meter, near-miss detection, pickups, and the two ways a run can end.
   */
  private updateRunState(dt: number, city: City): void {
    const body = this.body;

    this.runTime -= dt;
    this.scoring.update(dt);

    // A short grace window at the start of a run. Without it the opening
    // drop is pure loss: the player spends it falling, arrives at street
    // level already low, and a first-timer is dead before they have worked
    // out which button throws a web.
    this.flowGrace = Math.max(0, this.flowGrace - dt);
    if (this.flowGrace <= 0) this.flow.update(dt, body.grounded, this.flowDrainScale);
    this.scoring.sampleBody(body.speed, dt, !body.grounded, body.distance);
    this.scoring.noteDistrict(districtOf(body.position.x, body.position.z));

    // Ground contact: costs flow and shatters the combo. Never a death.
    if (body.justLanded) {
      this.award('groundContact');
      this.rig.shake(0.5, 0.22);
      this.punchGlitch(0.5);
    }

    // Near-miss: skimming geometry at speed. Cooldown keeps a single close
    // pass from paying out sixty times in a second.
    this.nearMissCooldown = Math.max(0, this.nearMissCooldown - dt);
    if (!body.grounded && body.speed > T.nearMissMinSpeed && this.nearMissCooldown <= 0) {
      const d = city.collision.nearestSurface(
        body.position.x,
        body.position.y,
        body.position.z,
        T.nearMissRadius
      );
      if (d < T.nearMissRadius) {
        this.award('nearMiss');
        this.nearMissCooldown = 0.42;
      }
    }

    const picked = this.tokens?.update(dt, 0, body.position, this.style.saturation) ?? 0;
    for (let i = 0; i < picked; i++) this.award('token');

    this.hud.setTimer(this.runTime);
    this.hud.setFlow(this.flow.display, this.flow.critical);
    this.hud.setCombo(this.scoring.combo, this.scoring.comboPulse);

    // Two ways out, and only one of them is a failure.
    //
    // Empty flow only ends the run once you are back ON THE GROUND. Cutting
    // a player off mid-arc feels arbitrary and unearned — the meter running
    // out while you are still flying should be a warning, not a verdict. It
    // also means a great save can rescue a dead run, which is the moment
    // worth playing for.
    if (this.flow.empty && body.grounded) this.endRun('flow');
    else if (this.runTime <= 0) this.endRun('time');
  }

  private award(type: Parameters<Scoring['award']>[0], scale = 1): void {
    this.scoring.award(type, this.flow, scale);
  }

  /**
   * Arc AoE against street-level beacons.
   *
   * Deliberately scoped per the spec: no enemies, no AI, no health. A beacon
   * is a marker with a radius, and resolving it is one burst and one payout.
   */
  private resolveBeaconsNear(at: THREE.Vector3): void {
    const city = this.city;
    if (!city) return;
    let hit = 0;
    for (const b of city.beacons) {
      if (b.resolved) continue;
      if (b.position.distanceTo(at) > T.arcRadius) continue;
      b.resolved = true;
      b.flash = 1;
      hit++;
      this.award('beacon');
      // Never touched the ground this run: that is the perfect save.
      if (this.scoring.stats.groundContacts === 0) this.award('perfectSave');
    }
    if (hit > 0) city.refreshBeacons();
  }

  /**
   * Run the play loop without rendering, at a fixed timestep.
   *
   * Lets a scripted scenario verify sixty seconds of physics in a fraction of
   * a second, and keeps the result independent of the display's refresh rate.
   */
  simulate(
    seconds: number,
    dt = 1 / 60,
    trace?: Array<Record<string, number | boolean>>,
    traceEvery = 12
  ): SwingReport | null {
    if (!this.city) this.buildCity();
    const bot = new SwingBot();
    const recorder = new SwingRecorder();
    const prevPilot = this.autoPilot;
    const prevRecorder = this.recorder;
    const prevState = this.state;

    this.startRun();
    // Drop straight into 'run'. Left in 'countdown', scoring events are
    // suppressed and endRun can never fire, so every scripted run "survived"
    // its full duration with a score of zero regardless of what happened.
    this.setState('run');
    this.autoPilot = bot;
    this.recorder = recorder;
    recorder.reset();

    const fakeLoop = {
      dt,
      elapsed: 0,
      animFrameIndex: 0,
      animStepRate: this.style.stepRate,
    } as unknown as Loop;

    const frames = Math.round(seconds / dt);
    for (let i = 0; i < frames; i++) {
      (fakeLoop as { elapsed: number }).elapsed += dt;
      (fakeLoop as { animFrameIndex: number }).animFrameIndex = Math.floor(
        (fakeLoop as { elapsed: number }).elapsed * this.style.stepRate
      );
      this.updatePlay(fakeLoop);
      if (trace && i % traceEvery === 0) {
        trace.push({
          f: i,
          y: round(this.body.position.y),
          sp: round(this.body.speed),
          vy: round(this.body.velocity.y),
          aim: this.web.aimValid,
          aimD: round(this.web.aimDistance),
          tether: this.web.left.active,
          len: round(this.web.left.length),
          apex: round(this.web.left.apexTimer, 3),
          ground: this.body.grounded,
        });
      }
    }

    this.autoPilot = prevPilot;
    this.recorder = prevRecorder;
    this.state = prevState;
    return recorder.finish();
  }

  private thwip(side: Side): void {
    // Must be the run clock, not loop.elapsed. Release reads this.clock, and
    // mixing the two made every dual-web timing comparison compare seconds
    // since page load against seconds since the run started.
    this.web.attach(side, this.body, this.clock);
  }

  private render(loop: Loop): void {
    const r = this.renderer;
    const t0 = performance.now();
    r.beginFrame();
    this.sky.update(r.camera, loop.elapsed, this.style.saturation);
    this.syncWorldUniforms(loop);
    this.syncPost(loop);
    this.post.renderScene(r.scene, r.camera);
    r.markSceneDrawCalls();
    this.post.compose();
    r.readStats();
    // Work done, not time elapsed. See tierForFrameMs.
    this.lastRenderMs = this.lastRenderMs * 0.85 + (performance.now() - t0) * 0.15;
  }

  /**
   * Drive the post chain. Focus follows what the player is looking at,
   * smoothed, and the speed lines radiate from where the body is actually
   * heading rather than from the middle of the screen.
   */
  private syncPost(loop: Loop): void {
    const cam = this.renderer.camera;
    const city = this.city;
    const preset = this.renderer.preset;

    // Focus distance: raycast down the crosshair, smoothed over ~0.3s so the
    // separations breathe instead of snapping every time an edge crosses.
    let targetFocus = 140;
    if (city) {
      const hit = city.collision.raycast(cam.position, this.rig.forward, 900, this.focusHit);
      targetFocus = hit ? this.focusHit.distance : 420;
    }
    const k = 1 - Math.exp(-3.3 * loop.dt);
    this.focusDist += (targetFocus - this.focusDist) * k;

    // Screen-space origin of travel.
    const speed = this.body.speed;
    let ox = 0.5;
    let oy = 0.5;
    if (speed > 1) {
      projected.copy(this.body.velocity).multiplyScalar(1 / speed).multiplyScalar(40).add(cam.position);
      projected.project(cam);
      ox = THREE.MathUtils.clamp(projected.x * 0.5 + 0.5, -0.6, 1.6);
      oy = THREE.MathUtils.clamp(projected.y * 0.5 + 0.5, -0.6, 1.6);
    }

    const lineAmount = THREE.MathUtils.clamp(
      (speed - T.speedLinesAt) / Math.max(1, T.maxSpeed - T.speedLinesAt),
      0,
      1
    );

    this.impactGlitch = Math.max(0, this.impactGlitch - loop.dt * 2.2);

    this.post.sync({
      time: loop.elapsed,
      animFrame: loop.animFrameIndex,
      near: cam.near,
      far: cam.far,
      dotScale: this.style.dotScale,
      boil: this.style.boil,
      glitch: this.style.glitch,
      saturation: 1,
      impact: this.impactGlitch,
      focusDist: this.focusDist,
      speed: lineAmount,
      speedOriginX: ox,
      speedOriginY: oy,
      speedVignette: this.rig.speedVignette,
      outlineEnabled: preset.outline,
      speedLineDensity: preset.speedLineDensity * this.save.settings.speedLineIntensity,
    });
  }

  /** Fire a one-shot glitch burst. Impacts and arc blasts only. */
  punchGlitch(amount = 0.7): void {
    this.impactGlitch = Math.max(this.impactGlitch, amount);
  }

  /**
   * Sample real frame time for the first few seconds of play and settle on a
   * quality tier. Skipped entirely when the player has pinned a tier by hand.
   */
  private autoDetectQuality(loop: Loop): void {
    if (this.qualitySettled) return;
    const pref = this.save.settings.quality;
    if (pref !== 'auto') {
      this.renderer.setQuality(pref);
      this.qualitySettled = true;
      return;
    }
    if (this.state !== 'run') return;

    // Ignore the first half second: shader compiles and the first city upload
    // land there and would drag every machine down to 'low'.
    this.qualityClock += loop.dt;
    if (this.qualityClock < 0.5) return;
    this.qualitySamples.push(this.lastRenderMs);
    if (this.qualityClock < 3) return;

    const sorted = this.qualitySamples.sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 16.7;
    const tier = tierForFrameMs(median);
    this.renderer.setQuality(tier);
    this.qualitySettled = true;
  }

  /** Push camera position, style and draw distance into the world shaders. */
  private syncWorldUniforms(loop: Loop): void {
    const city = this.city;
    if (!city) return;
    const cam = this.renderer.camera.position;
    // Haze has to swallow the edge of a 1.2km playfield well before the far
    // plane, or the city visibly stops. Tie it to the world, not the frustum.
    const fogNear = 230;
    const fogFar = Math.min(1150, this.renderer.preset.drawDistance * 0.62);

    const u = city.material.uniforms;
    (u.uCameraPos.value as THREE.Vector3).copy(cam);
    u.uSaturation.value = this.style.saturation;
    u.uHatching.value = this.renderer.preset.hatching ? 1 : 0;
    u.uFogNear.value = fogNear;
    u.uFogFar.value = fogFar;

    // Street level hazes out sooner than the skyline does: past the edge of
    // the playfield there is nothing but empty road, and it must not be seen.
    for (const mat of [city.ground.groundMaterial, city.ground.waterMaterial]) {
      const g = mat.uniforms;
      (g.uCameraPos.value as THREE.Vector3).copy(cam);
      g.uSaturation.value = this.style.saturation;
      g.uFogNear.value = fogNear * 0.7;
      g.uFogFar.value = fogFar * 0.72;
    }
    city.ground.waterMaterial.uniforms.uTime.value = loop.elapsed;
    city.cranes.update(loop.dt, city.anchors);
    city.beaconSystem.update(loop.dt, loop.elapsed);
  }

  // -- debug surface ---------------------------------------------------------

  teleport(x: number, y: number, z: number): void {
    this.flyCam.position.set(x, y, z);
    this.body.position.set(x, y, z);
    this.body.velocity.set(0, 0, 0);
    this.renderer.camera.position.set(x, y, z);
  }

  /**
   * Hand the controls to the autopilot and let it play LIVE, on screen.
   *
   * `simulate()` is headless and renders nothing, so it is useless for
   * watching. This drives the same bot through the real frame loop.
   */
  startAutoDemo(): void {
    this.autoPilot = new SwingBot();
    this.recorder = null;
    if (!this.city) this.buildCity();
    this.startRun();
    this.setState('run');
  }

  stopAutoDemo(): void {
    this.autoPilot = null;
  }

  /** Fire a web straight at the best anchor, for scripted verification. */
  forceSwing(side: Side = 'left'): boolean {
    const city = this.city;
    if (!city) return false;
    this.body.eye(eye);
    this.web.updateAim(eye, this.rig.forward, city);
    return this.web.attach(side, this.body, performance.now() / 1000);
  }

  cameraPosition(): THREE.Vector3 {
    return this.renderer.camera.position;
  }

  dispose(): void {
    this.ghost.dispose();
    this.fpRig.dispose();
    this.hud.dispose();
    this.city?.dispose();
    this.input.dispose();
    this.renderer.dispose();
  }
}
