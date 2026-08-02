/**
 * Onomatopoeia. Canvas-rendered letterforms with a heavy ink outline, popped
 * into screen space and faded out.
 *
 * DOM rather than sprites in the scene: it keeps them crisp, costs the GPU
 * nothing, and means they sit above the post chain instead of being screened
 * into dots along with everything else.
 *
 * Capped at three concurrent. Overused, they stop reading as punctuation and
 * start reading as clutter.
 */

const MAX_CONCURRENT = 3;

const COLORS = ['#ffd400', '#ff1f3d', '#22e3ff', '#ff2ea6'];

export class ComicText {
  private root: HTMLDivElement;
  private live: HTMLElement[] = [];
  private seed = 1;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'shouts';
    parent.appendChild(this.root);
  }

  /** Deterministic-ish jitter so repeats never land identically. */
  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  pop(text: string, opts: { big?: boolean } = {}): void {
    if (!text) return;
    while (this.live.length >= MAX_CONCURRENT) {
      const oldest = this.live.shift();
      oldest?.remove();
    }

    const el = document.createElement('div');
    el.className = 'shout' + (opts.big ? ' shout--big' : '');
    el.textContent = text;

    const rot = (this.rand() * 2 - 1) * 13;
    const scale = 0.85 + this.rand() * 0.4;
    // Keep them off the crosshair: the player is aiming through the middle.
    const side = this.rand() < 0.5 ? -1 : 1;
    const x = 50 + side * (14 + this.rand() * 20);
    const y = 34 + this.rand() * 30;
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
    el.style.setProperty('--rot', `${rot.toFixed(1)}deg`);
    el.style.setProperty('--scale', scale.toFixed(2));
    el.style.color = COLORS[Math.floor(this.rand() * COLORS.length) % COLORS.length];

    this.root.appendChild(el);
    this.live.push(el);
    window.setTimeout(() => {
      el.remove();
      const i = this.live.indexOf(el);
      if (i >= 0) this.live.splice(i, 1);
    }, 820);
  }

  clear(): void {
    for (const el of this.live) el.remove();
    this.live.length = 0;
  }

  dispose(): void {
    this.root.remove();
  }
}
