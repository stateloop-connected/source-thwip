/**
 * Where a web can stick.
 *
 * Anchors are discrete points — roof corners and edge midpoints — held in a
 * flat array with a 2D spatial hash over XZ. A cone query at 60fps touches a
 * few hundred candidates instead of every building in the city, and never
 * raycasts a mesh.
 *
 * Moving anchors (crane jibs in the construction district) live in a separate
 * short list that is scanned linearly, because there are a dozen of them and
 * rebuilding the hash every frame would cost more than the scan.
 */

import * as THREE from 'three';
import { HALF } from './Districts';

const CELL = 48;
const GRID = Math.ceil((HALF * 2) / CELL) + 2;

export interface AnchorQuery {
  found: boolean;
  point: THREE.Vector3;
  distance: number;
  /** Radians between the crosshair and the anchor. */
  angle: number;
  moving: boolean;
  movingIndex: number;
}

export function makeAnchorQuery(): AnchorQuery {
  return {
    found: false,
    point: new THREE.Vector3(),
    distance: 0,
    angle: 0,
    moving: false,
    movingIndex: -1,
  };
}

export class AnchorGrid {
  private xs: number[] = [];
  private ys: number[] = [];
  private zs: number[] = [];
  private cells: Int32Array[] = [];
  private built = false;

  /** Anchors that move; positions are refreshed by the world each frame. */
  readonly moving: THREE.Vector3[] = [];

  get count(): number {
    return this.xs.length;
  }

  add(x: number, y: number, z: number): void {
    this.xs.push(x);
    this.ys.push(y);
    this.zs.push(z);
    this.built = false;
  }

  addMoving(v: THREE.Vector3): number {
    this.moving.push(v);
    return this.moving.length - 1;
  }

  build(): void {
    const lists: number[][] = new Array(GRID * GRID);
    for (let i = 0; i < this.xs.length; i++) {
      const k = this.gi(this.zs[i]) * GRID + this.gi(this.xs[i]);
      (lists[k] ??= []).push(i);
    }
    this.cells = new Array(GRID * GRID);
    for (let k = 0; k < GRID * GRID; k++) {
      this.cells[k] = lists[k] ? Int32Array.from(lists[k]) : EMPTY;
    }
    this.built = true;
  }

  private gi(v: number): number {
    return Math.min(GRID - 1, Math.max(0, Math.floor((v + HALF) / CELL) + 1));
  }

  /** Position of anchor `i`. Valid for indices returned by `collect`. */
  x(i: number): number {
    return this.xs[i];
  }
  y(i: number): number {
    return this.ys[i];
  }
  z(i: number): number {
    return this.zs[i];
  }

  /**
   * Every static anchor within `radius`, as indices.
   *
   * `search` answers "what is the player aiming at", which is the wrong
   * question for anything that wants to weigh candidates by its own criteria
   * — occlusion, swing geometry, or a bot choosing a line.
   */
  collect(origin: THREE.Vector3, radius: number, out: number[]): number {
    out.length = 0;
    if (!this.built) return 0;
    const r2 = radius * radius;
    const gx0 = this.gi(origin.x - radius);
    const gx1 = this.gi(origin.x + radius);
    const gz0 = this.gi(origin.z - radius);
    const gz1 = this.gi(origin.z + radius);
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const list = this.cells[gz * GRID + gx] ?? EMPTY;
        for (let n = 0; n < list.length; n++) {
          const i = list[n];
          const dx = this.xs[i] - origin.x;
          const dy = this.ys[i] - origin.y;
          const dz = this.zs[i] - origin.z;
          if (dx * dx + dy * dy + dz * dz <= r2) out.push(i);
        }
      }
    }
    return out.length;
  }

  /**
   * Best anchor inside the search cone.
   * Score is `angle * 2 + distance * 0.01` exactly as specified — angle
   * dominates so the web goes where the player is looking, with distance
   * only breaking ties between similarly-aimed candidates.
   */
  search(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxRange: number,
    coneRadians: number,
    out: AnchorQuery
  ): boolean {
    out.found = false;
    out.moving = false;
    out.movingIndex = -1;
    if (!this.built) return false;

    let bestScore = Infinity;
    let bestX = 0;
    let bestY = 0;
    let bestZ = 0;
    let bestDist = 0;
    let bestAngle = 0;
    let bestMoving = -1;

    const cosCone = Math.cos(coneRadians);
    const range2 = maxRange * maxRange;

    const gx0 = this.gi(origin.x - maxRange);
    const gx1 = this.gi(origin.x + maxRange);
    const gz0 = this.gi(origin.z - maxRange);
    const gz1 = this.gi(origin.z + maxRange);

    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const list = this.cells[gz * GRID + gx] ?? EMPTY;
        for (let n = 0; n < list.length; n++) {
          const i = list[n];
          const dx = this.xs[i] - origin.x;
          const dy = this.ys[i] - origin.y;
          const dz = this.zs[i] - origin.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > range2 || d2 < 4) continue;
          const d = Math.sqrt(d2);
          const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
          if (cos < cosCone) continue;
          const angle = Math.acos(Math.min(1, cos));
          const score = angle * 2 + d * 0.01;
          if (score < bestScore) {
            bestScore = score;
            bestX = this.xs[i];
            bestY = this.ys[i];
            bestZ = this.zs[i];
            bestDist = d;
            bestAngle = angle;
            bestMoving = -1;
          }
        }
      }
    }

    for (let i = 0; i < this.moving.length; i++) {
      const m = this.moving[i];
      const dx = m.x - origin.x;
      const dy = m.y - origin.y;
      const dz = m.z - origin.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > range2 || d2 < 4) continue;
      const d = Math.sqrt(d2);
      const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
      if (cos < cosCone) continue;
      const angle = Math.acos(Math.min(1, cos));
      const score = angle * 2 + d * 0.01;
      if (score < bestScore) {
        bestScore = score;
        bestX = m.x;
        bestY = m.y;
        bestZ = m.z;
        bestDist = d;
        bestAngle = angle;
        bestMoving = i;
      }
    }

    if (bestScore === Infinity) return false;
    out.found = true;
    out.point.set(bestX, bestY, bestZ);
    out.distance = bestDist;
    out.angle = bestAngle;
    out.moving = bestMoving >= 0;
    out.movingIndex = bestMoving;
    return true;
  }
}

const EMPTY = new Int32Array(0);
