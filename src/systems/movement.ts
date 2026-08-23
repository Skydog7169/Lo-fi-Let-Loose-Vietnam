// Pathing over the coarse terrain grid (A* with cover preference and string-pull
// smoothing) + per-dot movement with terrain speed, formation slots and separation.
import { CONFIG } from '../config';
import { cellCenter, cellOf, isWalkable, speedAt, type TerrainGrid } from '../map/grid';
import { formationOffset, squadCentroid, squadsInOrder, type Dot, type GameState, type Squad } from '../state';
import { dist, norm, sub, v, type Vec } from '../vec';
import { rangeFor, threatDirection } from './squad_ai';

// ---------- A* ----------

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() { return this.keys.length; }
  push(k: number, val: number) {
    const ks = this.keys, vs = this.vals;
    let i = ks.length;
    ks.push(k); vs.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pk = ks[p]!;
      if (pk <= k) break;
      ks[i] = pk; vs[i] = vs[p]!;
      i = p;
    }
    ks[i] = k; vs[i] = val;
  }
  pop(): number {
    const ks = this.keys, vs = this.vals;
    const top = vs[0]!;
    const lk = ks.pop()!, lv = vs.pop()!;
    const n = ks.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = -1, mk = lk;
        if (l < n && ks[l]! < mk) { m = l; mk = ks[l]!; }
        if (r < n && ks[r]! < mk) { m = r; mk = ks[r]!; }
        if (m < 0) break;
        ks[i] = mk; vs[i] = vs[m]!;
        i = m;
      }
      ks[i] = lk; vs[i] = lv;
    }
    return top;
  }
}

const SQRT2 = Math.SQRT2;
const NDC = [1, -1, 0, 0, 1, 1, -1, -1];
const NDR = [0, 0, 1, -1, 1, -1, 1, -1];
const NSTEP = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];

/** Path cost for entering a cell: time cost, discounted for cover so squads prefer it (bible §10.1). */
function enterCost(g: TerrainGrid, i: number, vehicle: boolean): number {
  const c = (vehicle ? g.vehCost : g.infCost)[i]!;
  if (c === Infinity) return Infinity;
  return g.cover[i] ? c / CONFIG.WOODS_ROUTE_PREFERENCE : c;
}

function minEnterCost(g: TerrainGrid, vehicle: boolean): number {
  // Admissible heuristic scale: the cheapest possible cell cost.
  let m = Infinity;
  const arr = vehicle ? g.vehCost : g.infCost;
  for (let i = 0; i < arr.length; i++) {
    const c = g.cover[i] ? arr[i]! / CONFIG.WOODS_ROUTE_PREFERENCE : arr[i]!;
    if (c < m) m = c;
  }
  return m;
}
const minCostCache = new WeakMap<TerrainGrid, { inf: number; veh: number }>();
function heuristicScale(g: TerrainGrid, vehicle: boolean): number {
  let e = minCostCache.get(g);
  if (!e) { e = { inf: minEnterCost(g, false), veh: minEnterCost(g, true) }; minCostCache.set(g, e); }
  return vehicle ? e.veh : e.inf;
}

/** Nearest walkable cell index to a point (spiral search), or -1. */
function nearestWalkableCell(g: TerrainGrid, p: Vec, vehicle: boolean): number {
  const { c, r } = cellOf(g, p);
  const costs = vehicle ? g.vehCost : g.infCost;
  for (let rad = 0; rad < 12; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= g.cols || rr >= g.rows) continue;
        const i = rr * g.cols + cc;
        if (costs[i] !== Infinity) return i;
      }
    }
  }
  return -1;
}

// Reusable A* buffers (one search at a time; sim is single-threaded). A stamp array
// replaces per-call fills so a search costs O(cells touched), not O(all cells).
let bufN = 0;
let gScore = new Float64Array(0);
let came = new Int32Array(0);
let stamp = new Uint32Array(0);
let closedStamp = new Uint32Array(0);
let searchId = 0;
function ensureBuffers(n: number): void {
  if (bufN === n) return;
  bufN = n;
  gScore = new Float64Array(n);
  came = new Int32Array(n);
  stamp = new Uint32Array(n);
  closedStamp = new Uint32Array(n);
  searchId = 0;
}

/** Returns world-space waypoints from `from` to `to` (excluding `from`, ending at `to`), or [] if unreachable. */
export function findPath(g: TerrainGrid, from: Vec, to: Vec, vehicle = false): Vec[] {
  const start = nearestWalkableCell(g, from, vehicle);
  const goal = nearestWalkableCell(g, to, vehicle);
  if (start < 0 || goal < 0) return [];
  const cols = g.cols, rows = g.rows, n = cols * rows;
  ensureBuffers(n);
  searchId++;
  if (searchId === 0xffffffff) { stamp.fill(0); closedStamp.fill(0); searchId = 1; }
  const sid = searchId;
  const hScale = heuristicScale(g, vehicle) * CONFIG.PATH_HEURISTIC_WEIGHT;
  const gc = goal % cols, gr = (goal / cols) | 0;
  const h = (i: number) => {
    const c = i % cols, r = (i / cols) | 0;
    const dx = Math.abs(c - gc), dy = Math.abs(r - gr);
    return (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)) * hScale;
  };
  const open = new MinHeap();
  gScore[start] = 0; stamp[start] = sid; came[start] = -1;
  open.push(h(start), start);
  const costs = vehicle ? g.vehCost : g.infCost;
  let found = false;
  while (open.size) {
    const cur = open.pop();
    if (cur === goal) { found = true; break; }
    if (closedStamp[cur] === sid) continue;
    closedStamp[cur] = sid;
    const cc = cur % cols, cr = (cur / cols) | 0;
    const gCur = gScore[cur]!;
    for (let k = 0; k < 8; k++) {
      const dc = NDC[k]!, dr = NDR[k]!, step = NSTEP[k]!;
      const nc = cc + dc, nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (closedStamp[ni] === sid) continue;
      const ec = enterCost(g, ni, vehicle);
      if (ec === Infinity) continue;
      // no corner cutting past impassable cells
      if (dc !== 0 && dr !== 0) {
        if (costs[cr * cols + nc] === Infinity || costs[nr * cols + cc] === Infinity) continue;
      }
      const ng = gCur + step * ec;
      if (stamp[ni] !== sid || ng < gScore[ni]!) {
        stamp[ni] = sid;
        gScore[ni] = ng;
        came[ni] = cur;
        open.push(ng + h(ni), ni);
      }
    }
  }
  if (!found) return [];
  const cells: number[] = [];
  for (let i = goal; i !== -1; i = came[i]!) cells.push(i);
  cells.reverse();
  let pts = cells.map((i) => cellCenter(g, i % cols, (i / cols) | 0));
  // Replace the last waypoint with the exact goal if it is walkable.
  if (isWalkable(g, to, vehicle)) pts[pts.length - 1] = v(to.x, to.y);
  if (CONFIG.PATH_SMOOTHING) pts = smoothPath(g, from, pts, vehicle);
  return pts;
}

/** Is the straight segment a→b free of impassable cells AND terrain-class-consistent enough to shortcut?
 *  We only allow shortcuts when every sampled cell has the same cover flag as the endpoints' cells
 *  (so a path routed through woods for cover stays in the woods). */
function segmentOk(g: TerrainGrid, a: Vec, b: Vec, vehicle: boolean): boolean {
  const d = dist(a, b);
  const steps = Math.max(1, Math.ceil(d / (g.cell * 0.7)));
  const ca = cellOf(g, a);
  const coverA = g.cover[ca.r * g.cols + ca.c];
  // perpendicular clearance offsets so smoothed paths do not hug corners/bridge edges
  const ux = (b.x - a.x) / (d || 1), uy = (b.y - a.y) / (d || 1);
  const px = -uy * CONFIG.PATH_CLEARANCE, py = ux * CONFIG.PATH_CLEARANCE;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (!isWalkable(g, v(x, y), vehicle)) return false;
    if (!isWalkable(g, v(x + px, y + py), vehicle)) return false;
    if (!isWalkable(g, v(x - px, y - py), vehicle)) return false;
    const { c, r } = cellOf(g, v(x, y));
    if (g.cover[r * g.cols + c] !== coverA) return false;
  }
  return true;
}

function smoothPath(g: TerrainGrid, from: Vec, pts: Vec[], vehicle: boolean): Vec[] {
  if (pts.length <= 2) return pts;
  const out: Vec[] = [];
  let anchor = from;
  let i = 0;
  while (i < pts.length) {
    // greedy forward: extend the shortcut while the straight segment stays clear
    let j = i;
    while (j + 1 < pts.length && segmentOk(g, anchor, pts[j + 1]!, vehicle)) j++;
    out.push(pts[j]!);
    anchor = pts[j]!;
    i = j + 1;
  }
  return out;
}

// ---------- Squad path management ----------

/** Defend marker: occupy the nearest cover within DEFEND_COVER_SEARCH_R, preferring cover-edge
 *  cells that face enemy territory (bible §10.1). Falls back to the marker itself. */
function defendSpot(state: GameState, squad: Squad, marker: Vec): Vec {
  const g = state.grid;
  const R = CONFIG.DEFEND_COVER_SEARCH_R;
  const span = Math.ceil(R / g.cell);
  const { c, r } = cellOf(g, marker);
  const td = threatDirection(state, squad, marker);
  // neighbour step (8-dir) toward the threat
  const enemyDx = Math.abs(td.x) >= 0.38 ? Math.sign(td.x) : 0;
  const enemyDy = Math.abs(td.y) >= 0.38 ? Math.sign(td.y) : 0;
  let best: Vec | null = null, bestScore = Infinity;
  for (let dr = -span; dr <= span; dr++) for (let dc = -span; dc <= span; dc++) {
    const cc = c + dc, rr = r + dr;
    if (cc < 0 || rr < 0 || cc >= g.cols || rr >= g.rows) continue;
    const i = rr * g.cols + cc;
    if (!g.cover[i] || g.infCost[i] === Infinity) continue;
    const q = cellCenter(g, cc, rr);
    const d = dist(q, marker);
    if (d > R) continue;
    const ec = cc + enemyDx, er = rr + enemyDy;
    const isEdge = ec < 0 || ec >= g.cols || er < 0 || er >= g.rows || !g.cover[er * g.cols + ec];
    const score = d + (isEdge ? 0 : CONFIG.DEFEND_EDGE_BONUS);
    if (score < bestScore) { best = q; bestScore = score; }
  }
  return best ?? marker;
}

/** Where the squad is actually trying to go right now. */
export function resolveGoal(state: GameState, squad: Squad): Vec | null {
  if (squad.fallback) return squad.fallback;
  if (!squad.marker) return null;
  if (squad.marker.kind === 'defend') {
    const m = squad.marker.pos;
    if (squad.defendCache && squad.defendCache.marker.x === m.x && squad.defendCache.marker.y === m.y) return squad.defendCache.spot;
    const spot = defendSpot(state, squad, m);
    squad.defendCache = { marker: v(m.x, m.y), spot };
    return spot;
  }
  return squad.marker.pos;
}

export function updateSquadPaths(state: GameState): void {
  for (const squad of squadsInOrder(state)) {
    if (squad.kind === 'artillery') continue; // batteries are static
    const goal = resolveGoal(state, squad);
    if (!goal) { squad.path = []; squad.pathGoal = null; continue; }
    if (squad.pathGoal && squad.pathGoal.x === goal.x && squad.pathGoal.y === goal.y) continue;
    const c = squadCentroid(state, squad);
    if (!c) continue;
    squad.path = findPath(state.grid, c, goal, squad.kind === 'tank');
    squad.pathGoal = v(goal.x, goal.y);
    if (squad.path.length) { const p0 = squad.path[0]!; if (dist(p0, c) > 1) squad.heading = Math.atan2(p0.y - c.y, p0.x - c.x); }
    for (const id of squad.dotIds) { const d = state.dots[id]!; d.wp = 0; d.detour = null; }
    if (squad.state === 'IDLE' || squad.state === 'MOVING') squad.state = squad.path.length ? 'MOVING' : 'IDLE';
  }
}

// ---------- Dot movement ----------

function dotSpeed(squad: Squad): number {
  switch (squad.kind) {
    case 'recon': return CONFIG.RECON_SPEED;
    case 'tank': return CONFIG.TANK_SPEED;
    default: return CONFIG.INFANTRY_SPEED;
  }
}

/** Try to move `dot` to `np`; if blocked, slide along one axis. */
function moveBlocked(g: TerrainGrid, dot: Dot, np: Vec, vehicle: boolean): boolean {
  if (isWalkable(g, np, vehicle)) { dot.pos = np; return true; }
  const sx = v(np.x, dot.pos.y);
  if (isWalkable(g, sx, vehicle) && Math.abs(sx.x - dot.pos.x) > 1e-3) { dot.pos = sx; return true; }
  const sy = v(dot.pos.x, np.y);
  if (isWalkable(g, sy, vehicle) && Math.abs(sy.y - dot.pos.y) > 1e-3) { dot.pos = sy; return true; }
  return false;
}

export function updateMovement(state: GameState, dt: number): void {
  const g = state.grid;
  for (const squad of squadsInOrder(state)) {
    if (squad.kind === 'artillery') continue;
    const vehicle = squad.kind === 'tank';
    const base = dotSpeed(squad);
    const n = squad.dotIds.length;
    const pinned = squad.state === 'SUPPRESSED';
    let anyMoving = false;
    for (const id of squad.dotIds) {
      const dot = state.dots[id]!;
      if (!dot.alive) continue;
      dot.moving = false;
      if (dot.detourCooldown > 0) dot.detourCooldown--;
      const suppMult = 1 - CONFIG.SUPPRESS_SPEED_MULT_MAX * dot.suppression;

      // Engaging dots halt (bible §9.1) — except for a short step into adjacent cover.
      if (dot.coverSeek) {
        const toC = sub(dot.coverSeek, dot.pos);
        const d = Math.hypot(toC.x, toC.y);
        if (d <= 1.5) { dot.coverSeek = null; continue; }
        const sp = base * speedAt(g, dot.pos, vehicle) * suppMult;
        const dir = norm(toC);
        dot.moving = true;
        if (!moveBlocked(g, dot, v(dot.pos.x + dir.x * Math.min(d, sp * dt), dot.pos.y + dir.y * Math.min(d, sp * dt)), vehicle)) dot.coverSeek = null;
        continue;
      }
      if (pinned) continue;
      if (dot.targetId >= 0) {
        // Defenders halt where they stand; attackers keep closing on their target until comfortably inside range.
        if (!squad.marker || squad.marker.kind !== 'attack' || squad.fallback) continue;
        const tgt = state.dots[dot.targetId]!;
        const r = rangeFor(state, dot, tgt) * CONFIG.ENGAGE_STOP_FRACTION;
        const toE = sub(tgt.pos, dot.pos);
        const dE = Math.hypot(toE.x, toE.y);
        if (dE <= r + 1 || enemyWithin(state, dot, CONFIG.ENGAGE_MIN_DIST)) continue; // +1px hysteresis: no jitter at the boundary
        const sp = base * speedAt(g, dot.pos, vehicle) * suppMult;
        const dir = norm(toE);
        dot.moving = true;
        dot.facing = Math.atan2(dir.y, dir.x);
        moveBlocked(g, dot, v(dot.pos.x + dir.x * Math.min(dE - r, sp * dt), dot.pos.y + dir.y * Math.min(dE - r, sp * dt)), vehicle);
        continue;
      }
      const onDetour = !!dot.detour && dot.detour.length > 0;
      // A detour (respawn rejoin, or a dot squeezed off a bridge) must run even when the squad's own path is finished.
      if (!onDetour && dot.wp >= squad.path.length) continue;
      const isLast = dot.wp >= squad.path.length - 1;
      const wpPos = squad.path[Math.min(dot.wp, squad.path.length - 1)] ?? dot.pos;
      let target: Vec;
      let arriveR: number;
      if (onDetour) {
        // personal detour back onto the squad path
        target = dot.detour![0]!;
        arriveR = CONFIG.WAYPOINT_ARRIVE_R;
      } else {
        dot.detour = null;
        // Formation slot offset — only when the offset position is walkable.
        const off = formationOffset(dot.slot, n, squad.heading);
        target = v(wpPos.x + off.x, wpPos.y + off.y);
        if (!isWalkable(g, target, vehicle)) target = wpPos;
        arriveR = isLast ? CONFIG.MARKER_ARRIVE_R : CONFIG.WAYPOINT_ARRIVE_R;
      }
      const toT = sub(target, dot.pos);
      const d = Math.hypot(toT.x, toT.y);
      if (d <= arriveR) {
        if (dot.detour && dot.detour.length) dot.detour.shift();
        else dot.wp++;
        continue;
      }
      anyMoving = true;
      dot.moving = true;
      const sp = base * speedAt(g, dot.pos, vehicle) * suppMult;
      const stepLen = Math.min(d, sp * dt);
      const dir = norm(toT);
      dot.facing = Math.atan2(dir.y, dir.x);
      const moved = moveBlocked(g, dot, v(dot.pos.x + dir.x * stepLen, dot.pos.y + dir.y * stepLen), vehicle);
      if (!moved && dot.detourCooldown === 0) {
        // Blocked (pushed off a bridge, squeezed against the bank): re-path to the waypoint.
        dot.detour = findPath(g, dot.pos, wpPos, vehicle);
        dot.detourCooldown = CONFIG.DETOUR_COOLDOWN_TICKS;
      }
    }
    if (!anyMoving && squad.state === 'MOVING') squad.state = 'IDLE';
    else if (anyMoving && squad.state === 'IDLE') squad.state = 'MOVING';
  }
  applySeparation(state, dt);
}

function enemyWithin(state: GameState, dot: Dot, r: number): boolean {
  const r2 = r * r;
  for (const e of state.dots) {
    if (!e.alive || e.side === dot.side) continue;
    const dx = e.pos.x - dot.pos.x, dy = e.pos.y - dot.pos.y;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}

/** Dots push apart so a squad never collapses into a single pixel (applies to enemies too — no overlapping blobs). */
function applySeparation(state: GameState, dt: number): void {
  const F = CONFIG.DOT_SEPARATION_FORCE * dt;
  const RE = CONFIG.ENEMY_SEPARATION, RE2 = RE * RE;
  const RS = CONFIG.DOT_SEPARATION, RS2 = RS * RS;
  const dots = state.dots;
  const g = state.grid;
  for (let i = 0; i < dots.length; i++) {
    const a = dots[i]!;
    if (!a.alive) continue;
    for (let j = i + 1; j < dots.length; j++) {
      const b = dots[j]!;
      if (!b.alive) continue;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const d2 = dx * dx + dy * dy;
      const enemy = a.side !== b.side;
      const R = enemy ? RE : RS;
      if (d2 >= (enemy ? RE2 : RS2)) continue;
      const d = Math.sqrt(d2) || 0.001;
      // enemies get shoved apart hard (never overlap); friends drift apart gently
      const push = enemy ? Math.max((R - d) / 2, ((R - d) / R) * F) : ((R - d) / R) * F;
      const nx = d > 0.001 ? dx / d : 1, ny = d > 0.001 ? dy / d : 0;
      const ap = v(a.pos.x - nx * push, a.pos.y - ny * push);
      const bp = v(b.pos.x + nx * push, b.pos.y + ny * push);
      if (isWalkable(g, ap)) a.pos = ap;
      if (isWalkable(g, bp)) b.pos = bp;
    }
  }
}
