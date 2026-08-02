/**
 * Every sound effect, synthesized on demand.
 *
 * Each shot builds its own short-lived node graph and lets it die: nodes are
 * explicitly stopped so nothing accumulates over a long session. The wind and
 * the web-tension tone are the two exceptions — they are continuous and are
 * created once.
 */

import type { AudioEngine } from './AudioEngine';

export class Sfx {
  private e: AudioEngine;

  // Continuous voices
  private windSrc: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private tensionOsc: OscillatorNode | null = null;
  private tensionGain: GainNode | null = null;

  constructor(engine: AudioEngine) {
    this.e = engine;
    this.startContinuous();
  }

  private startContinuous(): void {
    const { ctx, sfxBus } = this.e;

    // Wind: brown-ish noise through a lowpass, cutoff and gain track speed.
    // This is the primary velocity cue in the whole game.
    this.windSrc = this.e.noiseSource();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 240;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFilter).connect(this.windGain).connect(sfxBus);
    this.windSrc.start();

    // Web tension: a low sine whose pitch tracks the load on the rope.
    this.tensionOsc = ctx.createOscillator();
    this.tensionOsc.type = 'sine';
    this.tensionOsc.frequency.value = 70;
    this.tensionGain = ctx.createGain();
    this.tensionGain.gain.value = 0;
    this.tensionOsc.connect(this.tensionGain).connect(sfxBus);
    this.tensionOsc.start();
  }

  /** @param speed01 0..1 normalised speed @param tension01 0..1 rope load */
  updateContinuous(speed01: number, tension01: number): void {
    const t = this.e.time;
    if (this.windGain && this.windFilter) {
      const s = Math.max(0, Math.min(1, speed01));
      this.windGain.gain.setTargetAtTime(s * s * 0.42, t, 0.09);
      this.windFilter.frequency.setTargetAtTime(220 + s * s * 1500, t, 0.09);
    }
    if (this.tensionGain && this.tensionOsc) {
      const x = Math.max(0, Math.min(1, tension01));
      this.tensionGain.gain.setTargetAtTime(x * 0.1, t, 0.06);
      this.tensionOsc.frequency.setTargetAtTime(58 + x * 92, t, 0.06);
    }
  }

  /** Filtered noise burst, 40ms, bandpass sweeping 3kHz -> 800Hz. */
  thwip(): void {
    const { ctx, sfxBus } = this.e;
    const t = this.e.time;
    const src = this.e.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3.4;
    bp.frequency.setValueAtTime(3000, t);
    bp.frequency.exponentialRampToValueAtTime(800, t + 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.004); // sharp attack
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(bp).connect(g).connect(sfxBus);
    src.start(t);
    src.stop(t + 0.07);
  }

  /** FM sine + noise crackle, fast decay. */
  arc(): void {
    const { ctx, sfxBus } = this.e;
    const t = this.e.time;

    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = 180;
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = 40;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(320, t);
    modGain.gain.exponentialRampToValueAtTime(4, t + 0.35);
    mod.connect(modGain).connect(carrier.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    carrier.connect(g).connect(sfxBus);
    carrier.start(t);
    mod.start(t);
    carrier.stop(t + 0.45);
    mod.stop(t + 0.45);

    const crack = this.e.noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.3, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    crack.connect(hp).connect(cg).connect(sfxBus);
    crack.start(t);
    crack.stop(t + 0.2);
  }

  /** Click transient plus a lowpassed thump. */
  impact(strength = 1): void {
    const { ctx, sfxBus } = this.e;
    const t = this.e.time;

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(120, t);
    thump.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.exponentialRampToValueAtTime(0.5 * strength, t + 0.006);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    thump.connect(tg).connect(sfxBus);
    thump.start(t);
    thump.stop(t + 0.24);

    const click = this.e.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.26 * strength, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    click.connect(lp).connect(cg).connect(sfxBus);
    click.start(t);
    click.stop(t + 0.08);
  }

  /** Short bright blip for pickups. */
  token(): void {
    const { ctx, sfxBus } = this.e;
    const t = this.e.time;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(1760, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(sfxBus);
    o.start(t);
    o.stop(t + 0.18);
  }

  /** Rising four-note major arpeggio. */
  rankUp(): void {
    const { ctx, sfxBus } = this.e;
    const t0 = this.e.time;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const t = t0 + i * 0.11;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      o.connect(g).connect(sfxBus);
      o.start(t);
      o.stop(t + 0.36);
    });
  }

  /** Descending buzz for a broken combo. */
  comboBreak(): void {
    const { ctx, sfxBus } = this.e;
    const t = this.e.time;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(330, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g).connect(sfxBus);
    o.start(t);
    o.stop(t + 0.36);
  }

  dispose(): void {
    this.windSrc?.stop();
    this.tensionOsc?.stop();
    this.windSrc = null;
    this.tensionOsc = null;
  }
}
