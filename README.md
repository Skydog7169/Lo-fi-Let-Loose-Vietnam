# TACMAP

Lo-fi top-down commander duel (HLL: Vietnam tactical map, as a game). See `TACMAP_Design_Bible.md` for the design and `CLAUDE.md` for the build plan.

```bash
npm install
npm run dev       # http://localhost:5174
npm run build     # typecheck + production build
```

Controls (Phase 1): drag a squad's flag = attack order; right-drag = defend; drag the map = pan; wheel = zoom; `P` = show paths; `R` = reset camera.
Dev hook: `tacmap.step(n)` in the console advances the sim `n` ticks deterministically.
