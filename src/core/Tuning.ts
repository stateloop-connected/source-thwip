/**
 * Every number that defines how the game feels, in one live-mutable object.
 *
 * `T` is read directly by hot loops (plain property access, no map lookups).
 * `PARAMS` describes each entry so the tuning panel can build itself, and so
 * values can be persisted and exported as a paste-ready constants block.
 */

export const T = {
  // -- body ----------------------------------------------------------------
  gravity: -24.0,
  maxSpeed: 55.0,
  airControlAccel: 7.0,
  terminalFallSpeed: -60.0,
  playerRadius: 0.45,
  eyeHeight: 1.7,
  jumpImpulse: 9.5,
  groundFriction: 6.0,
  groundAccel: 34.0,

  // -- web / tether --------------------------------------------------------
  maxAttachRange: 95.0,
  attachConeAngle: 14.0,
  steerAssist: 0.35,
  // Tuned up hard from the spec's 9.0 starting point. Reeling conserves
  // angular momentum, so it is the player's throttle; at 9 the swing never
  // reached the 1.2-2.0s apex cadence the feel test asks for.
  reelSpeed: 26.0,
  // Raised from the spec's 4.0: reeling conserves angular momentum, and a 4m
  // radius at swing speed is a 13 rad/s orbit -- over a revolution per second
  // and around 70g. Ten metres keeps the tightest arc readable.
  minTetherLength: 10.0,
  slingshotPower: 13.0,
  tetherStiffness: 0.85,
  releaseBoostFactor: 0.28,
  releaseBoostMax: 11.0,
  apexBoostWindow: 0.18,
  substeps: 4,
  tetherSlack: 1.02,
  tetherEnergyKeep: 0.72,
  // Capped well under gravity (24). Above that it is a thruster along the
  // velocity vector rather than a lean into the arc, and the swing's speed
  // stops coming from the geometry.
  swingPumpAccel: 14.0,
  webZipSpeed: 34.0,

  // -- camera --------------------------------------------------------------
  // HORIZONTAL degrees, the convention players expect. Three wants vertical,
  // and CameraRig converts. The spec's 78 read as horizontal is a 49 degree
  // vertical frustum -- tunnel vision for a game about speed -- so the base
  // is widened and the boost trimmed to keep the top end out of fisheye.
  baseFOV: 96.0,
  speedFOVBoost: 16.0,
  fovLerpRate: 4.0,
  maxCameraRoll: 6.0,
  headBobAmount: 0.045,
  speedVignetteAt: 35.0,
  lookSensitivity: 1.0,

  // -- moves ---------------------------------------------------------------
  wallRunDuration: 2.5,
  wallRunSpeed: 17.0,
  wallStickForce: 6.0,
  arcDashSpeed: 42.0,
  arcDashTime: 0.42,
  arcRadius: 26.0,
  camoFallSpeed: -6.5,
  camoFlowFactor: 0.35,

  // -- flow ----------------------------------------------------------------
  flowMax: 100.0,
  drainAirborne: 12.0,
  drainGrounded: 25.0,
  flowNearMiss: 8.0,
  flowWallRun: 6.0,
  flowPointLaunch: 12.0,
  flowToken: 15.0,
  flowBeacon: 25.0,
  flowPerfectSave: 10.0,
  flowSlingshot: 14.0,
  flowGroundContact: -20.0,

  // -- scoring -------------------------------------------------------------
  ptsNearMiss: 250,
  ptsWallRun: 150,
  ptsPointLaunch: 600,
  ptsToken: 400,
  ptsBeacon: 1500,
  ptsPerfectSave: 1000,
  ptsSlingshot: 900,
  comboMax: 30,
  comboDecayTime: 2.5,
  nearMissRadius: 3.0,
  nearMissMinSpeed: 25.0,
  runDuration: 90.0,

  // -- style / progression -------------------------------------------------
  stepRateRank1: 12.0,
  stepRateRank12: 24.0,
  glitchRank1: 1.0,
  glitchRank12: 0.0,
  saturationRank1: 0.62,
  saturationRank12: 1.0,
  dotScaleRank1: 6.5,
  dotScaleRank12: 2.4,
  boilRank1: 1.0,
  boilRank12: 0.35,

  // -- look ----------------------------------------------------------------
  halftoneStrength: 1.0,
  outlineStrength: 1.0,
  outlineThickness: 2.2,
  // Wider range and a smaller offset than the spec's starting point: the
  // chain screens into dots BEFORE it splits plates, so a 6px offset shears
  // the dot grid apart into rainbow confetti instead of reading as misprint.
  cmykFocusRange: 130.0,
  cmykMaxOffset: 9.0,
  speedLinesAt: 28.0,
  speedLineIntensity: 1.0,
  grainAmount: 0.12,
  vignetteAmount: 0.24,
  misregisterAmount: 1.0,
};

export type Tuning = typeof T;
export type TuningKey = keyof Tuning;

export interface ParamMeta {
  key: TuningKey;
  group: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

// prettier-ignore
export const PARAMS: ParamMeta[] = [
  { key: 'gravity',            group: 'Body',   label: 'Gravity',            min: -60,  max: -4,   step: 0.5,   unit: 'm/s²' },
  { key: 'maxSpeed',           group: 'Body',   label: 'Max speed',          min: 20,   max: 120,  step: 1,     unit: 'm/s' },
  { key: 'airControlAccel',    group: 'Body',   label: 'Air control',        min: 0,    max: 30,   step: 0.5,   unit: 'm/s²' },
  { key: 'terminalFallSpeed',  group: 'Body',   label: 'Terminal fall',      min: -120, max: -10,  step: 1,     unit: 'm/s' },
  { key: 'playerRadius',       group: 'Body',   label: 'Player radius',      min: 0.2,  max: 1.5,  step: 0.05,  unit: 'm' },
  { key: 'eyeHeight',          group: 'Body',   label: 'Eye height',         min: 0.8,  max: 2.4,  step: 0.05,  unit: 'm' },
  { key: 'jumpImpulse',        group: 'Body',   label: 'Jump impulse',       min: 0,    max: 24,   step: 0.5,   unit: 'm/s' },
  { key: 'groundFriction',     group: 'Body',   label: 'Ground friction',    min: 0,    max: 20,   step: 0.25 },
  { key: 'groundAccel',        group: 'Body',   label: 'Ground accel',       min: 0,    max: 90,   step: 1,     unit: 'm/s²' },

  { key: 'maxAttachRange',     group: 'Web',    label: 'Attach range',       min: 20,   max: 220,  step: 1,     unit: 'm' },
  { key: 'attachConeAngle',    group: 'Web',    label: 'Aim cone',           min: 1,    max: 45,   step: 0.5,   unit: '°' },
  { key: 'steerAssist',        group: 'Web',    label: 'Steer assist',       min: 0,    max: 1,    step: 0.01 },
  { key: 'reelSpeed',          group: 'Web',    label: 'Reel speed',         min: 0,    max: 40,   step: 0.25,  unit: 'm/s' },
  { key: 'minTetherLength',    group: 'Web',    label: 'Min tether',         min: 4,    max: 30,   step: 0.25,  unit: 'm' },
  { key: 'slingshotPower',     group: 'Web',    label: 'Slingshot power',    min: 0,    max: 40,   step: 0.5,   unit: 'm/s' },
  { key: 'tetherStiffness',    group: 'Web',    label: 'Tether stiffness',   min: 0.1,  max: 1,    step: 0.01 },
  { key: 'tetherSlack',        group: 'Web',    label: 'Attach slack',       min: 1,    max: 1.4,  step: 0.01 },
  { key: 'tetherEnergyKeep',   group: 'Web',    label: 'Swing energy keep',  min: 0,    max: 1,    step: 0.01 },
  { key: 'swingPumpAccel',     group: 'Web',    label: 'Swing pump',         min: 0,    max: 40,   step: 0.5,   unit: 'm/s²' },
  { key: 'releaseBoostFactor', group: 'Web',    label: 'Release boost',      min: 0,    max: 1,    step: 0.01 },
  { key: 'releaseBoostMax',    group: 'Web',    label: 'Release boost cap',  min: 0,    max: 30,   step: 0.25,  unit: 'm/s' },
  { key: 'apexBoostWindow',    group: 'Web',    label: 'Apex window',        min: 0.02, max: 0.8,  step: 0.01,  unit: 's' },
  { key: 'webZipSpeed',        group: 'Web',    label: 'Web-zip speed',      min: 5,    max: 80,   step: 1,     unit: 'm/s' },
  // Floor of 3: at 1 substep with a 1/30s frame the capsule tunnels through
  // building walls at top speed.
  { key: 'substeps',           group: 'Web',    label: 'Physics substeps',   min: 3,    max: 12,   step: 1 },

  { key: 'baseFOV',            group: 'Camera', label: 'Base FOV (horiz)',   min: 70,   max: 120,  step: 1,     unit: '°' },
  { key: 'speedFOVBoost',      group: 'Camera', label: 'Speed FOV boost',    min: 0,    max: 40,   step: 1,     unit: '°' },
  { key: 'fovLerpRate',        group: 'Camera', label: 'FOV lerp rate',      min: 0.5,  max: 15,   step: 0.1,   unit: '/s' },
  { key: 'maxCameraRoll',      group: 'Camera', label: 'Max roll',           min: 0,    max: 20,   step: 0.5,   unit: '°' },
  { key: 'headBobAmount',      group: 'Camera', label: 'Head bob',           min: 0,    max: 0.2,  step: 0.005, unit: 'm' },
  { key: 'speedVignetteAt',    group: 'Camera', label: 'Speed vignette at',  min: 10,   max: 70,   step: 1,     unit: 'm/s' },
  { key: 'lookSensitivity',    group: 'Camera', label: 'Sensitivity',        min: 0.2,  max: 3,    step: 0.05 },

  { key: 'wallRunDuration',    group: 'Moves',  label: 'Wall-run time',      min: 0.5,  max: 8,    step: 0.1,   unit: 's' },
  { key: 'wallRunSpeed',       group: 'Moves',  label: 'Wall-run speed',     min: 4,    max: 40,   step: 0.5,   unit: 'm/s' },
  { key: 'wallStickForce',     group: 'Moves',  label: 'Wall stick',         min: 0,    max: 20,   step: 0.25 },
  { key: 'arcDashSpeed',     group: 'Moves',  label: 'Arc dash speed',   min: 10,   max: 90,   step: 1,     unit: 'm/s' },
  { key: 'arcDashTime',      group: 'Moves',  label: 'Arc dash time',    min: 0.1,  max: 1.5,  step: 0.02,  unit: 's' },
  { key: 'arcRadius',        group: 'Moves',  label: 'Arc radius',       min: 5,    max: 60,   step: 1,     unit: 'm' },
  { key: 'camoFallSpeed',      group: 'Moves',  label: 'Camo fall speed',    min: -20,  max: -1,   step: 0.25,  unit: 'm/s' },
  { key: 'camoFlowFactor',     group: 'Moves',  label: 'Camo drain factor',  min: 0,    max: 1,    step: 0.01 },

  { key: 'flowMax',            group: 'Flow',   label: 'Flow capacity',      min: 20,   max: 200,  step: 5 },
  { key: 'drainAirborne',      group: 'Flow',   label: 'Drain airborne',     min: 0,    max: 40,   step: 0.5,   unit: '/s' },
  { key: 'drainGrounded',      group: 'Flow',   label: 'Drain grounded',     min: 0,    max: 60,   step: 0.5,   unit: '/s' },
  { key: 'flowNearMiss',       group: 'Flow',   label: '+ Near miss',        min: 0,    max: 40,   step: 0.5 },
  { key: 'flowWallRun',        group: 'Flow',   label: '+ Wall-run /s',      min: 0,    max: 40,   step: 0.5 },
  { key: 'flowPointLaunch',    group: 'Flow',   label: '+ Point launch',     min: 0,    max: 40,   step: 0.5 },
  { key: 'flowToken',          group: 'Flow',   label: '+ Token',            min: 0,    max: 60,   step: 0.5 },
  { key: 'flowBeacon',         group: 'Flow',   label: '+ Beacon',           min: 0,    max: 80,   step: 0.5 },
  { key: 'flowPerfectSave',    group: 'Flow',   label: '+ Perfect save',     min: 0,    max: 60,   step: 0.5 },
  { key: 'flowSlingshot',      group: 'Flow',   label: '+ Slingshot',        min: 0,    max: 60,   step: 0.5 },
  { key: 'flowGroundContact',  group: 'Flow',   label: '- Ground contact',   min: -80,  max: 0,    step: 1 },

  { key: 'ptsNearMiss',        group: 'Score',  label: 'Near miss',          min: 0,    max: 3000, step: 25 },
  { key: 'ptsWallRun',         group: 'Score',  label: 'Wall-run /s',        min: 0,    max: 3000, step: 25 },
  { key: 'ptsPointLaunch',     group: 'Score',  label: 'Point launch',       min: 0,    max: 5000, step: 25 },
  { key: 'ptsToken',           group: 'Score',  label: 'Token',              min: 0,    max: 3000, step: 25 },
  { key: 'ptsBeacon',          group: 'Score',  label: 'Beacon',             min: 0,    max: 8000, step: 50 },
  { key: 'ptsPerfectSave',     group: 'Score',  label: 'Perfect save',       min: 0,    max: 6000, step: 50 },
  { key: 'ptsSlingshot',       group: 'Score',  label: 'Slingshot',          min: 0,    max: 5000, step: 25 },
  { key: 'comboMax',           group: 'Score',  label: 'Combo cap',          min: 2,    max: 99,   step: 1,     unit: 'x' },
  { key: 'comboDecayTime',     group: 'Score',  label: 'Combo decay',        min: 0.5,  max: 10,   step: 0.1,   unit: 's' },
  { key: 'nearMissRadius',     group: 'Score',  label: 'Near-miss radius',   min: 0.5,  max: 12,   step: 0.1,   unit: 'm' },
  { key: 'nearMissMinSpeed',   group: 'Score',  label: 'Near-miss speed',    min: 5,    max: 60,   step: 1,     unit: 'm/s' },
  { key: 'runDuration',        group: 'Score',  label: 'Run length',         min: 15,   max: 300,  step: 5,     unit: 's' },

  { key: 'stepRateRank1',      group: 'Style',  label: 'Step rate @ r1',     min: 4,    max: 60,   step: 1,     unit: 'fps' },
  { key: 'stepRateRank12',     group: 'Style',  label: 'Step rate @ r12',    min: 4,    max: 60,   step: 1,     unit: 'fps' },
  { key: 'glitchRank1',        group: 'Style',  label: 'Glitch @ r1',        min: 0,    max: 2,    step: 0.02 },
  { key: 'glitchRank12',       group: 'Style',  label: 'Glitch @ r12',       min: 0,    max: 2,    step: 0.02 },
  { key: 'saturationRank1',    group: 'Style',  label: 'Saturation @ r1',    min: 0,    max: 1.6,  step: 0.02 },
  { key: 'saturationRank12',   group: 'Style',  label: 'Saturation @ r12',   min: 0,    max: 1.6,  step: 0.02 },
  { key: 'dotScaleRank1',      group: 'Style',  label: 'Dot scale @ r1',     min: 1,    max: 16,   step: 0.1,   unit: 'px' },
  { key: 'dotScaleRank12',     group: 'Style',  label: 'Dot scale @ r12',    min: 1,    max: 16,   step: 0.1,   unit: 'px' },
  { key: 'boilRank1',          group: 'Style',  label: 'Line boil @ r1',     min: 0,    max: 3,    step: 0.05 },
  { key: 'boilRank12',         group: 'Style',  label: 'Line boil @ r12',    min: 0,    max: 3,    step: 0.05 },

  { key: 'halftoneStrength',   group: 'Look',   label: 'Halftone strength',  min: 0,    max: 1.5,  step: 0.02 },
  { key: 'outlineStrength',    group: 'Look',   label: 'Outline strength',   min: 0,    max: 2,    step: 0.02 },
  { key: 'outlineThickness',   group: 'Look',   label: 'Outline thickness',  min: 0.4,  max: 4,    step: 0.05,  unit: 'px' },
  { key: 'cmykFocusRange',     group: 'Look',   label: 'CMYK focus range',   min: 20,   max: 600,  step: 5,     unit: 'm' },
  { key: 'cmykMaxOffset',      group: 'Look',   label: 'CMYK max split',     min: 0,    max: 24,   step: 0.25,  unit: 'px' },
  { key: 'speedLinesAt',       group: 'Look',   label: 'Speed lines from',   min: 5,    max: 60,   step: 1,     unit: 'm/s' },
  { key: 'speedLineIntensity', group: 'Look',   label: 'Speed line power',   min: 0,    max: 2,    step: 0.02 },
  { key: 'grainAmount',        group: 'Look',   label: 'Paper grain',        min: 0,    max: 0.6,  step: 0.01 },
  { key: 'vignetteAmount',     group: 'Look',   label: 'Vignette',           min: 0,    max: 1.5,  step: 0.02 },
  { key: 'misregisterAmount',  group: 'Look',   label: 'Misregistration',    min: 0,    max: 5,    step: 0.05,  unit: 'px' },
];

export const TUNING_DEFAULTS: Tuning = { ...T };

/** Bulk-apply saved or panel-edited values, ignoring anything unknown. */
export function applyTuning(values: Partial<Record<string, number>>): void {
  for (const p of PARAMS) {
    const v = values[p.key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      (T as Record<string, number>)[p.key] = v;
    }
  }
}

export function resetTuning(): void {
  applyTuning(TUNING_DEFAULTS as unknown as Record<string, number>);
}

/** Only the values that differ from defaults — keeps saved state small. */
export function tuningDelta(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of PARAMS) {
    if (T[p.key] !== TUNING_DEFAULTS[p.key]) out[p.key] = T[p.key];
  }
  return out;
}

/** Paste-ready constants block for the "Copy values as TypeScript" button. */
export function exportTuningTS(): string {
  const groups = new Map<string, ParamMeta[]>();
  for (const p of PARAMS) {
    const list = groups.get(p.group);
    if (list) list.push(p);
    else groups.set(p.group, [p]);
  }
  const lines: string[] = ['export const T = {'];
  for (const [group, params] of groups) {
    lines.push(`  // -- ${group.toLowerCase()} --`);
    for (const p of params) {
      const v = T[p.key];
      const num = Number.isInteger(v) ? v.toFixed(1) : String(Math.round(v * 1000) / 1000);
      lines.push(`  ${p.key}: ${num},${p.unit ? ` // ${p.unit}` : ''}`);
    }
  }
  lines.push('};');
  return lines.join('\n');
}
