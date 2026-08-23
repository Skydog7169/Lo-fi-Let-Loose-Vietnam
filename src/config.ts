// ALL tuning knobs live here. Systems code must not contain magic numbers.
// Every value is a default, not a decision — see TACMAP_Design_Bible.md §13.

export const CONFIG = {
  // ---- Canvas / loop ----
  LOGICAL_W: 1200,
  LOGICAL_H: 800,
  TICK_HZ: 60,
  MAX_FRAME_DT: 0.25, // seconds; clamp spiral-of-death

  // ---- Camera ----
  CAM_MIN_ZOOM: 1,
  CAM_MAX_ZOOM: 4,
  CAM_WHEEL_ZOOM_STEP: 1.1, // multiplicative per wheel notch

  // ---- Map grid overlay (flavor) ----
  GRID_COLS: 10, // A–J
  GRID_ROWS: 8, // 1–8

  // ---- Pathing grid ----
  PATH_CELL: 10, // px per walkability cell
  // Squad AI prefers cover tiles when the route through them costs < this much extra time.
  WOODS_ROUTE_PREFERENCE: 1.3,
  PATH_SMOOTHING: true,
  PATH_CLEARANCE: 4, // px either side of a smoothed segment that must also be walkable
  DETOUR_COOLDOWN_TICKS: 60, // a blocked dot re-paths to its waypoint at most this often

  // ---- Terrain movement multipliers (bible §4.2) ----
  TERRAIN_SPEED: {
    open: 1.0,
    woods: 0.7,
    village: 0.85,
    river: 0, // impassable
    road: 1.0, // infantry; vehicles use ROAD_VEHICLE_SPEED
    bridge: 1.0,
    ford: 0.6,
    hq: 1.0,
  } as Record<string, number>,
  ROAD_VEHICLE_SPEED: 1.2,
  TERRAIN_IS_COVER: {
    open: false,
    woods: true,
    village: true,
    river: false,
    road: false,
    bridge: false,
    ford: false,
    hq: false,
  } as Record<string, boolean>,

  // ---- Units ----
  INFANTRY_SPEED: 45, // px/s at 100% terrain
  RECON_SPEED: 50,
  TANK_SPEED: 60,
  SQUAD_SIZE: { infantry: 6, at: 6, recon: 4, tank: 1, artillery: 0 } as Record<string, number>,
  DOT_HP: 100,
  TANK_HP: 600,
  DOT_RADIUS: 3,
  FORMATION_RADIUS: 11, // px ring around squad centre for member slots
  DOT_SEPARATION: 7, // px; same-side dots push apart below this
  DOT_SEPARATION_FORCE: 30, // px/s
  WAYPOINT_ARRIVE_R: 6,
  MARKER_ARRIVE_R: 10,

  // ---- Capture points ----
  POINT_RADIUS: 60,
  POINT_COUNT: 5,

  // ---- Placeholder Phase-1 forces ----
  PLACEHOLDER_SQUADS_PER_SIDE: 3,

  // ---- Debug ----
  DEBUG_CONTROL_BOTH_SIDES: true, // Phase 1 only: human can drag either side's markers
  DEBUG_DRAW_PATHS: false,

  // ---- Palette (lo-fi flat colours) ----
  COLORS: {
    open: '#b9a97a',
    woods: '#41683a',
    village: '#8a8a86',
    villageEdge: '#55554f',
    river: '#4c7eab',
    road: '#d8ccA0',
    bridge: '#8c6f4c',
    ford: '#7da3c4',
    hq: '#b9a97a',
    grid: 'rgba(0,0,0,0.18)',
    gridLabel: 'rgba(0,0,0,0.45)',
    us: '#3c8cff',
    pavn: '#e8473c',
    usDim: 'rgba(60,140,255,0.25)',
    pavnDim: 'rgba(232,71,60,0.25)',
    leaderRing: '#ffffff',
    pointRing: '#f4f1e6',
    markerAttack: '#ffffff',
    debugPath: 'rgba(255,255,255,0.5)',
    letterbox: '#0b0d0f',
  },
} as const;

export type TerrainKey = keyof typeof CONFIG.TERRAIN_SPEED;
