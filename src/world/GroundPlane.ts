/**
 * Street level: one canvas-painted tile repeated across the playfield, plus
 * the river. Both write the MRT outputs so the outline and DoF passes treat
 * them like any other surface.
 */

import * as THREE from 'three';
import type { Rng } from '../core/Rng';
import { HALF, RIVER } from './Districts';
import { HASH, NOISE } from '../render/glsl';

/** Metres of street covered by one tile. Streets sit on a 60m pitch. */
const TILE_METRES = 120;
const TILE_PX = 1024;

export function buildStreetTexture(rng: Rng): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = TILE_PX;
  c.height = TILE_PX;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const px = TILE_PX / TILE_METRES; // pixels per metre

  // sidewalk / lot base
  g.fillStyle = '#4a4550';
  g.fillRect(0, 0, TILE_PX, TILE_PX);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
    g.fillRect(rng.f() * TILE_PX, rng.f() * TILE_PX, rng.range(2, 14), rng.range(2, 14));
  }

  const roadW = 16 * px;
  const half = TILE_PX / 2;
  const centres = [0, half];

  // asphalt
  g.fillStyle = '#26242e';
  for (const cy of centres) {
    g.fillRect(0, cy - roadW / 2, TILE_PX, roadW);
    g.fillRect(cy - roadW / 2, 0, roadW, TILE_PX);
  }

  // kerbs
  g.fillStyle = '#6d6878';
  for (const cy of centres) {
    g.fillRect(0, cy - roadW / 2 - 2, TILE_PX, 3);
    g.fillRect(0, cy + roadW / 2, TILE_PX, 3);
    g.fillRect(cy - roadW / 2 - 2, 0, 3, TILE_PX);
    g.fillRect(cy + roadW / 2, 0, 3, TILE_PX);
  }

  // dashed centre lines
  g.fillStyle = '#e8c93a';
  const dash = 5 * px;
  const gap = 4 * px;
  for (const cy of centres) {
    for (let x = 0; x < TILE_PX; x += dash + gap) {
      g.fillRect(x, cy - 1.5, dash, 3);
      g.fillRect(cy - 1.5, x, 3, dash);
    }
  }

  // crosswalks at every intersection
  g.fillStyle = '#d9d4c4';
  const stripe = 1.1 * px;
  for (const cx of centres) {
    for (const cy of centres) {
      for (let i = 0; i < 7; i++) {
        const off = -roadW / 2 + 1.5 * px + i * (roadW / 7.5);
        g.fillRect(cx + off, cy - roadW / 2 - 5 * px, stripe, 4 * px);
        g.fillRect(cx + off, cy + roadW / 2 + 1 * px, stripe, 4 * px);
        g.fillRect(cx - roadW / 2 - 5 * px, cy + off, 4 * px, stripe);
        g.fillRect(cx + roadW / 2 + 1 * px, cy + off, 4 * px, stripe);
      }
    }
  }

  // manholes, patches, tyre polish
  for (let i = 0; i < 40; i++) {
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.beginPath();
    g.arc(rng.f() * TILE_PX, rng.f() * TILE_PX, rng.range(3, 9), 0, Math.PI * 2);
    g.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

const GROUND_VERT = /* glsl */ `
precision highp float;
in vec3 position;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat4 modelMatrix;
uniform mat3 normalMatrix;
out vec3 vWorld;
out vec3 vNormalView;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalView = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const GROUND_FRAG = /* glsl */ `
precision highp float;
in vec3 vWorld;
in vec3 vNormalView;
uniform sampler2D uStreet;
uniform vec3 uAmbient;
uniform vec3 uHaze;
uniform vec3 uCameraPos;
uniform float uFogNear;
uniform float uFogFar;
uniform float uSaturation;
uniform float uTileMetres;
layout(location = 0) out vec4 gColor;
layout(location = 1) out vec4 gNormal;
${HASH}
${NOISE}
vec3 saturate3(vec3 c, float s) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, s);
}
void main() {
  // UVs come from world position, not mesh UVs, so the street grid stays
  // continuous across the two ground slabs that straddle the river.
  vec3 base = texture(uStreet, vWorld.xz / uTileMetres).rgb;
  // The street is in permanent shade between the towers: one flat band, and
  // a slow large-scale mottle so it never reads as a single digital fill.
  float mottle = 0.86 + 0.2 * vnoise(vWorld.xz * 0.012);
  vec3 lit = base * (uAmbient * 2.6) * mottle;
  float dist = length(vWorld - uCameraPos);
  lit = mix(lit, uHaze, smoothstep(uFogNear, uFogFar, dist) * 0.98);
  lit = saturate3(lit, uSaturation);
  gColor = vec4(lit, 1.0);
  gNormal = vec4(normalize(vNormalView) * 0.5 + 0.5, 1.0);
}
`;

const WATER_FRAG = /* glsl */ `
precision highp float;
in vec3 vWorld;
in vec3 vNormalView;
uniform vec3 uHaze;
uniform vec3 uCameraPos;
uniform float uFogNear;
uniform float uFogFar;
uniform float uSaturation;
uniform float uTime;
layout(location = 0) out vec4 gColor;
layout(location = 1) out vec4 gNormal;
${HASH}
${NOISE}
vec3 saturate3(vec3 c, float s) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, s);
}
void main() {
  // Ripples, not blobs: high frequency across the current, stretched along
  // it, with a slow swell underneath. Three flat tones, hard stepped.
  float ripple = fbm(vec2(vWorld.x * 0.26, vWorld.z * 0.075 + uTime * 0.55));
  float swell = fbm(vec2(vWorld.x * 0.045, vWorld.z * 0.02 - uTime * 0.14));
  float w = ripple * 0.68 + swell * 0.42;
  float bands = step(0.52, w) + step(0.63, w);
  vec3 deep = vec3(0.078, 0.106, 0.227);
  vec3 mid  = vec3(0.165, 0.259, 0.427);
  vec3 crest = vec3(0.976, 0.647, 0.494);
  vec3 col = bands < 0.5 ? deep : (bands < 1.5 ? mid : crest);
  // sun glitter concentrated in a lane, so the river has a direction
  float lane = exp(-abs(vWorld.x - 262.0) * 0.022);
  col = mix(col, crest, lane * step(0.60, ripple) * 0.7);
  col *= 0.92 + 0.16 * vnoise(vWorld.xz * 0.9);
  float dist = length(vWorld - uCameraPos);
  col = mix(col, uHaze, smoothstep(uFogNear, uFogFar, dist) * 0.95);
  col = saturate3(col, uSaturation);
  gColor = vec4(col, 1.0);
  gNormal = vec4(normalize(vNormalView) * 0.5 + 0.5, 1.0);
}
`;

export interface GroundBundle {
  slabs: THREE.Mesh[];
  water: THREE.Mesh;
  groundMaterial: THREE.RawShaderMaterial;
  waterMaterial: THREE.RawShaderMaterial;
}

/**
 * Two ground slabs, west and east of the river, so the water is a real
 * trench rather than a plane hidden under the street. Both extend far past
 * the playfield: the city's edge must dissolve into haze, never end at a
 * visible seam.
 */
export function createGround(street: THREE.CanvasTexture): GroundBundle {
  const shared = {
    uAmbient: { value: new THREE.Color(0.3, 0.28, 0.5) },
    uHaze: { value: new THREE.Color(0.74, 0.35, 0.42) },
    uCameraPos: { value: new THREE.Vector3() },
    uFogNear: { value: 240 },
    uFogFar: { value: 1080 },
    uSaturation: { value: 0.62 },
  };

  // Just past the playfield. Any further and the naked street grid — painted
  // crosswalks and centre lines over nothing — is legible to the horizon and
  // advertises exactly where the world stops.
  const reach = HALF + 260;
  const groundMaterial = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: GROUND_VERT,
    fragmentShader: GROUND_FRAG,
    uniforms: {
      uStreet: { value: street },
      uTileMetres: { value: TILE_METRES },
      ...shared,
    },
  });

  const slabs: THREE.Mesh[] = [];
  for (const [x0, x1] of [
    [-reach, RIVER.xMin],
    [RIVER.xMax, reach],
  ]) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, reach * 2), groundMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((x0 + x1) / 2, 0, 0);
    mesh.name = 'ground';
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    slabs.push(mesh);
  }

  const waterMaterial = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: GROUND_VERT,
    fragmentShader: WATER_FRAG,
    uniforms: {
      uTime: { value: 0 },
      ...cloneUniforms(shared),
    },
  });

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(RIVER.xMax - RIVER.xMin, reach * 2),
    waterMaterial
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set((RIVER.xMin + RIVER.xMax) / 2, RIVER.waterY, 0);
  water.name = 'water';
  water.updateMatrix();
  water.matrixAutoUpdate = false;

  return { slabs, water, groundMaterial, waterMaterial };
}

function cloneUniforms(u: Record<string, THREE.IUniform>): Record<string, THREE.IUniform> {
  const out: Record<string, THREE.IUniform> = {};
  for (const k in u) {
    const v = u[k].value;
    out[k] = {
      value:
        v instanceof THREE.Color
          ? v.clone()
          : v instanceof THREE.Vector3
            ? v.clone()
            : (v as unknown),
    };
  }
  return out;
}
