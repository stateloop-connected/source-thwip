/**
 * A procedural four-bar loop: kick, snare, hats, sub-bass.
 *
 * Scheduled a bar ahead on a lookahead timer rather than with setInterval, so
 * it stays sample-accurate and does not drift or stutter when the main thread
 * is busy. Tempo rises with rank — 86bpm at rank 1, 102bpm at rank 12 — so
 * the whole soundtrack tightens as the player gets better.
 */

import type { AudioEngine } from './AudioEngine';

const STEPS = 16;
/** 1 = hit. Four bars of a spare hip-hop-leaning pattern. */
const KICK = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0];
const SNARE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];
const HAT = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0];
/** Semitone offsets from the root, one per bar. */
const BASS_BARS = [0, 0, 3, -2];
const ROOT = 55; // A1

export class Music {
  bpm = 86;
  playing = false;

  private e: AudioEngine;
  private nextStepTime = 0;
  private step = 0;
  private bar = 0;
  private timer = 0;

  constructor(engine: AudioEngine) {
    this.e = engine;
  }

  /** 86bpm at rank 1 up to 102 at rank 12. */
  setRank(rank: number): void {
    const t = Math.max(0, Math.min(1, (rank - 1) / 11));
    this.bpm = 86 + t * 16;
  }

  start(): void {
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.bar = 0;
    this.nextStepTime = this.e.time + 0.08;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    this.playing = false;
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  private get stepDuration(): number {
    return 60 / this.bpm / 4; // sixteenth notes
  }

  /** Schedule everything that falls inside the next 120ms. */
  private schedule(): void {
    if (!this.playing) return;
    const ahead = 0.12;
    while (this.nextStepTime < this.e.time + ahead) {
      this.emit(this.step, this.nextStepTime);
      this.nextStepTime += this.stepDuration;
      this.step++;
      if (this.step >= STEPS) {
        this.step = 0;
        this.bar = (this.bar + 1) % 4;
      }
    }
  }

  private emit(step: number, t: number): void {
    if (KICK[step]) this.kick(t);
    if (SNARE[step]) this.snare(t);
    if (HAT[step]) this.hat(t, step % 4 === 0 ? 0.09 : 0.05);
    // Sub-bass on the downbeat and the and-of-three.
    if (step === 0 || step === 10) {
      const semis = BASS_BARS[this.bar];
      this.bass(t, ROOT * Math.pow(2, semis / 12), this.stepDuration * (step === 0 ? 5 : 3));
    }
  }

  private kick(t: number): void {
    const { ctx, musicBus } = this.e;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.85, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.connect(g).connect(musicBus);
    o.start(t);
    o.stop(t + 0.28);
  }

  private snare(t: number): void {
    const { ctx, musicBus } = this.e;
    const n = this.e.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1750;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.34, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    n.connect(bp).connect(g).connect(musicBus);
    n.start(t);
    n.stop(t + 0.18);
  }

  private hat(t: number, level: number): void {
    const { ctx, musicBus } = this.e;
    const n = this.e.noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    n.connect(hp).connect(g).connect(musicBus);
    n.start(t);
    n.stop(t + 0.06);
  }

  private bass(t: number, freq: number, dur: number): void {
    const { ctx, musicBus } = this.e;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(420, t);
    lp.frequency.exponentialRampToValueAtTime(150, t + dur);
    lp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.7, 0.08);
    o.connect(lp).connect(g).connect(musicBus);
    o.start(t);
    o.stop(t + dur + 0.3);
  }

  dispose(): void {
    this.stop();
  }
}
