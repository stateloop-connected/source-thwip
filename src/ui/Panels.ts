/**
 * Comic panels: the countdown, the score page, and the rank-up slam.
 *
 * Everything wipes in as a panel sliding across the frame rather than fading,
 * because a fade reads as a menu and a slide reads as a page turn.
 */

import type { ChallengeResult } from '../game/Challenges';
import type { RunStats } from '../game/Scoring';

export interface ScorePageData {
  stats: RunStats;
  challenges: ChallengeResult[];
  xpEarned: number;
  isBest: boolean;
  bestScore: number;
  rank: number;
  seedLabel: string;
  dailyPlace: number;
}

export class Panels {
  private root: HTMLDivElement;
  private countdownEl: HTMLDivElement;
  private scoreEl: HTMLDivElement;
  private rankEl: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'panels';
    this.root.innerHTML = `
      <div class="countdown" hidden><div class="countdown__panel"><span></span></div></div>
      <div class="scorepage" hidden></div>
      <div class="rankup" hidden></div>
    `;
    parent.appendChild(this.root);
    this.countdownEl = this.root.querySelector('.countdown') as HTMLDivElement;
    this.scoreEl = this.root.querySelector('.scorepage') as HTMLDivElement;
    this.rankEl = this.root.querySelector('.rankup') as HTMLDivElement;
  }

  /** "3", "2", "1", "GO" — each slams in on its own panel. */
  showCount(label: string): void {
    this.countdownEl.hidden = false;
    const panel = this.countdownEl.firstElementChild as HTMLElement;
    const span = panel.firstElementChild as HTMLElement;
    span.textContent = label;
    panel.classList.remove('is-in');
    // Force reflow so the animation restarts for every number.
    void panel.offsetWidth;
    panel.classList.add('is-in');
  }

  hideCount(): void {
    this.countdownEl.hidden = true;
  }

  showScore(data: ScorePageData, onRestart: () => void, onMenu: () => void): void {
    const s = data.stats;
    const mph = Math.round(s.topSpeedMs * 2.2369363);
    const rows: Array<[string, string]> = [
      ['TOP SPEED', `${mph} mph`],
      ['BEST COMBO', `x${s.bestCombo}`],
      ['LONGEST CHAIN', `${s.longestChain} swings`],
      ['AIRBORNE', `${s.airTime.toFixed(1)}s`],
      ['DISTANCE', `${(s.distance / 1000).toFixed(2)} km`],
      ['TOKENS', `${s.tokens}`],
      ['BEACONS', `${s.beacons}`],
      ['NEAR MISSES', `${s.nearMisses}`],
      ['GROUND HITS', `${s.groundContacts}`],
      ['DISTRICTS', `${s.districtsVisited.length}/5`],
    ];

    this.scoreEl.innerHTML = `
      <div class="scorepage__inner">
        <div class="panel scorepage__hero cant-l">
          <div class="scorepage__eyebrow">${data.isBest ? 'NEW PERSONAL BEST' : 'RUN COMPLETE'}</div>
          <div class="scorepage__score">${s.score.toLocaleString('en-US')}</div>
          <div class="scorepage__sub">
            BEST <b>${data.bestScore.toLocaleString('en-US')}</b>
            &middot; RANK <b>${data.rank}</b>
            &middot; CITY <b>${data.seedLabel}</b>
            ${data.dailyPlace > 0 ? `&middot; TODAY <b>#${data.dailyPlace}</b>` : ''}
          </div>
        </div>

        <div class="panel scorepage__stats cant-r">
          ${rows
            .map(
              ([k, v]) => `<div class="scorepage__row"><span>${k}</span><b>${v}</b></div>`
            )
            .join('')}
        </div>

        <div class="scorepage__cards">
          ${data.challenges
            .map(
              (c, i) => `
            <div class="card ${c.done ? 'is-done' : ''}" style="--i:${i}">
              <div class="card__stamp">${c.done ? 'CLEARED' : `${Math.round(c.progress * 100)}%`}</div>
              <div class="card__text">${c.challenge.text}</div>
              <div class="card__bar"><i style="transform:scaleX(${c.progress.toFixed(3)})"></i></div>
              <div class="card__xp">+${c.challenge.xp} XP</div>
            </div>`
            )
            .join('')}
        </div>

        <div class="scorepage__foot">
          ${data.xpEarned > 0 ? `<div class="scorepage__xp">+${data.xpEarned} XP EARNED</div>` : ''}
          <button class="scorepage__again" type="button">PRESS <span class="key">R</span> TO GO AGAIN</button>
          <button class="scorepage__menu" type="button">MENU</button>
        </div>
      </div>
    `;
    this.scoreEl.hidden = false;
    (this.scoreEl.querySelector('.scorepage__again') as HTMLButtonElement).onclick = onRestart;
    (this.scoreEl.querySelector('.scorepage__menu') as HTMLButtonElement).onclick = onMenu;
  }

  hideScore(): void {
    this.scoreEl.hidden = true;
  }

  get scoreVisible(): boolean {
    return !this.scoreEl.hidden;
  }

  /** Rank-up has to be a moment: slam, onomatopoeia, the new move named. */
  showRankUp(rank: number, shout: string, move: string, detail: string, stepRate: number): void {
    this.rankEl.innerHTML = `
      <div class="rankup__slam">
        <div class="rankup__shout">${shout}</div>
        <div class="panel rankup__panel">
          <div class="rankup__rank">RANK ${rank}</div>
          ${move ? `<div class="rankup__move">${move}</div>` : ''}
          <div class="rankup__detail">${detail}</div>
          <div class="rankup__fps">NOW ANIMATING ON ${stepRate.toFixed(0)} FPS</div>
        </div>
      </div>
    `;
    this.rankEl.hidden = false;
  }

  hideRankUp(): void {
    this.rankEl.hidden = true;
  }

  hideAll(): void {
    this.hideCount();
    this.hideScore();
    this.hideRankUp();
  }

  dispose(): void {
    this.root.remove();
  }
}
