/**
 * Persistence. localStorage only, one key, versioned, and it degrades to an
 * in-memory store if storage is unavailable (private windows, file:// in some
 * browsers) rather than throwing in the middle of a run.
 */

import { applyTuning, tuningDelta } from './Tuning';

export type QualityTier = 'low' | 'medium' | 'high';

export interface Settings {
  fov: number;
  headBob: boolean;
  cameraRoll: boolean;
  speedLineIntensity: number;
  reduceMotion: boolean;
  invertY: boolean;
  sensitivity: number;
  masterVolume: number;
  musicVolume: number;
  muted: boolean;
  quality: QualityTier | 'auto';
  showGhost: boolean;
}

export interface DailyEntry {
  score: number;
  rank: number;
  at: number;
}

export interface SaveData {
  version: number;
  rank: number;
  xp: number;
  runs: number;
  bestScore: number;
  bestCombo: number;
  bestSpeedMs: number;
  bestChain: number;
  totalDistance: number;
  challengesDone: string[];
  /** Flat [x,y,z, x,y,z, ...] recorded at 10Hz for the racing ghost. */
  ghost: number[];
  ghostScore: number;
  ghostSeed: number;
  daily: Record<string, DailyEntry[]>;
  settings: Settings;
  tuning: Record<string, number>;
  seenIntro: boolean;
}

const KEY = 'thwip.save.v1';
const VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  /** Horizontal degrees. See CameraRig for the conversion Three needs. */
  fov: 96,
  headBob: false,
  cameraRoll: false,
  speedLineIntensity: 1,
  reduceMotion: false,
  invertY: false,
  sensitivity: 1,
  masterVolume: 0.8,
  musicVolume: 0.55,
  muted: false,
  quality: 'auto',
  showGhost: true,
};

function defaults(): SaveData {
  return {
    version: VERSION,
    rank: 1,
    xp: 0,
    runs: 0,
    bestScore: 0,
    bestCombo: 0,
    bestSpeedMs: 0,
    bestChain: 0,
    totalDistance: 0,
    challengesDone: [],
    ghost: [],
    ghostScore: 0,
    ghostSeed: 0,
    daily: {},
    settings: { ...DEFAULT_SETTINGS },
    tuning: {},
    seenIntro: false,
  };
}

class MemoryStore {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

function pickStore(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    const probe = '__thwip_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return new MemoryStore();
  }
}

export class Save {
  data: SaveData;
  private store = pickStore();
  private flushTimer = 0;

  constructor() {
    this.data = this.load();
    applyTuning(this.data.tuning);
  }

  private load(): SaveData {
    const base = defaults();
    try {
      const raw = this.store.getItem(KEY);
      if (!raw) return base;
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      if (parsed.version !== VERSION) return base;
      return {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings ?? {}) },
        daily: parsed.daily ?? {},
        tuning: parsed.tuning ?? {},
        challengesDone: parsed.challengesDone ?? [],
        ghost: parsed.ghost ?? [],
      };
    } catch {
      return base;
    }
  }

  /** Coalesced write — safe to call on every scoring event. */
  save(): void {
    if (this.flushTimer) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = 0;
      this.flush();
    }, 350);
  }

  flush(): void {
    this.data.tuning = tuningDelta();
    try {
      this.store.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Quota exceeded: drop the ghost (by far the biggest field) and retry
      // once. Losing a ghost is fine; losing rank progress is not.
      this.data.ghost = [];
      try {
        this.store.setItem(KEY, JSON.stringify(this.data));
      } catch {
        /* give up silently - the run continues either way */
      }
    }
  }

  get settings(): Settings {
    return this.data.settings;
  }

  /** Record a run into the local daily top-10 for a seed's date key. */
  recordDaily(dateKey: string, score: number, rank: number): number {
    const list = this.data.daily[dateKey] ?? [];
    list.push({ score, rank, at: Date.now() });
    list.sort((a, b) => b.score - a.score);
    this.data.daily[dateKey] = list.slice(0, 10);
    this.save();
    return this.data.daily[dateKey].findIndex((e) => e.score === score && e.rank === rank) + 1;
  }

  dailyBoard(dateKey: string): DailyEntry[] {
    return this.data.daily[dateKey] ?? [];
  }

  resetProgress(): void {
    const settings = this.data.settings;
    this.data = defaults();
    this.data.settings = settings;
    this.flush();
  }
}
