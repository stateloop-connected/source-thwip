/**
 * Crime beacons: street-level markers that give the player a reason to look
 * down and commit to a dive.
 *
 * Deliberately scoped. There is no enemy AI, no pathfinding, no combat, no
 * health bars — a beacon is a glowing marker with a radius. Dive in, arc
 * blast, launch back out. That delivers the descent, the risk and the payoff
 * at a fraction of the cost of real combat, and the scope must not creep.
 */

import * as THREE from 'three';
import type { Rng } from '../core/Rng';
import type { CollisionGrid } from '../world/Collision';
import { HALF, inBridgeCorridor, districtAt } from '../world/Districts';

const COUNT = 9;

export interface Beacon {
  position: THREE.Vector3;
  resolved: boolean;
  /** 1 on resolve, decays — drives the burst flash. */
  flash: number;
}

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
in mat4 instanceMatrix;
in float iPhase;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat4 modelMatrix;
uniform mat3 normalMatrix;
uniform float uTime;
out vec3 vNormalView;
out float vPulse;
void main() {
  float pulse = 0.5 + 0.5 * sin(uTime * 3.4 + iPhase * 6.28);
  vec3 p = position * (1.0 + pulse * 0.16);
  vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vNormalView = normalize(normalMatrix * normal);
  vPulse = pulse;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec3 vNormalView;
in float vPulse;
layout(location = 0) out vec4 gColor;
layout(location = 1) out vec4 gNormal;
void main() {
  // Hot red-to-white, flat stepped. It has to be legible from 200m up.
  vec3 hot = mix(vec3(1.0, 0.16, 0.24), vec3(1.0, 0.92, 0.6), vPulse);
  float f = vNormalView.z > 0.5 ? 1.0 : 0.72;
  gColor = vec4(hot * f, 1.0);
  gNormal = vec4(normalize(vNormalView) * 0.5 + 0.5, 1.0);
}
`;

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class Beacons {
  readonly list: Beacon[] = [];
  readonly mesh: THREE.InstancedMesh;
  private material: THREE.RawShaderMaterial;
  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private scale = new THREE.Vector3(3.4, 9, 3.4);

  constructor(rng: Rng, collision: CollisionGrid) {
    const geometry = new THREE.ConeGeometry(1, 1, 6, 1, false);
    const phases = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) phases[i] = rng.f();
    geometry.setAttribute('iPhase', new THREE.InstancedBufferAttribute(phases, 1));

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 } },
      defines: { USE_INSTANCING: '' },
    });

    this.mesh = new THREE.InstancedMesh(geometry, this.material, COUNT);
    this.mesh.name = 'beacons';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;

    let guard = 0;
    while (this.list.length < COUNT && guard++ < COUNT * 60) {
      const x = rng.range(-HALF + 90, HALF - 90);
      const z = rng.range(-HALF + 90, HALF - 90);
      if (inBridgeCorridor(x, z)) continue;
      if (districtAt(x, z) === 'bridge') continue;
      // Must be on open street, not on a roof: the dive is the point.
      if (collision.heightAt(x, z) > 2) continue;
      this.list.push({ position: new THREE.Vector3(x, 5.5, z), resolved: false, flash: 0 });
    }
    this.refresh();
  }

  reset(): void {
    for (const b of this.list) {
      b.resolved = false;
      b.flash = 0;
    }
    this.refresh();
  }

  update(dt: number, time: number): void {
    this.material.uniforms.uTime.value = time;
    for (const b of this.list) if (b.flash > 0) b.flash = Math.max(0, b.flash - dt * 2);
  }

  refresh(): void {
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      if (b.resolved) {
        this.mesh.setMatrixAt(i, HIDDEN);
      } else {
        this.matrix.compose(b.position, this.quat, this.scale);
        this.mesh.setMatrixAt(i, this.matrix);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
