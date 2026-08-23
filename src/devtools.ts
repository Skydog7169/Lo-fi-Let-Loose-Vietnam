// Headless scenario runner exposed on window.tacmap for verification scripts.
// Not part of the game; no rendering, deterministic given seed.
import { createInitialState } from './scenarios';
import { stepSim } from './sim';
import type { GameState } from './state';
import { findPath } from './systems/movement';

export interface RunResult {
  seed: number;
  scenario: string;
  endedAt: number | null; // seconds when one side had no living dots
  minEnemyDist: number; // closest two living enemy dots ever got (mosh-pit check)
  alive: { sq: string; kind: string; alive: number; state: string }[];
  timeline: string[][];
}

export function runScenario(scenario: string, seed: number, seconds: number, sampleEvery = 10): RunResult {
  const st: GameState = createInitialState(seed, scenario);
  let minEnemyDist = Infinity;
  let endedAt: number | null = null;
  const timeline: string[][] = [];
  const ticks = Math.round(seconds * 60);
  for (let k = 0; k < ticks; k++) {
    stepSim(st);
    const us = st.dots.filter((d) => d.alive && d.side === 'US');
    const pv = st.dots.filter((d) => d.alive && d.side === 'PAVN');
    for (const a of us) for (const b of pv) {
      const dd = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
      if (dd < minEnemyDist) minEnemyDist = dd;
    }
    if (k % (sampleEvery * 60) === 0) {
      timeline.push([String(Math.round(k / 60)), ...st.squads.map((s) => {
        const al = s.dotIds.filter((i) => st.dots[i]!.alive);
        const supp = al.reduce((a, i) => a + st.dots[i]!.suppression, 0) / Math.max(1, al.length);
        return `${s.side[0]}${s.label}:${al.length}/${s.state[0]}/${supp.toFixed(1)}`;
      })]);
    }
    if (!us.length || !pv.length) { endedAt = Math.round(k / 60); break; }
  }
  return {
    seed, scenario, endedAt, minEnemyDist: Math.round(minEnemyDist),
    alive: st.squads.map((s) => ({ sq: s.side + s.label, kind: s.kind, alive: s.dotIds.filter((i) => st.dots[i]!.alive).length, state: s.state })),
    timeline,
  };
}

/** Summarise several seeds of one scenario. */
export function runMany(scenario: string, seeds: number[], seconds: number): Record<number, { end: number | null; min: number; alive: string[] }> {
  const out: Record<number, { end: number | null; min: number; alive: string[] }> = {};
  for (const seed of seeds) {
    const r = runScenario(scenario, seed, seconds, 9999);
    out[seed] = { end: r.endedAt, min: r.minEnemyDist, alive: r.alive.map((a) => `${a.sq}:${a.alive}/${a.state[0]}`) };
  }
  return out;
}

/** Time `n` path searches across the map (profiling helper). */
export function profilePaths(n = 50): { msPerPath: number; avgLen: number } {
  const st = createInitialState(1, 'default');
  const t0 = performance.now();
  let len = 0;
  for (let i = 0; i < n; i++) {
    const p = findPath(st.grid, { x: 60 + (i % 7) * 10, y: 300 + (i % 11) * 20 }, { x: 1100 - (i % 5) * 15, y: 200 + (i % 13) * 30 });
    len += p.length;
  }
  return { msPerPath: (performance.now() - t0) / n, avgLen: len / n };
}
