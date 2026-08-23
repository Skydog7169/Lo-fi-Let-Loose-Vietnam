// Pathing over the coarse terrain grid (A* with cover preference and string-pull
// smoothing) + per-dot movement with terrain speed, formation slots and separation.
import { CONFIG } from '../config';
import { cellCenter, cellOf, isWalkable, speedAt, type TerrainGrid } from '../map/grid';
import { formationOffset, squadCentroid, type Dot, type GameState, type Squad } from '../state';
import { dist, norm, sub, v, type Vec } from '../vec';

// ---------- A* ----------

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() { return this.keys.length; }
  push(k: number, val: number) {
    const ks = this.keys, vs = this.vals;
    ks.push(k); vs.push(val);
    let i = ks.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p]! <= ks[i]!) break;
      [ks[p], ks[i]] = [ks[i]!, ks[p]!];
      [vs[p], vs[i]] = [vs[i]!, vs[p]!];
      i = p;
    }
  }
  pop(): number {
    const ks = this.keys, vs = this.vals;
    const top = vs[0]!;
    const lk = ks.pop()!, lv = vs.pop()!;
    if (ks.length) {
      ks[0] = lk; vs[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < ks.length && ks[l]! < ks[m]!) m = l;
        if (r < ks.length && ks[r]! < ks[m]!) m = r;
        if (m === i) break;
        [ks[m], ks[i]] = [ks[i]!, ks[m]!];
        [vs[m], vs[i]] = [vs[i]!, vs[m]!];
        i = m;
      }
    }
    return top;
  }
}

const SQRT2 = Math.SQRT2;
const NEIGH: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

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

/** Returns world-space waypoints from `from` to `to` (excluding `from`, ending at `to`), or [] if unreachable. */
export function findPath(g: TerrainGrid, from: Vec, to: Vec, vehicle = false): Vec[] {
  const start = nearestWalkableCell(g, from, vehicle);
  const goal = nearestWalkableCell(g, to, vehicle);
  if (start < 0 || goal < 0) return [];
  const cols = g.cols, rows = g.rows, n = cols * rows;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const hScale = heuristicScale(g, vehicle);
  const gc = goal % cols, gr = (goal / cols) | 0;
  const h = (i: number) => {
    const c = i % cols, r = (i / cols) | 0;
    const dx = Math.abs(c - gc), dy = Math.abs(r - gr);
    return (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)) * hScale;
  };
  const open = new MinHeap();
  gScore[start] = 0;
  open.push(h(start), start);
  const costs = vehicle ? g.vehCost : g.infCost;
  let found = false;
  while (open.size) {
    const cur = open.pop();
    if (cur === goal) { found = true; break; }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cc = cur % cols, cr = (cur / cols) | 0;
    for (const [dc, dr, step] of NEIGH) {
      const nc = cc + dc, nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (closed[ni]) continue;
      const ec = enterCost(g, ni, vehicle);
      if (ec === Infinity) continue;
      // no corner cutting past impassable cells
      if (dc !== 0 && dr !== 0) {
        if (costs[cr * cols + nc] === Infinity || costs[nr * cols + cc] === Infinity) continue;
      }
      const ng = gScore[cur]! + step * ec;
      if (ng < gScore[ni]!) {
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
  const steps = Math.max(1, Math.ceil(d / (g.cell * 0.5)));
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
    // farthest j such that anchor→pts[j] is ok
    let j = i;
    for (let k = pts.length - 1; k > i; k--) {
      if (segmentOk(g, anchor, pts[k]!, vehicle)) { j = k; break; }
    }
    out.push(pts[j]!);
    anchor = pts[j]!;
    i = j + 1;
  }
  return out;
}

// ---------- Squad path management ----------

function squadGoal(squad: Squad): Vec | null {
  return squad.marker ? squad.marker.pos : null;
}

export function updateSquadPaths(state: GameState): void {
  for (const squad of state.squads) {
    const goal = squadGoal(squad);
    if (!goal) { squad.path = []; squad.pathGoal = null; continue; }
    if (squad.pathGoal && squad.pathGoal.x === goal.x && squad.pathGoal.y === goal.y) continue;
    const c = squadCentroid(state, squad);
    if (!c) continue;
    squad.path = findPath(state.grid, c, goal, squad.kind === 'tank');
    squad.pathGoal = v(goal.x, goal.y);
    for (const id of squad.dotIds) state.dots[id]!.wp = 0;
    squad.state = squad.path.length ? 'MOVING' : 'IDLE';
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
  for (const squad of state.squads) {
    if (!squad.path.length) continue;
    const vehicle = squad.kind === 'tank';
    const base = dotSpeed(squad);
    const n = squad.dotIds.length;
    let anyMoving = false;
    for (const id of squad.dotIds) {
      const dot = state.dots[id]!;
      if (!dot.alive) continue;
      if (dot.detourCooldown > 0) dot.detourCooldown--;
      if (dot.wp >= squad.path.length) continue;
      const isLast = dot.wp === squad.path.length - 1;
      const wpPos = squad.path[dot.wp]!;
      let target: Vec;
      let arriveR: number;
      if (dot.detour && dot.detour.length) {
        // personal detour back onto the squad path
        target = dot.detour[0]!;
        arriveR = CONFIG.WAYPOINT_ARRIVE_R;
      } else {
        dot.detour = null;
        // Formation slot offset — only when the offset position is walkable.
        const off = formationOffset(dot.slot, n);
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
      const sp = base * speedAt(g, dot.pos, vehicle) * (1 - 0.5 * dot.suppression);
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
  }
  applySeparation(state, dt);
}

/** Same-side dots push apart so a squad never collapses into a single pixel. */
function applySeparation(state: GameState, dt: number): void {
  const R = CONFIG.DOT_SEPARATION;
  const R2 = R * R;
  const F = CONFIG.DOT_SEPARATION_FORCE * dt;
  const dots = state.dots;
  const g = state.grid;
  for (let i = 0; i < dots.length; i++) {
    const a = dots[i]!;
    if (!a.alive) continue;
    for (let j = i + 1; j < dots.length; j++) {
      const b = dots[j]!;
      if (!b.alive || a.side !== b.side) continue;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= R2) continue;
      const d = Math.sqrt(d2) || 0.001;
      const push = ((R - d) / R) * F;
      const nx = d > 0.001 ? dx / d : 1, ny = d > 0.001 ? dy / d : 0;
      const ap = v(a.pos.x - nx * push, a.pos.y - ny * push);
      const bp = v(b.pos.x + nx * push, b.pos.y + ny * push);
      if (isWalkable(g, ap)) a.pos = ap;
      if (isWalkable(g, bp)) b.pos = bp;
    }
  }
}
