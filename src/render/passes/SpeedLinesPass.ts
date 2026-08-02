/**
 * Radial speed lines instead of motion blur.
 *
 * The film has no motion blur and neither does this. Lines emanate from the
 * screen-space velocity vector, so they streak away from wherever you are
 * actually heading rather than from the centre of the frame. This is the
 * primary sensation of velocity in the game — done right, 40 m/s reads as 100.
 */

import * as THREE from 'three';
import { ShaderPass, uniform, type Uniforms } from '../Fullscreen';
import { HASH } from '../glsl';

const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform vec2 uOrigin;
uniform float uAmount;
uniform float uDensity;
uniform float uAnimFrame;
uniform vec3 uInk;
out vec4 fragColor;

${HASH}

void main() {
  vec3 col = texture(tDiffuse, vUv).rgb;

  if (uAmount > 0.001) {
    float aspect = uResolution.x / uResolution.y;
    vec2 d = vUv - uOrigin;
    d.x *= aspect;
    float r = length(d);
    float a = atan(d.y, d.x);

    // One deterministic streak per angular slot; the slot count is the
    // density dial, and the seed steps so the pattern pops rather than slides.
    float slots = 64.0 + 150.0 * uDensity;
    float slot = floor(a / (6.2831853) * slots);
    float rnd = hash12(vec2(slot, floor(uAnimFrame * 0.5)));
    float rnd2 = hash12(vec2(slot + 91.0, floor(uAnimFrame * 0.5)));

    // Lines live in an annulus that closes toward the centre as speed rises.
    float inner = mix(0.62, 0.16, uAmount) + rnd * 0.22;
    float len = 0.18 + rnd2 * 0.5 * uAmount;
    float band = smoothstep(inner, inner + 0.05, r) * (1.0 - smoothstep(inner + len, inner + len + 0.22, r));

    // Thin the stroke: only the centre of each angular slot draws.
    float local = fract(a / 6.2831853 * slots);
    float stroke = 1.0 - smoothstep(0.0, 0.34 + rnd * 0.2, abs(local - 0.5) * 2.0);

    float line = band * stroke * step(0.35, rnd) * uAmount;
    // Dark ink near the frame edge, bright streaks in the mid field: comics
    // do both, and using only one reads as vignetting.
    col = mix(col, uInk, line * 0.55);
    col += vec3(1.0, 0.96, 0.9) * line * 0.28;
  }

  fragColor = vec4(col, 1.0);
}
`;

export function createSpeedLinesPass(width: number, height: number): ShaderPass {
  const uniforms: Uniforms = {
    tDiffuse: uniform<THREE.Texture | null>(null),
    uResolution: uniform(new THREE.Vector2(width, height)),
    uOrigin: uniform(new THREE.Vector2(0.5, 0.5)),
    uAmount: uniform(0),
    uDensity: uniform(1),
    uAnimFrame: uniform(0),
    uInk: uniform(new THREE.Color(0.05, 0.03, 0.09)),
  };
  return new ShaderPass('speedLines', FRAG, uniforms);
}
