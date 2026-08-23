// Four pools per side, base + per-held-point income accrued continuously.
import { CONFIG } from '../config';
import { pointsHeld, type GameState, type Resources, type Side } from '../state';

export function incomePerMinute(state: GameState, side: Side): Resources {
  const n = pointsHeld(state, side);
  return {
    wb: CONFIG.WB_BASE + CONFIG.WB_PER_POINT * n,
    mun: CONFIG.MUN_BASE + CONFIG.MUN_PER_POINT * n,
    man: (CONFIG.MAN_BASE + CONFIG.MAN_PER_POINT * n) * (side === 'US' ? CONFIG.ATTACKER_MANPOWER_MULT : 1),
    fuel: CONFIG.FUEL_BASE + CONFIG.FUEL_PER_POINT * n,
  };
}

export function updateEconomy(state: GameState, dt: number): void {
  if (!state.rules.income) return;
  for (const side of ['US', 'PAVN'] as Side[]) {
    const inc = incomePerMinute(state, side);
    const r = state.res[side];
    const k = dt / 60;
    r.wb += inc.wb * k; r.mun += inc.mun * k; r.man += inc.man * k; r.fuel += inc.fuel * k;
    state.stats[side].pointHeldTime += pointsHeld(state, side) * dt;
  }
}
