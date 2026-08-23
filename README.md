# TACMAP

Lo-fi top-down commander duel (HLL: Vietnam tactical map, as a game). See `TACMAP_Design_Bible.md` for the design and `CLAUDE.md` for the build plan.

```bash
npm install
npm run dev       # http://localhost:5174
npm run build     # typecheck + production build
```

Controls: drag a squad's flag = attack order; right-drag = defend; `G` + click = place garrison (setup: 3 free); click own garrison + click = redeploy; Enter = ready (setup); drag map = pan; wheel = zoom; `F` = reveal fog (debug); `P` = paths; `R` = reset camera.

URL params: `?scenario=<name>` (see `src/scenarios.ts`), `?seed=<n>`, `?setup=0` (skip setup, auto-place garrisons).

Dev: `tacmap.step(n)` in the console advances the sim `n` ticks deterministically; `npm run headless -- all|checks|perf|<scenario>` runs the Node verification suite.
