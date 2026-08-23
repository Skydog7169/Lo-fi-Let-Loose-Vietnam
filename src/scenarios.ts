// Named starting setups. 'default' is the placeholder match; the others are the
// Phase 2 verification scenes from CLAUDE.md. Select with ?scenario=name.
import { CONFIG } from './config';
import { createEmptyState, createSquad, SIDES, type GameState, type MarkerKind, type Side, type SquadKind } from './state';
import { v, type Vec } from './vec';

function place(state: GameState, side: Side, kind: SquadKind, label: string, pos: Vec, marker?: { kind: MarkerKind; pos: Vec }) {
  const sq = createSquad(state, side, kind, label, pos);
  if (marker) sq.marker = { kind: marker.kind, pos: v(marker.pos.x, marker.pos.y) };
  return sq;
}

export const SCENARIOS: Record<string, (s: GameState) => void> = {
  /** 3 infantry squads per side parked in each HQ. */
  default(s) {
    const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (const side of SIDES) {
      const hq = s.map.hqs.find((h) => h.side === side)!.rect;
      for (let i = 0; i < CONFIG.PLACEHOLDER_SQUADS_PER_SIDE; i++) {
        const y = hq.y + ((i + 1) * hq.h) / (CONFIG.PLACEHOLDER_SQUADS_PER_SIDE + 1);
        place(s, side, 'infantry', labels[i]!, v(hq.x + hq.w / 2, y));
      }
    }
  },
  /** Two equal squads meet in open paddy between points 3 and 5. */
  meet(s) {
    place(s, 'US', 'infantry', 'A', v(640, 250), { kind: 'attack', pos: v(940, 250) });
    place(s, 'PAVN', 'infantry', 'A', v(940, 250), { kind: 'attack', pos: v(640, 250) });
  },
  /** Mirror of meet (PAVN starts west) — checks for side-order bias. */
  meet_rev(s) {
    place(s, 'PAVN', 'infantry', 'A', v(640, 250), { kind: 'attack', pos: v(940, 250) });
    place(s, 'US', 'infantry', 'A', v(940, 250), { kind: 'attack', pos: v(640, 250) });
  },
  /** meet with creation order swapped (east squad created first) — isolates order bias from position bias. */
  meet_order(s) {
    place(s, 'US', 'infantry', 'A', v(940, 250), { kind: 'attack', pos: v(640, 250) });
    place(s, 'PAVN', 'infantry', 'A', v(640, 250), { kind: 'attack', pos: v(940, 250) });
  },
  /** Vertical meeting (north vs south) in the open east paddies — checks x/y symmetry. */
  meet_ns(s) {
    place(s, 'US', 'infantry', 'A', v(1060, 200), { kind: 'attack', pos: v(1060, 560) });
    place(s, 'PAVN', 'infantry', 'A', v(1060, 560), { kind: 'attack', pos: v(1060, 200) });
  },
  /** Defender sits in the south-west woods; an equal attacker crosses open ground toward it. */
  woods(s) {
    place(s, 'PAVN', 'infantry', 'A', v(280, 600), { kind: 'defend', pos: v(280, 600) });
    place(s, 'US', 'infantry', 'A', v(520, 640), { kind: 'attack', pos: v(300, 610) });
  },
  /** Covered defender; one US squad pins frontally from the open, a second swings through the woods to flank. */
  flank(s) {
    place(s, 'PAVN', 'infantry', 'A', v(300, 560), { kind: 'defend', pos: v(300, 560) });
    place(s, 'US', 'infantry', 'A', v(440, 520), { kind: 'attack', pos: v(330, 550) });
    place(s, 'US', 'infantry', 'B', v(440, 720), { kind: 'attack', pos: v(260, 615) });
  },
  /** Same as flank but without the flanker — control: the frontal push alone should stall/lose. */
  frontal(s) {
    place(s, 'PAVN', 'infantry', 'A', v(300, 560), { kind: 'defend', pos: v(300, 560) });
    place(s, 'US', 'infantry', 'A', v(440, 520), { kind: 'attack', pos: v(330, 550) });
  },
  /** A tank rolls through two infantry squads in the open, then into an AT ambush in the trees. */
  tank(s) {
    place(s, 'US', 'tank', 'T', v(700, 430), { kind: 'attack', pos: v(940, 640) });
    place(s, 'PAVN', 'infantry', 'A', v(760, 470), { kind: 'defend', pos: v(760, 470) });
    place(s, 'PAVN', 'infantry', 'B', v(800, 520), { kind: 'defend', pos: v(800, 520) });
    place(s, 'PAVN', 'at', 'C', v(960, 660), { kind: 'defend', pos: v(960, 660) });
  },
  /** Perf: ~200 dots in a brawl across the mid-lane. */
  stress(s) {
    for (let i = 0; i < 16; i++) {
      const y = 200 + i * 28;
      place(s, 'US', i % 5 === 4 ? 'at' : 'infantry', String(i), v(420 + (i % 3) * 20, y), { kind: 'attack', pos: v(900, y) });
      place(s, 'PAVN', i % 5 === 4 ? 'at' : 'infantry', String(i), v(900 - (i % 3) * 20, y), { kind: 'attack', pos: v(420, y) });
    }
    place(s, 'US', 'tank', 'T', v(400, 450), { kind: 'attack', pos: v(900, 450) });
    place(s, 'PAVN', 'tank', 'T', v(920, 450), { kind: 'attack', pos: v(400, 450) });
  },
  /** Artillery battery at the US HQ shelling a PAVN squad holding the village at point 2. */
  arty(s) {
    place(s, 'US', 'artillery', 'G', v(45, 400), { kind: 'attack', pos: v(440, 330) });
    place(s, 'PAVN', 'infantry', 'A', v(440, 330), { kind: 'defend', pos: v(440, 330) });
  },
};

export function createInitialState(seed: number, scenario: string = CONFIG.SCENARIO): GameState {
  const state = createEmptyState(seed, scenario);
  (SCENARIOS[scenario] ?? SCENARIOS['default']!)(state);
  return state;
}
