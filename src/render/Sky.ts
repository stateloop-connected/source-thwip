/**
 * The sky is a single fullscreen triangle drawn first, with depth writes off.
 * Two consequences, both wanted: it costs one triangle, and sky pixels keep
 * the cleared far-plane depth, so the CMYK misprint pass splits the horizon
 * into colour ghosts exactly the way an out-of-register press would.
 */

import * as THREE from 'three';
import { HASH, NOISE, SUN_GLSL } from './glsl';

const VERT = /* glsl */ `
precision highp float;
in vec2 position;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
out vec3 vDir;
void main() {
  vec4 view = uInvProj * vec4(position, 1.0, 1.0);
  vDir = mat3(uCamWorld) * (view.xyz / view.w);
  gl_Position = vec4(position, 1.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec3 vDir;
uniform float uTime;
uniform float uSaturation;
layout(location = 0) out vec4 gColor;
layout(location = 1) out vec4 gNormal;

${HASH}
${NOISE}
${SUN_GLSL}

const vec3 ZENITH  = vec3(0.086, 0.055, 0.212);
const vec3 UPPER   = vec3(0.278, 0.106, 0.427);
const vec3 MID     = vec3(0.686, 0.153, 0.478);
const vec3 HORIZON = vec3(0.920, 0.400, 0.267);
const vec3 GLOW    = vec3(1.000, 0.831, 0.259);
const vec3 BELOW   = vec3(0.129, 0.078, 0.180);

vec3 saturate3(vec3 c, float s) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, s);
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;

  // Four stops, then a light quantise so the gradient reads as printed
  // separations rather than a smooth digital ramp.
  vec3 col = mix(HORIZON, MID, smoothstep(-0.02, 0.16, h));
  col = mix(col, UPPER, smoothstep(0.12, 0.42, h));
  col = mix(col, ZENITH, smoothstep(0.38, 0.9, h));
  col = mix(BELOW, col, smoothstep(-0.16, 0.0, h));

  // The one shared sun. The disc has to sit where the key light comes from,
  // or in a world with no shadows nothing ties the geometry to the sky.
  vec3 sunDir = SUN_DIR;
  float sun = max(dot(dir, sunDir), 0.0);
  col += GLOW * pow(sun, 34.0) * 0.85;
  col += GLOW * pow(sun, 6.0) * 0.16;

  // stylised cloud bands: two posterised tones, drifting slowly
  float band = 1.0 - abs(h);
  vec2 cuv = vec2(atan(dir.z, dir.x) * 1.9, h * 5.2) + vec2(uTime * 0.011, 0.0);
  float clouds = fbm(cuv * 1.6);
  clouds = smoothstep(0.48, 0.72, clouds) * smoothstep(0.02, 0.30, h) * band;
  col = mix(col, mix(col, vec3(1.0, 0.87, 0.78), 0.55), clouds * 0.75);
  float rim = smoothstep(0.60, 0.78, fbm(cuv * 1.6 + 0.9)) * clouds;
  col = mix(col, vec3(1.0, 0.55, 0.62), rim * 0.35);

  // hard banding, 14 steps — the sky gets the thresher treatment too
  col = floor(col * 14.0 + 0.5) / 14.0;
  col = saturate3(col, uSaturation);

  gColor = vec4(col, 1.0);
  // Face the camera so the outline pass finds no edges in open sky.
  gNormal = vec4(0.5, 0.5, 1.0, 0.0);
}
`;

export class Sky {
  readonly mesh: THREE.Mesh;
  private material: THREE.RawShaderMaterial;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2)
    );
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uTime: { value: 0 },
        uSaturation: { value: 0.62 },
      },
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.matrixAutoUpdate = false;
  }

  update(camera: THREE.PerspectiveCamera, time: number, saturation: number): void {
    const u = this.material.uniforms;
    (u.uInvProj.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (u.uCamWorld.value as THREE.Matrix4).copy(camera.matrixWorld);
    u.uTime.value = time;
    u.uSaturation.value = saturation;
  }

  dispose(): void {
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
