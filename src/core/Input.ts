/**
 * Keyboard, mouse and pointer lock. Hand-rolled — no Three.js example
 * controls anywhere in this project.
 *
 * Mouse deltas accumulate between frames and are consumed by the camera rig,
 * so a 240Hz mouse on a 60Hz display still delivers every count.
 */

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'reel'
  | 'arc'
  | 'camo'
  | 'restart'
  | 'pause'
  | 'tuning';

const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  reel: ['ShiftLeft', 'ShiftRight'],
  arc: ['KeyE'],
  camo: ['KeyQ'],
  restart: ['KeyR'],
  pause: ['Escape'],
  tuning: ['Backquote'],
};

export class Input {
  readonly bindings: Record<Action, string[]> = { ...DEFAULT_BINDINGS };

  /** Accumulated pointer movement since the last endFrame(), in raw counts. */
  mouseDX = 0;
  mouseDY = 0;

  /** Held state for mouse buttons 0 (left web) and 2 (right web). */
  mouseLeft = false;
  mouseRight = false;
  mouseLeftPressed = false;
  mouseRightPressed = false;
  mouseLeftReleased = false;
  mouseRightReleased = false;

  locked = false;
  /** Fired whenever pointer lock is gained or lost. */
  onLockChange: ((locked: boolean) => void) | null = null;

  private held = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private releasedThisFrame = new Set<string>();
  private element: HTMLElement;
  private lockRequestedAt = 0;
  private gamepadIndex = -1;
  private padLeft = false;
  private padRight = false;

  constructor(element: HTMLElement) {
    this.element = element;

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    window.addEventListener('gamepadconnected', this.onGamepadConnected);
    window.addEventListener('gamepaddisconnected', this.onGamepadDisconnected);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    window.removeEventListener('gamepadconnected', this.onGamepadConnected);
    window.removeEventListener('gamepaddisconnected', this.onGamepadDisconnected);
  }

  // -- queries -------------------------------------------------------------

  down(action: Action): boolean {
    const codes = this.bindings[action];
    for (let i = 0; i < codes.length; i++) if (this.held.has(codes[i])) return true;
    return false;
  }

  justPressed(action: Action): boolean {
    const codes = this.bindings[action];
    for (let i = 0; i < codes.length; i++) if (this.pressedThisFrame.has(codes[i])) return true;
    return false;
  }

  justReleased(action: Action): boolean {
    const codes = this.bindings[action];
    for (let i = 0; i < codes.length; i++) if (this.releasedThisFrame.has(codes[i])) return true;
    return false;
  }

  keyDown(code: string): boolean {
    return this.held.has(code);
  }

  /** -1..1 on each axis from WASD plus left stick. */
  moveAxes(out: { x: number; y: number }): void {
    let x = 0;
    let y = 0;
    if (this.down('right')) x += 1;
    if (this.down('left')) x -= 1;
    if (this.down('forward')) y += 1;
    if (this.down('back')) y -= 1;
    const pad = this.gamepad();
    if (pad) {
      x += deadzone(pad.axes[0] ?? 0);
      y -= deadzone(pad.axes[1] ?? 0);
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    out.x = x;
    out.y = y;
  }

  // -- pointer lock --------------------------------------------------------

  requestLock(): void {
    if (this.locked) return;
    this.lockRequestedAt = performance.now();
    // Plain request first.
    //
    // The `unadjustedMovement` variant returns a promise, and retrying from
    // its .catch() puts the retry OUTSIDE the user gesture, where Chrome
    // rejects it outright. That left the player unlocked: mouse-look dead,
    // the real cursor drifting to the edge of the window, and no way to turn.
    // Raw input is a nicety; being able to look is not.
    try {
      this.element.requestPointerLock();
    } catch {
      /* reported via pointerlockerror */
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Chrome refuses a re-lock for ~1s after the user pressed Escape. */
  get lockCoolingDown(): boolean {
    return performance.now() - this.lockRequestedAt < 1300;
  }

  // -- frame lifecycle -----------------------------------------------------

  endFrame(): void {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseLeftPressed = false;
    this.mouseRightPressed = false;
    this.mouseLeftReleased = false;
    this.mouseRightReleased = false;
  }

  /** Poll the pad each frame; web triggers map to the shoulder buttons. */
  pollGamepad(): void {
    const pad = this.gamepad();
    if (!pad) return;
    const lookX = deadzone(pad.axes[2] ?? 0);
    const lookY = deadzone(pad.axes[3] ?? 0);
    this.mouseDX += lookX * 14;
    this.mouseDY += lookY * 14;
    const padL = (pad.buttons[6]?.value ?? 0) > 0.4 || (pad.buttons[4]?.pressed ?? false);
    const padR = (pad.buttons[7]?.value ?? 0) > 0.4 || (pad.buttons[5]?.pressed ?? false);
    if (padL !== this.padLeft) {
      if (padL) this.mouseLeftPressed = true;
      else this.mouseLeftReleased = true;
      this.padLeft = padL;
    }
    if (padR !== this.padRight) {
      if (padR) this.mouseRightPressed = true;
      else this.mouseRightReleased = true;
      this.padRight = padR;
    }
    // OR the two sources. Assigning would let an idle pad clear a held mouse
    // button on the very next poll.
    this.mouseLeft = this.mouseLeft || padL;
    this.mouseRight = this.mouseRight || padR;
  }

  private gamepad(): Gamepad | null {
    if (this.gamepadIndex < 0 || !navigator.getGamepads) return null;
    return navigator.getGamepads()[this.gamepadIndex] ?? null;
  }

  // -- listeners -----------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    // Let the browser keep its own shortcuts (reload, devtools, tab switch).
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    this.held.add(e.code);
    this.pressedThisFrame.add(e.code);
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
    this.releasedThisFrame.add(e.code);
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.mouseLeft = true;
      this.mouseLeftPressed = true;
    } else if (e.button === 2) {
      this.mouseRight = true;
      this.mouseRightPressed = true;
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.mouseLeft = false;
      this.mouseLeftReleased = true;
    } else if (e.button === 2) {
      this.mouseRight = false;
      this.mouseRightReleased = true;
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onBlur = (): void => {
    this.held.clear();
    this.mouseLeft = false;
    this.mouseRight = false;
  };

  private onPointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.element;
    this.onLockChange?.(this.locked);
  };

  private onPointerLockError = (): void => {
    this.locked = false;
    this.onLockChange?.(false);
  };

  private onGamepadConnected = (e: Event): void => {
    this.gamepadIndex = (e as GamepadEvent).gamepad.index;
  };

  private onGamepadDisconnected = (): void => {
    this.gamepadIndex = -1;
  };
}

const PREVENT_DEFAULT = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backquote',
  'Tab',
]);

function deadzone(v: number, dz = 0.16): number {
  const a = Math.abs(v);
  if (a < dz) return 0;
  return Math.sign(v) * ((a - dz) / (1 - dz));
}
