/**
 * Renderer ownership: the WebGL context, the scene camera, sizing, quality
 * tiers, and (from phase 3 onward) the MRT target that the post chain reads.
 *
 * Colour management is deliberately OFF. This is a flat, printed-ink look —
 * authored hex values must reach the framebuffer unchanged, with every tonal
 * decision made explicitly in the shaders rather than by a transfer curve.
 */

import * as THREE from 'three';
import type { QualityTier } from '../core/Save';
import { T } from '../core/Tuning';

export interface RenderStats {
  /** Draw calls for the world only — the number the phase-1 gate cares about. */
  sceneDrawCalls: number;
  /** World + every post pass. */
  drawCalls: number;
  triangles: number;
  programs: number;
  textures: number;
}

export const QUALITY_PRESETS: Record<
  QualityTier,
  {
    postScale: number;
    outline: boolean;
    speedLineDensity: number;
    drawDistance: number;
    maxPixelRatio: number;
    hatching: boolean;
  }
> = {
  low: {
    postScale: 0.6,
    outline: false,
    speedLineDensity: 0.55,
    drawDistance: 900,
    maxPixelRatio: 1,
    hatching: false,
  },
  medium: {
    postScale: 0.82,
    outline: true,
    speedLineDensity: 0.8,
    drawDistance: 1400,
    maxPixelRatio: 1.35,
    hatching: true,
  },
  high: {
    postScale: 1,
    outline: true,
    speedLineDensity: 1,
    drawDistance: 2100,
    // Six fullscreen passes are fill-rate bound. At dpr 2 on a 1512px window
    // that is 5.2M pixels x 6 passes, which no integrated GPU holds at 60fps;
    // 1.5 keeps the dots crisp and roughly halves the cost.
    maxPixelRatio: 1.5,
    hatching: true,
  },
};

/**
 * Pick a tier from measured frame time.
 *
 * Sampled over a couple of seconds of real play rather than a synthetic
 * benchmark, because the thing that actually costs is the post chain over
 * this display's pixel count.
 */
export function tierForFrameMs(ms: number): QualityTier {
  // Thresholds are for measured RENDER time, not the rAF delta. A rAF delta
  // is vsync-locked: a machine drawing in 3ms and one drawing in 16ms both
  // report 16.7 on a 60Hz panel, so classifying on it can never select
  // 'high' at all -- every 60Hz player silently gets 'medium'.
  if (ms > 11) return 'low';
  if (ms > 6.5) return 'medium';
  return 'high';
}

export class Renderer {
  readonly three: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;

  width = 1;
  height = 1;
  pixelRatio = 1;
  quality: QualityTier = 'high';

  /** Scene colour + view-normal, with a real depth attachment for the DoF. */
  sceneTarget: THREE.WebGLRenderTarget | null = null;

  readonly stats: RenderStats = {
    sceneDrawCalls: 0,
    drawCalls: 0,
    triangles: 0,
    programs: 0,
    textures: 0,
  };

  private onResizeHooks: Array<(w: number, h: number) => void> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    THREE.ColorManagement.enabled = false;

    this.three = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // the outline pass and halftone want hard pixels
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.three.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.three.toneMapping = THREE.NoToneMapping;
    this.three.autoClear = true;
    this.three.setClearColor(0x0b0d18, 1);
    this.three.debug.checkShaderErrors = import.meta.env.DEV;
    // We render several times per frame (scene + each post pass); letting
    // Three reset its counters per call would only ever report the last pass.
    this.three.info.autoReset = false;

    this.camera = new THREE.PerspectiveCamera(78, 1, 0.12, 2600);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
  }

  get preset() {
    return QUALITY_PRESETS[this.quality];
  }

  onResize(fn: (w: number, h: number) => void): void {
    this.onResizeHooks.push(fn);
  }

  setQuality(q: QualityTier): void {
    if (this.quality === q) return;
    this.quality = q;
    this.resize();
  }

  resize = (): void => {
    const w = Math.max(1, Math.floor(window.innerWidth));
    const h = Math.max(1, Math.floor(window.innerHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, this.preset.maxPixelRatio);

    this.width = w;
    this.height = h;
    this.pixelRatio = dpr;

    this.three.setPixelRatio(dpr);
    this.three.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.far = this.preset.drawDistance;
    // Vertical FOV derived from the horizontal tuning value. The rig
    // re-derives this every frame during play; this covers the first frame
    // and the free-fly camera, which never runs the rig.
    this.camera.fov =
      (2 * Math.atan(Math.tan((T.baseFOV * Math.PI) / 360) / this.camera.aspect) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();

    const bw = Math.max(1, Math.floor(w * dpr * this.preset.postScale));
    const bh = Math.max(1, Math.floor(h * dpr * this.preset.postScale));
    if (this.sceneTarget) this.sceneTarget.setSize(bw, bh);

    for (const fn of this.onResizeHooks) fn(bw, bh);
  };

  /** Buffer dimensions the post chain renders at (post scale applied). */
  bufferSize(): { w: number; h: number } {
    return {
      w: Math.max(1, Math.floor(this.width * this.pixelRatio * this.preset.postScale)),
      h: Math.max(1, Math.floor(this.height * this.pixelRatio * this.preset.postScale)),
    };
  }

  /** Two colour attachments (albedo, view normal) plus a depth texture. */
  createSceneTarget(): THREE.WebGLRenderTarget {
    const { w, h } = this.bufferSize();
    const target = new THREE.WebGLRenderTarget(w, h, {
      count: 2,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    const depth = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    depth.format = THREE.DepthFormat;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    target.depthTexture = depth;
    target.textures[0].name = 'gColor';
    target.textures[1].name = 'gNormal';
    this.sceneTarget = target;
    return target;
  }

  /** Call once at the top of each frame, before any render call. */
  beginFrame(): void {
    this.three.info.reset();
  }

  /** Call immediately after the world render, before post. */
  markSceneDrawCalls(): void {
    this.stats.sceneDrawCalls = this.three.info.render.calls;
    this.stats.triangles = this.three.info.render.triangles;
  }

  readStats(): void {
    const info = this.three.info;
    this.stats.drawCalls = info.render.calls;
    this.stats.programs = info.programs?.length ?? 0;
    this.stats.textures = info.memory.textures;
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('orientationchange', this.resize);
    this.sceneTarget?.dispose();
    this.three.dispose();
  }
}

/** True when we can actually run. Checked before anything else boots. */
export function webgl2Supported(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('experimental-webgl2'));
  } catch {
    return false;
  }
}
