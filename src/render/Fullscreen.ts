/**
 * Post-process pass plumbing: one fullscreen triangle, one raw GLSL3 shader,
 * ping-pong render targets. Hand-rolled rather than pulled from Three's
 * examples so the chain has exactly the passes this look needs and nothing
 * else — the whole composer is under a hundred lines.
 */

import * as THREE from 'three';
import { FULLSCREEN_VERT } from './glsl';

/** A single triangle that covers the viewport. Cheaper than two. */
function triangleGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
  return g;
}

const GEOMETRY = triangleGeometry();
const CAMERA = new THREE.Camera();

export type Uniforms = Record<string, THREE.IUniform>;

export class ShaderPass {
  readonly name: string;
  readonly material: THREE.RawShaderMaterial;
  readonly mesh: THREE.Mesh;
  enabled = true;

  constructor(name: string, fragment: string, uniforms: Uniforms) {
    this.name = name;
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: fragment,
      uniforms,
      depthTest: false,
      depthWrite: false,
      transparent: false,
    });
    this.mesh = new THREE.Mesh(GEOMETRY, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  get uniforms(): Uniforms {
    return this.material.uniforms;
  }

  set(name: string, value: unknown): void {
    const u = this.material.uniforms[name];
    if (u) u.value = value;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null): void {
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, CAMERA);
  }

  dispose(): void {
    this.material.dispose();
  }
}

/** Two same-sized targets, swapped between passes. */
export class PingPong {
  a: THREE.WebGLRenderTarget;
  b: THREE.WebGLRenderTarget;

  constructor(width: number, height: number) {
    const opts: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    this.a = new THREE.WebGLRenderTarget(width, height, opts);
    this.b = new THREE.WebGLRenderTarget(width, height, opts);
  }

  swap(): void {
    const t = this.a;
    this.a = this.b;
    this.b = t;
  }

  setSize(w: number, h: number): void {
    this.a.setSize(w, h);
    this.b.setSize(w, h);
  }

  dispose(): void {
    this.a.dispose();
    this.b.dispose();
  }
}

export function uniform<T>(value: T): THREE.IUniform<T> {
  return { value };
}
