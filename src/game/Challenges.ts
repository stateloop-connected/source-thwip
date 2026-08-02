/**
 * The variable reward. Three cards are drawn per run from a pool of twenty,
 * so the score page is never the same twice and there is always a specific
 * reason to press R.
 *
 * Cards are evaluated against the run's stats after the fact — nothing here
 * changes how the run plays, which keeps them from turning into objectives
 * that fight the flow.
 */

import type { Rng } from '../core/Rng';
import type { RunStats } from './Scoring';

export interface Challenge {
  id: string;
  text: string;
  xp: number;
  done: (s: RunStats) => boolean;
  /** 0..1 for the card's progress bar. */
  progress: (s: RunStats) => number;
}

function card(
  id: string,
  text: string,
  xp: number,
  value: (s: RunStats) => number,
  target: number
): Challenge {
  return {
    id,
    text,
    xp,
    done: (s) => value(s) >= target,
    progress: (s) => Math.max(0, Math.min(1, value(s) / target)),
  };
}

export const CHALLENGE_POOL: Challenge[] = [
  card('chain15', 'Chain 15 swings without touching the ground', 120, (s) => s.longestChain, 15),
  card('chain25', 'Chain 25 swings without touching the ground', 200, (s) => s.longestChain, 25),
  card('mph90', 'Hit 90 mph', 110, (s) => s.topSpeedMs * 2.2369363, 90),
  card('mph115', 'Hit 115 mph', 190, (s) => s.topSpeedMs * 2.2369363, 115),
  card('beacon3', 'Resolve 3 crime beacons', 200, (s) => s.beacons, 3),
  card('beacon1', 'Resolve a crime beacon', 90, (s) => s.beacons, 1),
  card('air60', 'Spend 60 seconds airborne', 150, (s) => s.airTime, 60),
  card('air45', 'Spend 45 seconds airborne', 100, (s) => s.airTime, 45),
  card('combo20', 'Reach a x20 combo', 180, (s) => s.bestCombo, 20),
  card('combo12', 'Reach a x12 combo', 110, (s) => s.bestCombo, 12),
  card('combo30', 'Max the combo at x30', 260, (s) => s.bestCombo, 30),
  card('tokens12', 'Collect 12 web-tokens', 130, (s) => s.tokens, 12),
  card('tokens20', 'Collect 20 web-tokens', 190, (s) => s.tokens, 20),
  card('near10', 'Ten near-misses', 120, (s) => s.nearMisses, 10),
  card('near20', 'Twenty near-misses', 190, (s) => s.nearMisses, 20),
  card('launch6', 'Six point-launches', 150, (s) => s.pointLaunches, 6),
  card('sling4', 'Four dual-web slingshots', 170, (s) => s.slingshots, 4),
  card('wall8', 'Wall-run for 8 seconds total', 130, (s) => s.wallRunTime, 8),
  card('districts3', 'Pass through 3 districts', 140, (s) => s.districtsVisited.length, 3),
  card('distance3k', 'Travel 3 kilometres', 160, (s) => s.distance, 3000),
  card('clean', 'Finish without touching the ground', 300, (s) => (s.groundContacts === 0 ? 1 : 0), 1),
  card('score50k', 'Score 50,000 in one run', 220, (s) => s.score, 50000),
];

/** Three distinct cards for this run, drawn from the seeded stream. */
export function drawChallenges(rng: Rng, count = 3): Challenge[] {
  const pool = [...CHALLENGE_POOL];
  rng.shuffle(pool);
  return pool.slice(0, count);
}

export interface ChallengeResult {
  challenge: Challenge;
  done: boolean;
  progress: number;
}

export function evaluate(cards: Challenge[], stats: RunStats): ChallengeResult[] {
  return cards.map((c) => ({ challenge: c, done: c.done(stats), progress: c.progress(stats) }));
}

export function xpEarned(results: ChallengeResult[]): number {
  return results.reduce((sum, r) => sum + (r.done ? r.challenge.xp : 0), 0);
}
