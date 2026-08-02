/**
 * Web-tokens: seeded pickups that give the player a reason to steer.
 *
 * Placed above rooftops along plausible swing lines rather than uniformly,
 * because a token you would never fly near is not a reward, it is decoration.
 * One InstancedMesh, spun on the stepped animation clock.
 */

import * as THREE from 'three';
import type { Rng } from '../core/Rng';
import type { CollisionGrid } from '../world/Collision';
import { HALF } from '../world/Districts';

const TOKEN_COUNT = 90;
const PICKUP_RADIUS = 4.6;
const RESPAWN = 14;

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
uniform float uSpin;
out vec3 vNormalView;
out float vPhase;
void main() {
  float a = uSpin + iPhase * 6.2831;
  float c = cos(a), s = sin(a);
  mat3 spin = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
  vec3 p = spin * position;
  vec3 n = spin * normal;
  vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vNormalView = normalize(normalMatrix * n);
  vPhase = iPhase;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec3 vNormalView;
in float vPhase;
uniform float uSaturation;
layout(location = 0) out vec4 gColor;
layout(location = 1) out vec4 gNormal;
void main() {
  // Two flat tones and a hot rim. Tokens must read instantly at 50 m/s.
  float f = vNormalView.z;
  vec3 hot = vec3(1.0, 0.83, 0.16);
  vec3 deep = vec3(0.92, 0.16, 0.28);
  vec3 col = f > 0.55 ? hot : (f > 0.1 ? mix(hot, deep, 0.55) : deep);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);
  gColor = vec4(col, 1.0);
  gNormal = vec4(normalize(vNormalView) * 0.5 + 0.5, 1.0);
}
`;

interface Token {
  pos: THREE.Vector3;
  taken: boolean;
  timer: number;
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class Tokens {
  readonly mesh: THREE.InstancedMesh;
  private tokens: Token[] = [];
  private material: THREE.RawShaderMaterial;
  private matrix = new THREE.Matrix4();
  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private scale = new THREE.Vector3(1.7, 1.7, 1.7);

  constructor(rng: Rng, collision: CollisionGrid) {
    // Octahedron: cheap, reads as a faceted gem, silhouettes well.
    const geometry = new THREE.OctahedronGeometry(1, 0);
    const phases = new Float32Array(TOKEN_COUNT);
    for (let i = 0; i < TOKEN_COUNT; i++) phases[i] = rng.f();
    geometry.setAttribute('iPhase', new THREE.InstancedBufferAttribute(phases, 1));

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uSpin: { value: 0 }, uSaturation: { value: 1 } },
      defines: { USE_INSTANCING: '' },
    });

    this.mesh = new THREE.InstancedMesh(geometry, this.material, TOKEN_COUNT);
    this.mesh.name = 'tokens';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;

    this.place(rng, collision);
    this.refresh();
  }

  /** Hover them just above rooftops, where a swing line naturally passes. */
  private place(rng: Rng, collision: CollisionGrid): void {
    let guard = 0;
    while (this.tokens.length < TOKEN_COUNT && guard++ < TOKEN_COUNT * 40) {
      const x = rng.range(-HALF + 60, HALF - 60);
      const z = rng.range(-HALF + 60, HALF - 60);
      const top = collision.heightAt(x, z);
      if (top < 6) continue; // open street: nothing to skim past
      const y = top + rng.range(8, 26);
      this.tokens.push({ pos: new THREE.Vector3(x, y, z), taken: false, timer: 0 });
    }
    // Guarantee the full count even on a pathological seed.
    while (this.tokens.length < TOKEN_COUNT) {
      this.tokens.push({
        pos: new THREE.Vector3(rng.jitter(HALF - 80), rng.range(40, 90), rng.jitter(HALF - 80)),
        taken: false,
        timer: 0,
      });
    }
  }

  reset(): void {
    for (const t of this.tokens) {
      t.taken = false;
      t.timer = 0;
    }
    this.refresh();
  }

  /** Returns how many were collected this frame. */
  update(dt: number, animFrame: number, player: THREE.Vector3, saturation: number): number {
    this.material.uniforms.uSpin.value = animFrame * 0.42;
    this.material.uniforms.uSaturation.value = saturation;

    let collected = 0;
    let dirty = false;
    const r2 = PICKUP_RADIUS * PICKUP_RADIUS;
    for (let i = 0; i < this.tokens.length; i++) {
      const t = this.tokens[i];
      if (t.taken) {
        t.timer -= dt;
        if (t.timer <= 0) {
          t.taken = false;
          dirty = true;
        }
        continue;
      }
      if (t.pos.distanceToSquared(player) < r2) {
        t.taken = true;
        t.timer = RESPAWN;
        collected++;
        dirty = true;
      }
    }
    if (dirty) this.refresh();
    return collected;
  }

  private refresh(): void {
    for (let i = 0; i < this.tokens.length; i++) {
      const t = this.tokens[i];
      if (t.taken) {
        this.mesh.setMatrixAt(i, HIDDEN);
      } else {
        this.pos.copy(t.pos);
        this.matrix.compose(this.pos, this.quat, this.scale);
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
