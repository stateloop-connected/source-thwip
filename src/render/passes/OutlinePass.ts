/**
 * Sobel edges on depth + view normals, with line boil.
 *
 * The boil is the whole point. A static sobel outline reads as a filter
 * applied to a 3D game; jittering the sample offsets with noise that only
 * changes when the STEPPED animation clock ticks reads as a human re-inking
 * the same drawing every other frame. Get the stepping wrong and it just
 * looks like the edges are vibrating.
 */

import { ShaderPass, uniform, type Uniforms } from '../Fullscreen';
import { DEPTH, HASH } from '../glsl';
import * as THREE from 'three';

const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uThickness;
uniform float uStrength;
uniform float uBoil;
uniform float uAnimFrame;
uniform float uPixelScale;
uniform vec3 uInk;
out vec4 fragColor;

${HASH}
${DEPTH}

float depthAt(vec2 uv) {
  return linearDepth(texture(tDepth, uv).r, uNear, uFar);
}

void main() {
  vec3 base = texture(tDiffuse, vUv).rgb;
  vec2 texel = 1.0 / uResolution;

  float d0 = depthAt(vUv);

  // Closer geometry gets a heavier line, the way an inker weights foreground.
  // Thickness is authored in CSS pixels and scaled into buffer texels here,
  // otherwise the line gets THINNER as quality rises -- sub-pixel at high,
  // two pixels at low, which is exactly backwards.
  float proximity = clamp(1.0 - d0 / 260.0, 0.0, 1.0);
  float width = uThickness * uPixelScale * (0.9 + 1.5 * proximity);

  // Boil: hash keyed on the stepped animation index, quantised in screen
  // space so neighbouring pixels share a wobble instead of shimmering.
  vec2 boil = (hash22(floor(vUv * uResolution / 3.0) + vec2(uAnimFrame, uAnimFrame * 1.7)) - 0.5)
              * 0.0022 * uBoil;
  vec2 uv = vUv + boil;

  vec2 o = texel * width;
  float dl = depthAt(uv - vec2(o.x, 0.0));
  float dr = depthAt(uv + vec2(o.x, 0.0));
  float du = depthAt(uv - vec2(0.0, o.y));
  float dd = depthAt(uv + vec2(0.0, o.y));

  // Depth edge, normalised by distance so far geometry does not go solid black.
  float depthEdge = (abs(dl - d0) + abs(dr - d0) + abs(du - d0) + abs(dd - d0));
  depthEdge /= max(1.0, d0 * 0.22);

  vec3 n0 = texture(tNormal, uv).rgb * 2.0 - 1.0;
  vec3 nl = texture(tNormal, uv - vec2(o.x, 0.0)).rgb * 2.0 - 1.0;
  vec3 nr = texture(tNormal, uv + vec2(o.x, 0.0)).rgb * 2.0 - 1.0;
  vec3 nu = texture(tNormal, uv - vec2(0.0, o.y)).rgb * 2.0 - 1.0;
  vec3 nd = texture(tNormal, uv + vec2(0.0, o.y)).rgb * 2.0 - 1.0;
  float normalEdge = (1.0 - dot(n0, nl)) + (1.0 - dot(n0, nr))
                   + (1.0 - dot(n0, nu)) + (1.0 - dot(n0, nd));

  float edge = smoothstep(0.55, 1.25, depthEdge) + smoothstep(0.85, 1.9, normalEdge);
  edge = clamp(edge, 0.0, 1.0) * uStrength;

  // Never ink the far haze - the skyline should dissolve, not be outlined.
  //
  // Gate on the NEAREST depth in the neighbourhood, not the centre. Sky
  // pixels linearise to the far plane, so gating on the centre meant the
  // outside of every building silhouette against the sky was never inked at
  // all -- only a one-pixel strip inside it, in ink the same value as the
  // building. That is the whole skyline read, and it was missing.
  float dNear = min(min(dl, dr), min(du, dd));
  edge *= 1.0 - smoothstep(uFar * 0.45, uFar * 0.92, min(d0, dNear));

  fragColor = vec4(mix(base, uInk, edge), 1.0);
}
`;

export function createOutlinePass(
  depth: THREE.Texture,
  normal: THREE.Texture,
  width: number,
  height: number
): ShaderPass {
  const uniforms: Uniforms = {
    tDiffuse: uniform<THREE.Texture | null>(null),
    tDepth: uniform(depth),
    tNormal: uniform(normal),
    uResolution: uniform(new THREE.Vector2(width, height)),
    uNear: uniform(0.12),
    uFar: uniform(2100),
    uThickness: uniform(2.2),
    uStrength: uniform(1),
    uBoil: uniform(1),
    uAnimFrame: uniform(0),
    uPixelScale: uniform(1),
    // Darker than any surface it can be drawn on. At (0.04,0.03,0.07) the
    // ink matched the shadow band it was inking and the line vanished.
    uInk: uniform(new THREE.Color(0.012, 0.008, 0.026)),
  };
  return new ShaderPass('outline', FRAG, uniforms);
}
