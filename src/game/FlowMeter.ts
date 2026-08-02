/**
 * The only fail state in the game.
 *
 * Flow always drains, so the player can never coast, and it drains twice as
 * fast on the ground — which is the pressure that keeps them airborne without
 * ever needing a death screen. Touching the ground costs flow and shatters
 * the combo; it does not kill. That distinction is the entire addiction
 * mechanism and it must not be softened in either direction.
 */

import { T } from '../core/Tuning';

export class FlowMeter {
  value = 100;
  /** True on the frame flow first hit zero. */
  justEmptied = false;
  /** Smoothed 0..1 for the HUD bar, so it never snaps. */
  display = 1;

  reset(): void {
    this.value = T.flowMax;
    this.display = 1;
    this.justEmptied = false;
  }

  get normalized(): number {
    return Math.max(0, Math.min(1, this.value / Math.max(1, T.flowMax)));
  }

  get critical(): boolean {
    return this.value < 25;
  }

  get empty(): boolean {
    return this.value <= 0;
  }

  /**
   * @param grounded whether the player is touching a walkable surface
   * @param drainScale 1 normally; the camo glide slows it
   */
  update(dt: number, grounded: boolean, drainScale = 1): void {
    const was = this.value;
    const rate = grounded ? T.drainGrounded : T.drainAirborne;
    this.value = Math.max(0, this.value - rate * drainScale * dt);
    this.justEmptied = was > 0 && this.value <= 0;
    this.display += (this.normalized - this.display) * (1 - Math.exp(-9 * dt));
  }

  add(amount: number): void {
    this.value = Math.max(0, Math.min(T.flowMax, this.value + amount));
  }
}
