/**
 * The hands you swing with, and the webs they throw.
 *
 * Limb segments live in one InstancedMesh parented to the camera, posed by a
 * two-bone IK solve toward each active anchor. Poses are sampled against the
 * stepped animation clock — this is the one place the "animated on twos"
 * trick is supposed to show. The web line itself is rebuilt every frame so it
 * stays glued to the hand, but its sag and boil are sampled stepped, so the
 * secondary motion pops on twos while the attachment never breaks.
 */

import * as THREE from 'three';
import { createSuitMaterial } from '../render/ToonMaterial';
import type { Tether } from './WebSystem';
import type { PlayerBody } from './PlayerBody';

const SEG_UPPER = 0.29;
const SEG_FORE = 0.33;
const LIMB_COUNT = 12;

const UP = new THREE.Vector3(0, 1, 0);
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const mid = new THREE.Vector3();
const perp = new THREE.Vector3();
const dirV = new THREE.Vector3();
const elbow = new THREE.Vector3();
const target = new THREE.Vector3();
const quat = new THREE.Quaternion();
const scaleV = new THREE.Vector3();
const matrix = new THREE.Matrix4();

/**
 * Viewmodel placement, not anatomy.
 *
 * A real shoulder sits ~0.2m from the eye, and at that range a forearm fills
 * two thirds of the frame at any sane field of view. Every first-person game
 * cheats this the same way: push the whole rig forward so it reads as arms at
 * the edges of vision instead of scenery in the middle of the screen.
 */
const SHOULDER = {
  left: new THREE.Vector3(-0.4, -0.3, -0.56),
  right: new THREE.Vector3(0.4, -0.3, -0.56),
};
const IDLE = {
  left: new THREE.Vector3(-0.46, -0.42, -0.9),
  right: new THREE.Vector3(0.46, -0.42, -0.9),
};

const SUIT_BLACK = new THREE.Color(0.07, 0.07, 0.1);
const SUIT_RED = new THREE.Color(0.85, 0.09, 0.19);

export class FirstPersonRig {
  readonly limbs: THREE.InstancedMesh;
  readonly webs: [WebLine, WebLine];
  readonly material: THREE.RawShaderMaterial;

  /** 0..1 camouflage fade, driven by the camo glide move. */
  camo = 0;

  private lastAnimFrame = -1;
  private handWorld: [THREE.Vector3, THREE.Vector3] = [
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];
  private poseTarget: [THREE.Vector3, THREE.Vector3] = [
    IDLE.left.clone(),
    IDLE.right.clone(),
  ];
  private posed: [THREE.Vector3, THREE.Vector3] = [IDLE.left.clone(), IDLE.right.clone()];
  private sway = new THREE.Vector3();

  constructor() {
    this.material = createSuitMaterial();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const tints = new Float32Array(LIMB_COUNT * 3);
    for (let i = 0; i < LIMB_COUNT; i++) {
      // wrist bands and the shins carry the red accent
      const red = i === 3 || i === 7 || i === 9 || i === 11;
      const c = red ? SUIT_RED : SUIT_BLACK;
      tints[i * 3] = c.r;
      tints[i * 3 + 1] = c.g;
      tints[i * 3 + 2] = c.b;
    }
    geometry.setAttribute('iTint', new THREE.InstancedBufferAttribute(tints, 3));

    this.limbs = new THREE.InstancedMesh(geometry, this.material, LIMB_COUNT);
    this.limbs.frustumCulled = false;
    this.limbs.matrixAutoUpdate = false;
    this.limbs.renderOrder = 5;
    this.limbs.name = 'fp-limbs';

    this.webs = [new WebLine(), new WebLine()];
  }

  /** Add limbs under the camera and web lines into world space. */
  attachTo(camera: THREE.Camera, scene: THREE.Object3D): void {
    camera.add(this.limbs);
    scene.add(this.webs[0].mesh);
    scene.add(this.webs[1].mesh);
  }

  setStyle(saturation: number): void {
    this.material.uniforms.uSaturation.value = saturation;
    this.material.uniforms.uCamo.value = this.camo;
  }

  update(
    dt: number,
    animFrameIndex: number,
    camera: THREE.PerspectiveCamera,
    body: PlayerBody,
    tethers: [Tether, Tether],
    visible: boolean
  ): void {
    this.limbs.visible = visible;
    if (!visible) {
      this.webs[0].mesh.visible = false;
      this.webs[1].mesh.visible = false;
      return;
    }

    // Sway from velocity, in camera space. Continuous, so the arms feel
    // attached to a body that is actually moving.
    camera.worldToLocal(a.copy(body.position).add(body.velocity));
    this.sway.lerp(a.multiplyScalar(0.014).clampLength(0, 0.16), 1 - Math.exp(-9 * dt));

    const stepped = animFrameIndex !== this.lastAnimFrame;
    this.lastAnimFrame = animFrameIndex;

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 'left' : 'right';
      const t = tethers[i];
      const shoulder = SHOULDER[side];

      if (t.active) {
        // Point the hand along the direction of the anchor, anchored to the
        // shoulder rather than to the camera origin, then clamp to reach.
        target.copy(t.anchor);
        camera.worldToLocal(target);
        target.sub(shoulder).normalize().multiplyScalar(SEG_UPPER + SEG_FORE - 0.02);
        target.add(shoulder);
        // Keep each hand on its own side and below the eye line: an
        // unconstrained target swings the arm across the centre of the frame
        // and covers exactly what the player is aiming at.
        const side = i === 0 ? -1 : 1;
        target.x = side * Math.max(0.28, side * target.x);
        target.y = Math.min(target.y, -0.08);
        target.z = Math.min(target.z, -0.5);
        this.poseTarget[i].copy(target);
      } else {
        this.poseTarget[i].copy(IDLE[side]).add(this.sway);
      }

      // Pose held between animation steps: the "on twos" read.
      if (stepped) this.posed[i].lerp(this.poseTarget[i], t.active ? 0.85 : 0.42);

      this.solveArm(i, shoulder, this.posed[i]);
    }

    // Legs exist for the fall-down look only. Rendering them the rest of the
    // time just puts slabs at the bottom of the frame.
    this.poseLegs(body, camera.rotation.x < -0.3);
    this.limbs.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < 2; i++) {
      const t = tethers[i];
      const web = this.webs[i];
      web.mesh.visible = t.active;
      if (!t.active) continue;
      // Limbs are an identity-transform child of the camera, so camera space
      // is limb space: one conversion, every frame, so the web never detaches.
      camera.localToWorld(this.handWorld[i].copy(this.posed[i]));
      web.update(this.handWorld[i], t.anchor, animFrameIndex, body.speed);
    }
  }

  /** Analytic two-bone IK. Elbow is pushed out and down, like a real arm. */
  private solveArm(index: number, shoulder: THREE.Vector3, wrist: THREE.Vector3): void {
    dirV.subVectors(wrist, shoulder);
    let d = dirV.length();
    const maxD = SEG_UPPER + SEG_FORE - 0.001;
    const minD = Math.abs(SEG_UPPER - SEG_FORE) + 0.001;
    if (d < 1e-5) {
      dirV.set(0, -1, 0);
      d = minD;
    }
    d = Math.min(maxD, Math.max(minD, d));
    dirV.normalize();

    const aLen = (SEG_UPPER * SEG_UPPER - SEG_FORE * SEG_FORE + d * d) / (2 * d);
    const hLen = Math.sqrt(Math.max(0, SEG_UPPER * SEG_UPPER - aLen * aLen));
    mid.copy(shoulder).addScaledVector(dirV, aLen);

    // pole vector: outward and down, so elbows never invert through the torso
    perp.set(index === 0 ? -1 : 1, -0.85, 0.15).normalize();
    perp.addScaledVector(dirV, -perp.dot(dirV));
    if (perp.lengthSq() < 1e-6) perp.set(0, -1, 0);
    perp.normalize();
    elbow.copy(mid).addScaledVector(perp, hLen);

    const base = index * 4;
    this.segment(base + 0, shoulder, elbow, 0.078);
    this.segment(base + 1, elbow, wrist, 0.066);
    a.copy(wrist).addScaledVector(dirV, 0.06);
    this.segment(base + 2, wrist, a, 0.078);
    b.copy(elbow).lerp(wrist, 0.8);
    this.segment(base + 3, b, wrist, 0.073);
  }

  /** Only ever seen on the look-down. Cheap, and it sells the drop. */
  private poseLegs(body: PlayerBody, visible: boolean): void {
    if (!visible) {
      matrix.makeScale(0, 0, 0);
      for (let i = 8; i < LIMB_COUNT; i++) this.limbs.setMatrixAt(i, matrix);
      return;
    }
    const falling = Math.max(0, Math.min(1, -body.velocity.y / 26));
    const tuck = 0.28 + falling * 0.34;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      a.set(s * 0.2, -0.62, -0.5);
      b.set(s * (0.24 + tuck * 0.16), -0.98 - falling * 0.06, -0.72 - tuck * 0.3);
      this.segment(8 + i * 2, a, b, 0.115);
      const knee = b.clone();
      b.set(s * (0.2 + tuck * 0.08), -1.3 + tuck * 0.32, -0.66 - tuck * 0.6);
      this.segment(9 + i * 2, knee, b, 0.095);
    }
  }

  /** Place instance `i` as a box spanning p0 -> p1. */
  private segment(i: number, p0: THREE.Vector3, p1: THREE.Vector3, thickness: number): void {
    a.subVectors(p1, p0);
    const len = a.length();
    if (len < 1e-5) {
      matrix.makeScale(0, 0, 0);
      this.limbs.setMatrixAt(i, matrix);
      return;
    }
    a.multiplyScalar(1 / len);
    quat.setFromUnitVectors(UP, a);
    mid.copy(p0).addScaledVector(a, len * 0.5);
    scaleV.set(thickness, len, thickness);
    matrix.compose(mid, quat, scaleV);
    this.limbs.setMatrixAt(i, matrix);
  }

  dispose(): void {
    this.limbs.geometry.dispose();
    this.material.dispose();
    this.webs[0].dispose();
    this.webs[1].dispose();
  }
}

// -- web line --------------------------------------------------------------

const SEGMENTS = 16;
const RING = 5;

const WEB_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
in float aT;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat4 modelMatrix;
uniform mat3 normalMatrix;
out vec3 vNormalView;
out float vT;
void main() {
  vNormalView = normalize(normalMatrix * normal);
  vT = aT;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const WEB_FRAG = /* glsl */ `
precision highp float;
in vec3 vNormalView;
in float vT;
uniform float uSaturation;
layout(location = 0) out vec4 gColor;
layout(location = 1) out vec4 gNormal;
void main() {
  // Two flat tones only. A web is ink, not a lit cylinder.
  float shade = vNormalView.z > 0.45 ? 1.0 : 0.62;
  vec3 col = mix(vec3(0.96, 0.97, 1.0), vec3(0.72, 0.78, 0.92), 1.0 - shade);
  col *= mix(1.0, 0.82, vT);
  gColor = vec4(col, 1.0);
  gNormal = vec4(normalize(vNormalView) * 0.5 + 0.5, 1.0);
}
`;

class WebLine {
  readonly mesh: THREE.Mesh;
  private positions: Float32Array;
  private normals: Float32Array;
  private geometry: THREE.BufferGeometry;
  private material: THREE.RawShaderMaterial;

  constructor() {
    const vertexCount = (SEGMENTS + 1) * RING;
    this.positions = new Float32Array(vertexCount * 3);
    this.normals = new Float32Array(vertexCount * 3);
    const ts = new Float32Array(vertexCount);
    const indices: number[] = [];
    for (let s = 0; s < SEGMENTS; s++) {
      for (let r = 0; r < RING; r++) {
        const r1 = (r + 1) % RING;
        const i0 = s * RING + r;
        const i1 = s * RING + r1;
        const i2 = (s + 1) * RING + r;
        const i3 = (s + 1) * RING + r1;
        indices.push(i0, i2, i1, i1, i2, i3);
      }
    }
    for (let s = 0; s <= SEGMENTS; s++) {
      for (let r = 0; r < RING; r++) ts[s * RING + r] = s / SEGMENTS;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    this.geometry.setAttribute('aT', new THREE.BufferAttribute(ts, 1));
    this.geometry.setIndex(indices);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: WEB_VERT,
      fragmentShader: WEB_FRAG,
      uniforms: { uSaturation: { value: 1 } },
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.name = 'web-line';
  }

  update(hand: THREE.Vector3, anchor: THREE.Vector3, animFrame: number, speed: number): void {
    const p = this.positions;
    const n = this.normals;
    a.subVectors(anchor, hand);
    const dist = a.length();
    if (dist < 1e-4) return;
    a.multiplyScalar(1 / dist);

    // Sag shrinks as the line goes taut at speed.
    const sag = Math.min(2.6, dist * 0.05) * (1 - Math.min(0.8, speed / 60));

    perp.copy(UP).cross(a);
    if (perp.lengthSq() < 1e-5) perp.set(1, 0, 0);
    perp.normalize();
    b.copy(a).cross(perp).normalize();

    for (let s = 0; s <= SEGMENTS; s++) {
      const t = s / SEGMENTS;
      mid.copy(hand).addScaledVector(a, dist * t);
      mid.y -= sag * 4 * t * (1 - t);
      // Boil: sampled against the stepped clock, so it pops on twos.
      const wob = hash2(animFrame * 0.37 + s * 1.31) * 0.05 * Math.sin(t * Math.PI);
      mid.addScaledVector(perp, wob);

      const radius = (0.036 - 0.02 * t) * (1 + 0.25 * Math.sin(t * 9 + animFrame));
      for (let r = 0; r < RING; r++) {
        const ang = (r / RING) * Math.PI * 2;
        const cs = Math.cos(ang);
        const sn = Math.sin(ang);
        dirV.copy(perp).multiplyScalar(cs).addScaledVector(b, sn);
        const i = (s * RING + r) * 3;
        p[i] = mid.x + dirV.x * radius;
        p[i + 1] = mid.y + dirV.y * radius;
        p[i + 2] = mid.z + dirV.z * radius;
        n[i] = dirV.x;
        n[i + 1] = dirV.y;
        n[i + 2] = dirV.z;
      }
    }
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('normal').needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

function hash2(x: number): number {
  const s = Math.sin(x * 127.1) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}
