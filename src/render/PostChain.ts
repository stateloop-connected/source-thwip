/**
 * The composer. Renders the scene into an MRT target (colour + view normal +
 * depth), then walks an ordered pass list, ping-ponging between two buffers,
 * with the last enabled pass writing straight to the screen.
 *
 * Chain order is fixed by the look and must not be shuffled:
 *   outline -> halftone -> CMYK misprint DoF -> speed lines -> glitch -> paper
 */

import * as THREE from 'three';
import { PingPong, ShaderPass, uniform } from './Fullscreen';
import type { Renderer } from './Renderer';
import { createOutlinePass } from './passes/OutlinePass';
import { createHalftonePass } from './passes/HalftonePass';
import { createCmykDofPass } from './passes/CmykDofPass';
import { createSpeedLinesPass } from './passes/SpeedLinesPass';
import { createGlitchPass } from './passes/GlitchPass';
import { createPaperPass } from './passes/PaperPass';
import { T } from '../core/Tuning';

/** Everything the chain needs from the game each frame. */
export interface PostState {
  time: number;
  animFrame: number;
  near: number;
  far: number;
  /** Style values interpolated from rank. */
  dotScale: number;
  boil: number;
  glitch: number;
  saturation: number;
  /** Transient glitch from impacts, 0..1. */
  impact: number;
  /** Metres to whatever the player is looking at. */
  focusDist: number;
  /** 0..1 speed-line strength and its screen-space origin. */
  speed: number;
  speedOriginX: number;
  speedOriginY: number;
  speedVignette: number;
  /** Quality-tier scalars. */
  outlineEnabled: boolean;
  speedLineDensity: number;
}

const COPY_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D tDiffuse;
out vec4 fragColor;
void main() { fragColor = texture(tDiffuse, vUv); }
`;

export class PostChain {
  readonly passes: ShaderPass[] = [];
  private buffers: PingPong;
  private copy: ShaderPass;
  private renderer: Renderer;
  private sceneTarget: THREE.WebGLRenderTarget;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.sceneTarget = renderer.sceneTarget ?? renderer.createSceneTarget();
    const { w, h } = renderer.bufferSize();
    this.buffers = new PingPong(w, h);
    this.copy = new ShaderPass('copy', COPY_FRAG, { tDiffuse: uniform<THREE.Texture | null>(null) });

    renderer.onResize((bw, bh) => {
      this.buffers.setSize(bw, bh);
      this.sceneTarget.setSize(bw, bh);
      for (const p of this.passes) {
        const res = p.uniforms.uResolution;
        if (res) (res.value as THREE.Vector2).set(bw, bh);
      }
    });
  }

  add(pass: ShaderPass): ShaderPass {
    this.passes.push(pass);
    return pass;
  }

  /**
   * The chain, in the one order that produces the look.
   *
   * Outline first so edges are inked before anything screens or splits them;
   * halftone before the misprint so the dots themselves separate; speed lines
   * over the printed image; glitch and paper last, on the finished plate.
   */
  buildDefaultChain(): void {
    const { w, h } = this.renderer.bufferSize();
    this.add(createOutlinePass(this.depthTexture, this.normalTexture, w, h));
    this.add(createHalftonePass(this.depthTexture, w, h));
    this.add(createCmykDofPass(this.depthTexture, w, h));
    this.add(createSpeedLinesPass(w, h));
    this.add(createGlitchPass(w, h));
    this.add(createPaperPass(w, h));
  }

  /** Push one frame of game state into every pass that needs it. */
  sync(s: PostState): void {
    // Screen-space patterns are authored in CSS pixels. Without this every
    // dot, line and split changes physical size with the quality tier and
    // the display's DPR.
    const px = this.renderer.pixelRatio * this.renderer.preset.postScale;

    const outline = this.get('outline');
    if (outline) {
      outline.enabled = s.outlineEnabled && T.outlineStrength > 0.001;
      outline.set('uNear', s.near);
      outline.set('uFar', s.far);
      outline.set('uBoil', s.boil);
      outline.set('uAnimFrame', s.animFrame);
      outline.set('uThickness', T.outlineThickness);
      outline.set('uStrength', T.outlineStrength);
      outline.set('uPixelScale', px);
    }

    const halftone = this.get('halftone');
    if (halftone) {
      halftone.set('uScale', s.dotScale);
      halftone.set('uStrength', T.halftoneStrength);
      halftone.set('uPixelScale', px);
      halftone.set('uNear', s.near);
      halftone.set('uFar', s.far);
      halftone.enabled = T.halftoneStrength > 0.001;
    }

    const dof = this.get('cmykDof');
    if (dof) {
      dof.set('uNear', s.near);
      dof.set('uFar', s.far);
      dof.set('uFocusDist', s.focusDist);
      dof.set('uFocusRange', T.cmykFocusRange);
      // Quantise the split to whole dot cells so a shifted plate stays in
      // phase with its own screen instead of shearing across it.
      dof.set('uMaxOffset', T.cmykMaxOffset * px);
      dof.set('uCell', s.dotScale * px);
      dof.enabled = T.cmykMaxOffset > 0.001;
    }

    const lines = this.get('speedLines');
    if (lines) {
      lines.set('uAmount', s.speed * T.speedLineIntensity);
      lines.set('uDensity', s.speedLineDensity);
      lines.set('uAnimFrame', s.animFrame);
      (lines.uniforms.uOrigin.value as THREE.Vector2).set(s.speedOriginX, s.speedOriginY);
      lines.enabled = s.speed * T.speedLineIntensity > 0.004;
    }

    const glitch = this.get('glitch');
    if (glitch) {
      glitch.set('uAmount', s.glitch);
      glitch.set('uImpact', s.impact);
      glitch.set('uAnimFrame', s.animFrame);
      glitch.enabled = s.glitch + s.impact > 0.004;
    }

    const paper = this.get('paper');
    if (paper) {
      paper.set('uTime', s.time);
      paper.set('uSpeedVignette', s.speedVignette);
      paper.set('uSaturation', s.saturation);
      paper.set('uGrain', T.grainAmount);
      paper.set('uVignette', T.vignetteAmount);
      paper.set('uMisregister', T.misregisterAmount);
    }
  }

  get(name: string): ShaderPass | undefined {
    return this.passes.find((p) => p.name === name);
  }

  /** Colour attachment of the scene target — pass 0's input. */
  get colorTexture(): THREE.Texture {
    return this.sceneTarget.textures[0];
  }

  get normalTexture(): THREE.Texture {
    return this.sceneTarget.textures[1];
  }

  get depthTexture(): THREE.Texture {
    return this.sceneTarget.depthTexture as THREE.Texture;
  }

  /** Render scene into the MRT target. Call before `compose`. */
  renderScene(scene: THREE.Object3D, camera: THREE.Camera): void {
    const gl = this.renderer.three;
    gl.setRenderTarget(this.sceneTarget);
    gl.clear(true, true, false);
    gl.render(scene, camera);
  }

  /** Walk the pass list; last enabled pass writes to the default framebuffer. */
  compose(): void {
    const gl = this.renderer.three;
    const active = this.passes.filter((p) => p.enabled);

    if (active.length === 0) {
      this.copy.set('tDiffuse', this.colorTexture);
      this.copy.render(gl, null);
      gl.setRenderTarget(null);
      return;
    }

    let input: THREE.Texture = this.colorTexture;
    for (let i = 0; i < active.length; i++) {
      const pass = active[i];
      const last = i === active.length - 1;
      pass.set('tDiffuse', input);
      pass.render(gl, last ? null : this.buffers.a);
      if (!last) {
        input = this.buffers.a.texture;
        this.buffers.swap();
      }
    }
    gl.setRenderTarget(null);
  }

  dispose(): void {
    for (const p of this.passes) p.dispose();
    this.copy.dispose();
    this.buffers.dispose();
  }
}
