/**
 * The ghost: your best run on this city, replayed as a translucent halftoned
 * silhouette you race.
 *
 * Recording is 10Hz, rounded to a decimetre — 900 samples for a 90 second run,
 * which is what keeps it inside the localStorage quota. Playback is NOT 10Hz:
 * the samples are a Catmull-Rom control polygon sampled every frame, because a
 * ghost that visibly moves ten times a second reads as broken rather than as
 * a replay.
 *
 * It is drawn as an apparition, not as a character. No depth write, no normal
 * write, and therefore no ink from the outline pass: everything real in this
 * world is outlined, the ghost is not, and that is how you know at a glance
 * that the figure ahead of you is not a thing you can hit.
 */

import * as THREE from 'three';
import type { SaveData } from '../core/Save';
import { HALFTONE } from '../render/glsl';

const INTERVAL = 0.1;
/** 140s of samples. A guard against a pathological run, not a real limit. */
const MAX_SAMPLES = 1400;
/** Under a second and a half there is nothing worth racing. */
const MIN_SAMPLES = 15;
const LIMB_COUNT = 6;

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
in mat4 instanceMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat4 modelMatrix;
uniform mat3 normalMatrix;
out vec3 vNormalView;
out float vViewDepth;
void main() {
  vec3 scale = vec3(
    length(instanceMatrix[0].xyz),
    length(instanceMatrix[1].xyz),
    length(instanceMatrix[2].xyz)
  );
  mat3 instRot = mat3(
    instanceMatrix[0].xyz / max(scale.x, 1e-4),
    instanceMatrix[1].xyz / max(scale.y, 1e-4),
    instanceMatrix[2].xyz / max(scale.z, 1e-4)
  );
  vec4 view = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  vNormalView = normalize(normalMatrix * (instRot * normal));
  vViewDepth = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec3 vNormalView;
in float vViewDepth;
uniform float uSaturation;
uniform float uDotScale;
layout(location = 0) out vec4 gColor;
layout(location = 1) out vec4 gNormal;

${HALFTONE}

/** How solidly the silhouette prints. Drives the dot size, not the alpha. */
const float COVERAGE = 0.62;

void main() {
  // Two flat tones of cold ink. A ghost is a printed shape, not a lit body,
  // and the cold hue keeps it clear of the warm city and the red suit.
  float shade = vNormalView.z > 0.45 ? 1.0 : 0.62;
  vec3 col = mix(vec3(0.26, 0.60, 0.86), vec3(0.74, 0.96, 1.0), shade);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);

  // Ben-Day dots on the cyan plate's print angle. gl_FragCoord is already in
  // buffer pixels, so the shared helper's resolution term is 1.
  float dots = halftone(gl_FragCoord.xy, 0.2618, 1.0 - COVERAGE, uDotScale, vec2(1.0));
  float alpha = mix(0.10, 0.85, dots);

  // Fade out at point-blank range. You start every run inside your own ghost,
  // and a figure filling the frame for the first half second of a 90 second
  // run is not atmosphere, it is a wall.
  alpha *= smoothstep(1.6, 5.0, vViewDepth);

  gColor = vec4(col, alpha);
  // Alpha zero leaves the normal attachment untouched under the blend, which
  // is what keeps the outline pass from inking an apparition.
  gNormal = vec4(0.0);
}
`;

const UP = new THREE.Vector3(0, 1, 0);
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const pa = new THREE.Vector3();
const pb = new THREE.Vector3();
const dir = new THREE.Vector3();
const mid = new THREE.Vector3();
const quat = new THREE.Quaternion();
const scaleV = new THREE.Vector3();
const matrix = new THREE.Matrix4();

export class Ghost {
  readonly mesh: THREE.InstancedMesh;
  /** Where the ghost is right now, interpolated. Empty when it is not on. */
  readonly position = new THREE.Vector3();

  private material: THREE.RawShaderMaterial;
  /** Flat [x,y,z, ...] being replayed this run. Read-only, owned by Save. */
  private path: number[] = [];
  /** Flat [x,y,z, ...] being recorded this run. */
  private recorded: number[] = [];
  private recordAcc = 0;
  private clock = 0;
  private heading = new THREE.Vector3(0, 0, -1);

  constructor() {
    const geometry = new THREE.BoxGeometry(1, 1, 1);

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uSaturation: { value: 1 }, uDotScale: { value: 5 } },
      defines: { USE_INSTANCING: '' },
      transparent: true,
      // The ghost occludes nothing. A translucent figure punching a hole in
      // the depth buffer would make the misprint DoF focus on the wrong plane
      // and the outline pass ink a silhouette that is not really there.
      depthWrite: false,
    });

    this.mesh = new THREE.InstancedMesh(geometry, this.material, LIMB_COUNT);
    this.mesh.name = 'ghost';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
  }

  /** Debug surface: how much run is recorded, and how much is replayable. */
  get recordedCount(): number {
    return this.recorded.length / 3;
  }

  get sampleCount(): number {
    return this.path.length / 3;
  }

  /**
   * Start recording a run, and put the stored ghost on the field if it can be
   * raced. A ghost from another seed would fly through solid buildings, so the
   * seed has to match before it is allowed on screen.
   */
  begin(save: SaveData, seed: number): void {
    this.recorded.length = 0;
    // Primed, so the first frame of the run lands sample zero at t = 0 and
    // recording and playback share one origin.
    this.recordAcc = INTERVAL;
    this.clock = 0;
    this.path = [];
    this.mesh.visible = false;

    if ((save.ghostSeed >>> 0) !== (seed >>> 0)) return;
    if (!usable(save.ghost)) return;
    this.path = save.ghost;
  }

  /** Sample the body at 10Hz. Called every frame of a run; most do nothing. */
  record(dt: number, at: THREE.Vector3): void {
    this.recordAcc += dt;
    if (this.recordAcc < INTERVAL) return;
    // Subtracted, not zeroed: zeroing lets the cadence drift with the frame
    // rate, and a ghost recorded at 144Hz would then replay slow at 60.
    this.recordAcc -= INTERVAL;
    if (this.recorded.length >= MAX_SAMPLES * 3) return;
    // A decimetre. The body covers up to 5.5m between samples, so the
    // quantisation is invisible and it cuts the stored JSON by two thirds.
    this.recorded.push(dec(at.x), dec(at.y), dec(at.z));
  }

  setStyle(saturation: number, dotScale: number): void {
    this.material.uniforms.uSaturation.value = saturation;
    this.material.uniforms.uDotScale.value = Math.max(1, dotScale);
  }

  /**
   * Advance the replay and pose the figure.
   *
   * The clock runs whether or not the ghost is being shown: this is a race,
   * so switching it off in the pause menu hides your rival, it does not stop
   * them, and switching it back on finds them where they should be.
   */
  update(dt: number, animFrame: number, show: boolean): void {
    if (this.path.length === 0) return;
    this.clock += dt;
    if (!show || !this.sample(this.clock)) {
      // Hidden, or the stored run was shorter than this one and the ghost has
      // already crossed its own finish line.
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.pose(animFrame);
  }

  /**
   * Store this run as the ghost when it is the best one on this city.
   *
   * The seed is stored alongside it, and a seed change retires the old ghost
   * outright rather than comparing scores across two different cities.
   */
  commit(save: SaveData, seed: number, score: number): void {
    this.mesh.visible = false;
    if (this.recorded.length < MIN_SAMPLES * 3) return;
    const sameCity = (save.ghostSeed >>> 0) === (seed >>> 0);
    if (sameCity && score <= save.ghostScore && usable(save.ghost)) return;
    // A copy: `recorded` is emptied and refilled by the next run, and the
    // stored ghost must not be emptied along with it.
    save.ghost = this.recorded.slice();
    save.ghostScore = score;
    save.ghostSeed = seed >>> 0;
  }

  /** Position and heading at `t` seconds into the run. False when spent. */
  private sample(t: number): boolean {
    const s = this.path;
    const n = s.length / 3;
    const f = t / INTERVAL;
    const i = Math.floor(f);
    if (i < 0 || i >= n - 1) return false;

    // Catmull-Rom wants a neighbour either side; clamp at both ends.
    const a = Math.max(0, i - 1) * 3;
    const b = i * 3;
    const c = (i + 1) * 3;
    const d = Math.min(n - 1, i + 2) * 3;
    const k = f - i;
    this.position.set(
      spline(s[a], s[b], s[c], s[d], k),
      spline(s[a + 1], s[b + 1], s[c + 1], s[d + 1], k),
      spline(s[a + 2], s[b + 2], s[c + 2], s[d + 2], k)
    );

    // Heading off the segment being traversed rather than off the spline's
    // derivative: three to five metres of travel is a far steadier direction
    // than a tangent that reverses whenever the arc tightens.
    this.heading.set(s[c] - s[b], s[c + 1] - s[b + 1], s[c + 2] - s[b + 2]);
    if (this.heading.lengthSq() < 1e-6) this.heading.set(0, 0, -1);
    else this.heading.normalize();
    return true;
  }

  /**
   * Six boxes: torso, head, two arms reaching for a web that is not there,
   * two trailing legs. Posed a little over life size, because at two hundred
   * metres a 1.7m figure is three dots and a rumour.
   *
   * Sampled against the stepped animation clock, so the ghost is animated on
   * twos exactly like the hands are.
   */
  private pose(animFrame: number): void {
    const f = this.heading;
    right.copy(f).cross(UP);
    // Straight up or straight down: any perpendicular will do, and picking one
    // beats letting the basis collapse mid-dive.
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    up.copy(right).cross(f).normalize();

    const swing = Math.sin(animFrame * 0.55);

    this.segment(0, this.local(pa, 0, -0.34, -0.06), this.local(pb, 0, 0.39, 0.18), 0.39);
    this.segment(1, this.local(pa, 0, 0.53, 0.22), this.local(pb, 0, 0.85, 0.28), 0.3);

    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      this.local(pa, s * 0.23, 0.34, 0.16);
      this.local(pb, s * 0.35, 0.99 + swing * s * 0.14, 0.48 - swing * s * 0.16);
      this.segment(2 + i, pa, pb, 0.14);
      this.local(pa, s * 0.15, -0.39, -0.02);
      this.local(pb, s * 0.25, -1.1 + swing * s * 0.11, -0.41 - swing * s * 0.21);
      this.segment(4 + i, pa, pb, 0.17);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Figure space — x across, y up, z along travel — into the world. */
  private local(out: THREE.Vector3, x: number, y: number, z: number): THREE.Vector3 {
    return out
      .copy(this.position)
      .addScaledVector(right, x)
      .addScaledVector(up, y)
      .addScaledVector(this.heading, z);
  }

  /** Place instance `i` as a box spanning from -> to. */
  private segment(i: number, from: THREE.Vector3, to: THREE.Vector3, thickness: number): void {
    dir.subVectors(to, from);
    const len = dir.length();
    if (len < 1e-5) {
      matrix.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, matrix);
      return;
    }
    dir.multiplyScalar(1 / len);
    quat.setFromUnitVectors(UP, dir);
    mid.copy(from).addScaledVector(dir, len * 0.5);
    scaleV.set(thickness, len, thickness);
    matrix.compose(mid, quat, scaleV);
    this.mesh.setMatrixAt(i, matrix);
  }

  dispose(): void {
    this.mesh.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Uniform Catmull-Rom through four evenly spaced samples.
 *
 * A straight lerp between 10Hz samples chords the arc: at 50 m/s the control
 * points are five metres apart, and the ghost would turn in ten visible
 * corners a second. A cubic through the neighbours does not.
 */
function spline(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t;
  return (
    0.5 *
    (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t2 * t)
  );
}

function dec(v: number): number {
  return Math.round(v * 10) / 10;
}

/** localStorage is user-writable, so nothing about a stored ghost is trusted. */
function usable(raw: number[]): boolean {
  if (!Array.isArray(raw)) return false;
  if (raw.length < MIN_SAMPLES * 3 || raw.length % 3 !== 0) return false;
  for (let i = 0; i < raw.length; i++) if (!Number.isFinite(raw[i])) return false;
  return true;
}
