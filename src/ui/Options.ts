/**
 * Pause / options. The comfort switches live here and every one of them
 * defaults to the safe setting: no camera roll, no head bob, motion softened
 * on request.
 */

import type { Save, QualityTier } from '../core/Save';

export interface OptionsHooks {
  onResume: () => void;
  onMenu: () => void;
  onChange: () => void;
}

export class Options {
  private el: HTMLDivElement;
  private save: Save;
  private hooks: OptionsHooks;

  constructor(parent: HTMLElement, save: Save, hooks: OptionsHooks) {
    this.save = save;
    this.hooks = hooks;
    this.el = document.createElement('div');
    this.el.className = 'options';
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.build();
  }

  private build(): void {
    const s = this.save.settings;
    this.el.innerHTML = `
      <div class="panel options__panel cant-l">
        <h2>PAUSED</h2>
        <div class="options__grid">
          ${slider('fov', 'Field of view', s.fov, 70, 120, 1, '°')}
          ${slider('sensitivity', 'Mouse sensitivity', s.sensitivity, 0.2, 3, 0.05, '')}
          ${slider('speedLineIntensity', 'Speed lines', s.speedLineIntensity, 0, 2, 0.05, '')}
          ${slider('masterVolume', 'Master volume', s.masterVolume, 0, 1, 0.02, '')}
          ${slider('musicVolume', 'Music volume', s.musicVolume, 0, 1, 0.02, '')}
          ${toggle('headBob', 'Head bob (grounded only)', s.headBob)}
          ${toggle('cameraRoll', 'Camera roll', s.cameraRoll)}
          ${toggle('invertY', 'Invert Y', s.invertY)}
          ${toggle('muted', 'Mute', s.muted)}
          ${toggle('showGhost', 'Show ghost', s.showGhost)}
          ${toggle('reduceMotion', 'Reduce motion (softens everything)', s.reduceMotion)}
          <label class="options__row">
            <span>Quality</span>
            <select data-key="quality">
              ${['auto', 'low', 'medium', 'high']
                .map((q) => `<option value="${q}" ${s.quality === q ? 'selected' : ''}>${q}</option>`)
                .join('')}
            </select>
          </label>
        </div>
        <div class="options__controls">
          <b>MOUSE</b> look &middot; <b>LMB/RMB</b> webs &middot; <b>SHIFT</b> reel &middot;
          <b>SPACE</b> jump / web-zip &middot; <b>W</b> wall-run &middot; <b>E</b> arc &middot;
          <b>Q</b> camo &middot; <b>R</b> restart &middot; <b>&#96;</b> tuning
        </div>
        <div class="options__buttons">
          <button data-act="resume">RESUME</button>
          <button data-act="menu">MAIN MENU</button>
        </div>
      </div>
    `;

    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      const key = t.dataset.key;
      if (!key) return;
      const settings = this.save.settings as unknown as Record<string, unknown>;
      if (t instanceof HTMLInputElement && t.type === 'checkbox') settings[key] = t.checked;
      else if (t instanceof HTMLInputElement) {
        settings[key] = Number(t.value);
        const out = t.parentElement?.querySelector('.options__value');
        if (out) out.textContent = t.value;
      } else settings[key] = t.value as QualityTier | 'auto';
      this.save.save();
      this.hooks.onChange();
    });

    this.el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).dataset.act;
      if (act === 'resume') this.hooks.onResume();
      else if (act === 'menu') this.hooks.onMenu();
    });
  }

  show(): void {
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  dispose(): void {
    this.el.remove();
  }
}

function slider(
  key: string,
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  unit: string
): string {
  return `<label class="options__row">
    <span>${label}</span>
    <input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${value}">
    <i class="options__value">${value}${unit}</i>
  </label>`;
}

function toggle(key: string, label: string, on: boolean): string {
  return `<label class="options__row options__row--check">
    <span>${label}</span>
    <input type="checkbox" data-key="${key}" ${on ? 'checked' : ''}>
  </label>`;
}
