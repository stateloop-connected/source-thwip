/**
 * Frame timing.
 *
 * Two clocks live here and they must never be confused:
 *
 *  - `dt` / `elapsed`  run free at display rate. Camera, mouse-look, physics
 *    and post-processing all use these. Stepping them would make the game
 *    feel broken and make people motion sick.
 *
 *  - `animFrameIndex` ticks at `animStepRate` (12fps at rank 1, 24fps at rank
 *    12). Only pose sampling, web-line geometry rebuilds and line-boil noise
 *    are allowed to read it. That is the "animated on twos" trick.
 */

export type LoopCallback = (loop: Loop) => void;

const MAX_DT = 1 / 30;

export class Loop {
  /** Clamped seconds since previous frame. Never exceeds 1/30. */
  dt = 0;
  /** Unclamped seconds since previous frame — for diagnostics only. */
  rawDt = 0;
  /** Clamped, accumulated seconds since start. */
  elapsed = 0;
  /** Free-running frame counter. */
  frame = 0;
  /** Smoothed frames per second. */
  fps = 60;
  /** Smoothed frame time in milliseconds — used for quality auto-detect. */
  avgFrameMs = 16.7;

  /** Ticks at animStepRate. Animation and stepped VFX sample against this. */
  animFrameIndex = 0;
  /** Current animation step rate in fps. Driven by rank. */
  animStepRate = 12;
  /** True on the single frame where animFrameIndex just advanced. */
  animAdvanced = true;
  /** 0..1 progress through the current animation frame. */
  animAlpha = 0;

  running = false;

  private animAcc = 0;
  private prev = 0;
  private rafId = 0;
  private cb: LoopCallback | null = null;
  private fpsAcc = 0;
  private fpsFrames = 0;

  start(cb: LoopCallback): void {
    if (this.running) return;
    this.cb = cb;
    this.running = true;
    this.prev = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /**
   * Call when returning from a paused / backgrounded state so the next frame
   * does not integrate the entire time the tab was hidden.
   */
  resync(): void {
    this.prev = performance.now();
  }

  private tick = (now: number): void => {
    this.rafId = requestAnimationFrame(this.tick);

    this.rawDt = (now - this.prev) / 1000;
    this.prev = now;

    // The single most important line in the file. A tab that was hidden for
    // 40 seconds must not hand the physics a 40 second timestep.
    this.dt = this.rawDt > MAX_DT ? MAX_DT : this.rawDt < 0 ? 0 : this.rawDt;
    this.elapsed += this.dt;
    this.frame++;

    // fps / frame time, smoothed over ~0.25s windows
    this.fpsAcc += this.rawDt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.25) {
      const measured = this.fpsFrames / this.fpsAcc;
      this.fps = this.fps * 0.6 + measured * 0.4;
      this.avgFrameMs = 1000 / Math.max(1, this.fps);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }

    // stepped animation clock
    const stepDur = 1 / Math.max(1, this.animStepRate);
    this.animAcc += this.dt;
    this.animAdvanced = false;
    while (this.animAcc >= stepDur) {
      this.animAcc -= stepDur;
      this.animFrameIndex++;
      this.animAdvanced = true;
    }
    this.animAlpha = this.animAcc / stepDur;

    this.cb?.(this);
  };
}
