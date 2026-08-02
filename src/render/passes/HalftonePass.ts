/**
 * Ben-Day dots at misaligned print angles.
 *
 * Each channel is screened at its own classic press angle — C 15, M 75, Y 0 —
 * and it is that misregistration that produces the off-register moire the eye
 * reads as "printed". Screening all three channels at the same angle gives a
 * clean dot grid that reads as a screen-door filter instead.
 *
 * Dot size is driven by luminance, so shadows go coarse and crude while
 * highlights lose their dots entirely.
 */

import * as THREE from 'three';
import { ShaderPass, uniform, type Uniforms } from '../Fullscreen';
import { DEPTH, HALFTONE, INK_PAPER, LUMA } from '../glsl';

const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2 uResolution;
uniform float uScale;
uniform float uStrength;
uniform float uPixelScale;
uniform float uNear;
uniform float uFar;
out vec4 fragColor;

${HALFTONE}
${LUMA}
${DEPTH}
${INK_PAPER}

void main() {
  vec3 c = texture(tDiffuse, vUv).rgb;
  float scale = uScale * uPixelScale;

  // A black plate first. Screening R/G/B as three equal process inks makes
  // shadows into rainbow confetti, because the three screens' gaps almost
  // never coincide. Real comic shadow is ink black plus ONE accent screen.
  float k = 1.0 - max(max(c.r, c.g), c.b);
  float ki = halftone(vUv, 0.7854, 1.0 - k, scale, uResolution); // 45 deg, K

  // One accent plate carries the hue: magenta where the pixel is warm,
  // cyan where it is cool.
  float warm = step(c.b, c.r);
  float accentAngle = warm > 0.5 ? 1.3090 : 0.2618; // 75 deg / 15 deg
  vec3 accentInk = warm > 0.5 ? vec3(0.86, 0.14, 0.44) : vec3(0.13, 0.72, 0.88);
  float chroma = clamp(max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b), 0.0, 1.0);
  float ai = halftone(vUv, accentAngle, 1.0 - chroma, scale, uResolution);

  // Ink on paper, with a real black point and a real white point.
  vec3 printed = mix(PAPER, INK, ki);
  printed = mix(printed, accentInk, ai * (1.0 - ki) * 0.85);

  // Vanish in light, bite hard in shadow -- and never screen the sky, which
  // is 40% of the frame and reads as a screen-door filter over the whole
  // image the moment it gets dots.
  float depth = linearDepth(texture(tDepth, vUv).r, uNear, uFar);
  float sky = step(uFar * 0.95, depth);
  float amount = uStrength * (1.0 - smoothstep(0.55, 0.95, luma(c))) * (1.0 - sky);

  fragColor = vec4(mix(c, printed, amount), 1.0);
}
`;

export function createHalftonePass(
  depth: THREE.Texture,
  width: number,
  height: number
): ShaderPass {
  const uniforms: Uniforms = {
    tDiffuse: uniform<THREE.Texture | null>(null),
    tDepth: uniform(depth),
    uResolution: uniform(new THREE.Vector2(width, height)),
    uScale: uniform(6.5),
    uStrength: uniform(1),
    uPixelScale: uniform(1),
    uNear: uniform(0.12),
    uFar: uniform(2100),
  };
  return new ShaderPass('halftone', FRAG, uniforms);
}
