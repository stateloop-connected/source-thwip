/**
 * First-person camera. Hand-rolled, never a Three.js example control.
 *
 * The comfort contract from the spec is enforced here, not left to options:
 * roll is off by default, head bob never runs while airborne, and every
 * effect collapses toward zero when "reduce motion" is on. Nothing in this
 * file is ever stepped to the animation framerate — a stepped camera makes
 * people ill.
 */

import * as THREE from 'three';
import { T } from '../core/Tuning';
import type { Input } from '../core/Input';
import type { Settings } from '../core/Save';
import type { PlayerBody } from './PlayerBody';

const HALF_PI = Math.PI / 2 - 0.001;
const eyeTmp = new THREE.Vector3();
const DEG = Math.PI / 180;

/** Horizontal FOV (what players expect) -> vertical FOV (what Three wants). */
export function horizontalToVertical(hFovDeg: number, aspect: number): number {
  const h = hFovDeg * DEG;
  return (2 * Math.atan(Math.tan(h / 2) / Math.max(0.2, aspect))) / DEG;
}

export class CameraRig {
  yaw = 0;
  pitch = 0;
  fov = T.baseFOV;
  roll = 0;
  /** 0..1, handed to the post chain to darken the frame at speed. */
  speedVignette = 0;
  /** 0..1 normalised speed, drives FOV and the speed-line pass. */
  speedFactor = 0;

  private bobPhase = 0;
  private bobOffset = 0;
  private shakeTime = 0;
  private shakeAmount = 0;
  private shakeSeed = 0;

  readonly forward = new THREE.Vector3(0, 0, -1);
  readonly right = new THREE.Vector3(1, 0, 0);

  reset(yaw = 0, pitch = 0): void {
    this.yaw = yaw;
    this.pitch = pitch;
    this.roll = 0;
    this.fov = T.baseFOV;
    this.bobPhase = 0;
    this.bobOffset = 0;
    this.shakeTime = 0;
    this.shakeAmount = 0;
  }

  /** Impacts and arc blasts only. Never during ordinary swinging. */
  shake(amount: number, duration = 0.28): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
    this.shakeTime = Math.max(this.shakeTime, duration);
    this.shakeSeed = Math.random() * 1000;
  }

  /** Mouse look. Runs every frame at full rate regardless of anything else. */
  look(input: Input, settings: Settings): void {
    const sens = 0.0022 * T.lookSensitivity * settings.sensitivity;
    this.yaw -= input.mouseDX * sens;
    this.pitch -= input.mouseDY * sens * (settings.invertY ? -1 : 1);
    this.applyOrientation();
  }

  /** Recompute the basis from yaw/pitch. Also used by scripted scenarios. */
  applyOrientation(): void {
    this.pitch = Math.max(-HALF_PI, Math.min(HALF_PI, this.pitch));
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;

    this.forward.set(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /** Horizontal-only forward, for movement intent. */
  flatForward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  update(
    dt: number,
    body: PlayerBody,
    settings: Settings,
    camera: THREE.PerspectiveCamera
  ): void {
    const reduce = settings.reduceMotion;
    const speed = body.speed;
    this.speedFactor = Math.min(1, speed / Math.max(1, T.maxSpeed));

    // FOV kick, eased so it never snaps
    const boost = T.speedFOVBoost * this.speedFactor * (reduce ? 0.35 : 1);
    const targetFov = settings.fov + boost;
    const k = 1 - Math.exp(-T.fovLerpRate * dt);
    this.fov += (targetFov - this.fov) * k;

    // roll, opt-in only
    let targetRoll = 0;
    if (settings.cameraRoll && !reduce) {
      const lateral = body.velocity.dot(this.right);
      targetRoll = THREE.MathUtils.clamp(
        (-lateral / Math.max(8, T.maxSpeed * 0.55)) * (T.maxCameraRoll * Math.PI) / 180,
        (-T.maxCameraRoll * Math.PI) / 180,
        (T.maxCameraRoll * Math.PI) / 180
      );
    }
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-6 * dt));

    // head bob: grounded only, always off in the air
    let targetBob = 0;
    if (settings.headBob && !reduce && body.grounded) {
      const horiz = Math.hypot(body.velocity.x, body.velocity.z);
      this.bobPhase += dt * (4 + horiz * 0.45);
      targetBob = Math.sin(this.bobPhase * 2) * T.headBobAmount * Math.min(1, horiz / 8);
    } else {
      this.bobPhase = 0;
    }
    this.bobOffset += (targetBob - this.bobOffset) * (1 - Math.exp(-14 * dt));

    const vigStart = T.speedVignetteAt;
    const target = THREE.MathUtils.clamp((speed - vigStart) / Math.max(1, T.maxSpeed - vigStart), 0, 1);
    this.speedVignette += (target * (reduce ? 0.4 : 1) - this.speedVignette) * (1 - Math.exp(-5 * dt));

    body.eye(eyeTmp);
    camera.position.set(eyeTmp.x, eyeTmp.y + this.bobOffset, eyeTmp.z);

    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const f = Math.max(0, this.shakeTime) * this.shakeAmount * (reduce ? 0.3 : 1);
      const t = this.shakeSeed + performance.now() * 0.05;
      camera.position.x += Math.sin(t * 1.7) * f * 0.5;
      camera.position.y += Math.sin(t * 2.3) * f * 0.5;
      if (this.shakeTime <= 0) this.shakeAmount = 0;
    }

    camera.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');

    // The FOV numbers in the spec and the options panel are HORIZONTAL, the
    // way every game presents them. Three's camera.fov is vertical, so 78
    // would silently become ~140 degrees horizontal — a fisheye that makes
    // the first-person hands loom like scenery.
    const vFov = horizontalToVertical(this.fov, camera.aspect);
    if (Math.abs(camera.fov - vFov) > 0.01) {
      camera.fov = vFov;
      camera.updateProjectionMatrix();
    }
  }
}
