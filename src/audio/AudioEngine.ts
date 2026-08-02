/**
 * Web Audio, 100% synthesized. There is not a single audio file in this
 * project — every sound is built from oscillators, filtered noise and
 * envelopes at runtime.
 *
 * The context must be created inside a real user gesture, so this is
 * constructed from the start-overlay click and nowhere else.
 */

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly sfxBus: GainNode;
  readonly musicBus: GainNode;

  /** One shared noise buffer; generating it per-shot would allocate madly. */
  readonly noise: AudioBuffer;

  private muted = false;

  constructor() {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.55;
    this.musicBus.connect(this.master);

    // Two seconds of white noise, looped and re-windowed per shot.
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
  }

  get time(): number {
    return this.ctx.currentTime;
  }

  /** Browsers suspend the context when the tab is hidden. */
  resume(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  suspend(): void {
    if (this.ctx.state === 'running') void this.ctx.suspend();
  }

  setMasterVolume(v: number): void {
    this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.time, 0.02);
  }

  setMusicVolume(v: number): void {
    this.musicBus.gain.setTargetAtTime(v, this.time, 0.05);
  }

  setMuted(muted: boolean, volume: number): void {
    this.muted = muted;
    this.setMasterVolume(volume);
  }

  /** Duck the music under a moment — rank-ups, mostly. */
  duck(amount: number, seconds: number, back: number): void {
    const g = this.musicBus.gain;
    const now = this.time;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(amount, now, 0.03);
    g.setTargetAtTime(back, now + seconds, 0.25);
  }

  /** A one-shot noise source windowed by its own gain envelope. */
  noiseSource(): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    // Random start offset so repeated shots do not phase-lock into a tone.
    src.loopStart = 0;
    src.loopEnd = this.noise.duration;
    return src;
  }

  dispose(): void {
    void this.ctx.close();
  }
}
