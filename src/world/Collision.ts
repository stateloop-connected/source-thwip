/**
 * Broadphase + narrowphase against axis-aligned boxes only.
 *
 * The whole city is boxes, so there is no reason to raycast meshes: a flat
 * Float32Array of extents plus a 2D grid over XZ answers every query the game
 * asks — capsule resolution, web raycasts, near-miss proximity — in constant
 * time regardless of how many buildings exist.
 */

import * as THREE from 'three';
import { HALF, RIVER } from './Districts';

const CELL = 40;
const GRID = Math.ceil((HALF * 2) / CELL) + 2;

export interface RayHit {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  index: number;
}

export class CollisionGrid {
  /** minX,minY,minZ,maxX,maxY,maxZ per box. */
  private ext: number[] = [];
  private cells: Int32Array[] = [];
  private counts: number[] = [];
  private built = false;

  /** Street height. The river carves below it — see groundHeightAt. */
  groundY = 0;

  /** Stamp per box index, so a box spanning several cells resolves once. */
  private visited = new Int32Array(0);
  private stamp = 0;

  /**
   * The walkable floor under a given column.
   *
   * A single scalar would put an invisible floor across the whole river: the
   * capsule would stand on air eight metres above the water, and the ground
   * contact penalty would fire out over open water.
   */
  groundHeightAt(x: number): number {
    return x >= RIVER.xMin && x <= RIVER.xMax ? RIVER.waterY : this.groundY;
  }

  get boxCount(): number {
    return this.ext.length / 6;
  }

  addBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): number {
    const i = this.ext.length / 6;
    this.ext.push(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2);
    this.built = false;
    return i;
  }

  boxExtents(i: number, out: number[]): void {
    for (let k = 0; k < 6; k++) out[k] = this.ext[i * 6 + k];
  }

  build(): void {
    const lists: number[][] = new Array(GRID * GRID);
    const n = this.boxCount;
    for (let i = 0; i < n; i++) {
      const minX = this.ext[i * 6];
      const minZ = this.ext[i * 6 + 2];
      const maxX = this.ext[i * 6 + 3];
      const maxZ = this.ext[i * 6 + 5];
      const gx0 = this.gi(minX);
      const gx1 = this.gi(maxX);
      const gz0 = this.gi(minZ);
      const gz1 = this.gi(maxZ);
      for (let gz = gz0; gz <= gz1; gz++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const k = gz * GRID + gx;
          (lists[k] ??= []).push(i);
        }
      }
    }
    this.cells = new Array(GRID * GRID);
    this.counts = new Array(GRID * GRID);
    for (let k = 0; k < GRID * GRID; k++) {
      const l = lists[k];
      this.cells[k] = l ? Int32Array.from(l) : EMPTY;
      this.counts[k] = l ? l.length : 0;
    }
    this.visited = new Int32Array(n);
    this.stamp = 0;
    this.built = true;
  }

  private gi(v: number): number {
    return Math.min(GRID - 1, Math.max(0, Math.floor((v + HALF) / CELL) + 1));
  }

  private cellAt(x: number, z: number): Int32Array {
    if (!this.built) return EMPTY;
    return this.cells[this.gi(z) * GRID + this.gi(x)] ?? EMPTY;
  }

  /**
   * Push a vertical capsule out of every box it overlaps and remove the
   * velocity driving into each contact.
   *
   * Velocity is cancelled per contact rather than once against the deepest
   * normal. Doing it once is a real trap: a body resting in a corner keeps
   * accumulating gravity into a normal that never gets cancelled, and the
   * instant it clears the ledge it fires off at terminal velocity.
   */
  resolveCapsule(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    radius: number,
    halfHeight: number,
    out: ContactInfo
  ): void {
    out.hit = false;
    out.grounded = false;
    out.wall = false;
    out.normal.set(0, 0, 0);
    out.penetration = 0;

    const r = radius;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      // build() rasterises each AABB into every cell it overlaps, so a single
      // box can appear in the query several times. Resolving it once per
      // appearance multiplies the correction — a 46m tower on a 40m grid gets
      // pushed four times per pass, which launches the body across the map.
      this.stamp++;
      const gx0 = this.gi(pos.x - r);
      const gx1 = this.gi(pos.x + r);
      const gz0 = this.gi(pos.z - r);
      const gz1 = this.gi(pos.z + r);
      for (let gz = gz0; gz <= gz1; gz++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const list = this.cells[gz * GRID + gx] ?? EMPTY;
          for (let n = 0; n < list.length; n++) {
            const i = list[n];
            if (this.visited[i] === this.stamp) continue;
            this.visited[i] = this.stamp;
            if (this.pushOut(i, pos, vel, r, halfHeight, out)) moved = true;
          }
        }
      }
      if (!moved) break;
    }

    // ground plane. halfHeight is the capsule's segment half-length, so the
    // feet sit one radius below it.
    const floor = this.groundHeightAt(pos.x) + halfHeight + radius;
    if (pos.y < floor) {
      pos.y = floor;
      if (vel.y < 0) vel.y = 0;
      out.hit = true;
      out.grounded = true;
      out.normal.set(0, 1, 0);
    }
  }

  private pushOut(
    i: number,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    r: number,
    halfHeight: number,
    out: ContactInfo
  ): boolean {
    const e = this.ext;
    const b = i * 6;
    // Closest point on the capsule's vertical segment to the box's y span.
    const segY = Math.max(pos.y - halfHeight, Math.min(pos.y + halfHeight, clamp(pos.y, e[b + 1], e[b + 4])));
    const cx = clamp(pos.x, e[b], e[b + 3]);
    const cy = clamp(segY, e[b + 1], e[b + 4]);
    const cz = clamp(pos.z, e[b + 2], e[b + 5]);
    let dx = pos.x - cx;
    let dy = segY - cy;
    let dz = pos.z - cz;
    let d2 = dx * dx + dy * dy + dz * dz;

    if (d2 > r * r) return false;

    let nx: number;
    let ny: number;
    let nz: number;
    let push: number;

    if (d2 < 1e-8) {
      // Centre is inside the box. Escape along the shallowest face, pushing by
      // the real penetration depth plus the radius. Getting this wrong is
      // catastrophic and silent: a fabricated depth can push *inward*, and the
      // body then wedges forever while gravity accumulates in its velocity.
      const toLoX = pos.x - e[b];
      const toHiX = e[b + 3] - pos.x;
      const toLoY = segY - e[b + 1];
      const toHiY = e[b + 4] - segY;
      const toLoZ = pos.z - e[b + 2];
      const toHiZ = e[b + 5] - pos.z;

      const pX = Math.min(toLoX, toHiX);
      const pY = Math.min(toLoY, toHiY);
      const pZ = Math.min(toLoZ, toHiZ);

      nx = 0;
      ny = 0;
      nz = 0;
      if (pY <= pX && pY <= pZ) {
        ny = toHiY < toLoY ? 1 : -1;
        push = pY + r;
      } else if (pX <= pZ) {
        nx = toHiX < toLoX ? 1 : -1;
        push = pX + r;
      } else {
        nz = toHiZ < toLoZ ? 1 : -1;
        push = pZ + r;
      }
    } else {
      const d = Math.sqrt(d2);
      const inv = 1 / d;
      nx = dx * inv;
      ny = dy * inv;
      nz = dz * inv;
      push = r - d;
    }

    pos.x += nx * push;
    pos.y += ny * push;
    pos.z += nz * push;

    // Kill only the component driving into this surface, so grazing a wall at
    // speed costs almost nothing but resting on one cannot build velocity.
    const into = vel.x * nx + vel.y * ny + vel.z * nz;
    if (into < 0) {
      // A corner contact has a diagonal normal, so removing it from a purely
      // vertical fall leaves a large purely-horizontal remainder: the fall is
      // rotated rather than arrested, and the body gets flung tens of metres
      // sideways off a ledge it only grazed. A contact may slow you or stop
      // you; it may never make you faster along the ground.
      const hBefore = Math.hypot(vel.x, vel.z);
      vel.x -= nx * into;
      vel.y -= ny * into;
      vel.z -= nz * into;
      const hAfter = Math.hypot(vel.x, vel.z);
      if (hAfter > hBefore && hAfter > 1e-6) {
        const s = hBefore / hAfter;
        vel.x *= s;
        vel.z *= s;
      }
    }

    if (push > out.penetration) {
      out.penetration = push;
      out.normal.set(nx, ny, nz);
    }
    out.hit = true;
    if (ny > 0.65) out.grounded = true;
    else if (Math.abs(ny) < 0.55) out.wall = true;
    return true;
  }

  /** Slab-test raycast walked over the grid. Returns the nearest hit. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, hit: RayHit): boolean {
    let best = maxDist;
    let bestIndex = -1;
    let bestNormal = 0;

    // Straightforward supercover walk: step cell by cell along the ray.
    const steps = Math.ceil(maxDist / (CELL * 0.5)) + 1;
    const seen = this.scratchSeen;
    seen.clear();
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * maxDist;
      const px = origin.x + dir.x * t;
      const pz = origin.z + dir.z * t;
      const gx = this.gi(px);
      const gz = this.gi(pz);
      for (let oz = -1; oz <= 1; oz++) {
        for (let ox = -1; ox <= 1; ox++) {
          const cx = gx + ox;
          const cz = gz + oz;
          // Unclamped neighbours wrap onto the opposite edge of the map and
          // silently test boxes a kilometre away.
          if (cx < 0 || cx >= GRID || cz < 0 || cz >= GRID) continue;
          const key = cz * GRID + cx;
          if (seen.has(key)) continue;
          seen.add(key);
          const list = this.cells[key] ?? EMPTY;
          for (let n = 0; n < list.length; n++) {
            const i = list[n];
            const r = this.raySlab(i, origin, dir, best);
            if (r.t >= 0 && r.t < best) {
              best = r.t;
              bestIndex = i;
              bestNormal = r.axis;
            }
          }
        }
      }
      if (bestIndex >= 0 && t > best) break;
    }

    if (bestIndex < 0) return false;
    hit.distance = best;
    hit.index = bestIndex;
    hit.point.set(origin.x + dir.x * best, origin.y + dir.y * best, origin.z + dir.z * best);
    hit.normal.set(0, 0, 0);
    const axis = Math.abs(bestNormal) - 1;
    const sign = bestNormal > 0 ? 1 : -1;
    if (axis === 0) hit.normal.x = sign;
    else if (axis === 1) hit.normal.y = sign;
    else hit.normal.z = sign;
    return true;
  }

  private scratchSeen = new Set<number>();
  private slabResult = { t: -1, axis: 0 };

  private raySlab(i: number, o: THREE.Vector3, d: THREE.Vector3, maxT: number) {
    const e = this.ext;
    const b = i * 6;
    let tmin = 0;
    let tmax = maxT;
    let axis = 0;
    for (let a = 0; a < 3; a++) {
      const od = a === 0 ? o.x : a === 1 ? o.y : o.z;
      const dd = a === 0 ? d.x : a === 1 ? d.y : d.z;
      const lo = e[b + a];
      const hi = e[b + a + 3];
      if (Math.abs(dd) < 1e-7) {
        if (od < lo || od > hi) {
          this.slabResult.t = -1;
          return this.slabResult;
        }
        continue;
      }
      const inv = 1 / dd;
      let t1 = (lo - od) * inv;
      let t2 = (hi - od) * inv;
      let sign = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        sign = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        axis = (a + 1) * sign;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) {
        this.slabResult.t = -1;
        return this.slabResult;
      }
    }
    if (axis === 0) {
      // tmin never advanced: the origin is already inside this box. There is
      // no entry face to report, and inventing one hands the caller a normal
      // pointing in an arbitrary direction at zero distance.
      this.slabResult.t = -1;
      return this.slabResult;
    }
    this.slabResult.t = tmin;
    this.slabResult.axis = axis;
    return this.slabResult;
  }

  /** Distance from a point to the nearest box surface, capped at `max`. */
  nearestSurface(x: number, y: number, z: number, max: number): number {
    let best = max;
    const gx0 = this.gi(x - max);
    const gx1 = this.gi(x + max);
    const gz0 = this.gi(z - max);
    const gz1 = this.gi(z + max);
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const list = this.cells[gz * GRID + gx] ?? EMPTY;
        for (let n = 0; n < list.length; n++) {
          const b = list[n] * 6;
          const e = this.ext;
          const dx = Math.max(e[b] - x, 0, x - e[b + 3]);
          const dy = Math.max(e[b + 1] - y, 0, y - e[b + 4]);
          const dz = Math.max(e[b + 2] - z, 0, z - e[b + 5]);
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < best) best = d;
        }
      }
    }
    return best;
  }

  /** Height of the tallest box overlapping this column, or groundY. */
  heightAt(x: number, z: number): number {
    const list = this.cellAt(x, z);
    let top = this.groundY;
    for (let n = 0; n < list.length; n++) {
      const b = list[n] * 6;
      const e = this.ext;
      if (x >= e[b] && x <= e[b + 3] && z >= e[b + 2] && z <= e[b + 5] && e[b + 4] > top) {
        top = e[b + 4];
      }
    }
    return top;
  }
}

export interface ContactInfo {
  hit: boolean;
  grounded: boolean;
  wall: boolean;
  normal: THREE.Vector3;
  penetration: number;
}

export function makeContact(): ContactInfo {
  return { hit: false, grounded: false, wall: false, normal: new THREE.Vector3(), penetration: 0 };
}

const EMPTY = new Int32Array(0);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
