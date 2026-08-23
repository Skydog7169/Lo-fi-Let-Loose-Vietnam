// Headless verification runner: `npm run headless -- <scenario|all> [seeds] [seconds]`
// Bundled with esbuild and run in Node — no DOM, deterministic.
import { checkInfiltration, profilePaths, runAiMatch, runMany, runPhase3Checks, runScenario } from '../src/devtools';
import { SCENARIOS } from '../src/scenarios';

const [, , what = 'all', seedsArg = '20', secsArg = '150'] = process.argv;
const nSeeds = Number(seedsArg), secs = Number(secsArg);
const seeds = Array.from({ length: nSeeds }, (_, i) => i + 100);

function summarise(sc: string) {
  const r = runMany(sc, seeds, secs);
  const wins = { US: 0, PAVN: 0, draw: 0 };
  let minAll = Infinity;
  const ends: number[] = [];
  for (const k of Object.keys(r)) {
    const row = r[Number(k)]!;
    const us = row.alive.filter((a) => a.startsWith('US')).reduce((a, s) => a + parseInt(s.split(':')[1]!), 0);
    const pv = row.alive.filter((a) => a.startsWith('PAVN')).reduce((a, s) => a + parseInt(s.split(':')[1]!), 0);
    if (us && pv) wins.draw++; else if (us) wins.US++; else wins.PAVN++;
    minAll = Math.min(minAll, row.min);
    if (row.end !== null) ends.push(row.end);
  }
  ends.sort((a, b) => a - b);
  const med = ends.length ? ends[Math.floor(ends.length / 2)] : null;
  console.log(`${sc.padEnd(10)} US ${String(wins.US).padStart(2)}  PAVN ${String(wins.PAVN).padStart(2)}  draw ${String(wins.draw).padStart(2)}  minEnemyDist ${String(minAll).padStart(3)}px  medianEnd ${med === null ? '—' : med + 's'}`);
}

const t0 = performance.now();
if (what === 'perf') {
  console.log('paths', profilePaths(200));
  const a = performance.now();
  const r = runScenario('stress', 1, 60, 999);
  const ms = performance.now() - a;
  console.log(`stress: 60s sim in ${ms.toFixed(0)}ms → ${(ms / 3600).toFixed(3)} ms/tick, alive ${r.alive.reduce((s, x) => s + x.alive, 0)}`);
} else if (what === 'aimatch') {
  for (const seed of seeds.slice(0, nSeeds)) {
    const r = runAiMatch(seed, secs);
    console.log(`seed ${seed}: ${r.phase} ${JSON.stringify(r.result)} at ${r.seconds}s  points ${r.points}  cas US ${r.stats.US.casualties} PAVN ${r.stats.PAVN.casualties}  garrisons ${JSON.stringify(r.garrisons)}  bought ${JSON.stringify(r.abilitiesBought)}`);
  }
} else if (what === 'infiltrate') {
  for (const seed of seeds.slice(0, nSeeds)) { const r = checkInfiltration(seed); console.log(`${r.pass ? 'PASS' : 'FAIL'} seed ${seed}: ${r.detail}`); }
} else if (what === 'checks') {
  const res = runPhase3Checks(Number(seedsArg) || 1);
  for (const c of res) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name.padEnd(48)} ${c.detail}`);
  console.log(`${res.filter((c) => c.pass).length}/${res.length} passed`);
} else if (what === 'all') {
  for (const sc of Object.keys(SCENARIOS)) if (!['default', 'stress', 'match', 'optouch', 'garrisoncamp', 'hidden', 'win_capture', 'win_timeout', 'win_annihilate'].includes(sc)) summarise(sc);
} else {
  const r = runScenario(what, seeds[0]!, secs, 10);
  console.log(JSON.stringify(r, null, 1));
  summarise(what);
}
console.log(`(${((performance.now() - t0) / 1000).toFixed(1)}s)`);
