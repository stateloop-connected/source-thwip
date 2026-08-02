/**
 * Free-fly inspection camera. Used at the phase-1 gate to walk the city and
 * check district transitions, draw calls and seed determinism, and kept in the
 * shipped build behind `?test=fly` because it costs nothing and it is the
 * fastest way to inspect a generated city.
 */

import * as THREE from 'three';
import type { Input } from '../core/Input';

const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class FlyCamera {
  yaw = 0;
  pitch = -0.12;
  speed = 60;
  position = new THREE.Vector3(0, 120, 260);

  private axes = { x: 0, y: 0 };

  update(dt: number, input: Input, camera: THREE.PerspectiveCamera): void {
    const sens = 0.0022;
    this.yaw -= input.mouseDX * sens;
    this.pitch -= input.mouseDY * sens;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));

    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    camera.getWorldDirection(FORWARD);
    RIGHT.crossVectors(FORWARD, UP).normalize();

    input.moveAxes(this.axes);
    const boost = input.down('reel') ? 4.5 : input.keyDown('KeyC') ? 0.25 : 1;
    const v = this.speed * boost * dt;

    this.position.addScaledVector(FORWARD, this.axes.y * v);
    this.position.addScaledVector(RIGHT, this.axes.x * v);
    if (input.down('jump')) this.position.y += v;
    if (input.down('camo')) this.position.y -= v;

    camera.position.copy(this.position);
  }
}
