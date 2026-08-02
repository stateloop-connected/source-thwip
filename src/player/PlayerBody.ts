/**
 * One point mass with a capsule for collision. That is the entire character
 * controller — a physics engine here would be a liability, not an asset.
 *
 * Integration is semi-implicit Euler, run at `substeps` per frame, with the
 * web tethers solved as hard position constraints between the integrate and
 * collide steps (see WebSystem). Position projection plus radial-velocity
 * removal is what makes the swing feel crisp; a stiffness spring oscillates
 * and feels like swinging on a bungee cord.
 */

import * as THREE from 'three';
import { T } from '../core/Tuning';
import { makeContact, type CollisionGrid, type ContactInfo } from '../world/Collision';

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class PlayerBody {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly contact: ContactInfo = makeContact();

  grounded = false;
  /** True on the frame the player transitioned from airborne to grounded. */
  justLanded = false;
  wallContact = false;
  readonly wallNormal = new THREE.Vector3();

  /** Seconds since the player last touched anything walkable. */
  airTime = 0;
  /** Metres travelled this run. */
  distance = 0;

  /** Camera-relative movement intent, set each frame from input. */
  readonly moveInput = new THREE.Vector2();
  readonly forward = new THREE.Vector3(0, 0, -1);
  readonly right = new THREE.Vector3(1, 0, 0);

  /** Externally applied one-shot impulses (dash, zip, jump). */
  gravityScale = 1;
  /** Seconds of remaining gravity immunity, used by the arc dash. */
  noGravityTimer = 0;

  get radius(): number {
    return T.playerRadius;
  }

  /** Half-length of the capsule's central segment. */
  get halfHeight(): number {
    return Math.max(0.05, T.eyeHeight / 2 - T.playerRadius);
  }

  /** Distance from the capsule centre up to the eye. */
  get eyeOffset(): number {
    return T.eyeHeight - (this.halfHeight + T.playerRadius);
  }

  get speed(): number {
    return this.velocity.length();
  }

  get speedMph(): number {
    return this.velocity.length() * 2.2369363;
  }

  reset(at: THREE.Vector3): void {
    this.position.copy(at);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.justLanded = false;
    this.wallContact = false;
    this.airTime = 0;
    this.distance = 0;
    this.noGravityTimer = 0;
    this.gravityScale = 1;
  }

  /** Gravity, air control and integration for one substep. */
  integrate(h: number, tethered: boolean): void {
    const v = this.velocity;

    if (this.noGravityTimer > 0) {
      this.noGravityTimer -= h;
    } else {
      v.y += T.gravity * this.gravityScale * h;
      if (v.y < T.terminalFallSpeed) v.y = T.terminalFallSpeed;
    }

    const mx = this.moveInput.x;
    const my = this.moveInput.y;
    if (mx !== 0 || my !== 0) {
      // Movement intent in the camera's horizontal frame. Never vertical:
      // being able to fly with W would kill every risk in the game.
      tmp.set(0, 0, 0);
      tmp.addScaledVector(this.right, mx);
      tmp.addScaledVector(this.forward, my);
      tmp.y = 0;
      if (tmp.lengthSq() > 1e-6) {
        tmp.normalize();

        if (this.grounded) {
          v.addScaledVector(tmp, T.groundAccel * h);
        } else {
          // Air control is LATERAL, exactly as specified. Strip the component
          // along current velocity so holding W steers the arc instead of
          // acting as a thruster - that is what was pinning the body at max
          // speed and turning every swing into a straight line.
          const speed = v.length();
          if (speed > 1) {
            tmp2.copy(v).multiplyScalar(1 / speed);
            tmp.addScaledVector(tmp2, -tmp.dot(tmp2));
          }
          v.addScaledVector(tmp, T.airControlAccel * h);

          // Pumping a swing only works on the way down, the same way it works
          // on a playground. Gating it here is what gives the arc its shape.
          if (tethered && my > 0 && speed > 1) {
            const descent = Math.max(0, -v.y / speed);
            v.addScaledVector(tmp2, T.swingPumpAccel * my * descent * h);
          }
        }
      }
    }

    if (this.grounded) {
      const f = Math.max(0, 1 - T.groundFriction * h);
      v.x *= f;
      v.z *= f;
    }

    this.clampSpeed();
    this.position.addScaledVector(v, h);
    this.distance += Math.abs(v.length() * h);
  }

  /** Clear per-frame latches. Call once, before the substep loop. */
  beginFrame(): void {
    this.justLanded = false;
  }

  /** The hard speed cap. Must be re-applied after anything that can add. */
  clampSpeed(): void {
    const max = T.maxSpeed;
    const s2 = this.velocity.lengthSq();
    if (s2 > max * max) this.velocity.multiplyScalar(max / Math.sqrt(s2));
  }

  /** Push out of the world. Velocity cancellation happens per contact. */
  collide(grid: CollisionGrid, h: number): void {
    const wasGrounded = this.grounded;
    const contact = this.contact;
    grid.resolveCapsule(this.position, this.velocity, this.radius, this.halfHeight, contact);

    this.grounded = contact.grounded;
    this.wallContact = contact.wall;
    if (contact.wall) this.wallNormal.copy(contact.normal);

    // Latched, not assigned. collide() runs once per substep, so a landing on
    // substep 1 would be cleared by substeps 2-4 and the game -- which reads
    // this after the whole loop -- would never see a ground contact at all.
    if (this.grounded && !wasGrounded) this.justLanded = true;
    if (this.grounded) this.airTime = 0;
    else this.airTime += h;

    if (!Number.isFinite(this.position.x + this.position.y + this.position.z)) {
      // Defensive: a NaN here would poison every downstream system silently.
      this.position.set(0, 200, 0);
      this.velocity.set(0, 0, 0);
    }
  }

  /** World-space eye position for the camera. */
  eye(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.position).setY(this.position.y + this.eyeOffset);
  }
}
