// Deterministic PRNG (mulberry32). The sim must only draw randomness through
// the GameState's rng so that a seed fully determines a match.
export interface Rng { s: number }

export const makeRng = (seed: number): Rng => ({ s: seed >>> 0 });

export function rand(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const randRange = (r: Rng, lo: number, hi: number): number => lo + rand(r) * (hi - lo);
