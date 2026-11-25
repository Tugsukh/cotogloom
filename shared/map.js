// The building: everything is an axis-aligned box {min:[x,y,z], max:[x,y,z], mat}.
// Used by the server (collision, line of sight) and the client (rendering + prediction).
//
// Top view (x → right, z ↓ down), 40 x 30 m, two storeys (ground 0–3 m, mezzanine/loft 3.2–6 m):
//
//   z=0  +---------+--+----------------+--+---------+
//        | OFFICE  |c | MEETING ROOM   |c |  LAB    |      upstairs over the meeting room:
//   EXIT ]  (B)    |o |  (H)           |o |  (E)    |      LOFT WEST | LOFT EAST, reached from
//        +---------+r +-------++-------+r +---------+      the balcony (z 8–10) via the stairs
//   z=10 | KITCHEN |r |S  ATRIUM (6 m  |r | LIBRARY |
//        |  (C)    |i |T   high, open) |i |  (F)    |
//        +---------+d |A               |d +---------+
//   z=20 | STORAGE |o |IR              |o | SERVER  |
//        |  (D)    |r +-------  -------+r |  ROOM(G)|
//        |         |  |  LOBBY (spawn) |  |         |
//   z=30 +---------+--+----------------+--+---------+
//       x=0      10  12               28  30       40

import { CONFIG } from './config.js';

const T = 0.2;          // wall thickness
const G1 = 3.0;         // ground-floor ceiling (underside of the slab)
const UP = 3.2;         // upper-floor level (top of the slab)
const ROOF = 6.0;
const DOOR_H = 2.2;

const boxes = [];
function box(x0, y0, z0, x1, y1, z1, mat = 'wall') {
  boxes.push({
    min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
    max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
    mat,
  });
}

/** Wall running along X at depth z, from x0 to x1, with door gaps [{c: centre, w: width, h: height}]. */
function wallX(z, x0, x1, y0, y1, doors = [], mat = 'wall') {
  let cur = x0;
  for (const d of [...doors].sort((a, b) => a.c - b.c)) {
    const a = d.c - d.w / 2, b = d.c + d.w / 2;
    if (a > cur) box(cur, y0, z - T / 2, a, y1, z + T / 2, mat);
    const top = y0 + (d.h ?? DOOR_H);
    if (top < y1) box(a, top, z - T / 2, b, y1, z + T / 2, mat);
    cur = b;
  }
  if (cur < x1) box(cur, y0, z - T / 2, x1, y1, z + T / 2, mat);
}

/** Wall running along Z at x, from z0 to z1, with door gaps. */
function wallZ(x, z0, z1, y0, y1, doors = [], mat = 'wall') {
  let cur = z0;
  for (const d of [...doors].sort((a, b) => a.c - b.c)) {
    const a = d.c - d.w / 2, b = d.c + d.w / 2;
    if (a > cur) box(x - T / 2, y0, cur, x + T / 2, y1, a, mat);
    const top = y0 + (d.h ?? DOOR_H);
    if (top < y1) box(x - T / 2, top, a, x + T / 2, y1, b, mat);
    cur = b;
  }
  if (cur < z1) box(x - T / 2, y0, cur, x + T / 2, y1, z1, mat);
}

/** Table/desk: top high enough that a crouched player (0.8 m) fits under, a standing one (1.7 m) doesn't. */
const TABLE_UNDERSIDE = 0.92;
function table(cx, cz, w, d, y0 = 0, mat = 'wood') {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  box(x0, y0 + TABLE_UNDERSIDE, z0, x1, y0 + 1.0, z1, mat);
  const L = 0.08, i = 0.04;
  for (const [lx, lz] of [[x0 + i, z0 + i], [x1 - i - L, z0 + i], [x0 + i, z1 - i - L], [x1 - i - L, z1 - i - L]]) {
    box(lx, y0, lz, lx + L, y0 + TABLE_UNDERSIDE, lz + L, mat);
  }
}

/** Walk-in closet with a door gap on one side ('n' = -z, 's' = +z, 'w' = -x, 'e' = +x). */
function closet(x0, z0, x1, z1, side, y0 = 0, h = 2.3) {
  const t = 0.08, dw = 0.9, y1 = y0 + h;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const seg = (ax0, az0, ax1, az1, hasDoor, alongX) => {
    if (!hasDoor) { box(ax0, y0, az0, ax1, y1, az1, 'closet'); return; }
    if (alongX) {
      box(ax0, y0, az0, cx - dw / 2, y1, az1, 'closet');
      box(cx + dw / 2, y0, az0, ax1, y1, az1, 'closet');
      box(cx - dw / 2, y0 + 2.0, az0, cx + dw / 2, y1, az1, 'closet');
    } else {
      box(ax0, y0, az0, ax1, y1, cz - dw / 2, 'closet');
      box(ax0, y0, cz + dw / 2, ax1, y1, az1, 'closet');
      box(ax0, y0 + 2.0, cz - dw / 2, ax1, y1, cz + dw / 2, 'closet');
    }
  };
  seg(x0, z0, x1, z0 + t, side === 'n', true);
  seg(x0, z1 - t, x1, z1, side === 's', true);
  seg(x0, z0, x0 + t, z1, side === 'w', false);
  seg(x1 - t, z0, x1, z1, side === 'e', false);
  box(x0, y1, z0, x1, y1 + 0.06, z1, 'closet'); // roof
}

// ------------------------------------------------------------------ shell
box(-1, -0.3, -1, 41, 0, 31, 'floor');
box(-0.2, ROOF, -0.2, 40.2, ROOF + 0.2, 30.2, 'ceiling');

const EXIT_Z = 5;
wallX(0, -0.1, 40.1, 0, ROOF);                                  // north outer
wallX(30, -0.1, 40.1, 0, ROOF);                                 // south outer
wallZ(0, 0, 30, 0, ROOF, [{ c: EXIT_Z, w: 1.4, h: 2.4 }]);      // west outer (exit gap)
box(-0.1, 0, EXIT_Z - 0.7, 0.0, 2.4, EXIT_Z + 0.7, 'exit');     // the exit door itself (solid)
wallZ(40, 0, 30, 0, ROOF);                                      // east outer

// ground-floor slabs (also the floor of the loft / balcony)
box(0, G1, 0, 12, UP, 30, 'ceiling');       // west wing + corridor
box(28, G1, 0, 40, UP, 30, 'ceiling');      // east wing + corridor
box(12, G1, 0, 28, UP, 10, 'ceiling');      // meeting room + balcony
box(12, G1, 22, 28, UP, 30, 'ceiling');     // lobby

// ------------------------------------------------------------------ west wing (office, kitchen, storage)
wallZ(10, 0, 30, 0, G1, [{ c: 6.5, w: 1.2 }, { c: 15, w: 1.2 }, { c: 25, w: 1.2 }]);
wallX(10, 0, 10, 0, G1, [{ c: 7, w: 1.2 }]);
wallX(20, 0, 10, 0, G1, [{ c: 3, w: 1.2 }]);

// ------------------------------------------------------------------ east wing (lab, library, server room)
wallZ(30, 0, 30, 0, G1, [{ c: 5, w: 1.2 }, { c: 15, w: 1.2 }, { c: 25, w: 1.2 }]);
wallX(10, 30, 40, 0, G1, [{ c: 33, w: 1.2 }]);
wallX(20, 30, 40, 0, G1);

// ------------------------------------------------------------------ corridors -> centre
wallZ(12, 0, 8, 0, G1, [{ c: 4, w: 1.2 }]);
wallZ(12, 8, 22, 0, ROOF, [{ c: 21, w: 1.2 }]);                // atrium west wall (full height)
wallZ(12, 22, 30, 0, G1, [{ c: 26, w: 1.2 }]);
wallZ(28, 0, 8, 0, G1, [{ c: 4, w: 1.2 }]);
wallZ(28, 8, 22, 0, ROOF, [{ c: 15, w: 1.6, h: 2.4 }]);        // atrium east wall (full height)
wallZ(28, 22, 30, 0, G1, [{ c: 26, w: 1.2 }]);

// meeting room / atrium
wallX(8, 12, 28, 0, G1, [{ c: 20, w: 2.0 }]);
// lobby / atrium
wallX(22, 12, 28, 0, ROOF, [{ c: 20, w: 3.0, h: 2.6 }]);

// ------------------------------------------------------------------ upstairs: balcony + loft
wallX(8, 12, 28, UP, ROOF, [{ c: 16, w: 1.2 }, { c: 24, w: 1.2 }]);  // loft south wall (doors from balcony)
wallZ(20, 0, 8, UP, ROOF, [{ c: 4, w: 1.2 }]);                       // loft partition
wallZ(12, 0, 8, UP, ROOF);
wallZ(28, 0, 8, UP, ROOF);
box(13.5, UP, 9.95, 28, UP + 1.0, 10.05, 'rail');                     // balcony railing

// staircase along the atrium's west wall: 16 steps of 0.2 m, from z=20 (bottom) up to the balcony at z=10.
// Steps are thin slabs, so there is a crawl space under the high end.
const STEPS = 16, RUN = 10 / STEPS, RISE = UP / STEPS;
for (let i = 0; i < STEPS; i++) {
  const top = (i + 1) * RISE;
  const z1 = 20 - i * RUN, z0 = z1 - RUN;
  box(12.1, Math.max(0, top - 0.2), z0, 13.5, top, z1, 'stair');
}
box(13.5, 2.0, 10.6, 13.58, UP + 1.0, 14.5, 'rail'); // short side rail at the top of the stairs

// ------------------------------------------------------------------ furniture
// Office (B)
table(3, 3, 2.4, 1.2); table(7, 3, 2.4, 1.2); table(5, 7.5, 2.4, 1.2);
closet(0.1, 8.4, 1.7, 9.9, 'e');
box(8.8, 0, 0.1, 9.9, 1.9, 0.6, 'shelf');
// Kitchen (C)
box(0.1, 0, 10.6, 1.0, 0.95, 19.4, 'counter');
table(5, 15, 3, 1.4);
box(8.8, 0, 10.2, 9.8, 2.0, 11.0, 'fridge');
box(8.8, 0, 18.6, 9.8, 1.0, 19.8, 'crate');
// Storage (D) — dark
box(1, 0, 22, 1.5, 2.2, 28, 'shelf'); box(3.5, 0, 22, 4, 2.2, 28, 'shelf'); box(6, 0, 23, 6.5, 2.2, 28, 'shelf');
box(8, 0, 27, 9, 1.0, 28, 'crate'); box(8.3, 0, 25.4, 9.3, 1.0, 26.4, 'crate'); box(8.2, 1.0, 27.1, 8.9, 1.7, 27.9, 'crate');
closet(8.4, 20.2, 9.9, 21.8, 'w');
// Meeting room (H)
table(20, 4, 6, 1.6); table(20, 4, 0.2, 0.2); // extra centre leg
box(26.5, 0, 0.1, 27.9, 1.9, 0.6, 'shelf');
// Lab (E)
table(33, 3, 2.4, 1.2); table(37, 3, 2.4, 1.2); table(35, 7, 3, 1.2, 0, 'metal');
box(39, 0, 6, 39.9, 2.0, 9, 'metal');
// Library (F)
box(32, 0, 12, 38, 2.2, 12.4, 'shelf'); box(32, 0, 15.3, 38, 2.2, 15.7, 'shelf'); box(32, 0, 18.4, 38, 2.2, 18.8, 'shelf');
table(31.2, 17, 1.0, 1.6);
// Server room (G) — dark
box(32, 0, 22, 33, 2.2, 28, 'rack'); box(35, 0, 22, 36, 2.2, 28, 'rack'); box(38, 0, 22, 39, 2.2, 26.5, 'rack');
closet(36.5, 28.2, 38.4, 29.9, 'n');
// Lobby (spawn)
box(18, 0, 24, 22, 1.1, 24.8, 'counter');
box(13, 0, 29.0, 17, 0.45, 29.8, 'bench'); box(23, 0, 29.0, 27, 0.45, 29.8, 'bench');
box(12.3, 0, 22.3, 13, 1.2, 23, 'plant'); box(27, 0, 22.3, 27.7, 1.2, 23, 'plant');
// Atrium
box(19.7, 0, 17.7, 20.3, ROOF, 18.3, 'pillar');
table(23, 14, 2, 2); table(25.5, 19.5, 2.2, 1.2);
box(16.5, 0, 12.5, 17.5, 1.0, 13.5, 'crate'); box(16.6, 0, 13.6, 17.4, 0.8, 14.4, 'crate');
box(26.3, 0, 10.5, 27.8, 1.3, 11.6, 'crate');
// Loft west — dark
box(17.5, UP, 0.5, 18.5, UP + 1.0, 1.5, 'crate'); box(18.6, UP, 0.5, 19.6, UP + 1.6, 1.5, 'crate');
table(16, 4.5, 2.2, 1.2, UP);
// Loft east
closet(26.2, 0.1, 27.9, 1.8, 's', UP);
table(23.5, 4, 2.6, 1.2, UP);
box(20.3, UP, 6.5, 21.3, UP + 1.0, 7.6, 'crate');

// ------------------------------------------------------------------ task stations (solid consoles)
// sign: where the code-lock code is painted when this station rolls the code-lock task (faces rotY).
const S = (id, room, x, y, z, sign) => ({ id, room, pos: [x, y, z], sign });
const stations = [
  S(1, 'Office', 9.3, 0, 9.2, { pos: [5, 1.7, 0.11], rotY: 0 }),
  S(2, 'Kitchen', 5, 0, 18.9, { pos: [9.89, 1.6, 13.5], rotY: -Math.PI / 2 }),
  S(3, 'Storage', 7.4, 0, 23.6, { pos: [2.5, 1.6, 29.89], rotY: Math.PI }),
  S(4, 'Meeting room', 13.4, 0, 1.0, { pos: [12.11, 1.6, 6.3], rotY: Math.PI / 2 }),
  S(5, 'Lab', 38.9, 0, 1.2, { pos: [33, 1.6, 9.89], rotY: Math.PI }),
  S(6, 'Library', 39.2, 0, 13.6, { pos: [39.89, 1.6, 17.2], rotY: -Math.PI / 2 }),
  S(7, 'Server room', 34, 0, 29.2, { pos: [39.89, 1.6, 28.2], rotY: -Math.PI / 2 }),
  S(8, 'Atrium', 27.2, 0, 21.2, { pos: [20.31, 1.7, 18], rotY: Math.PI / 2 }),
  S(9, 'Loft west', 13.0, UP, 1.0, { pos: [19.89, UP + 1.6, 6], rotY: -Math.PI / 2 }),
  S(10, 'Loft east', 21.5, UP, 1.0, { pos: [25, UP + 1.6, 0.11], rotY: 0 }),
];
for (const st of stations) box(st.pos[0] - 0.3, st.pos[1], st.pos[2] - 0.3, st.pos[0] + 0.3, st.pos[1] + 1.0, st.pos[2] + 0.3, 'station');

// ------------------------------------------------------------------ lights (dark rooms have none)
const lights = [
  { pos: [5, 2.75, 4.5], color: '#ffe2b0' },     // office
  { pos: [5, 2.75, 15], color: '#d8ecff' },      // kitchen
  { pos: [20, 2.75, 4], color: '#ffd9a0' },      // meeting room
  { pos: [35, 2.75, 4.5], color: '#cfe3ff' },    // lab
  { pos: [35, 2.75, 14], color: '#ffcf8a' },     // library
  { pos: [20, 2.75, 26.5], color: '#ffe2b0' },   // lobby
  { pos: [22, 5.4, 16], color: '#b8c8ff', intensity: CONFIG.ROOM_LIGHT_INTENSITY * 1.6, distance: 16 }, // atrium
  { pos: [24, 5.5, 4], color: '#ffd090' },       // loft east
  { pos: [11, 2.75, 15], color: '#a0b0d0', intensity: CONFIG.ROOM_LIGHT_INTENSITY * 0.5, distance: 9 }, // west corridor
];

export const MAP = {
  name: 'Gloom House',
  bounds: { min: [0, 0, 0], max: [40, ROOF, 30] },
  boxes,
  stations,
  // exit door on the west outer wall of the office, far from the lobby spawn
  exit: { pos: [0.0, 0, EXIT_Z], normal: [1, 0, 0], width: 1.4, height: 2.4 },
  spawns: [[14.5, 0, 26.5], [16.5, 0, 26.5], [23.5, 0, 26.5], [25.5, 0, 26.5], [15.5, 0, 28], [24.5, 0, 28], [16, 0, 23.5], [24, 0, 23.5]],
  seekerSpawn: [20, 0, 12.5],
  lobbySpawns: [[15, 0, 26], [17, 0, 26], [23, 0, 26], [25, 0, 26], [15, 0, 27.5], [17, 0, 27.5], [23, 0, 27.5], [25, 0, 27.5]],
  lights,
};
