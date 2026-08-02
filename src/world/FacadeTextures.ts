/**
 * Every surface in the city is painted here, once, into a canvas and uploaded
 * as a single DataArrayTexture. No image files exist in this project.
 *
 * A texture array rather than an atlas is deliberate: array layers wrap
 * independently, so a 10-metre tile can repeat across a 160-metre tower with
 * no atlas bleed and no per-fragment UV arithmetic.
 *
 * RGB is the painted surface. Alpha is a separate lit-window mask, merged in
 * by hand — canvas alpha would composite into RGB and lose the distinction.
 */

import * as THREE from 'three';
import type { Rng } from '../core/Rng';

export const TILE_SIZE = 256;
/** Metres of real wall covered by one tile. Sets window scale everywhere. */
export const TILE_METRES = 10;

export const FACADE_LAYERS = 6;
export const ROOF_LAYERS = 3;
export const TOTAL_LAYERS = FACADE_LAYERS + ROOF_LAYERS;

interface Palette {
  wall: string;
  trim: string;
  dark: string;
  glassOff: string;
  litWarm: string;
  litCool: string;
}

// Bright, saturated bases. Three lighting bands multiply these down hard, so
// anything that looks "correct" in isolation reads as black on the shadow side.
const PALETTES: Palette[] = [
  { wall: '#cf6552', trim: '#93402f', dark: '#5d2a24', glassOff: '#4a3350', litWarm: '#ffd479', litCool: '#8fe3ff' },
  { wall: '#d6c9b6', trim: '#9d9080', dark: '#6a6154', glassOff: '#465468', litWarm: '#ffcf6b', litCool: '#a5e8ff' },
  { wall: '#7597c6', trim: '#4c6b96', dark: '#31456a', glassOff: '#33486a', litWarm: '#ffd98c', litCool: '#7fdcff' },
  { wall: '#e6cf9c', trim: '#b0956a', dark: '#7a6749', glassOff: '#4f4160', litWarm: '#ffc95e', litCool: '#9fe6ff' },
  { wall: '#57a8a8', trim: '#367878', dark: '#245153', glassOff: '#2d5c68', litWarm: '#ffdd8f', litCool: '#7ff0ff' },
  { wall: '#8b5f9e', trim: '#5d3a6e', dark: '#3d2650', glassOff: '#402a5c', litWarm: '#ffc7a1', litCool: '#b18cff' },
];

const ROOF_PALETTES = [
  { base: '#7b8880', patch: '#8f9c93', unit: '#b0bab4', pipe: '#4c5652' },
  { base: '#8a7570', patch: '#9d8781', unit: '#bcaaa2', pipe: '#584945' },
  { base: '#6e7994', patch: '#818da8', unit: '#a3adc4', pipe: '#454d63' },
];

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = TILE_SIZE;
  c.height = TILE_SIZE;
  const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  return [c, ctx];
}

/** Speckle + streaks so nothing reads as a flat digital fill. */
function grime(ctx: CanvasRenderingContext2D, rng: Rng, strength: number): void {
  ctx.save();
  for (let i = 0; i < 220; i++) {
    const x = rng.f() * TILE_SIZE;
    const y = rng.f() * TILE_SIZE;
    const r = rng.range(0.6, 2.6);
    ctx.globalAlpha = rng.range(0.02, 0.09) * strength;
    ctx.fillStyle = rng.chance(0.5) ? '#000' : '#fff';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 14; i++) {
    const x = rng.f() * TILE_SIZE;
    ctx.globalAlpha = rng.range(0.03, 0.1) * strength;
    ctx.fillStyle = '#000';
    ctx.fillRect(x, 0, rng.range(1, 4), TILE_SIZE);
  }
  ctx.restore();
}

function paintFacade(
  ctx: CanvasRenderingContext2D,
  mask: CanvasRenderingContext2D,
  rng: Rng,
  pal: Palette
): void {
  ctx.fillStyle = pal.wall;
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  mask.fillStyle = '#000';
  mask.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

  const cols = rng.int(3, 5);
  const rows = rng.int(3, 4);
  const cellW = TILE_SIZE / cols;
  const cellH = TILE_SIZE / rows;
  const winW = cellW * rng.range(0.46, 0.66);
  const winH = cellH * rng.range(0.48, 0.7);
  const style = rng.int(0, 2);

  // floor ledges between window rows
  ctx.fillStyle = pal.trim;
  for (let r = 0; r < rows; r++) {
    ctx.fillRect(0, Math.round(r * cellH), TILE_SIZE, Math.max(2, Math.round(cellH * 0.07)));
  }
  if (style === 1) {
    // vertical pilasters
    for (let c = 0; c <= cols; c++) {
      ctx.fillStyle = pal.trim;
      ctx.fillRect(Math.round(c * cellW - 2), 0, 4, TILE_SIZE);
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.round(c * cellW + (cellW - winW) / 2);
      const y = Math.round(r * cellH + (cellH - winH) / 2 + cellH * 0.06);
      const w = Math.round(winW);
      const h = Math.round(winH);

      // recess shadow, then the pane
      ctx.fillStyle = pal.dark;
      ctx.fillRect(x - 2, y - 2, w + 4, h + 4);

      const lit = rng.chance(0.22);
      if (lit) {
        const warm = rng.chance(0.72);
        ctx.fillStyle = warm ? pal.litWarm : pal.litCool;
        ctx.fillRect(x, y, w, h);
        mask.fillStyle = '#fff';
        mask.fillRect(x, y, w, h);
        // a silhouette in some lit windows reads as life inside
        if (rng.chance(0.28)) {
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          const sw = Math.max(2, w * rng.range(0.16, 0.3));
          ctx.fillRect(x + rng.f() * (w - sw), y + h * 0.35, sw, h * 0.65);
          mask.fillStyle = 'rgba(0,0,0,0.45)';
          mask.fillRect(x + rng.f() * (w - sw), y + h * 0.35, sw, h * 0.65);
        }
      } else {
        ctx.fillStyle = pal.glassOff;
        ctx.fillRect(x, y, w, h);
        // sky reflection on the upper third of dark glass
        ctx.fillStyle = 'rgba(140,180,230,0.16)';
        ctx.fillRect(x, y, w, Math.max(2, h * 0.34));
      }

      if (style === 2) {
        ctx.fillStyle = pal.trim;
        ctx.fillRect(x - 3, y + h + 1, w + 6, 3); // sill
      }
    }
  }

  grime(ctx, rng, 1);
}

function paintRoof(ctx: CanvasRenderingContext2D, mask: CanvasRenderingContext2D, rng: Rng, i: number): void {
  const pal = ROOF_PALETTES[i % ROOF_PALETTES.length];
  ctx.fillStyle = pal.base;
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  mask.fillStyle = '#000';
  mask.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

  // tar patches
  for (let i2 = 0; i2 < 9; i2++) {
    ctx.fillStyle = pal.patch;
    ctx.globalAlpha = rng.range(0.25, 0.6);
    ctx.fillRect(rng.f() * TILE_SIZE, rng.f() * TILE_SIZE, rng.range(20, 90), rng.range(16, 70));
  }
  ctx.globalAlpha = 1;

  // seams
  ctx.strokeStyle = pal.pipe;
  ctx.lineWidth = 2;
  for (let i2 = 0; i2 < 6; i2++) {
    const y = rng.f() * TILE_SIZE;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(TILE_SIZE, y);
    ctx.stroke();
  }

  // rooftop kit: AC units, vents, a tank
  for (let i2 = 0; i2 < rng.int(4, 7); i2++) {
    const x = rng.range(10, TILE_SIZE - 50);
    const y = rng.range(10, TILE_SIZE - 50);
    const w = rng.range(16, 40);
    const h = rng.range(14, 34);
    ctx.fillStyle = pal.unit;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = pal.pipe;
    ctx.fillRect(x, y + h - 4, w, 4);
    ctx.fillRect(x + 2, y + 2, w - 4, 3);
  }
  for (let i2 = 0; i2 < rng.int(2, 5); i2++) {
    ctx.fillStyle = pal.pipe;
    ctx.beginPath();
    ctx.arc(rng.f() * TILE_SIZE, rng.f() * TILE_SIZE, rng.range(3, 7), 0, Math.PI * 2);
    ctx.fill();
  }

  // one skylight per roof, faintly lit
  if (rng.chance(0.6)) {
    const x = rng.range(20, TILE_SIZE - 60);
    const y = rng.range(20, TILE_SIZE - 60);
    ctx.fillStyle = '#ffd479';
    ctx.fillRect(x, y, 34, 24);
    mask.fillStyle = 'rgba(255,255,255,0.7)';
    mask.fillRect(x, y, 34, 24);
  }

  grime(ctx, rng, 0.7);
}

/**
 * Builds every surface layer and uploads one array texture.
 * Deterministic for a given seed, which is what lets the daily challenge
 * promise everyone the same city.
 */
export function buildFacadeArray(rng: Rng): THREE.DataArrayTexture {
  const [, ctx] = makeCanvas();
  const [, maskCtx] = makeCanvas();
  const data = new Uint8Array(TILE_SIZE * TILE_SIZE * 4 * TOTAL_LAYERS);
  const stride = TILE_SIZE * TILE_SIZE * 4;

  for (let layer = 0; layer < TOTAL_LAYERS; layer++) {
    const sub = rng.fork(layer * 977 + 31);
    if (layer < FACADE_LAYERS) {
      paintFacade(ctx, maskCtx, sub, PALETTES[layer % PALETTES.length]);
    } else {
      paintRoof(ctx, maskCtx, sub, layer - FACADE_LAYERS);
    }

    const color = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
    const maskData = maskCtx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
    const base = layer * stride;
    for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
      data[base + i * 4] = color[i * 4];
      data[base + i * 4 + 1] = color[i * 4 + 1];
      data[base + i * 4 + 2] = color[i * 4 + 2];
      data[base + i * 4 + 3] = maskData[i * 4];
    }
  }

  const tex = new THREE.DataArrayTexture(data, TILE_SIZE, TILE_SIZE, TOTAL_LAYERS);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
