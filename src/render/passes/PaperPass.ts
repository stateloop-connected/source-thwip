/**
 * The final plate: paper fibre, vignette, and a whole-frame misregistration
 * that drifts slowly.
 *
 * The rule is that the frame must never look digitally clean. Even at rank 12
 * with the glitch gone, a pixel-perfect image would read as a 3D render with
 * a filter on it rather than as ink that was physically pressed onto stock.
 */

import * as THREE from 'three';
import { ShaderPass, uniform, type Uniforms } from '../Fullscreen';
import { HASH, INK_PAPER, NOISE } from '../glsl';

const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uTime;
uniform float uGrain;
uniform float uVignette;
uniform float uSpeedVignette;
uniform float uMisregister;
uniform float uSaturation;
out vec4 fragColor;

${HASH}
${NOISE}
${INK_PAPER}

void main() {
  vec2 texel = 1.0 / uResolution;

  // Slow drift of the whole frame's plates, about a pixel.
  vec2 drift = vec2(sin(uTime * 0.31), cos(uTime * 0.23)) * uMisregister * texel;
  vec3 col;
  col.r = texture(tDiffuse, vUv + drift).r;
  col.g = texture(tDiffuse, vUv).g;
  col.b = texture(tDiffuse, vUv - drift).b;

  // Paper fibre: two scales of noise, multiplied like tooth in the stock.
  float fibre = vnoise(vUv * uResolution.xy * 0.55);
  float coarse = vnoise(vUv * uResolution.xy * 0.09);
  float tooth = mix(coarse, fibre, 0.65);
  col *= 1.0 - uGrain * (0.5 - tooth) * 1.4;

  // Vignette composited toward INK, not scaled toward zero. A multiplicative
  // vignette drags the corners into mid-grey and destroys the frame's
  // highlights -- it was killing 96% of pixels above L 0.85 on its own.
  vec2 v = vUv - 0.5;
  float r = dot(v, v);
  col = mix(col, INK, uVignette * smoothstep(0.10, 0.55, r));
  col = mix(col, INK, uSpeedVignette * smoothstep(0.06, 0.30, r) * 0.55);

  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export function createPaperPass(width: number, height: number): ShaderPass {
  const uniforms: Uniforms = {
    tDiffuse: uniform<THREE.Texture | null>(null),
    uResolution: uniform(new THREE.Vector2(width, height)),
    uTime: uniform(0),
    uGrain: uniform(0.12),
    uVignette: uniform(0.5),
    uSpeedVignette: uniform(0),
    uMisregister: uniform(1),
    uSaturation: uniform(1),
  };
  return new ShaderPass('paper', FRAG, uniforms);
}
