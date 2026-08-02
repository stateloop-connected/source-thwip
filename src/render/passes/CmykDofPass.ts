/**
 * Misprint depth of field — the single effect that most says "animated comic"
 * fastest.
 *
 * There is no lens blur in the film and there is none here. Out-of-focus
 * geometry splits into offset cyan/magenta/yellow ghosts, exactly as a
 * printing press does when its plates are out of register. A Gaussian blur
 * here would read as every other 3D game ever made.
 *
 * Focus distance follows what the player is looking at, smoothed on the CPU.
 */

import * as THREE from 'three';
import { ShaderPass, uniform, type Uniforms } from '../Fullscreen';
import { DEPTH } from '../glsl';

const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uFocusDist;
uniform float uFocusRange;
uniform float uMaxOffset;
uniform float uCell;
out vec4 fragColor;

${DEPTH}

void main() {
  float d = linearDepth(texture(tDepth, vUv).r, uNear, uFar);

  // Circle of confusion, but used as a plate offset rather than a blur radius.
  float coc = clamp(abs(d - uFocusDist) / max(1.0, uFocusRange), 0.0, 1.0);
  coc *= coc; // hold focus longer near the subject, then split hard

  vec2 texel = 1.0 / uResolution;
  // Registration error on a real press is measured in dots. Snapping the
  // offset to whole screen cells keeps each shifted plate aligned with its
  // own dot grid, which is what reads as misprint rather than as shearing.
  float amt = coc * uMaxOffset;
  if (uCell > 1.0) amt = uCell * floor(amt / uCell + 0.5);

  // Separations pull apart along opposite diagonals, like a slipped plate.
  vec2 rOff = vec2( amt,  amt * 0.5) * texel;
  vec2 bOff = vec2(-amt, -amt * 0.5) * texel;

  vec3 col;
  col.r = texture(tDiffuse, vUv + rOff).r;
  col.g = texture(tDiffuse, vUv).g;
  col.b = texture(tDiffuse, vUv + bOff).b;

  // A yellow plate offset perpendicular to the other two completes the CMY
  // triad; without it the split reads as plain chromatic aberration.
  vec2 yOff = vec2(amt * 0.35, -amt * 0.7) * texel;
  vec3 yellow = texture(tDiffuse, vUv + yOff).rgb;
  col = mix(col, min(col, vec3(yellow.r, yellow.g, col.b)), coc * 0.35);

  fragColor = vec4(col, 1.0);
}
`;

export function createCmykDofPass(
  depth: THREE.Texture,
  width: number,
  height: number
): ShaderPass {
  const uniforms: Uniforms = {
    tDiffuse: uniform<THREE.Texture | null>(null),
    tDepth: uniform(depth),
    uResolution: uniform(new THREE.Vector2(width, height)),
    uNear: uniform(0.12),
    uFar: uniform(2100),
    uFocusDist: uniform(60),
    uFocusRange: uniform(130),
    uMaxOffset: uniform(9),
    uCell: uniform(6.5),
  };
  return new ShaderPass('cmykDof', FRAG, uniforms);
}
