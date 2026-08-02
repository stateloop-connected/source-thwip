/**
 * Builds an entire city from one 32-bit number.
 *
 * Nothing here may call Math.random(). Same seed in, byte-identical city out,
 * on every machine — that promise is what the daily challenge is built on and
 * what makes a screenshot comparison a valid regression test.
 */

import * as THREE from 'three';
import { Rng } from '../core/Rng';
import { buildParts, type BuiltCity, type Part } from './BuildingFactory';
import { buildFacadeArray, TILE_METRES } from './FacadeTextures';
import { buildStreetTexture, createGround, type GroundBundle } from './GroundPlane';
import { AnchorGrid } from './AnchorGrid';
import { CollisionGrid } from './Collision';
import { createToonMaterial } from '../render/ToonMaterial';
import { addBridge, addPark, CraneField, type WorldBuild } from './Landmarks';
import { Beacons, type Beacon } from '../game/Beacons';
import {
  CANYON,
  DISTRICTS,
  districtAt,
  districtWeight,
  HALF,
  inBridgeCorridor,
  type DistrictId,
  type DistrictRules,
} from './Districts';

/**
 * A lot may only be built where it actually stands.
 *
 * Sampling the district at the 46m cell centre and then placing buildings up
 * to 37m away puts towers in the river and trees in the road. Test the lot.
 */
function canBuildAt(x: number, z: number, id: DistrictId): boolean {
  return districtAt(x, z) === id && !inBridgeCorridor(x, z);
}

export interface City {
  beacons: Beacon[];
  refreshBeacons(): void;
  beaconSystem: Beacons;
  group: THREE.Group;
  collision: CollisionGrid;
  anchors: AnchorGrid;
  cranes: CraneField;
  material: THREE.RawShaderMaterial;
  ground: GroundBundle;
  built: BuiltCity;
  spawn: THREE.Vector3;
  seed: number;
  stats: { buildings: number; instances: number; anchors: number; boxes: number };
  dispose(): void;
}

/** Master grid pitch. District rules subdivide within a cell. */
const CELL = 46;

export function generateCity(seed: number): City {
  const rng = new Rng(seed);
  const parts: Part[] = [];
  const collision = new CollisionGrid();
  const anchors = new AnchorGrid();
  const cranes = new CraneField();
  const build: WorldBuild = { parts, collision, anchors, rng };

  let buildings = 0;
  const cells = Math.floor((HALF * 2) / CELL);
  const origin = -HALF + CELL / 2;

  for (let gz = 0; gz < cells; gz++) {
    for (let gx = 0; gx < cells; gx++) {
      const cx = origin + gx * CELL;
      const cz = origin + gz * CELL;
      const id = districtAt(cx, cz);
      const rules = DISTRICTS[id];
      const cellRng = rng.fork(gz * 1013 + gx * 7 + 3);

      switch (id) {
        case 'brownstones':
          buildings += brownstoneBlock(build, cellRng, rules, cx, cz);
          break;
        case 'canyons':
          if (gx % 3 !== 0) buildings += canyonBlock(build, cellRng, rules, cx, cz);
          break;
        case 'construction':
          buildings += constructionBlock(build, cellRng, rules, cx, cz);
          break;
        case 'bridge':
        case 'park':
          break;
      }
    }
  }

  addBridge(build);
  addPark(build);
  cranes.plan(build, 7);

  collision.build();
  anchors.build();

  const facades = buildFacadeArray(rng.fork(9001));
  const material = createToonMaterial(facades);
  (material.uniforms.uTexelsPerMetre as THREE.IUniform<number>).value = 1 / TILE_METRES;

  const built = buildParts(parts, material);
  const group = new THREE.Group();
  group.name = 'world';
  group.add(built.group);
  group.add(cranes.build(material));

  const street = buildStreetTexture(rng.fork(4242));
  const ground = createGround(street);
  for (const slab of ground.slabs) group.add(slab);
  group.add(ground.water);

  const beacons = new Beacons(rng.fork(31337), collision);
  group.add(beacons.mesh);

  const spawn = pickSpawn(collision);

  return {
    beacons: beacons.list,
    refreshBeacons: () => beacons.refresh(),
    beaconSystem: beacons,
    group,
    collision,
    anchors,
    cranes,
    material,
    ground,
    built,
    spawn,
    seed,
    stats: {
      buildings,
      instances: built.instanceCount,
      anchors: anchors.count,
      boxes: collision.boxCount,
    },
    dispose() {
      // InstancedMesh.dispose() is what frees the instanceMatrix VBO; the
      // geometry dispose alone leaks it silently on every city rebuild.
      for (const m of built.meshes) {
        m.dispose();
        m.geometry.dispose();
      }
      cranes.mesh?.dispose();
      cranes.mesh?.geometry.dispose();
      beacons.dispose();
      material.dispose();
      facades.dispose();
      street.dispose();
      for (const slab of ground.slabs) slab.geometry.dispose();
      ground.water.geometry.dispose();
      ground.groundMaterial.dispose();
      ground.waterMaterial.dispose();
    },
  };
}

/**
 * Find open sky to start in.
 *
 * A hardcoded spawn is a trap: the generator is seeded, so one seed in ten
 * puts the player inside a tower, where the capsule wedges and the run is
 * dead before the first web. Walk outward from downtown until a column is
 * clear, then start well above whatever is there.
 */
function pickSpawn(collision: CollisionGrid): THREE.Vector3 {
  const startX = CANYON.x + 40;
  const startZ = CANYON.z + 150;
  let bestX = startX;
  let bestZ = startZ;
  let bestNeighbour = 0;
  let bestScore = -Infinity;

  for (let ring = 0; ring < 14; ring++) {
    for (let step = 0; step < 12; step++) {
      const a = (step / 12) * Math.PI * 2;
      const x = startX + Math.cos(a) * ring * 24;
      const z = startZ + Math.sin(a) * ring * 24;
      if (Math.abs(x) > HALF - 90 || Math.abs(z) > HALF - 90) continue;

      // The column itself must be clear so the capsule does not spawn inside
      // a tower...
      const top = columnTop(collision, x, z);
      if (top > 8) continue;

      // ...but the point is to start SURROUNDED by things to web at. An
      // optimally clear column is an empty street, which is the worst
      // possible opening: nothing in range, and a long fall to the pavement.
      let neighbour = 0;
      for (let s = 0; s < 8; s++) {
        const na = (s / 8) * Math.PI * 2;
        const h = collision.heightAt(x + Math.cos(na) * 55, z + Math.sin(na) * 55);
        if (h > neighbour) neighbour = h;
      }
      const score = neighbour - ring * 1.5;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestZ = z;
        bestNeighbour = neighbour;
      }
    }
  }

  // Just above the local rooftops: high enough to see a line, low enough that
  // the first web is in range before the flow meter has done any damage. A
  // long opening drop is dead time the player pays for and cannot act during.
  const y = Math.max(46, Math.min(96, bestNeighbour + 12));
  return new THREE.Vector3(bestX, y, bestZ);
}

/** Tallest geometry in this column, sampled around the capsule's girth. */
function columnTop(collision: CollisionGrid, x: number, z: number): number {
  let top = 0;
  for (const [ox, oz] of [
    [0, 0],
    [3, 0],
    [-3, 0],
    [0, 3],
    [0, -3],
  ]) {
    const h = collision.heightAt(x + ox, z + oz);
    if (h > top) top = h;
  }
  return top;
}

// -- district block generators ---------------------------------------------

/** Four tight lots per cell. Low anchors, fast rhythm, no room to think. */
function brownstoneBlock(
  w: WorldBuild,
  rng: Rng,
  rules: DistrictRules,
  cx: number,
  cz: number
): number {
  let n = 0;
  const lot = CELL / 2;
  for (let i = 0; i < 4; i++) {
    if (rng.chance(rules.gapChance)) continue;
    const ox = ((i % 2) - 0.5) * lot;
    const oz = (Math.floor(i / 2) - 0.5) * lot;
    const x = cx + ox + rng.jitter(1.6);
    const z = cz + oz + rng.jitter(1.6);
    if (!canBuildAt(x, z, 'brownstones')) continue;

    const w0 = rng.range(rules.footprint[0], Math.min(rules.footprint[1], lot - 5));
    const d0 = rng.range(rules.footprint[0], Math.min(rules.footprint[1], lot - 5));

    // One lot in six is a mid-rise. Without them the whole district is dead
    // air above 30m: an arc that gains any altitude has nothing left to catch,
    // and two thirds of the map becomes unswingable.
    const midRise = rng.chance(0.17);
    const h = midRise
      ? rng.range(42, 74)
      : rng.range(rules.height[0], rules.height[1]);
    emitBuilding(w, rng, rules, x, z, w0, d0, h, !midRise);
    n++;
  }
  return n;
}

/** One tower, big setbacks, huge arcs between them. */
function canyonBlock(
  w: WorldBuild,
  rng: Rng,
  rules: DistrictRules,
  cx: number,
  cz: number
): number {
  if (rng.chance(rules.gapChance)) return 0;
  const x = cx + rng.jitter(4);
  const z = cz + rng.jitter(4);
  if (!canBuildAt(x, z, 'canyons')) return 0;

  const weight = districtWeight(cx, cz, 'canyons');
  const w0 = rng.range(rules.footprint[0], rules.footprint[1]);
  const d0 = rng.range(rules.footprint[0], rules.footprint[1]);
  const h = rng.range(rules.height[0], rules.height[1]) * (0.55 + 0.45 * weight);

  emitBuilding(w, rng, rules, x, z, w0, d0, h, false);

  // A ladder of flank anchors every ~22m. Without it a fall into a canyon
  // street has nothing to grab until you are back above roof height, which
  // makes the best district in the game punish its own worst moment.
  for (let y = 34; y < h - 12; y += 22) {
    w.anchors.add(x + w0 / 2 + 1.2, y, z);
    w.anchors.add(x - w0 / 2 - 1.2, y, z);
    w.anchors.add(x, y + 11, z + d0 / 2 + 1.2);
    w.anchors.add(x, y + 11, z - d0 / 2 - 1.2);
  }

  // stepped setbacks - the silhouette that makes a skyline read as a skyline
  let cy = h;
  let cw = w0;
  let cd = d0;
  const steps = rng.int(1, 3);
  for (let s = 0; s < steps; s++) {
    cw *= rng.range(0.6, 0.8);
    cd *= rng.range(0.6, 0.8);
    const sh = rng.range(8, 26);
    push(w, rng, rules, x, cy + sh / 2, z, cw, sh, cd);
    w.collision.addBox(x, cy + sh / 2, z, cw, sh, cd);
    cy += sh;
    w.anchors.add(x + cw / 2, cy, z + cd / 2);
    w.anchors.add(x - cw / 2, cy, z - cd / 2);
  }

  if (rng.chance(0.35)) {
    const sh = rng.range(14, 38);
    push(w, rng, rules, x, cy + sh / 2, z, 2.6, sh, 2.6);
    w.anchors.add(x, cy + sh, z);
    cy += sh;
  }
  return 1;
}

/** Skeletal frames: open floors, exposed girders, and the moving jibs. */
function constructionBlock(
  w: WorldBuild,
  rng: Rng,
  rules: DistrictRules,
  cx: number,
  cz: number
): number {
  if (rng.chance(rules.gapChance)) return 0;
  const x = cx + rng.jitter(3);
  const z = cz + rng.jitter(3);
  if (!canBuildAt(x, z, 'construction')) return 0;
  const w0 = rng.range(rules.footprint[0], rules.footprint[1]);
  const d0 = rng.range(rules.footprint[0], rules.footprint[1]);
  const h = rng.range(rules.height[0], rules.height[1]);
  const floors = Math.max(3, Math.round(h / 8));
  const clad = Math.floor(floors * rng.range(0.2, 0.55));

  // corner columns
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      push(w, rng, rules, x + (sx * w0) / 2, h / 2, z + (sz * d0) / 2, 1.6, h, 1.6);
    }
  }
  // floor slabs, clad at the bottom and open above
  for (let f = 1; f <= floors; f++) {
    const y = (f / floors) * h;
    push(w, rng, rules, x, y, z, w0, 0.9, d0);
    w.collision.addBox(x, y, z, w0, 0.9, d0);
    if (f <= clad) {
      push(w, rng, rules, x, y - 4, z, w0 * 0.99, 7.4, d0 * 0.99);
      w.collision.addBox(x, y - 4, z, w0, 7.4, d0);
    }
    if (f === floors || f % 3 === 0) {
      w.anchors.add(x + w0 / 2, y, z + d0 / 2);
      w.anchors.add(x - w0 / 2, y, z - d0 / 2);
    }
  }
  return 1;
}

// -- shared emission -------------------------------------------------------

function push(
  w: WorldBuild,
  rng: Rng,
  rules: DistrictRules,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number
): void {
  w.parts.push({
    x,
    y,
    z,
    sx,
    sy,
    sz,
    rotY: 0,
    tint: rng.pick(rules.tints),
    facade: rng.pick(rules.facades),
    roof: rng.pick(rules.roofs),
    seed: rng.f() * 100,
    kind: 'box',
  });
}

function emitBuilding(
  w: WorldBuild,
  rng: Rng,
  rules: DistrictRules,
  x: number,
  z: number,
  sx: number,
  sz: number,
  h: number,
  cornice: boolean
): void {
  push(w, rng, rules, x, h / 2, z, sx, h, sz);
  w.collision.addBox(x, h / 2, z, sx, h, sz);

  if (cornice) {
    push(w, rng, rules, x, h + 0.7, z, sx + 1.4, 1.4, sz + 1.4);
    w.collision.addBox(x, h + 0.7, z, sx + 1.4, 1.4, sz + 1.4);
  }

  // roof corners are the anchors a player actually aims at
  const top = h + (cornice ? 1.4 : 0);
  const ax = sx / 2 - 0.6;
  const az = sz / 2 - 0.6;
  w.anchors.add(x + ax, top, z + az);
  w.anchors.add(x - ax, top, z + az);
  w.anchors.add(x + ax, top, z - az);
  w.anchors.add(x - ax, top, z - az);
  if (sx > 24 || sz > 24) {
    w.anchors.add(x, top, z + az);
    w.anchors.add(x, top, z - az);
  }
  // mid-height anchors let you web the flank of a tower, not just its lip
  if (h > 60) {
    w.anchors.add(x + ax, h * 0.68, z + az);
    w.anchors.add(x - ax, h * 0.68, z - az);
  }

  // rooftop water tank
  if (rng.chance(0.26)) {
    const r = rng.range(1.6, 2.9);
    const th = rng.range(3.4, 5.6);
    const ox = rng.jitter(sx * 0.22);
    const oz = rng.jitter(sz * 0.22);
    w.parts.push({
      x: x + ox,
      y: top + th / 2 + 1.4,
      z: z + oz,
      sx: r * 2,
      sy: th,
      sz: r * 2,
      rotY: 0,
      tint: 0x6d4b38,
      facade: 0,
      roof: 6,
      seed: rng.f() * 100,
      kind: 'cyl',
    });
    // legs read as a silhouette from below and cost one box
    push(w, rng, rules, x + ox, top + 0.7, z + oz, r * 1.5, 1.4, r * 1.5);
    w.anchors.add(x + ox, top + th + 1.6, z + oz);
  }
}

/** Which district a world position belongs to — used by HUD and challenges. */
export function districtOf(x: number, z: number): DistrictId {
  return districtAt(x, z);
}
