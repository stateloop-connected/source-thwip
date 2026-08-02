/**
 * Rank-driven glitch, plus impact bursts.
 *
 * At rank 1 this fires constantly, which conveniently means early-game jank
 * reads as intentional style. As the player ranks up it recedes to nothing,
 * and the world literally resolves around them.
 *
 * Everything here samples the stepped animation clock, so the tearing pops on
 * twos like the rest of the character animation rather than sliding smoothly.
 */

import * as THREE from 'three';
import { ShaderPass, uniform, type Uniforms } from '../Fullscreen';
import { HASH } from '../glsl';

const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uAmount;
uniform float uImpact;
uniform float uAnimFrame;
out vec4 fragColor;

${HASH}

void main() {
  float amt = clamp(uAmount + uImpact, 0.0, 1.6);
  if (amt < 0.002) {
    fragColor = vec4(texture(tDiffuse, vUv).rgb, 1.0);
    return;
  }

  float frame = floor(uAnimFrame);
  vec2 uv = vUv;

  // Horizontal block displacement: a couple of bands slip sideways.
  //
  // Magnitudes are deliberately small. amt = 1.0 is rank 1, which the player
  // sees for their entire first hour: it has to read as a printing defect
  // they can still aim through, not as a broken signal.
  float blocks = 14.0;
  float row = floor(vUv.y * blocks);
  float rowSeed = hash12(vec2(row, frame));
  // 'active' is a reserved word in GLSL ES 3.0.
  float rowOn = step(1.0 - 0.10 * amt, rowSeed);
  float shift = (hash12(vec2(row + 37.0, frame)) - 0.5) * 0.018 * amt * rowOn;
  uv.x = fract(uv.x + shift);

  // Whole-frame jolt on impacts only.
  uv.x += (hash12(vec2(frame, 3.0)) - 0.5) * 0.012 * uImpact;

  // Channel tearing, each plate pulled a different way.
  float sep = (0.0005 + 0.0018 * amt) * (0.4 + 0.6 * hash12(vec2(frame, 7.0)));
  vec3 col;
  col.r = texture(tDiffuse, uv + vec2(sep, 0.0)).r;
  col.g = texture(tDiffuse, uv).g;
  col.b = texture(tDiffuse, uv - vec2(sep * 0.8, sep * 0.3)).b;

  // Occasional scanline dropout.
  float drop = step(0.997 - 0.006 * amt, hash12(vec2(floor(vUv.y * uResolution.y * 0.5), frame)));
  col = mix(col, col * vec3(1.25, 0.95, 1.15), drop * amt * 0.5);

  fragColor = vec4(col, 1.0);
}
`;

export function createGlitchPass(width: number, height: number): ShaderPass {
  const uniforms: Uniforms = {
    tDiffuse: uniform<THREE.Texture | null>(null),
    uResolution: uniform(new THREE.Vector2(width, height)),
    uAmount: uniform(1),
    uImpact: uniform(0),
    uAnimFrame: uniform(0),
  };
  return new ShaderPass('glitch', FRAG, uniforms);
}
