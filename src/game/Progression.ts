/**
 * Twelve ranks, and the best idea in the design: the framerate is the reward.
 *
 * In the film the hero animates on twos until he masters his powers, then
 * steps up to smooth. Here the player earns that transition — as rank rises
 * the animation step rate climbs from 12 to 24fps, the glitch recedes,
 * colour saturates, the halftone dots get finer and the line boil calms. The
 * world literally resolves into focus around them.
 *
 * ONLY animation and VFX are stepped. Camera, mouse-look, physics and post
 * always run at full framerate — see Loop.
 */

import { T } from '../core/Tuning';

export const MAX_RANK = 12;

/** Cumulative XP needed to reach each rank. Index 0 is rank 1. */
export const RANK_XP: readonly number[] = [
  0, 260, 620, 1080, 1660, 2380, 3260, 4320, 5580, 7060, 8780, 10760,
];

export type MoveId = 'thwip' | 'wallRun' | 'webZip' | 'arcDash' | 'camoGlide' | 'pointLaunch';

export interface Unlock {
  rank: number;
  id: MoveId;
  name: string;
  detail: string;
  shout: string;
}

export const UNLOCKS: readonly Unlock[] = [
  { rank: 1, id: 'thwip', name: 'THWIP', detail: 'Left and right web. Hold to stay tethered.', shout: 'THWIP!' },
  { rank: 3, id: 'wallRun', name: 'WALL-RUN', detail: 'Hold W on wall contact. Refills flow while you run.', shout: 'SKRTT!' },
  { rank: 5, id: 'webZip', name: 'WEB-ZIP', detail: 'SPACE while tethered yanks you hard toward the anchor.', shout: 'ZIPP!' },
  { rank: 7, id: 'arcDash', name: 'ARC DASH', detail: 'E for a bio-electric burst. Brief gravity immunity and an AoE.', shout: 'KRAKK!' },
  { rank: 9, id: 'camoGlide', name: 'CAMO GLIDE', detail: 'Q to vanish into a slow fall. Flow drains slower.', shout: 'HUSH...' },
  { rank: 12, id: 'pointLaunch', name: 'POINT LAUNCH', detail: 'Dual-web slingshot at double power. The mastery move.', shout: 'SHOOM!' },
];

export interface StyleValues {
  stepRate: number;
  glitch: number;
  saturation: number;
  dotScale: number;
  boil: number;
}

/** Linear across the twelve ranks, exactly as specified. */
export function styleForRank(rank: number): StyleValues {
  const t = Math.max(0, Math.min(1, (rank - 1) / (MAX_RANK - 1)));
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    stepRate: lerp(T.stepRateRank1, T.stepRateRank12),
    glitch: lerp(T.glitchRank1, T.glitchRank12),
    saturation: lerp(T.saturationRank1, T.saturationRank12),
    dotScale: lerp(T.dotScaleRank1, T.dotScaleRank12),
    boil: lerp(T.boilRank1, T.boilRank12),
  };
}

export function rankForXp(xp: number): number {
  let rank = 1;
  for (let i = 0; i < RANK_XP.length; i++) if (xp >= RANK_XP[i]) rank = i + 1;
  return Math.min(MAX_RANK, rank);
}

export function unlockAt(rank: number): Unlock | undefined {
  return UNLOCKS.find((u) => u.rank === rank);
}

export function hasMove(rank: number, id: MoveId): boolean {
  const u = UNLOCKS.find((x) => x.id === id);
  return !!u && rank >= u.rank;
}
