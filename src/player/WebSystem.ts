/**
 * The heart of the game.
 *
 * Two independent tethers, each a hard distance constraint. Every substep a
 * stretched tether projects the body back onto its sphere and deletes the
 * outward radial component of velocity. No springs: a spring oscillates and
 * reads as mushy, a hard constraint reads as a rope.
 *
 * Auto-aim searches a cone for a scored anchor, then blends that anchor
 * toward the raw crosshair raycast by (1 - steerAssist), so the assist dial
 * runs continuously from "pure physics" to "it goes where I meant".
 */

import * as THREE from 'three';
import { T } from '../core/Tuning';
import { makeAnchorQuery, type AnchorQuery } from '../world/AnchorGrid';
import type { RayHit } from '../world/Collision';
import type { City } from '../world/CityGenerator';
import type { PlayerBody } from './PlayerBody';

export type Side = 'left' | 'right';

export interface Tether {
  active: boolean;
  readonly anchor: THREE.Vector3;
  length: number;
  attachTime: number;
  moving: boolean;
  movingIndex: number;
  /** Counts down after the swing passes its apex; release inside it launches. */
  apexTimer: number;
  prevVy: number;
  /**
   * True once this tether has actually carried a descent. Both the apex
   * window and the release boost require it, so energy can only be banked by
   * swinging through an arc — otherwise tapping attach/release is free
   * altitude and the player simply ascends out of the city forever.
   */
  hasDescended: boolean;
  /** Was the constraint engaged on the previous substep? */
  wasTaut: boolean;
}

export interface ReleaseResult {
  released: boolean;
  pointLaunch: boolean;
  slingshot: boolean;
  boost: number;
}

export interface WebEvents {
  onAttach?(side: Side, anchor: THREE.Vector3, moving: boolean): void;
  onRelease?(side: Side, result: ReleaseResult): void;
}

function makeTether(): Tether {
  return {
    active: false,
    anchor: new THREE.Vector3(),
    length: 0,
    attachTime: 0,
    moving: false,
    movingIndex: -1,
    apexTimer: 0,
    prevVy: 0,
    hasDescended: false,
    wasTaut: false,
  };
}

const dir = new THREE.Vector3();
const normal = new THREE.Vector3();

/** Radians per second the body may orbit an anchor. Comfort limit. */
const MAX_OMEGA = 2.6;
/** Beyond this the cone anchor and the crosshair hit are different targets. */
const BLEND_LIMIT = 9;

export class WebSystem {
  readonly left = makeTether();
  readonly right = makeTether();
  /** Hoisted so the per-substep loops do not allocate an array each call. */
  private readonly tethers: readonly Tether[] = [this.left, this.right];

  /** Where a thwip would land right now. Drives the crosshair state. */
  readonly aimPoint = new THREE.Vector3();
  aimValid = false;
  aimDistance = 0;
  aimMoving = false;
  aimMovingIndex = -1;

  events: WebEvents = {};

  private cone: AnchorQuery = makeAnchorQuery();
  private ray: RayHit = {
    distance: 0,
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    index: -1,
  };
  private dualSince = -1;

  get activeCount(): number {
    return (this.left.active ? 1 : 0) + (this.right.active ? 1 : 0);
  }

  get anyActive(): boolean {
    return this.left.active || this.right.active;
  }

  tether(side: Side): Tether {
    return side === 'left' ? this.left : this.right;
  }

  releaseAll(): void {
    this.left.active = false;
    this.right.active = false;
    this.dualSince = -1;
  }

  /**
   * Resolve where the crosshair is pointing. Run once per frame, before any
   * attach attempt, so the HUD and the attach agree exactly.
   */
  updateAim(eye: THREE.Vector3, forward: THREE.Vector3, city: City): void {
    const cone = this.cone;
    // Off the ground the cone stays tight, because precision is the skill.
    // ON the ground it opens right up: every anchor is a rooftop far above
    // you and a 14 degree cone finds nothing at all, which made a single
    // touchdown an unrecoverable death rather than a lost combo.
    const grounded = this.spinUpBody?.grounded ?? false;
    const coneAngle = ((grounded ? T.attachConeAngle * 2.6 : T.attachConeAngle) * Math.PI) / 180;
    const coneFound = city.anchors.search(eye, forward, T.maxAttachRange, coneAngle, cone);
    const rayFound = city.collision.raycast(eye, forward, T.maxAttachRange, this.ray);

    if (coneFound && rayFound) {
      // (1 - steerAssist) toward the raw hit: assist 1 keeps the scored
      // anchor, assist 0 gives the player exactly what they aimed at.
      //
      // Only blend when the two candidates are the same target. Lerping
      // between a rooftop corner and a wall twenty metres away lands in open
      // sky, and roughly one thwip in seven visibly stuck to nothing.
      const apart = cone.point.distanceTo(this.ray.point);
      if (apart < BLEND_LIMIT) {
        this.aimPoint.lerpVectors(cone.point, this.ray.point, 1 - T.steerAssist);
      } else {
        // Disagreement: assist decides which one wins outright.
        this.aimPoint.copy(T.steerAssist >= 0.5 ? cone.point : this.ray.point);
      }
      this.aimMoving = cone.moving && this.aimPoint.distanceTo(cone.point) < 2;
      this.aimMovingIndex = this.aimMoving ? cone.movingIndex : -1;
    } else if (coneFound) {
      this.aimPoint.copy(cone.point);
      this.aimMoving = cone.moving;
      this.aimMovingIndex = cone.movingIndex;
    } else if (rayFound) {
      this.aimPoint.copy(this.ray.point);
      this.aimMoving = false;
      this.aimMovingIndex = -1;
    } else {
      this.aimValid = false;
      this.aimMoving = false;
      this.aimMovingIndex = -1;
      return;
    }

    this.aimValid = true;
    this.aimDistance = eye.distanceTo(this.aimPoint);
  }

  /** Fire a web. Returns false when there was nothing in range to hit. */
  attach(side: Side, body: PlayerBody, elapsed: number): boolean {
    if (!this.aimValid) return false;
    const t = this.tether(side);
    t.active = true;
    t.anchor.copy(this.aimPoint);
    t.moving = this.aimMoving;
    t.movingIndex = this.aimMovingIndex;
    t.attachTime = elapsed;
    t.apexTimer = 0;
    t.prevVy = body.velocity.y;
    t.hasDescended = false;
    t.wasTaut = false;
    // A little slack on attach so the first substep is a swing, not a jolt.
    t.length = Math.max(T.minTetherLength, body.position.distanceTo(t.anchor) * T.tetherSlack);

    if (this.activeCount === 2) {
      this.dualSince = elapsed;
    }
    this.events.onAttach?.(side, t.anchor, t.moving);
    return true;
  }

  /** Let go, applying the release boost and reporting what kind it was. */
  release(side: Side, body: PlayerBody, elapsed: number, out: ReleaseResult): ReleaseResult {
    const t = this.tether(side);
    out.released = false;
    out.pointLaunch = false;
    out.slingshot = false;
    out.boost = 0;
    if (!t.active) return out;

    const wasDual = this.activeCount === 2;
    t.active = false;

    const speed = body.speed;
    // The boost is payment for work done. A tether that never carried a
    // descent earns nothing, otherwise tapping attach/release is free lift
    // and the player simply ratchets out of the top of the city.
    let boost = t.hasDescended ? Math.min(speed * T.releaseBoostFactor, T.releaseBoostMax) : 0;
    if (t.apexTimer > 0) {
      out.pointLaunch = true;
      boost *= 1.9;
    }
    body.velocity.y += boost;

    // The slingshot has to be an explicit impulse. A distance constraint can
    // only ever remove energy, so two of them are strictly SLOWER than one --
    // "let go of one of two ropes" produces no speed spike on its own, no
    // matter how it is arranged. Fire along the bisector of the two ropes,
    // scaled by how much they converge.
    if (wasDual && this.dualSince >= 0 && elapsed - this.dualSince > 0.1) {
      const other = t === this.left ? this.right : this.left;
      if (other.active) {
        dir.subVectors(t.anchor, body.position).normalize();
        normal.subVectors(other.anchor, body.position).normalize();
        // 0 when the ropes point the same way, 1 when they are opposed: a
        // wide stance is what stores the tension worth releasing.
        const spread = (1 - dir.dot(normal)) * 0.5;
        if (spread > 0.12) {
          // Fire along travel, not along the ropes' bisector. The bisector
          // points up between the two anchors, so using it as the launch
          // direction can cancel the very momentum the slingshot is supposed
          // to reward -- it measured SLOWER than a single web.
          const power =
            T.slingshotPower * spread * (0.45 + 0.55 * (speed / Math.max(1, T.maxSpeed)));
          if (speed > 1) {
            dir.copy(body.velocity).multiplyScalar(1 / speed);
          } else {
            dir.set(0, 1, 0);
          }
          body.velocity.addScaledVector(dir, power);
          body.velocity.y += power * 0.3;
          out.slingshot = true;
          out.boost = boost + power;
        }
      }
    }
    if (!wasDual) this.dualSince = -1;
    out.released = true;
    if (out.boost === 0) out.boost = boost;
    this.events.onRelease?.(side, out);
    return out;
  }

  /**
   * Shorten every active tether, conserving angular momentum.
   *
   * Just shrinking the length repositions the body and leaves its speed
   * alone, which is why reeling felt like nothing. Pulling yourself in on a
   * rope has to spin you faster — v * r stays constant — and that is the
   * single biggest source of speed in the whole game.
   */
  reel(h: number): void {
    const delta = T.reelSpeed * h;
    const body = this.spinUpBody;
    // Shorten every rope, but spin the body up ONCE. Applying the gain per
    // tether means holding two webs doubles the acceleration, which made
    // dual-web reeling the fastest thing in the game for the wrong reason.
    let bestGain = 1;
    let driver: Tether | null = null;
    for (const t of this.tethers) {
      if (!t.active) continue;
      const next = Math.max(T.minTetherLength, t.length - delta);
      if (next < t.length && next > 0.5) {
        const gain = t.length / next;
        if (gain > bestGain) {
          bestGain = gain;
          driver = t;
        }
        t.length = next;
      }
    }
    if (!driver || !body || bestGain <= 1) return;

    // Pumping only works on the way down, exactly as it does on a playground
    // swing: shortening the rope while tension is high adds energy, doing it
    // at the top just shortens the arc. This is the game's one honest source
    // of speed, and gating it here is what makes Shift a timing skill rather
    // than a throttle you hold forever.
    dir.subVectors(body.position, driver.anchor).normalize();
    const below = Math.max(0, dir.y * -1); // 1 hanging straight down, 0 level
    const pump = 0.25 + 0.75 * below;
    bestGain = 1 + (bestGain - 1) * pump;
    if (bestGain <= 1.0000001) return;

    // Cap angular velocity. Uncapped, reeling to the minimum length turns a
    // 50m arc into a 4m orbit at 13 rad/s -- 70g and 1.25 revolutions per
    // second, which is a comfort failure, not a skill expression.
    normal.subVectors(body.position, driver.anchor);
    const radius = Math.max(0.5, normal.length());
    const tangential = Math.sqrt(Math.max(0, body.velocity.lengthSq() - (body.velocity.dot(normal) / radius) ** 2));
    const omega = tangential / radius;
    if (omega >= MAX_OMEGA) return;
    const allowed = Math.min(bestGain, MAX_OMEGA / Math.max(1e-3, omega));
    this.spinUp(driver, allowed);
  }

  private spinUpBody: PlayerBody | null = null;

  /** Bound by the play loop each frame so reel() can reach the body. */
  bindBody(body: PlayerBody): void {
    this.spinUpBody = body;
  }

  private spinUp(t: Tether, gain: number): void {
    const body = this.spinUpBody;
    if (!body) return;
    normal.subVectors(body.position, t.anchor);
    const len = normal.length();
    if (len < 1e-4) return;
    normal.multiplyScalar(1 / len);
    // Scale only the tangential part: the radial component is the reel
    // itself and must not be amplified.
    const radial = body.velocity.dot(normal);
    dir.copy(body.velocity).addScaledVector(normal, -radial);
    dir.multiplyScalar(gain - 1);
    body.velocity.add(dir);
  }

  /** Yank hard toward the nearest active anchor. Unlocked at rank 5. */
  zip(body: PlayerBody): boolean {
    const t = this.nearestActive(body);
    if (!t) return false;
    dir.subVectors(t.anchor, body.position);
    const d = dir.length();
    if (d < 0.5) return false;
    dir.multiplyScalar(1 / d);
    body.velocity.addScaledVector(dir, T.webZipSpeed);
    t.length = Math.max(T.minTetherLength, t.length * 0.72);
    return true;
  }

  private nearestActive(body: PlayerBody): Tether | null {
    let best: Tether | null = null;
    let bestD = Infinity;
    for (const t of this.tethers) {
      if (!t.active) continue;
      const d = body.position.distanceToSquared(t.anchor);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  /**
   * One substep of constraint solving. Runs after integration and before
   * collision, so the player is never pushed through a wall by a tether.
   */
  constrain(body: PlayerBody, h: number, city: City): void {
    for (const t of this.tethers) {
      if (!t.active) continue;

      if (t.moving && t.movingIndex >= 0) {
        const m = city.anchors.moving[t.movingIndex];
        if (m) t.anchor.copy(m);
      }

      normal.subVectors(body.position, t.anchor);
      const len = normal.length();
      if (len > 1e-5 && len > t.length) {
        normal.multiplyScalar(1 / len);
        const correction = (len - t.length) * T.tetherStiffness;
        body.position.addScaledVector(normal, -correction);

        const radial = body.velocity.dot(normal);
        if (radial > 0) {
          const before = body.velocity.length();
          body.velocity.addScaledVector(normal, -radial);

          // Recover most of the energy the projection deleted, so the player
          // does not bleed altitude every arc until they are walking.
          //
          // Only while the rope was ALREADY taut. On the catch frame the
          // surviving tangential component can be almost zero, and rescaling
          // it back up to the full pre-projection speed turns 0.01 m/s of
          // drift into 29 m/s in a direction set by float noise. That is a
          // whip, not a swing.
          const after = body.velocity.length();
          if (t.wasTaut && after > 1e-4 && before > after) {
            const target = 1 + (before / after - 1) * T.tetherEnergyKeep;
            // Never let the recovery dominate: it is a correction, not a pump.
            const keep = Math.min(target, 1 + 0.35);
            body.velocity.multiplyScalar(keep);
          }
        }
        t.wasTaut = true;
      } else {
        t.wasTaut = false;
      }

      // Apex detection. The top of the arc is where vertical velocity crosses
      // from rising to falling; the bottom crosses the other way, so the sign
      // of the crossing distinguishes them without any height bookkeeping.
      //
      // It only counts once the tether has carried a real descent. Without
      // that gate the window opens on any slow drift, which turns nearly
      // every release into a "point launch" and lets the player ratchet
      // themselves into the sky.
      const vy = body.velocity.y;
      if (vy < -6) t.hasDescended = true;
      if (t.hasDescended && t.prevVy > 0 && vy <= 0) {
        t.apexTimer = T.apexBoostWindow;
      } else {
        t.apexTimer = Math.max(0, t.apexTimer - h);
      }
      t.prevVy = vy;
    }
  }
}

export function makeReleaseResult(): ReleaseResult {
  return { released: false, pointLaunch: false, slingshot: false, boost: 0 };
}
