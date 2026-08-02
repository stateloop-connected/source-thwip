/**
 * The unlockable moves. Each one opens lines through the city that were
 * previously impossible, so old ground plays new.
 *
 * Rank gating lives here rather than in the input handler so a locked move
 * simply does not exist — no "not unlocked yet" message, no dead key.
 */

import * as THREE from 'three';
import { T } from '../core/Tuning';
import type { PlayerBody } from './PlayerBody';

const along = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

export type MoveEvent = 'wallRunStart' | 'wallRunTick' | 'arc' | 'camoOn' | 'camoOff' | 'zip';

export class Moves {
  /** Seconds of wall-run remaining. */
  wallRunLeft = 0;
  wallRunning = false;
  /** Seconds of arc dash remaining. */
  arcLeft = 0;
  camoActive = false;

  /** Accumulates wall-run seconds so scoring can pay out per second. */
  private wallTick = 0;
  private wallCooldown = 0;
  onEvent: ((e: MoveEvent, at?: THREE.Vector3) => void) | null = null;

  reset(): void {
    this.wallRunLeft = 0;
    this.wallRunning = false;
    this.arcLeft = 0;
    this.camoActive = false;
    this.wallTick = 0;
    this.wallCooldown = 0;
  }

  /** Flow drains slower while camouflaged. */
  get flowDrainScale(): number {
    return this.camoActive ? T.camoFlowFactor : 1;
  }

  /**
   * Wall-run: hold forward against a wall. Runs along the surface rather than
   * up it, which keeps it a traversal tool instead of a way to climb out of
   * every mistake.
   */
  updateWallRun(dt: number, body: PlayerBody, wantForward: boolean, unlocked: boolean): void {
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);

    if (!unlocked || !wantForward || !body.wallContact || body.grounded || this.wallCooldown > 0) {
      if (this.wallRunning) {
        this.wallRunning = false;
        this.wallTick = 0;
      }
      if (!body.wallContact || body.grounded) this.wallRunLeft = T.wallRunDuration;
      return;
    }

    if (!this.wallRunning) {
      this.wallRunning = true;
      this.wallRunLeft = this.wallRunLeft > 0 ? this.wallRunLeft : T.wallRunDuration;
      this.onEvent?.('wallRunStart');
    }

    this.wallRunLeft -= dt;
    if (this.wallRunLeft <= 0) {
      this.wallRunning = false;
      this.wallCooldown = 0.6;
      return;
    }

    // Travel along the wall, in the direction the player is already going.
    along.copy(body.velocity);
    along.addScaledVector(body.wallNormal, -along.dot(body.wallNormal));
    along.y = 0;
    if (along.lengthSq() < 0.5) along.copy(body.forward).addScaledVector(body.wallNormal, -body.forward.dot(body.wallNormal));
    if (along.lengthSq() < 1e-4) return;
    along.normalize();

    const target = T.wallRunSpeed;
    body.velocity.x += (along.x * target - body.velocity.x) * Math.min(1, 6 * dt);
    body.velocity.z += (along.z * target - body.velocity.z) * Math.min(1, 6 * dt);
    // Cancel the fall and hold on, rather than sticking to the surface.
    if (body.velocity.y < 0) body.velocity.y *= Math.max(0, 1 - 7 * dt);
    body.velocity.addScaledVector(body.wallNormal, -T.wallStickForce * dt);
    body.velocity.y += 5.5 * dt;

    this.wallTick += dt;
    while (this.wallTick >= 1) {
      this.wallTick -= 1;
      this.onEvent?.('wallRunTick');
    }
  }

  /**
   * Arc dash: a bio-electric burst forward with brief gravity immunity.
   * The AoE that resolves crime beacons is applied by the caller, which owns
   * the beacon list.
   */
  arcDash(body: PlayerBody, dir: THREE.Vector3, unlocked: boolean): boolean {
    if (!unlocked || this.arcLeft > 0) return false;
    this.arcLeft = T.arcDashTime;
    body.noGravityTimer = Math.max(body.noGravityTimer, T.arcDashTime);
    along.copy(dir);
    if (along.lengthSq() < 1e-4) along.copy(up);
    along.normalize();
    body.velocity.addScaledVector(along, T.arcDashSpeed);
    body.clampSpeed();
    this.onEvent?.('arc', body.position);
    return true;
  }

  /** Camo glide: invisible slow fall. Costs nothing but your momentum. */
  setCamo(on: boolean, unlocked: boolean): void {
    const next = unlocked && on;
    if (next === this.camoActive) return;
    this.camoActive = next;
    this.onEvent?.(next ? 'camoOn' : 'camoOff');
  }

  update(dt: number, body: PlayerBody): void {
    if (this.arcLeft > 0) this.arcLeft -= dt;
    if (this.camoActive && !body.grounded && body.velocity.y < T.camoFallSpeed) {
      // Ease toward the glide speed instead of snapping, so entering camo in
      // a long fall reads as opening a chute.
      body.velocity.y += (T.camoFallSpeed - body.velocity.y) * Math.min(1, 4 * dt);
    }
  }
}
