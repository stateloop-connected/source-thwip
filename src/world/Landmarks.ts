/**
 * The set pieces that give three of the districts their character: the
 * suspension bridge (cables as rails), the park (deliberate anchor drought),
 * and the construction site (the only moving anchors in the game).
 */

import * as THREE from 'three';
import type { Rng } from '../core/Rng';
import type { Part } from './BuildingFactory';
import type { CollisionGrid } from './Collision';
import type { AnchorGrid } from './AnchorGrid';
import { BRIDGE, PARK, RIVER, SITE } from './Districts';

export interface WorldBuild {
  parts: Part[];
  collision: CollisionGrid;
  anchors: AnchorGrid;
  rng: Rng;
}

const CABLE_TINT = 0x9aa6b2;
const STEEL_TINT = 0xb8bcc4;
const DECK_TINT = 0x7d8590;

function part(
  w: WorldBuild,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  tint: number,
  extra: Partial<Part> = {}
): void {
  w.parts.push({
    x,
    y,
    z,
    sx,
    sy,
    sz,
    rotY: 0,
    tint,
    // Roof layers on every face: they carry no window grid, so the bridge
    // reads as painted steel and stone instead of a suspension tower with
    // lit offices in it.
    facade: 8,
    roof: 8,
    seed: w.rng.f() * 100,
    kind: 'box',
    ...extra,
  });
}

/**
 * Suspension bridge across the river. The two main cables are chains of
 * short tilted boxes rather than tubes, so they batch with every other
 * rectilinear thing in the city, and anchors are seeded along them — riding
 * a cable down its own curve is the district's signature line.
 */
export function addBridge(w: WorldBuild): void {
  addRiverBanks(w);
  const [tx0, tx1] = BRIDGE.towerX;
  const z = BRIDGE.z;
  const deckY = BRIDGE.deckY;
  const topY = BRIDGE.towerHeight;
  const deckHalfZ = 13;
  // Short approaches. A long span reaches into the canyon district and the
  // deck then passes straight through towers that were placed without any
  // knowledge of it.
  const spanPad = BRIDGE.approach;

  // deck
  const deckX0 = RIVER.xMin - spanPad;
  const deckX1 = RIVER.xMax + spanPad;
  const deckLen = deckX1 - deckX0;
  part(w, (deckX0 + deckX1) / 2, deckY, z, deckLen, 2.4, deckHalfZ * 2, DECK_TINT);
  w.collision.addBox((deckX0 + deckX1) / 2, deckY, z, deckLen, 2.4, deckHalfZ * 2);
  // side rails - low walls that read as edges when you skim the deck
  for (const sz of [-1, 1]) {
    part(w, (deckX0 + deckX1) / 2, deckY + 2.2, z + sz * deckHalfZ, deckLen, 2, 1.4, STEEL_TINT);
  }

  // towers
  for (const tx of [tx0, tx1]) {
    for (const sz of [-1, 1]) {
      const legZ = z + sz * (deckHalfZ - 1.5);
      part(w, tx, topY / 2, legZ, 7, topY, 7, STEEL_TINT);
      w.collision.addBox(tx, topY / 2, legZ, 7, topY, 7);
      w.anchors.add(tx, topY - 2, legZ);
      w.anchors.add(tx, topY * 0.62, legZ);
    }
    // cross braces
    part(w, tx, topY - 8, z, 7, 4, deckHalfZ * 2, STEEL_TINT);
    part(w, tx, deckY + 26, z, 5.5, 3.4, deckHalfZ * 2, STEEL_TINT);
    w.anchors.add(tx, topY - 6, z);
  }

  // main cables: parabolic sag between the towers, then down to the anchorages
  for (const sz of [-1, 1]) {
    const cz = z + sz * (deckHalfZ - 1.5);
    cable(w, tx0, topY - 3, tx1, topY - 3, cz, 30, deckY + 16, true);
    cable(w, deckX0, deckY + 6, tx0, topY - 3, cz, 0, 0, false);
    cable(w, tx1, topY - 3, deckX1, deckY + 6, cz, 0, 0, false);
  }
}

/** Quay walls so the river reads as a carved trench, not a hole in the map. */
function addRiverBanks(w: WorldBuild): void {
  const len = 3000;
  const depth = Math.abs(RIVER.waterY) + 4;
  for (const [x, dir] of [
    [RIVER.xMin, -1],
    [RIVER.xMax, 1],
  ]) {
    part(w, x + dir * 3, -depth / 2 + 1, 0, 6, depth, len, 0x565060);
    w.collision.addBox(x + dir * 3, -depth / 2 + 1, 0, 6, depth, len);
    // kerb lip along the waterfront
    part(w, x + dir * 1.2, 0.6, 0, 2.4, 1.2, len, 0x7d7688);
  }
}

function cable(
  w: WorldBuild,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z: number,
  sag: number,
  hangerFloor: number,
  hangers: boolean
): void {
  const segments = 22;
  let px = x0;
  let py = y0;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const nx = x0 + (x1 - x0) * t;
    const ny = y0 + (y1 - y0) * t - sag * 4 * t * (1 - t);
    const dx = nx - px;
    const dy = ny - py;
    const len = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    part(w, (px + nx) / 2, (py + ny) / 2, z, len * 1.04, 1.1, 1.1, CABLE_TINT, {
      rotZ: angle,
    });

    if (hangers && i % 2 === 0) {
      const h = ny - hangerFloor;
      if (h > 3) {
        part(w, nx, hangerFloor + h / 2, z, 0.5, h, 0.5, CABLE_TINT);
        // Anchors along the cable turn the span into a rail you can ride.
        w.anchors.add(nx, ny, z);
      }
    }
    px = nx;
    py = ny;
  }
}

/**
 * The park: open green with sparse tall trees. The anchor drought here is
 * the point — crossing it is a commitment you make with the speed you
 * arrived carrying.
 */
export function addPark(w: WorldBuild): void {
  const { rng } = w;
  const count = 78;
  for (let i = 0; i < count; i++) {
    const a = rng.f() * Math.PI * 2;
    const r = Math.sqrt(rng.f());
    const x = PARK.x + Math.cos(a) * r * PARK.rx * 0.88;
    const z = PARK.z + Math.sin(a) * r * PARK.rz * 0.88;
    const h = rng.range(16, 31);
    const trunkR = rng.range(0.5, 0.95);

    w.parts.push({
      x,
      y: h * 0.3,
      z,
      sx: trunkR * 2,
      sy: h * 0.6,
      sz: trunkR * 2,
      rotY: 0,
      tint: 0x5a4330,
      facade: 3,
      roof: 7,
      seed: rng.f() * 100,
      kind: 'cyl',
    });

    const canopyH = h * 0.72;
    const canopyR = rng.range(5.5, 9.5);
    for (let c = 0; c < 2; c++) {
      w.parts.push({
        x,
        y: h * 0.52 + c * canopyH * 0.26,
        z,
        sx: canopyR * 2 * (1 - c * 0.26),
        sy: canopyH * (1 - c * 0.18),
        sz: canopyR * 2 * (1 - c * 0.26),
        rotY: rng.f() * 3,
        tint: c === 0 ? 0x3f7a3a : 0x59a04a,
        facade: 3,
        roof: 7,
        seed: rng.f() * 100,
        kind: 'cone',
      });
    }

    w.collision.addBox(x, h * 0.35, z, trunkR * 2.4, h * 0.7, trunkR * 2.4);
    // Only the tallest trees are worth a web - that is what makes it a drought.
    if (h > 25) w.anchors.add(x, h * 0.92, z);
  }

  // a bandstand to break the silhouette and give one guaranteed anchor
  part(w, PARK.x, 9, PARK.z, 16, 18, 16, 0xb8a07a, {});
  w.collision.addBox(PARK.x, 9, PARK.z, 16, 18, 16);
  w.anchors.add(PARK.x, 18.5, PARK.z);
}

interface Crane {
  baseX: number;
  baseZ: number;
  mastTop: number;
  jibLen: number;
  angle: number;
  speed: number;
  jibIndex: number;
  counterIndex: number;
  anchorIndex: number;
}

/**
 * Tower cranes. Their jib tips are the only anchors in the game that move,
 * which makes the construction district a timing problem rather than a
 * geometry problem.
 */
export class CraneField {
  readonly cranes: Crane[] = [];
  mesh: THREE.InstancedMesh | null = null;

  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private pos = new THREE.Vector3();
  private scale = new THREE.Vector3();

  plan(w: WorldBuild, count: number): void {
    const { rng } = w;
    for (let i = 0; i < count; i++) {
      const baseX = SITE.x + rng.jitter(SITE.half * 0.78);
      const baseZ = SITE.z + rng.jitter(SITE.half * 0.78);
      const mastTop = rng.range(72, 118);
      const jibLen = rng.range(38, 56);
      const crane: Crane = {
        baseX,
        baseZ,
        mastTop,
        jibLen,
        angle: rng.f() * Math.PI * 2,
        speed: rng.range(0.055, 0.13) * (rng.chance(0.5) ? 1 : -1),
        jibIndex: -1,
        counterIndex: -1,
        anchorIndex: w.anchors.addMoving(new THREE.Vector3(baseX, mastTop, baseZ)),
      };

      // static mast, batched with the rest of the city
      part(w, baseX, mastTop / 2, baseZ, 3.4, mastTop, 3.4, 0xe0a52c);
      w.collision.addBox(baseX, mastTop / 2, baseZ, 3.4, mastTop, 3.4);
      w.anchors.add(baseX, mastTop - 4, baseZ);

      this.cranes.push(crane);
    }
  }

  /** Rotating parts live in their own small mesh so they can be re-posed. */
  build(material: THREE.Material): THREE.InstancedMesh {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const count = this.cranes.length * 2;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'cranes';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;

    const tints = new Float32Array(count * 3);
    const layers = new Float32Array(count * 2);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      tints[i * 3] = 0.88;
      tints[i * 3 + 1] = 0.65;
      tints[i * 3 + 2] = 0.18;
      layers[i * 2] = 1;
      layers[i * 2 + 1] = 8;
      seeds[i] = i * 3.7;
    }
    geometry.setAttribute('iTint', new THREE.InstancedBufferAttribute(tints, 3));
    geometry.setAttribute('iLayers', new THREE.InstancedBufferAttribute(layers, 2));
    geometry.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seeds, 1));

    for (let i = 0; i < this.cranes.length; i++) {
      this.cranes[i].jibIndex = i * 2;
      this.cranes[i].counterIndex = i * 2 + 1;
    }
    this.mesh = mesh;
    this.update(0, null);
    return mesh;
  }

  update(dt: number, anchors: AnchorGrid | null): void {
    const mesh = this.mesh;
    if (!mesh) return;
    for (const c of this.cranes) {
      c.angle += c.speed * dt;
      const cos = Math.cos(c.angle);
      const sin = Math.sin(c.angle);

      const jibMid = c.jibLen * 0.5;
      this.pos.set(c.baseX + cos * jibMid, c.mastTop - 2, c.baseZ + sin * jibMid);
      this.euler.set(0, -c.angle, 0);
      this.quat.setFromEuler(this.euler);
      this.scale.set(c.jibLen, 2.2, 2.2);
      this.matrix.compose(this.pos, this.quat, this.scale);
      mesh.setMatrixAt(c.jibIndex, this.matrix);

      const back = 14;
      this.pos.set(c.baseX - cos * back, c.mastTop - 2, c.baseZ - sin * back);
      this.scale.set(back * 2, 2.6, 3.2);
      this.matrix.compose(this.pos, this.quat, this.scale);
      mesh.setMatrixAt(c.counterIndex, this.matrix);

      if (anchors) {
        anchors.moving[c.anchorIndex].set(
          c.baseX + cos * (c.jibLen - 2),
          c.mastTop - 3,
          c.baseZ + sin * (c.jibLen - 2)
        );
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
}
