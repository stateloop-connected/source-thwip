/**
 * Points, combo, and the event feed the HUD and score page read from.
 *
 * The combo is a pressure gauge, not a bank: it decays on its own, so the
 * player is always being pushed to do the next thing rather than being
 * allowed to sit on a number they already earned.
 */

import { T } from '../core/Tuning';
import type { FlowMeter } from './FlowMeter';

export type ScoreEventType =
  | 'nearMiss'
  | 'wallRun'
  | 'pointLaunch'
  | 'token'
  | 'beacon'
  | 'perfectSave'
  | 'slingshot'
  | 'groundContact';

interface Rule {
  points: () => number;
  flow: () => number;
  combo: number;
  label: string;
  shout: string;
}

const RULES: Record<ScoreEventType, Rule> = {
  nearMiss: { points: () => T.ptsNearMiss, flow: () => T.flowNearMiss, combo: 2, label: 'NEAR MISS', shout: 'WHIP' },
  wallRun: { points: () => T.ptsWallRun, flow: () => T.flowWallRun, combo: 1, label: 'WALL-RUN', shout: 'SKRTT' },
  pointLaunch: { points: () => T.ptsPointLaunch, flow: () => T.flowPointLaunch, combo: 3, label: 'POINT LAUNCH', shout: 'SHOOM' },
  token: { points: () => T.ptsToken, flow: () => T.flowToken, combo: 1, label: 'TOKEN', shout: 'TING' },
  beacon: { points: () => T.ptsBeacon, flow: () => T.flowBeacon, combo: 5, label: 'BEACON', shout: 'KRAKK' },
  perfectSave: { points: () => T.ptsPerfectSave, flow: () => T.flowPerfectSave, combo: 3, label: 'PERFECT SAVE', shout: 'CLEAN' },
  slingshot: { points: () => T.ptsSlingshot, flow: () => T.flowSlingshot, combo: 4, label: 'SLINGSHOT', shout: 'FWOOSH' },
  groundContact: { points: () => 0, flow: () => T.flowGroundContact, combo: 0, label: 'GROUNDED', shout: 'WHUMP' },
};

export interface RunStats {
  score: number;
  bestCombo: number;
  topSpeedMs: number;
  distance: number;
  airTime: number;
  swings: number;
  longestChain: number;
  nearMisses: number;
  tokens: number;
  beacons: number;
  pointLaunches: number;
  slingshots: number;
  wallRunTime: number;
  groundContacts: number;
  districtsVisited: string[];
}

export interface AwardResult {
  points: number;
  label: string;
  shout: string;
  combo: number;
}

export type ScoreListener = (type: ScoreEventType, result: AwardResult) => void;

function blankStats(): RunStats {
  return {
    score: 0,
    bestCombo: 1,
    topSpeedMs: 0,
    distance: 0,
    airTime: 0,
    swings: 0,
    longestChain: 0,
    nearMisses: 0,
    tokens: 0,
    beacons: 0,
    pointLaunches: 0,
    slingshots: 0,
    wallRunTime: 0,
    groundContacts: 0,
    districtsVisited: [],
  };
}

export class Scoring {
  score = 0;
  combo = 1;
  /** Grows on every scoring event, drives the HUD's punch animation. */
  comboPulse = 0;
  stats: RunStats = blankStats();
  onEvent: ScoreListener | null = null;

  private decayTimer = 0;
  private chain = 0;

  reset(): void {
    this.score = 0;
    this.combo = 1;
    this.comboPulse = 0;
    this.decayTimer = 0;
    this.chain = 0;
    this.stats = blankStats();
  }

  update(dt: number): void {
    this.comboPulse = Math.max(0, this.comboPulse - dt * 3.4);
    if (this.combo <= 1) return;
    this.decayTimer += dt;
    if (this.decayTimer >= T.comboDecayTime) {
      this.decayTimer = 0;
      this.combo = Math.max(1, this.combo - 1);
    }
  }

  /** Apply an event: score it, move the combo, and feed the flow meter. */
  award(type: ScoreEventType, flow: FlowMeter, scale = 1): AwardResult {
    const rule = RULES[type];
    const points = Math.round(rule.points() * scale * this.combo);

    if (type === 'groundContact') {
      // Never a death. A shattered multiplier is what makes it hurt.
      this.combo = 1;
      this.chain = 0;
      this.stats.groundContacts++;
    } else {
      this.combo = Math.min(Math.round(T.comboMax), this.combo + rule.combo);
      this.comboPulse = 1;
    }
    this.decayTimer = 0;

    this.score += points;
    // stats.score is what the score page, the challenge cards and the saved
    // best all read. Leaving it unsynced meant every run reported zero no
    // matter how well it went.
    this.stats.score = this.score;
    flow.add(rule.flow() * scale);

    switch (type) {
      case 'nearMiss':
        this.stats.nearMisses++;
        break;
      case 'token':
        this.stats.tokens++;
        break;
      case 'beacon':
        this.stats.beacons++;
        break;
      case 'pointLaunch':
        this.stats.pointLaunches++;
        break;
      case 'slingshot':
        this.stats.slingshots++;
        break;
      case 'wallRun':
        this.stats.wallRunTime += scale;
        break;
      case 'perfectSave':
      case 'groundContact':
        break;
    }
    if (this.combo > this.stats.bestCombo) this.stats.bestCombo = this.combo;

    const result: AwardResult = { points, label: rule.label, shout: rule.shout, combo: this.combo };
    this.onEvent?.(type, result);
    return result;
  }

  /** Called on every web attach so the score page can report swing chains. */
  countSwing(): void {
    this.stats.swings++;
    this.chain++;
    if (this.chain > this.stats.longestChain) this.stats.longestChain = this.chain;
  }

  noteDistrict(id: string): void {
    if (!this.stats.districtsVisited.includes(id)) this.stats.districtsVisited.push(id);
  }

  sampleBody(speedMs: number, dt: number, airborne: boolean, distance: number): void {
    if (speedMs > this.stats.topSpeedMs) this.stats.topSpeedMs = speedMs;
    if (airborne) this.stats.airTime += dt;
    this.stats.distance = distance;
  }
}
