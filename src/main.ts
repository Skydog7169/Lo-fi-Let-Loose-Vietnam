// Boot: canvas, letterboxed scaling, fixed-timestep loop decoupled from render.
import { CONFIG } from './config';
import { makeCommander } from './commander';
import { type Side } from './state';
import { createInitialState } from './scenarios';
import { stepSim, TICK_DT } from './sim';
import { attachInput, createUiState, updateViewport } from './ui/input';
import { drawHud } from './ui/hud';
import { buildStaticLayer, drawWorld } from './render/draw';
import { profilePaths, runMany, runScenario } from './devtools';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 1);
const scenario = params.get('scenario') ?? CONFIG.SCENARIO;
let state = createInitialState(seed, scenario);
const ui = createUiState();
const commanders: Record<Side, ReturnType<typeof makeCommander>> = {
  US: makeCommander(() => state, 'US'),
  PAVN: makeCommander(() => state, 'PAVN'),
};
const staticLayer = buildStaticLayer(state.map);

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth, h = window.innerHeight;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  updateViewport(ui, w, h);
}
window.addEventListener('resize', resize);
resize();

attachInput(canvas, () => state, ui, commanders);

let last = performance.now();
let acc = 0;
let fps = 0;
function frame(now: number): void {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > CONFIG.MAX_FRAME_DT) dt = CONFIG.MAX_FRAME_DT;
  fps = fps * 0.9 + (1 / Math.max(dt, 1e-6)) * 0.1;
  acc += dt;
  while (acc >= TICK_DT) {
    stepSim(state);
    acc -= TICK_DT;
  }
  render();
  requestAnimationFrame(frame);
}

function render(): void {
  const dpr = window.devicePixelRatio || 1;
  const { scale, ox, oy } = ui.view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = CONFIG.COLORS.letterbox;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, CONFIG.LOGICAL_W, CONFIG.LOGICAL_H); ctx.clip();
  drawWorld(ctx, staticLayer, state, ui);
  drawHud(ctx, state, ui, fps);
  ctx.restore();
}

requestAnimationFrame(frame);

// expose for console poking during development
(window as unknown as { tacmap: unknown }).tacmap = {
  get state() { return state; },
  ui,
  commanders,
  reset: (s: number, sc?: string) => { state = createInitialState(s, sc ?? state.scenario); },
  /** Advance the sim n ticks and redraw — used for headless/background-tab testing. */
  step: (n: number) => { for (let i = 0; i < n; i++) stepSim(state); render(); },
  render,
  runScenario,
  runMany,
  profilePaths,
};
