/**
 * Deterministic seeded randomness. Every city, token layout, beacon position
 * and challenge draw comes from here, so a seed reproduces a world exactly on
 * any machine. Nothing in the world generator may call Math.random().
 */

export type RandFn = () => number;

/** mulberry32 — small, fast, good enough distribution for level generation. */
export function mulberry32(seed: number): RandFn {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** cyrb53 string hash → 32-bit seed. Used to turn "2026-07-31" into a city. */
export function hashSeed(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)) >>> 0;
}

/** Convenience wrapper with the helpers the generators actually want. */
export class Rng {
  readonly seed: number;
  private next: RandFn;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.next = mulberry32(this.seed);
  }

  /** [0,1) */
  f(): number {
    return this.next();
  }

  /** [min,max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min,max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(min + this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Random element. */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }

  /** In-place Fisher-Yates. Returns the same array for chaining. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /** Symmetric jitter: [-amount, +amount) */
  jitter(amount: number): number {
    return (this.next() * 2 - 1) * amount;
  }

  /** Weighted pick. weights need not be normalised. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Fork a child stream so sub-generators can't disturb each other's order. */
  fork(salt: number): Rng {
    return new Rng((this.seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0);
  }
}

/** Today's date in local time as YYYY-MM-DD — the daily challenge key. */
export function todayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The seed everybody in the world plays today. */
export function dailySeed(now = new Date()): number {
  return hashSeed('thwip-daily-' + todayKey(now));
}

/** A fresh random seed for a casual run. */
export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
