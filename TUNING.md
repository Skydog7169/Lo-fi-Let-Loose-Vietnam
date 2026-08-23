# TUNING — first playtest notes

Every number is in `src/config.ts`. Things the headless suite already tells us (`npm run headless -- aimatch 8 1500`):

- **Attacker bleeds at the river.** AI-vs-AI, the US usually takes point 1 and then stalls at An Cuong (point 2) with ~340 casualties to ~140. Bible §13's first question ("does a lost early garrison snowball?") is less of an issue than the bridge chokepoint + village cover. Candidate knobs: `MAN_BASE`/`MAN_PER_POINT` (attacker reinforcement), `CAPTURE_SECONDS_PER_DOT`, village cover (`COVER_*`), or giving the attacker a bigger draft budget.
- **Numbers:** `SUPERIORITY_RATIO` 2, `PUSH_STOP_FRACTION` 0.3, `OVERRUN_DIST` 26 make 2v1 decisive in ~10 s; if pushes feel suicidal against cover, raise `PUSH_STOP_FRACTION`.
- **Firefights** in the open last ~30 s (6v6), woods defender vs open attacker ~55 s and decisive, flank+pin ~26 s. If they feel too fast, lower `INF_HIT_CHANCE` (0.12) or raise `SUPPRESS_PER_SHOT`; if stalemates drag, lower `SUPPRESS_DECAY_S` or cheapen `ABILITY.barrage`.
- **Artillery battery** (30 shells) wipes a stationary village squad by itself in ~35 s — probably too strong; consider `ARTY_SHELL_DAMAGE` 60→40 or fewer shells.
- **Economy:** base Manpower 50/min is 10 soldiers/min; the defender holding 5 points gets 175/min. Expect the first real playtest to want `MAN_BASE` up or `MANPOWER_PER_SOLDIER` down for the attacker.
- **Garrison loss** is permanent and the AI will find an undefended rear garrison via the north corridor within ~90 s. If that feels unfair, raise `GARRISON_DESTROY_SECONDS` or lower `VISION_RECON`.
- **Tanks:** HE 55 dmg / 18 px splash every 2 s, standing off at 135 px; an AT squad (2 gunners, 2 s, 60%, 150) kills a tank in ~7 s if it comes within 60 px of them in cover. If tanks feel too safe, lower `TANK_STANDOFF_FRACTION` or `TANK_COVER_SPOT_RANGE`.
- **AI-vs-AI with assault + spawn lock only: ≈3 of 8 attacker wins, most others reach point 4–5.** Spare levers if the attacker needs more: `FIRE_REVEAL_S` 1.5 (shooters visible), `ATTACKER_MANPOWER_MULT` 1.2–1.35, `CAPTURE_SECONDS_PER_DOT` 45; if less: `ACTIVE_POINT_SPAWN_LOCK_R` 150.
