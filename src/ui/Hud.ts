/**
 * In-run HUD. DOM rather than canvas so text stays crisp at any resolution
 * and costs the GPU nothing.
 *
 * The crosshair is the single most important element on screen: the player
 * must know, before pressing the button, whether a thwip will connect.
 */

export type CrosshairState = 'none' | 'ready' | 'attached';

const SPIDER_SVG = `
<svg viewBox="0 0 40 40" aria-hidden="true">
  <g class="ch-legs" fill="none" stroke-linecap="round" stroke-width="2.1">
    <path d="M20 15 L10 6 M20 15 L30 6 M20 19 L5 14 M20 19 L35 14
             M20 22 L6 27 M20 22 L34 27 M20 25 L11 35 M20 25 L29 35"/>
  </g>
  <ellipse class="ch-body" cx="20" cy="20" rx="3.4" ry="4.8"/>
  <circle class="ch-dot" cx="20" cy="20" r="1.15"/>
</svg>`;

export class Hud {
  readonly el: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private speedEl: HTMLElement;
  private timerEl: HTMLElement;
  private comboEl: HTMLElement;
  private flowFill: HTMLElement;
  private flowBar: HTMLElement;
  private feedEl: HTMLElement;
  private state: CrosshairState = 'none';
  private lastCombo = -1;
  private lastTimer = -1;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud__crosshair" data-state="none">${SPIDER_SVG}</div>
      <div class="hud__timer"><b>90</b></div>
      <div class="hud__flow">
        <div class="hud__flow-bar"><div class="hud__flow-fill"></div></div>
        <span class="hud__flow-label">FLOW</span>
      </div>
      <div class="hud__combo" data-on="0">&times;<b>1</b></div>
      <div class="hud__feed"></div>
      <div class="hud__speed"><b>0</b><span>MPH</span></div>
    `;
    this.crosshair = this.el.querySelector('.hud__crosshair') as HTMLDivElement;
    this.speedEl = this.el.querySelector('.hud__speed b') as HTMLElement;
    this.timerEl = this.el.querySelector('.hud__timer b') as HTMLElement;
    this.comboEl = this.el.querySelector('.hud__combo') as HTMLElement;
    this.flowFill = this.el.querySelector('.hud__flow-fill') as HTMLElement;
    this.flowBar = this.el.querySelector('.hud__flow-bar') as HTMLElement;
    this.feedEl = this.el.querySelector('.hud__feed') as HTMLElement;
    parent.appendChild(this.el);
    this.hide();
  }

  setCrosshair(state: CrosshairState): void {
    if (state === this.state) return;
    this.state = state;
    this.crosshair.dataset.state = state;
  }

  setSpeed(mph: number): void {
    const v = Math.round(mph);
    if (this.speedEl.textContent !== String(v)) this.speedEl.textContent = String(v);
  }

  setTimer(seconds: number): void {
    const v = Math.max(0, Math.ceil(seconds));
    if (v === this.lastTimer) return;
    this.lastTimer = v;
    this.timerEl.textContent = String(v);
    this.timerEl.parentElement?.classList.toggle('is-low', v <= 10);
  }

  setFlow(normalized: number, critical: boolean): void {
    this.flowFill.style.transform = `scaleX(${Math.max(0.001, normalized)})`;
    this.flowBar.classList.toggle('is-critical', critical);
  }

  setCombo(combo: number, pulse: number): void {
    if (combo !== this.lastCombo) {
      this.lastCombo = combo;
      (this.comboEl.querySelector('b') as HTMLElement).textContent = String(combo);
      this.comboEl.dataset.on = combo > 1 ? '1' : '0';
    }
    // Punch scale driven by the pulse rather than a CSS animation, so rapid
    // events stack instead of restarting each other.
    const s = 1 + pulse * 0.42;
    this.comboEl.style.transform = `rotate(-4deg) scale(${s.toFixed(3)})`;
  }

  /** Short-lived scrolling list of what just scored. */
  pushFeed(label: string, points: number): void {
    const row = document.createElement('div');
    row.className = 'hud__feed-row';
    row.innerHTML = `<span>${label}</span><b>+${points.toLocaleString('en-US')}</b>`;
    this.feedEl.prepend(row);
    while (this.feedEl.children.length > 5) this.feedEl.lastElementChild?.remove();
    window.setTimeout(() => row.classList.add('is-out'), 900);
    window.setTimeout(() => row.remove(), 1500);
  }

  clearFeed(): void {
    this.feedEl.innerHTML = '';
    this.lastCombo = -1;
    this.lastTimer = -1;
  }

  show(): void {
    this.el.style.display = '';
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  dispose(): void {
    this.el.remove();
  }
}
