/**
 * Deterministic scripted scenarios, reachable with ?test=<name>.
 *
 * The point is to be able to answer "does the swing actually work" without a
 * human at the keyboard: the bot flies the character, and the recorder
 * measures the numbers the phase-2 gate asks for — apex-to-apex cadence,
 * chained swings, ground contacts, and whether anything ever goes NaN.
 */

import * as THREE from 'three';
import type { Game } from '../core/Game';

export interface SwingReport {
  seconds: number;
  frames: number;
  swings: number;
  releases: number;
  pointLaunches: number;
  groundContacts: number;
  longestChain: number;
  apexIntervals: number[];
  apexMean: number;
  apexMedian: number;
  /**
   * Time between consecutive web attachments — the rhythm the player
   * actually feels. Apex intervals alone are misleading: when a swing does
   * not complete its arc, consecutive recorded apexes span several cycles.
   */
  cycleIntervals: number[];
  cycleMedian: number;
  /** Fraction of swings that reached an apex before release. */
  apexCompletion: number;
  /** Percent of apex intervals inside the spec's 1.2-2.0s window. */
  apexInWindowPct: number;
  apexP25: number;
  apexP75: number;
  minSpeed: number;
  maxSpeed: number;
  meanSpeed: number;
  nanFrames: number;
  belowGroundFrames: number;
  tetherLengthMin: number;
}

const dir = new THREE.Vector3();
const toAnchor = new THREE.Vector3();
const target = new THREE.Vector3();
const candidates: number[] = [];

/**
 * An autopilot that swings the way the game wants to be played: web something
 * AHEAD of you and above, ride it down through the low point, let go near the
 * apex with your momentum pointing at the next building.
 *
 * The anchor-ahead rule is the whole thing. Webbing whatever happens to be
 * overhead produces a pendulum that hangs and stops, which is what the first
 * version of this bot did, and it made the swing look far worse than it is.
 */
export class SwingBot {
  enabled = true;
  /** Set each frame; the play loop reads it in place of the reel key. */
  reeling = false;
  private cooldown = 0;
  private held = 0;
  private wasGrounded = false;

  /** Runs inside the play update, after look and before physics. */
  drive(game: Game, dt: number): void {
    const body = game.body;
    const web = game.web;
    const city = game.city;
    if (!city) return;

    this.cooldown = Math.max(0, this.cooldown - dt);

    // Heading: where we are actually travelling, flattened.
    dir.copy(body.velocity);
    dir.y = 0;
    if (dir.lengthSq() < 1) dir.set(0, 0, -1);
    dir.normalize();

    const hasTarget = web.left.active ? false : this.pickAnchor(game, target);

    let targetYaw = Math.atan2(-dir.x, -dir.z);
    let targetPitch = 0.1;
    if (hasTarget) {
      toAnchor.subVectors(target, body.position);
      targetYaw = Math.atan2(-toAnchor.x, -toAnchor.z);
      targetPitch = Math.atan2(toAnchor.y, Math.hypot(toAnchor.x, toAnchor.z));
      targetPitch = Math.max(-0.4, Math.min(0.9, targetPitch));
    }

    // Snap fairly hard: a slow turn means the anchor drifts out of the 14
    // degree attach cone before the throw lands.
    const k = 1 - Math.exp(-16 * dt);
    game.rig.yaw = angleLerp(game.rig.yaw, targetYaw, k);
    game.rig.pitch += (targetPitch - game.rig.pitch) * k;
    game.rig.applyOrientation();

    body.moveInput.set(0, 1);
    game.rig.flatForward(body.forward);
    body.right.copy(game.rig.right);

    // Ground recovery. Without it a single touchdown ends the run: the bot
    // jogs along the street forever because every anchor is above the cone.
    if (body.grounded) {
      // Exactly the escape jump a human gets from SPACE, once per landing --
      // not the continuous levitation this used to apply, which hid the fact
      // that a real player could not get off the street at all.
      if (!this.wasGrounded) body.velocity.y = Math.max(body.velocity.y, 9.5 * 1.9);
      this.wasGrounded = true;
      if (web.left.active) {
        web.release('left', body, game.elapsedForTests, game.releaseScratch);
        this.held = 0;
      }
    } else {
      this.wasGrounded = false;
    }

    body.eye(toAnchor);
    web.updateAim(toAnchor, game.rig.forward, city);

    if (web.left.active) {
      this.held += dt;
      // Reel for the whole arc, not just the descent. Shortening a swinging
      // tether raises angular speed for free, which is what turns a long
      // floaty arc into one that completes inside the target cadence.
      this.reeling = web.left.length > 20;

      const stalled = body.speed < 7 && this.held > 0.6;
      // Release technique is altitude-adaptive, the way a real player's is.
      // High up, let go as soon as momentum turns upward: that keeps the
      // cycle short and the speed high. Low down, ride the arc all the way
      // to the apex to buy height back, or you sink to street level and stay
      // there.
      const wantsHeight = body.position.y < this.floorTarget(game);
      const onTheRise =
        !wantsHeight && web.left.hasDescended && body.velocity.y > 3 && this.held > 0.95;
      if (web.left.apexTimer > 0 || onTheRise || stalled || this.held > 3.5) {
        web.release('left', body, game.elapsedForTests, game.releaseScratch);
        this.held = 0;
        this.reeling = false;
        this.cooldown = 0.05;
      }
    } else {
      this.reeling = false;
      if (this.cooldown <= 0 && hasTarget && web.aimValid) {
        const d = web.aimDistance;
        if (d > 12 && d < 70) {
          web.attach('left', body, game.elapsedForTests);
          this.held = 0;
        }
      }
    }
  }

  /** Altitude the bot tries to stay above: roughly rooftop height locally. */
  private floorTarget(game: Game): number {
    const city = game.city;
    if (!city) return 50;
    const b = game.body.position;
    return Math.max(38, city.collision.heightAt(b.x, b.z) + 34);
  }

  /**
   * Score nearby anchors for swing quality rather than for crosshair
   * proximity: ahead of the current heading, comfortably above, and at a
   * distance that gives a tight arc rather than a long slow one.
   */
  private pickAnchor(game: Game, out: THREE.Vector3): boolean {
    const city = game.city;
    if (!city) return false;
    const body = game.body;
    const anchors = city.anchors;
    body.eye(toAnchor);
    const n = anchors.collect(toAnchor, 78, candidates);
    if (n === 0) return false;

    let best = -Infinity;
    let bestIndex = -1;
    for (let c = 0; c < n; c++) {
      const i = candidates[c];
      const dx = anchors.x(i) - toAnchor.x;
      const dy = anchors.y(i) - toAnchor.y;
      const dz = anchors.z(i) - toAnchor.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz < 10) continue; // directly overhead: a pendulum that hangs
      const dist = Math.hypot(horiz, dy);
      if (dist < 16 || dist > 58) continue;

      // ahead of travel
      const ahead = (dx * dir.x + dz * dir.z) / Math.max(1e-3, horiz);
      if (ahead < 0.5) continue;
      // Above, but decisively more ahead than above. A steep anchor makes the
      // player fall *along* the rope instead of swinging around it, which is
      // what was stretching every arc past three seconds.
      if (dy < 5 || dy > 40 || horiz < dy * 1.2) continue;

      // Prefer a ~32m throw that leads the heading and sits a little above.
      const distScore = 1 - Math.abs(dist - 32) / 40;
      const riseScore = 1 - Math.abs(dy - 15) / 34;
      const score = ahead * 2.6 + distScore * 1.4 + riseScore * 0.9;
      if (score > best) {
        best = score;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) return false;
    out.set(anchors.x(bestIndex), anchors.y(bestIndex), anchors.z(bestIndex));
    return true;
  }
}

export class SwingRecorder {
  report: SwingReport = blank();
  private chain = 0;
  private lastApex = -1;
  private prevVy = 0;
  private tetherApexes = 0;
  private speedSum = 0;

  reset(): void {
    this.report = blank();
    this.chain = 0;
    this.lastApex = -1;
    this.prevVy = 0;
    this.tetherApexes = 0;
    this.speedSum = 0;
    this.lastAttach = -1;
    this.clock = 0;
  }

  sample(game: Game, dt: number, elapsed: number): void {
    const r = this.report;
    this.clock = elapsed;
    const body = game.body;
    const web = game.web;

    r.frames++;
    r.seconds += dt;

    const p = body.position;
    const v = body.velocity;
    if (!Number.isFinite(p.x + p.y + p.z + v.x + v.y + v.z)) r.nanFrames++;
    if (p.y < -20) r.belowGroundFrames++;

    const speed = body.speed;
    this.speedSum += speed;
    if (speed < r.minSpeed) r.minSpeed = speed;
    if (speed > r.maxSpeed) r.maxSpeed = speed;
    r.meanSpeed = this.speedSum / r.frames;

    if (body.justLanded) {
      r.groundContacts++;
      this.chain = 0;
    }

    for (const t of [web.left, web.right]) {
      if (t.active && t.length < r.tetherLengthMin) r.tetherLengthMin = t.length;
    }

    // Apex cadence, measured from the TRAJECTORY rather than from the
    // tether's apex flag. The flag only fires while a tether is still
    // attached, so releasing at or before the apex -- which is the whole
    // technique -- means it almost never fires, and the intervals it does
    // record span several swings. That measures the wrong thing and flatters
    // the result.
    const vy = body.velocity.y;
    if (!body.grounded && this.prevVy > 0 && vy <= 0) {
      if (this.lastApex >= 0) {
        const gap = elapsed - this.lastApex;
        if (gap > 0.15 && gap < 10) r.apexIntervals.push(Math.round(gap * 1000) / 1000);
      }
      this.lastApex = elapsed;
    }
    this.prevVy = vy;
    if (web.left.apexTimer > 0 || web.right.apexTimer > 0) this.tetherApexes++;
  }

  private lastAttach = -1;
  private clock = 0;

  countAttach(): void {
    this.report.swings++;
    this.chain++;
    if (this.chain > this.report.longestChain) this.report.longestChain = this.chain;
    if (this.lastAttach >= 0) {
      const gap = this.clock - this.lastAttach;
      if (gap > 0.1 && gap < 12) this.report.cycleIntervals.push(Math.round(gap * 1000) / 1000);
    }
    this.lastAttach = this.clock;
  }

  countRelease(pointLaunch: boolean): void {
    this.report.releases++;
    if (pointLaunch) this.report.pointLaunches++;
  }

  finish(): SwingReport {
    const r = this.report;
    const cycles = [...r.cycleIntervals].sort((a, b) => a - b);
    r.cycleMedian = cycles.length
      ? Math.round(cycles[Math.floor(cycles.length / 2)] * 1000) / 1000
      : 0;
    r.apexCompletion = r.swings ? Math.round((100 * this.tetherApexes) / (r.swings * 60)) : 0;
    const sorted = [...r.apexIntervals].sort((a, b) => a - b);
    if (sorted.length) {
      const inWindow = sorted.filter((x) => x >= 1.2 && x <= 2.0).length;
      r.apexInWindowPct = Math.round((100 * inWindow) / sorted.length);
      r.apexP25 = sorted[Math.floor(sorted.length * 0.25)];
      r.apexP75 = sorted[Math.floor(sorted.length * 0.75)];
    }
    r.apexMean = sorted.length ? sorted.reduce((s, x) => s + x, 0) / sorted.length : 0;
    r.apexMedian = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    if (r.minSpeed === Infinity) r.minSpeed = 0;
    if (r.tetherLengthMin === Infinity) r.tetherLengthMin = 0;
    r.apexMean = Math.round(r.apexMean * 1000) / 1000;
    r.apexMedian = Math.round(r.apexMedian * 1000) / 1000;
    r.minSpeed = Math.round(r.minSpeed * 100) / 100;
    r.maxSpeed = Math.round(r.maxSpeed * 100) / 100;
    r.meanSpeed = Math.round(r.meanSpeed * 100) / 100;
    r.seconds = Math.round(r.seconds * 100) / 100;
    return r;
  }
}

function blank(): SwingReport {
  return {
    seconds: 0,
    frames: 0,
    swings: 0,
    releases: 0,
    pointLaunches: 0,
    groundContacts: 0,
    longestChain: 0,
    apexIntervals: [],
    apexMean: 0,
    apexMedian: 0,
    cycleIntervals: [],
    cycleMedian: 0,
    apexCompletion: 0,
    apexInWindowPct: 0,
    apexP25: 0,
    apexP75: 0,
    minSpeed: Infinity,
    maxSpeed: 0,
    meanSpeed: 0,
    nanFrames: 0,
    belowGroundFrames: 0,
    tetherLengthMin: Infinity,
  };
}

function angleLerp(from: number, to: number, t: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d * t;
}
