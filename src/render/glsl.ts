/**
 * Shared GLSL. These snippets are pasted into several shaders, so they live
 * in one place — a hash that disagrees between the outline pass and the
 * halftone pass shows up immediately as shimmering.
 */

/**
 * THE sun direction. One value, shared by the sky, the world and the suit.
 *
 * Azimuth is deliberately ~22 degrees off the street grid. With the light
 * square-on, the +X and -Z faces of every box return almost the same N.L and
 * collapse into the same lighting band, so every building corner between them
 * has zero value contrast and the three-band thresher degenerates to two.
 * Off-axis, all five surface orientations land in different bands.
 */
export const SUN_DIR: readonly [number, number, number] = [0.8, 0.5, -0.33];

export const SUN_GLSL = /* glsl */ `
const vec3 SUN_DIR = normalize(vec3(0.80, 0.50, -0.33));
`;

/** Ink and paper. The frame must have a real black point and a real white. */
export const INK_PAPER = /* glsl */ `
const vec3 INK = vec3(0.031, 0.024, 0.055);
const vec3 PAPER = vec3(0.961, 0.941, 0.882);
`;

/** Cheap deterministic hashes. No texture lookups anywhere in this project. */
export const HASH = /* glsl */ `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
`;

/** Value noise + 3-octave fbm, used for paper fibre, clouds and grime. */
export const NOISE = /* glsl */ `
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}
`;

/**
 * Ben-Day dots. Each channel is sampled at a different print angle — that
 * misalignment is the whole trick, it is what makes it read as ink on paper
 * rather than as a screen-door filter.
 */
export const HALFTONE = /* glsl */ `
float halftone(vec2 uv, float angle, float intensity, float scale, vec2 res) {
  float s = sin(angle), c = cos(angle);
  vec2 p = uv * res / max(scale, 0.5);
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  vec2 cell = fract(p) - 0.5;
  float radius = sqrt(clamp(1.0 - intensity, 0.0, 1.0)) * 0.55;
  return smoothstep(radius + 0.03, radius - 0.03, length(cell));
}
`;

/** Screen-space ink hatching for the darkest lighting band. */
export const HATCH = /* glsl */ `
float hatch(vec2 uv, float angle, float freq) {
  float s = sin(angle), c = cos(angle);
  vec2 p = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
  return smoothstep(0.35, 0.5, abs(fract(p.y * freq) - 0.5));
}
`;

/** Perspective depth buffer value -> metres. */
export const DEPTH = /* glsl */ `
float linearDepth(float d, float near, float far) {
  float z = d * 2.0 - 1.0;
  return (2.0 * near * far) / (far + near - z * (far - near));
}
`;

export const LUMA = /* glsl */ `
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

/**
 * Standard fullscreen-triangle vertex shader for every post pass.
 * No `#version` directive here or in any other shader in this project —
 * Three prepends it for GLSL3 materials, and a second one is a compile error.
 */
export const FULLSCREEN_VERT = /* glsl */ `
precision highp float;
in vec2 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;
