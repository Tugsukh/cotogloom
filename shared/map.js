// Phase 1 test room. Replaced by the full building in phase 2.
const boxes = [];
const box = (x0, y0, z0, x1, y1, z1, mat = 'wall') =>
  boxes.push({ min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)], mat });

box(-1, -0.2, -1, 21, 0, 21, 'floor');
box(-0.2, 0, 0, 0, 3, 20); box(20, 0, 0, 20.2, 3, 20);
box(0, 0, -0.2, 20, 3, 0); box(0, 0, 20, 20, 3, 20.2);
box(8, 0.92, 8, 12, 1.0, 10, 'wood');

export const MAP = {
  name: 'Test room',
  bounds: { min: [0, 0, 0], max: [20, 3, 20] },
  boxes,
  spawns: [[4, 0, 4], [6, 0, 4], [8, 0, 4], [10, 0, 4], [12, 0, 4], [14, 0, 4], [16, 0, 4], [4, 0, 6]],
  seekerSpawn: [10, 0, 15],
  lobbySpawns: [[4, 0, 4], [6, 0, 4], [8, 0, 4], [10, 0, 4]],
  stations: [],
  exit: { pos: [0.1, 0, 10], normal: [1, 0, 0], width: 1.4, height: 2.4 },
  lights: [{ pos: [10, 2.7, 10], color: '#ffe2b0' }],
};
