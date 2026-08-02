/**
 * The live tuning panel. Backtick toggles it.
 *
 * Treated as a shipped feature, not debug scaffolding: this is how the game
 * gets tuned after hand-off without another build pass. Every constant in the
 * physics, loop and style sections is a labelled slider that takes effect on
 * the next frame, values persist to localStorage, and "Copy as TypeScript"
 * dumps a paste-ready constants block.
 */

import {
  exportTuningTS,
  PARAMS,
  resetTuning,
  T,
  type ParamMeta,
} from '../core/Tuning';
import type { Game } from '../core/Game';

export class TuningPanel {
  private el: HTMLDivElement;
  private readout: HTMLElement;
  private game: Game;
  private open = false;
  private rows = new Map<string, { input: HTMLInputElement; value: HTMLElement }>();

  constructor(parent: HTMLElement, game: Game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.className = 'tuner';
    this.el.hidden = true;

    const groups = new Map<string, ParamMeta[]>();
    for (const p of PARAMS) {
      const list = groups.get(p.group);
      if (list) list.push(p);
      else groups.set(p.group, [p]);
    }

    const head = document.createElement('div');
    head.className = 'tuner__head';
    head.innerHTML = `
      <b>TUNING</b>
      <span class="tuner__readout"></span>
      <button data-act="copy">Copy as TypeScript</button>
      <button data-act="reset">Reset to defaults</button>
      <button data-act="close">Close</button>
    `;
    this.el.appendChild(head);
    this.readout = head.querySelector('.tuner__readout') as HTMLElement;

    const body = document.createElement('div');
    body.className = 'tuner__body';
    for (const [group, params] of groups) {
      const section = document.createElement('section');
      section.innerHTML = `<h4>${group}</h4>`;
      for (const p of params) section.appendChild(this.buildRow(p));
      body.appendChild(section);
    }
    this.el.appendChild(body);

    head.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).dataset.act;
      if (act === 'copy') void this.copy();
      else if (act === 'reset') this.reset();
      else if (act === 'close') this.toggle(false);
    });

    parent.appendChild(this.el);
  }

  private buildRow(p: ParamMeta): HTMLElement {
    const row = document.createElement('label');
    row.className = 'tuner__row';
    row.innerHTML = `
      <span class="tuner__label">${p.label}</span>
      <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${T[p.key]}">
      <span class="tuner__value"></span>
    `;
    const input = row.querySelector('input') as HTMLInputElement;
    const value = row.querySelector('.tuner__value') as HTMLElement;
    const paint = () => {
      value.textContent = `${round(T[p.key])}${p.unit ? ' ' + p.unit : ''}`;
    };
    input.addEventListener('input', () => {
      (T as Record<string, number>)[p.key] = Number(input.value);
      paint();
      this.game.save.save();
    });
    paint();
    this.rows.set(p.key, { input, value });
    return row;
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.el.hidden = !this.open;
    if (this.open) this.syncInputs();
  }

  get isOpen(): boolean {
    return this.open;
  }

  private syncInputs(): void {
    for (const p of PARAMS) {
      const row = this.rows.get(p.key);
      if (!row) continue;
      row.input.value = String(T[p.key]);
      row.value.textContent = `${round(T[p.key])}${p.unit ? ' ' + p.unit : ''}`;
    }
  }

  /** Live diagnostics, updated only while the panel is open. */
  update(fps: number): void {
    if (!this.open) return;
    const g = this.game;
    const s = g.renderer.stats;
    this.readout.textContent =
      `${fps.toFixed(0)}fps · ${g.lastRenderMs.toFixed(2)}ms · ` +
      `${s.sceneDrawCalls} draws · ${(s.triangles / 1000).toFixed(1)}k tris · ` +
      `${g.web.activeCount} tethers · ${g.body.speedMph.toFixed(0)}mph · ` +
      `flow ${g.flow.value.toFixed(0)} · x${g.scoring.combo} · ${g.renderer.quality}`;
  }

  private reset(): void {
    resetTuning();
    this.syncInputs();
    this.game.save.save();
  }

  private async copy(): Promise<void> {
    const text = exportTuningTS();
    try {
      await navigator.clipboard.writeText(text);
      this.flash('Copied');
    } catch {
      // Clipboard can be blocked; fall back to a selectable textarea.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.className = 'tuner__dump';
      this.el.appendChild(ta);
      ta.select();
      this.flash('Select + copy');
    }
  }

  private flash(msg: string): void {
    const prev = this.readout.textContent;
    this.readout.textContent = msg;
    window.setTimeout(() => {
      this.readout.textContent = prev;
    }, 1100);
  }

  dispose(): void {
    this.el.remove();
  }
}

function round(v: number): string {
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
