/**
 * The click-to-start overlay. It exists for two hard browser requirements —
 * pointer lock and AudioContext both need a real user gesture — so it doubles
 * as the place the controls are taught. A stranger has to be swinging within
 * fifteen seconds of landing here.
 */

const CONTROLS: Array<[key: string, label: string, gate?: string]> = [
  ['MOUSE', 'look'],
  // Kept short so the grid does not overflow; the banner above the button
  // carries the full "HOLD to stay tethered" instruction, which is the single
  // most important thing on this screen.
  ['LMB / RMB', 'webs &mdash; hold!'],
  ['SHIFT', 'reel in'],
  ['SPACE', 'jump / web-zip', 'RANK 5'],
  ['W on wall', 'wall-run', 'RANK 3'],
  ['E', 'arc dash', 'RANK 7'],
  ['Q', 'camo glide', 'RANK 9'],
  ['R', 'restart instantly'],
  ['ESC', 'pause'],
  ['`', 'tuning panel'],
];

export interface StartScreenInfo {
  rank: number;
  bestScore: number;
  runs: number;
  seedLabel: string;
}

export class StartScreen {
  readonly el: HTMLDivElement;
  private cta: HTMLButtonElement;
  private meta: HTMLDivElement;
  private onStart: () => void;

  constructor(parent: HTMLElement, info: StartScreenInfo, onStart: () => void) {
    this.onStart = onStart;

    this.el = document.createElement('div');
    this.el.className = 'screen';
    this.el.innerHTML = `
      <div class="screen__dots"></div>
      <div class="start">
        <h1 class="start__title">THWIP</h1>
        <div class="start__tag">Ninety seconds. Don't touch the ground.</div>
        <div class="start__how">
          <b>HOLD</b> a mouse button on a building ahead and above &middot;
          <b>HOLD SHIFT</b> through the bottom of the swing to build speed &middot;
          release as you rise, then throw the next web
        </div>
        <button class="start__cta" type="button">
          Click to swing
          <small>pointer lock &middot; desktop &amp; mouse</small>
        </button>
        <div class="panel cant-l" style="width:100%;max-width:760px">
          <div class="controls">
            ${CONTROLS.map(
              ([k, label, gate]) => `
              <div class="controls__row">
                <span class="key">${k}</span>
                <span class="controls__label">${label}</span>
                ${gate ? `<em>${gate}</em>` : ''}
              </div>`
            ).join('')}
          </div>
        </div>
        <div class="start__meta"></div>
        <p class="start__legal">
          An original stylistic homage to comic-book animation. Not affiliated with,
          endorsed by, or licensed from any comics publisher or film studio.
          Every mesh, texture, sound and letterform in this game is generated in code.
        </p>
      </div>
    `;

    this.cta = this.el.querySelector('.start__cta') as HTMLButtonElement;
    this.meta = this.el.querySelector('.start__meta') as HTMLDivElement;
    this.setInfo(info);

    this.cta.addEventListener('click', this.handleStart);
    this.el.addEventListener('keydown', this.handleKey);
    parent.appendChild(this.el);
    window.addEventListener('keydown', this.handleKey);
  }

  setInfo(info: StartScreenInfo): void {
    this.meta.innerHTML = `
      <div>RANK <b>${info.rank}</b> / 12</div>
      <div>BEST <b>${info.bestScore.toLocaleString('en-US')}</b></div>
      <div>RUNS <b>${info.runs}</b></div>
      <div>CITY <b>${info.seedLabel}</b></div>
    `;
  }

  show(): void {
    this.el.style.display = '';
    this.el.setAttribute('aria-hidden', 'false');
  }

  hide(): void {
    this.el.style.display = 'none';
    this.el.setAttribute('aria-hidden', 'true');
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKey);
    this.el.remove();
  }

  private handleStart = (): void => {
    this.onStart();
  };

  private handleKey = (e: KeyboardEvent): void => {
    if (!this.visible) return;
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      this.onStart();
    }
  };
}

/** Full-screen blocking panel for touch devices and missing WebGL2. */
export function showNotice(parent: HTMLElement, title: string, body: string): void {
  const screen = document.createElement('div');
  screen.className = 'screen';
  screen.innerHTML = `
    <div class="screen__dots"></div>
    <div class="panel notice cant-r">
      <h2>${title}</h2>
      <p>${body}</p>
    </div>
  `;
  parent.appendChild(screen);
}
