/**
 * The "thresher": hard-stepped lighting, three bands, no smooth falloff
 * anywhere. Written as a RawShaderMaterial so nothing from Three's lighting
 * chunks can sneak a smooth diffuse term back in, and so the fragment shader
 * can write the MRT normal buffer the outline and DoF passes need.
 *
 * One material serves every building in the city. Variation comes from
 * per-instance attributes (tint, facade layer, roof layer, seed), which is
 * what keeps the whole city inside a handful of draw calls.
 */

import * as THREE from 'three';
import { HASH, HATCH, NOISE, SUN_DIR } from './glsl';

const VERT = /* glsl */ `
precision highp float;

in vec3 position;
in vec3 normal;
in vec2 uv;
#ifdef USE_INSTANCING
in mat4 instanceMatrix;
in vec3 iTint;
in vec2 iLayers;
in float iSeed;
#endif

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform float uTexelsPerMetre;

out vec2 vUv;
out vec3 vNormalView;
out vec3 vNormalWorld;
out vec3 vWorld;
out vec3 vTint;
out vec2 vLayers;
out float vSeed;
out float vLocalY;
out float vHeight;

void main() {
  vec3 pos = position;
  vec3 nrm = normal;
  vec3 scale = vec3(1.0);
  vec3 tint = vec3(1.0);
  vec2 layers = vec2(0.0);
  float seed = 0.0;

#ifdef USE_INSTANCING
  scale = vec3(
    length(instanceMatrix[0].xyz),
    length(instanceMatrix[1].xyz),
    length(instanceMatrix[2].xyz)
  );
  tint = iTint;
  layers = iLayers;
  seed = iSeed;
  vec4 world4 = modelMatrix * instanceMatrix * vec4(pos, 1.0);
  mat3 instRot = mat3(
    instanceMatrix[0].xyz / max(scale.x, 1e-4),
    instanceMatrix[1].xyz / max(scale.y, 1e-4),
    instanceMatrix[2].xyz / max(scale.z, 1e-4)
  );
  nrm = instRot * nrm;
#else
  vec4 world4 = modelMatrix * vec4(pos, 1.0);
#endif

  vWorld = world4.xyz;
  vNormalWorld = normalize(mat3(modelMatrix) * nrm);
  vNormalView = normalize(normalMatrix * nrm);

  // Facade tiling derived from the instance's real-world size, so a window
  // is the same physical size on a 12m brownstone and a 160m tower.
  vec2 tiling;
  vec3 an = abs(normal);
  if (an.y > 0.5)      tiling = vec2(scale.x, scale.z);
  else if (an.x > 0.5) tiling = vec2(scale.z, scale.y);
  else                 tiling = vec2(scale.x, scale.y);
  // Per-instance phase shift. Without it every building's window grid lines
  // up with its neighbours and the whole city reads as one repeated tile.
  vec2 phase = fract(vec2(seed * 0.7371, seed * 0.3193));
  vUv = uv * tiling * uTexelsPerMetre + phase;

  vTint = tint;
  vLayers = layers;
  vSeed = seed;
  vLocalY = (position.y + 0.5) * scale.y;
  vHeight = scale.y;

  gl_Position = projectionMatrix * viewMatrix * world4;
}
`;

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DArray;

in vec2 vUv;
in vec3 vNormalView;
in vec3 vNormalWorld;
in vec3 vWorld;
in vec3 vTint;
in vec2 vLayers;
in float vSeed;
in float vLocalY;
in float vHeight;

uniform sampler2DArray uFacades;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec3 uHaze;
uniform vec3 uCameraPos;
uniform float uFogNear;
uniform float uFogFar;
uniform float uSaturation;
uniform float uHatching;
uniform float uWindowGlow;

layout(location = 0) out vec4 gColor;
layout(location = 1) out vec4 gNormal;

${HASH}
${NOISE}
${HATCH}

vec3 saturate3(vec3 c, float s) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, s);
}

void main() {
  bool isRoof = abs(vNormalWorld.y) > 0.55;
  float layer = isRoof ? vLayers.y : vLayers.x;
  vec4 tex = texture(uFacades, vec3(vUv, layer));

  vec3 base = tex.rgb * vTint;

  // -- thresher: exactly three bands, hard steps, never a smooth ramp -----
  float ndl = dot(normalize(vNormalWorld), uLightDir) * 0.5 + 0.5;
  int bandIndex = ndl < 0.35 ? 0 : (ndl < 0.72 ? 1 : 2);

  // Ambient occlusion at the base of every building and large-scale grime,
  // standing in for the shadow maps this renderer deliberately does not have.
  //
  // Both DEMOTE the band index rather than multiplying on top of it. As
  // continuous multipliers they spanned 2.4x and 1.16x, which is a wider
  // tonal range than the step from band 0 to band 1 -- a smooth gradient
  // out-ranging the quantised one, which is exactly what the look forbids.
  float aoT = smoothstep(0.0, min(24.0, vHeight * 0.55), vLocalY);
  int aoStep = aoT < 0.30 ? 2 : (aoT < 0.66 ? 1 : 0);
  int dirt = vnoise(vWorld.xz * 0.035 + vSeed * 13.0) < 0.40 ? 1 : 0;
  int finalBand = bandIndex - aoStep - dirt;
  finalBand = finalBand < 0 ? 0 : (finalBand > 2 ? 2 : finalBand);
  float band = finalBand == 0 ? 0.30 : (finalBand == 1 ? 0.68 : 1.0);

  vec3 lit = base * (uLightColor * band + uAmbient);

  // -- hatching, darkest band only ---------------------------------------
  if (uHatching > 0.5 && finalBand == 0) {
    vec2 sp = gl_FragCoord.xy;
    float h1 = hatch(sp, 0.785, 0.115);
    lit *= mix(0.62, 1.0, h1);
    if (ndl < 0.18) {
      float h2 = hatch(sp, 2.356, 0.105);
      lit *= mix(0.72, 1.0, h2);
    }
  }

  // -- lit windows: emissive, immune to the lighting bands ----------------
  float win = tex.a;
  if (win > 0.01) {
    vec3 glow = mix(vec3(1.0, 0.86, 0.42), vec3(0.55, 0.92, 1.0), hash11(vSeed * 7.7 + floor(vUv.x) + floor(vUv.y) * 31.0));
    lit = mix(lit, glow * uWindowGlow, win);
  }

  // -- distance haze: districts fade into the print rather than popping ---
  float dist = length(vWorld - uCameraPos);
  float fog = smoothstep(uFogNear, uFogFar, dist);
  lit = mix(lit, uHaze, fog * 0.92);

  lit = saturate3(lit, uSaturation);

  gColor = vec4(lit, 1.0);
  gNormal = vec4(normalize(vNormalView) * 0.5 + 0.5, 1.0);
}
`;

export interface ToonUniforms {
  uFacades: THREE.IUniform<THREE.DataArrayTexture | null>;
  uLightDir: THREE.IUniform<THREE.Vector3>;
  uLightColor: THREE.IUniform<THREE.Color>;
  uAmbient: THREE.IUniform<THREE.Color>;
  uHaze: THREE.IUniform<THREE.Color>;
  uCameraPos: THREE.IUniform<THREE.Vector3>;
  uFogNear: THREE.IUniform<number>;
  uFogFar: THREE.IUniform<number>;
  uSaturation: THREE.IUniform<number>;
  uHatching: THREE.IUniform<number>;
  uWindowGlow: THREE.IUniform<number>;
  uTexelsPerMetre: THREE.IUniform<number>;
}

/**
 * One low sun, one cool fill. Matches the sky's sun direction exactly.
 *
 * RawShaderMaterial gets no automatic defines from Three, so USE_INSTANCING
 * has to be declared here by hand — the renderer still binds `instanceMatrix`
 * from the InstancedMesh as long as the shader declares the attribute.
 */
export function createToonMaterial(
  facades: THREE.DataArrayTexture,
  instanced = true
): THREE.RawShaderMaterial {
  const uniforms: ToonUniforms = {
    uFacades: { value: facades },
    uLightDir: { value: new THREE.Vector3(...SUN_DIR).normalize() },
    // Scaled so the brightest facade albedo lands near 0.95 at band 1.0
    // instead of clipping: 9.3% of the frame had a pinned red channel, which
    // kills hue AND removes the halftone dots from the brightest areas.
    uLightColor: { value: new THREE.Color(1.0, 0.82, 0.6) },
    uAmbient: { value: new THREE.Color(0.26, 0.24, 0.46) },
    uHaze: { value: new THREE.Color(0.74, 0.35, 0.42) },
    uCameraPos: { value: new THREE.Vector3() },
    uFogNear: { value: 240 },
    uFogFar: { value: 1080 },
    uSaturation: { value: 0.62 },
    uHatching: { value: 1 },
    uWindowGlow: { value: 1 },
    uTexelsPerMetre: { value: 1 / 4.2 },
  };

  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    defines: instanced ? { USE_INSTANCING: '' } : {},
    side: THREE.FrontSide,
    transparent: false,
  });
}

// -- suit ------------------------------------------------------------------

const SUIT_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
in mat4 instanceMatrix;
in vec3 iTint;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat4 modelMatrix;
uniform mat3 normalMatrix;
out vec3 vNormalView;
out vec3 vNormalWorld;
out vec3 vTint;
out vec3 vLocal;
out vec3 vViewDir;
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
  vec3 nrm = instRot * normal;
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vNormalWorld = normalize(mat3(modelMatrix) * nrm);
  vNormalView = normalize(normalMatrix * nrm);
  vTint = iTint;
  vLocal = position;
  vec4 viewPos = viewMatrix * world;
  vViewDir = normalize(-viewPos.xyz);
  gl_Position = projectionMatrix * viewPos;
}
`;

const SUIT_FRAG = /* glsl */ `
precision highp float;
in vec3 vNormalView;
in vec3 vNormalWorld;
in vec3 vTint;
in vec3 vLocal;
in vec3 vViewDir;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec3 uRim;
uniform float uSaturation;
uniform float uCamo;
layout(location = 0) out vec4 gColor;
layout(location = 1) out vec4 gNormal;

vec3 saturate3(vec3 c, float s) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, s);
}

void main() {
  float ndl = dot(normalize(vNormalWorld), uLightDir) * 0.5 + 0.5;
  float band = ndl < 0.35 ? 0.30 : (ndl < 0.72 ? 0.68 : 1.0);
  vec3 lit = vTint * (uLightColor * band + uAmbient);

  // Hard cyan/magenta rim so a black suit still reads against a dark city.
  float rim = pow(1.0 - max(dot(normalize(vNormalView), normalize(vViewDir)), 0.0), 2.4);
  lit += uRim * step(0.55, rim) * 0.9;

  lit = saturate3(lit, uSaturation);
  // Active camouflage: fade to a bare rim outline rather than vanishing.
  float alpha = mix(1.0, 0.16, uCamo);
  lit = mix(lit, uRim * 0.8, uCamo * 0.7);
  gColor = vec4(lit, alpha);
  gNormal = vec4(normalize(vNormalView) * 0.5 + 0.5, 1.0);
}
`;

/** Black suit, red accents, hard rim. Used by the first-person limbs. */
export function createSuitMaterial(): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: SUIT_VERT,
    fragmentShader: SUIT_FRAG,
    uniforms: {
      uLightDir: { value: new THREE.Vector3(0.62, 0.42, -0.66).normalize() },
      uLightColor: { value: new THREE.Color(1.32, 1.02, 0.74) },
      uAmbient: { value: new THREE.Color(0.34, 0.3, 0.58) },
      uRim: { value: new THREE.Color(1.0, 0.12, 0.24) },
      uSaturation: { value: 0.62 },
      uCamo: { value: 0 },
    },
    defines: { USE_INSTANCING: '' },
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: true,
  });
}
