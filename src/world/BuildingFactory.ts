/**
 * Turns a flat list of parts into a handful of InstancedMeshes.
 *
 * Two rules keep the draw-call budget: every rectilinear thing in the city —
 * towers, cornices, setbacks, girders, crane jibs, water tanks — shares one
 * unit box, and parts are bucketed into spatial sectors so the frustum can
 * throw away most of the city without costing a draw call each.
 */

import * as THREE from 'three';
import { HALF, PLAYFIELD } from './Districts';

export type GeoKind = 'box' | 'cyl' | 'cone';

export interface Part {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rotY: number;
  /** Tilt, used by bridge cables and crane jibs. Usually zero. */
  rotX?: number;
  rotZ?: number;
  tint: number;
  facade: number;
  roof: number;
  seed: number;
  kind: GeoKind;
}

/** 5x5 sectors over the playfield: enough for culling, few enough to batch. */
const SECTORS = 5;
const SECTOR_SIZE = PLAYFIELD / SECTORS;

function baseGeometry(kind: GeoKind): THREE.BufferGeometry {
  switch (kind) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1);
    case 'cyl':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 9, 1, false);
    case 'cone':
      return new THREE.ConeGeometry(0.5, 1, 7, 1, false);
  }
}

function sectorIndex(x: number, z: number): number {
  const sx = Math.min(SECTORS - 1, Math.max(0, Math.floor((x + HALF) / SECTOR_SIZE)));
  const sz = Math.min(SECTORS - 1, Math.max(0, Math.floor((z + HALF) / SECTOR_SIZE)));
  return sz * SECTORS + sx;
}

export interface BuiltCity {
  group: THREE.Group;
  meshes: THREE.InstancedMesh[];
  instanceCount: number;
}

export function buildParts(parts: Part[], material: THREE.Material): BuiltCity {
  const buckets = new Map<string, Part[]>();
  for (const p of parts) {
    const key = `${p.kind}:${sectorIndex(p.x, p.z)}`;
    const list = buckets.get(key);
    if (list) list.push(p);
    else buckets.set(key, [p]);
  }

  const group = new THREE.Group();
  group.name = 'city';
  const meshes: THREE.InstancedMesh[] = [];

  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();

  for (const [key, list] of buckets) {
    const kind = key.split(':')[0] as GeoKind;
    const geometry = baseGeometry(kind);
    const count = list.length;

    const tints = new Float32Array(count * 3);
    const layers = new Float32Array(count * 2);
    const seeds = new Float32Array(count);

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = key;
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;

    for (let i = 0; i < count; i++) {
      const p = list[i];
      pos.set(p.x, p.y, p.z);
      euler.set(p.rotX ?? 0, p.rotY, p.rotZ ?? 0);
      quat.setFromEuler(euler);
      scale.set(p.sx, p.sy, p.sz);
      matrix.compose(pos, quat, scale);
      mesh.setMatrixAt(i, matrix);

      color.setHex(p.tint);
      tints[i * 3] = color.r;
      tints[i * 3 + 1] = color.g;
      tints[i * 3 + 2] = color.b;
      layers[i * 2] = p.facade;
      layers[i * 2 + 1] = p.roof;
      seeds[i] = p.seed;
    }

    geometry.setAttribute('iTint', new THREE.InstancedBufferAttribute(tints, 3));
    geometry.setAttribute('iLayers', new THREE.InstancedBufferAttribute(layers, 2));
    geometry.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();

    group.add(mesh);
    meshes.push(mesh);
  }

  return { group, meshes, instanceCount: parts.length };
}

/** Convenience for the generators: append a rectilinear part. */
export function box(
  out: Part[],
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  opts: { tint: number; facade: number; roof: number; seed: number; rotY?: number }
): void {
  out.push({
    x,
    y,
    z,
    sx,
    sy,
    sz,
    rotY: opts.rotY ?? 0,
    tint: opts.tint,
    facade: opts.facade,
    roof: opts.roof,
    seed: opts.seed,
    kind: 'box',
  });
}
