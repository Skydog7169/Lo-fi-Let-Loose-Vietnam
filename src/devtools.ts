// Headless scenario runner exposed on window.tacmap for verification scripts.
// Not part of the game; no rendering, deterministic given seed.
import { createInitialState } from './scenarios';
import { stepSim } from './sim';
import { sectorLineX, type GameState } from './state';
import { CONFIG } from './config';
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

// ---- Phase 3 verification checks (spawning / capture / fog / end conditions) ----

type Check = { name: string; pass: boolean; detail: string };

function run(st: GameState, seconds: number, until?: (s: GameState) => boolean): number {
  const ticks = Math.round(seconds * 60);
  for (let k = 0; k < ticks; k++) { stepSim(st); if (until && until(st)) return k / 60; }
  return -1;
}

export function runPhase3Checks(seed = 1): Check[] {
  const out: Check[] = [];
  const push = (name: string, pass: boolean, detail: string) => out.push({ name, pass, detail });

  // 1. OP touch deletes it; squad falls back to garrison respawn
  {
    const st = createInitialState(seed, 'optouch');
    const pav = st.squads.find((s) => s.side === 'PAVN')!;
    const tTouch = run(st, 60, (s) => s.squads[pav.id]!.op === null);
    push('OP deleted on enemy touch', tTouch >= 0, `deleted at ${tTouch.toFixed(1)}s`);
    // kill the PAVN squad outright, then wait for a wave: it should come back at the garrison (700,560), not the OP
    for (const id of pav.dotIds) { const d = st.dots[id]!; d.alive = false; d.hp = 0; }
    st.waveTimer.PAVN = 0.5;
    run(st, 5, (s) => pav.dotIds.some((id) => s.dots[id]!.alive));
    const back = pav.dotIds.map((id) => st.dots[id]!).filter((d) => d.alive);
    const nearGar = back.length > 0 && back.every((d) => Math.hypot(d.pos.x - 700, d.pos.y - 560) < 40);
    push('squad without OP respawns at nearest garrison', nearGar, `${back.length} alive, first at ${back[0] ? `${back[0].pos.x | 0},${back[0].pos.y | 0}` : '—'}`);
  }
  // 2. garrison camping
  {
    const st = createInitialState(seed, 'garrisoncamp');
    const g = st.garrisons.find((x) => x.side === 'PAVN' && x.pos.x === 360)!;
    const tDis = run(st, 60, (s) => s.garrisons[g.id]!.disabled);
    const tDes = run(st, 60, (s) => s.garrisons[g.id]!.state === 'destroyed');
    push('garrison disabled by nearby enemy', tDis >= 0, `disabled at ${tDis.toFixed(1)}s`);
    push('garrison destroyed after 10s camping', tDes >= 0 && Math.abs(tDes - CONFIG.GARRISON_DESTROY_SECONDS) < 0.5, `destroyed ${tDes.toFixed(1)}s after disable`);
    run(st, 30);
    push('destroyed garrison stays destroyed', st.garrisons[g.id]!.state === 'destroyed', st.garrisons[g.id]!.state);
  }
  // 3. hidden squad in wooded corridor inside US territory
  {
    const st = createInitialState(seed, 'hidden');
    const pav = st.squads.find((s) => s.side === 'PAVN')!;
    let seenInWoods = false, seenInOpen = false, samplesWoods = 0, samplesOpen = 0;
    run(st, 60, (s) => {
      const alive = pav.dotIds.map((id) => s.dots[id]!).filter((d) => d.alive);
      if (!alive.length) return true;
      const vis = s.vis.US.dotVisible;
      const anyVisible = alive.some((d) => vis[d.id] === 1);
      const cy = alive.reduce((a, d) => a + d.pos.y, 0) / alive.length;
      if (cy < 120) { samplesWoods++; if (anyVisible) seenInWoods = true; }
      if (cy > 185 && cy < 260) { samplesOpen++; if (anyVisible) seenInOpen = true; }
      return cy > 260;
    });
    push('squad in woods invisible inside our territory', samplesWoods > 0 && !seenInWoods, `${samplesWoods} samples in woods, seen=${seenInWoods}`);
    push('squad visible once it exits the trees', samplesOpen > 0 && seenInOpen, `${samplesOpen} samples in open, seen=${seenInOpen}`);
    push('sector line at start', Math.abs(sectorLineX(st) - 160) < 1, `x=${sectorLineX(st)}`);
  }
  // 4. win by capture
  {
    const st = createInitialState(seed, 'win_capture');
    const t0 = st.timer;
    const t = run(st, 400, (s) => s.phase === 'ended');
    push('US wins by capturing point 5', st.result?.winner === 'US' && (st.result?.reason ?? '').includes('point 5'), `${JSON.stringify(st.result)} at ${t.toFixed(0)}s`);
    push('captures add +3:00 each', Math.abs(st.timer - (t0 - t + 5 * CONFIG.CAPTURE_BONUS_SECONDS)) < 2, `timer ${st.timer.toFixed(0)} (start ${t0}, elapsed ${t.toFixed(0)})`);
    push('sector line advanced past the map', sectorLineX(st) >= st.map.width, `x=${sectorLineX(st)}`);
  }
  // 5. win by timeout
  {
    const st = createInitialState(seed, 'win_timeout');
    const t = run(st, 60, (s) => s.phase === 'ended');
    push('PAVN wins at time-out', st.result?.winner === 'PAVN' && (st.result?.reason ?? '').includes('time'), `${JSON.stringify(st.result)} at ${t.toFixed(0)}s`);
  }
  // 6. annihilation
  {
    const st = createInitialState(seed, 'win_annihilate');
    const t = run(st, 200, (s) => s.phase === 'ended');
    push('annihilation ends the match', st.result?.winner === 'US' && (st.result?.reason ?? '').includes('annihilated'), `${JSON.stringify(st.result)} at ${t.toFixed(0)}s`);
  }
  // 7. full match runs; economy ticks; OPs get dropped
  {
    const st = createInitialState(seed, 'match');
    const wb0 = st.res.US.wb;
    run(st, 120);
    const ops = st.squads.filter((s) => s.op).length;
    push('economy accrues', st.res.US.wb > wb0 && st.res.PAVN.mun > CONFIG.START_MUN, `US wb ${st.res.US.wb.toFixed(0)} PAVN mun ${st.res.PAVN.mun.toFixed(0)}`);
    push('idle squads drop OPs', ops > 0, `${ops} squads have OPs after 120s`);
    push('match still running', st.phase === 'play', st.phase);
  }
  return out;
}
