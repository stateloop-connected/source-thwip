/**
 * Bootstrap. Checks the two things that can make this game impossible to play
 * (no WebGL2, no fine pointer), builds the game, and hands the frame clock to
 * the loop. Everything past this point assumes a working context.
 */

import './ui/styles.css';
import { Game } from './core/Game';
import { Loop } from './core/Loop';
import { StartScreen, showNotice } from './ui/StartScreen';
import { webgl2Supported } from './render/Renderer';
import { dailySeed, hashSeed, todayKey } from './core/Rng';
import { PARAMS, resetTuning, T } from './core/Tuning';

const ui = document.getElementById('ui') as HTMLDivElement;
const canvas = document.getElementById('view') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);

function fatal(title: string, body: string): void {
  canvas.style.display = 'none';
  showNotice(ui, title, body);
}

if (!webgl2Supported()) {
  fatal(
    'No WebGL2',
    'This city is drawn entirely on the GPU and needs WebGL2. Try a current Chrome, Edge, Firefox or Safari with hardware acceleration switched on.'
  );
} else if (!window.matchMedia('(any-pointer: fine)').matches) {
  fatal(
    'Desktop + mouse required',
    'Swinging needs pointer lock and two mouse buttons, which touch devices cannot provide. Come back on a laptop or desktop and it will be waiting.'
  );
} else {
  boot();
}

function boot(): void {
  const game = new Game(canvas, ui);
  const loop = new Loop();

  // ?seed=<anything> pins the city; otherwise the daily seed is the default
  // so the city is the same for everyone on a given day.
  const seedParam = params.get('seed');
  if (seedParam) {
    const n = Number(seedParam);
    game.useSeed(Number.isFinite(n) ? n : hashSeed(seedParam), `seed ${seedParam}`);
  } else {
    // Default is the daily: same city for everyone today, and scores are
    // filed against the date so the local top-10 means something.
    game.useSeed(dailySeed(), `daily ${todayKey()}`);
    game.dateKeyForSeed = todayKey();
  }

  const test = params.get('test');
  if (test === 'fly') game.mode = 'fly';

  game.buildCity();

  const start = new StartScreen(
    ui,
    {
      rank: game.save.data.rank,
      bestScore: game.save.data.bestScore,
      runs: game.save.data.runs,
      seedLabel: game.seedLabel,
    },
    () => {
      start.hide();
      game.begin();
    }
  );

  game.onStateChange = (state) => {
    if (state === 'paused' || state === 'menu') start.show();
    else start.hide();
  };

  // Pause immediately when the tab goes away, and resync the clock on return
  // so the first visible frame does not integrate the whole hidden interval.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loop.resync();
  });

  loop.start((l) => game.update(l));

  exposeDebugHandle(game, loop);
}

function exposeDebugHandle(game: Game, loop: Loop): void {
  const handle = {
    game,
    loop,
    /** Live constants. Mutating these takes effect on the next frame. */
    tuning: T,
    params: PARAMS,
    resetTuning,
    get state() {
      return game.state;
    },
    get stats() {
      return {
        fps: Math.round(loop.fps * 10) / 10,
        frameMs: Math.round(loop.avgFrameMs * 100) / 100,
        sceneDrawCalls: game.renderer.stats.sceneDrawCalls,
        drawCalls: game.renderer.stats.drawCalls,
        triangles: game.renderer.stats.triangles,
        programs: game.renderer.stats.programs,
        animFrameIndex: loop.animFrameIndex,
        animStepRate: loop.animStepRate,
      };
    },
    get player() {
      const b = game.body;
      const tether = (t: { active: boolean; anchor: { x: number; y: number; z: number }; length: number }) => ({
        active: t.active,
        anchor: { x: t.anchor.x, y: t.anchor.y, z: t.anchor.z },
        length: t.length,
      });
      return {
        position: { x: b.position.x, y: b.position.y, z: b.position.z },
        velocity: { x: b.velocity.x, y: b.velocity.y, z: b.velocity.z },
        speed: b.speed,
        speedMph: b.speedMph,
        grounded: b.grounded,
        airTime: b.airTime,
        tethers: [tether(game.web.left), tether(game.web.right)],
        aimValid: game.web.aimValid,
      };
    },
    teleport(x: number, y: number, z: number) {
      game.teleport(x, y, z);
    },
    setRank(n: number) {
      game.setRank(n);
      return game.save.data.rank;
    },
    grantXp(n: number) {
      return game.grantXp(n);
    },
    get style() {
      return { ...game.style, rank: game.save.data.rank };
    },
    forceSwing(side: 'left' | 'right' = 'left') {
      return game.forceSwing(side);
    },
    /** Let the autopilot play on screen, in real time, so it can be watched. */
    autoDemo() {
      game.startAutoDemo();
    },
    stopAutoDemo() {
      game.stopAutoDemo();
    },
    /** Headless physics verification: sixty seconds of swinging, instantly. */
    simulate(seconds = 60, dt = 1 / 60, trace?: Array<Record<string, number | boolean>>) {
      return game.simulate(seconds, dt, trace);
    },
  };
  // The debug surface is a cheat menu in production. It exposes live physics
  // constants, setRank(), and an autopilot that plays the game for you — all
  // of which would make a public leaderboard meaningless. Dev builds only.
  //
  // This raises the cost of casual cheating; it does not make the client
  // trustworthy. Anything a browser runs, a determined player can rewrite.
  // A real leaderboard has to validate server-side.
  if (import.meta.env.DEV) {
    (window as unknown as { __game: typeof handle }).__game = handle;
  }
}
