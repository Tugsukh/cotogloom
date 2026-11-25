// Shared physics: the player is an axis-aligned box (radius x height) standing on its feet position.
// Used identically by the browser (prediction) and the server (validation).
import { CONFIG } from './config.js';

const EPS = 1e-4;

/** Return the first box overlapping the player box at (x,y,z), or null. */
export function overlapsAny(x, y, z, h, boxes, r = CONFIG.PLAYER_RADIUS) {
  const minX = x - r, maxX = x + r, minY = y, maxY = y + h, minZ = z - r, maxZ = z + r;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (maxX <= b.min[0] + EPS || minX >= b.max[0] - EPS) continue;
    if (maxZ <= b.min[2] + EPS || minZ >= b.max[2] - EPS) continue;
    if (maxY <= b.min[1] + EPS || minY >= b.max[1] - EPS) continue;
    return b;
  }
  return null;
}

/** All boxes overlapping the player box. */
export function overlapsList(x, y, z, h, boxes, r = CONFIG.PLAYER_RADIUS) {
  const out = [];
  const minX = x - r, maxX = x + r, minY = y, maxY = y + h, minZ = z - r, maxZ = z + r;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (maxX <= b.min[0] + EPS || minX >= b.max[0] - EPS) continue;
    if (maxZ <= b.min[2] + EPS || minZ >= b.max[2] - EPS) continue;
    if (maxY <= b.min[1] + EPS || minY >= b.max[1] - EPS) continue;
    out.push(b);
  }
  return out;
}

/** Highest box top under the player's footprint that is at or below `y` (+tolerance). */
export function groundHeight(x, z, y, boxes, r = CONFIG.PLAYER_RADIUS) {
  let best = -Infinity;
  const minX = x - r, maxX = x + r, minZ = z - r, maxZ = z + r;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (maxX <= b.min[0] + EPS || minX >= b.max[0] - EPS) continue;
    if (maxZ <= b.min[2] + EPS || minZ >= b.max[2] - EPS) continue;
    const top = b.max[1];
    if (top <= y + 0.01 && top > best) best = top;
  }
  return best;
}

/** True if a standing body fits at the position (used to stand up from a crouch). */
export function canStand(x, y, z, boxes) {
  return !overlapsAny(x, y, z, CONFIG.HEIGHT_STAND, boxes);
}

function moveHorizontal(s, axis, d, h, boxes, allowStep) {
  const nx = axis === 0 ? s.x + d : s.x;
  const nz = axis === 2 ? s.z + d : s.z;
  if (!overlapsAny(nx, s.y, nz, h, boxes)) { s.x = nx; s.z = nz; return true; }
  if (allowStep) {
    // Step up: the obstacle top must be within STEP_HEIGHT and there must be room above it.
    const hits = overlapsList(nx, s.y, nz, h, boxes);
    let top = -Infinity;
    for (const b of hits) top = Math.max(top, b.max[1]);
    const rise = top - s.y;
    if (rise > 0 && rise <= CONFIG.STEP_HEIGHT + EPS &&
        !overlapsAny(nx, top + EPS, nz, h, boxes) &&
        !overlapsAny(s.x, top + EPS, s.z, h, boxes)) {
      s.x = nx; s.z = nz; s.y = top + EPS; s.vy = 0; s.onGround = true;
      return true;
    }
  }
  return false;
}

/**
 * Advance a body by a horizontal displacement (dx, dz) and gravity over dt.
 * s = { x, y, z, vy, onGround }, h = current body height. Mutates and returns s.
 * Per-axis resolution with sub-steps (no tunnelling), step-up and ground snapping.
 */
export function moveBody(s, dx, dz, dt, h, boxes, gravity = true) {
  const wasGround = s.onGround;

  // ---- vertical
  if (gravity) s.vy = Math.max(s.vy - CONFIG.GRAVITY * dt, -CONFIG.MAX_FALL_SPEED);
  const dy = s.vy * dt;
  s.onGround = false;
  if (dy !== 0) {
    const ny = s.y + dy;
    const hits = overlapsList(s.x, ny, s.z, h, boxes);
    if (hits.length === 0) s.y = ny;
    else if (dy < 0) {
      let top = -Infinity;
      for (const b of hits) top = Math.max(top, b.max[1]);
      s.y = Math.min(s.y, top + EPS);
      s.vy = 0; s.onGround = true;
    } else {
      let bottom = Infinity;
      for (const b of hits) bottom = Math.min(bottom, b.min[1]);
      s.y = Math.max(s.y, bottom - h - EPS);
      s.vy = 0;
    }
  }

  // ---- horizontal, sub-stepped
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.08));
  const sx = dx / steps, sz = dz / steps;
  const allowStep = wasGround || s.onGround;
  let blockedX = false, blockedZ = false;
  for (let i = 0; i < steps; i++) {
    if (sx && !blockedX) blockedX = !moveHorizontal(s, 0, sx, h, boxes, allowStep);
    if (sz && !blockedZ) blockedZ = !moveHorizontal(s, 2, sz, h, boxes, allowStep);
  }

  // ---- ground snap (walking down stairs / off small ledges)
  if (!s.onGround && wasGround && s.vy <= 0) {
    const g = groundHeight(s.x, s.z, s.y, boxes);
    if (s.y - g <= CONFIG.GROUND_SNAP && !overlapsAny(s.x, g + EPS, s.z, h, boxes)) {
      s.y = g + EPS; s.vy = 0; s.onGround = true;
    }
  }
  return s;
}

/** Segment p->q vs AABB (slab test). Returns entry t in [0,1] or -1. */
export function segmentBox(p, q, b) {
  let tmin = 0, tmax = 1;
  for (let a = 0; a < 3; a++) {
    const d = q[a] - p[a];
    if (Math.abs(d) < 1e-9) {
      if (p[a] <= b.min[a] || p[a] >= b.max[a]) return -1;
    } else {
      let t1 = (b.min[a] - p[a]) / d, t2 = (b.max[a] - p[a]) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

/** True if nothing in `boxes` blocks the straight line between p and q. */
export function lineOfSight(p, q, boxes) {
  for (let i = 0; i < boxes.length; i++) {
    const t = segmentBox(p, q, boxes[i]);
    if (t >= 0 && t < 0.999) return false;
  }
  return true;
}

/** Closest distance from point p to the player body box at feet position (x,y,z). */
export function distToBody(p, x, y, z, h, r = CONFIG.PLAYER_RADIUS) {
  const cx = Math.max(x - r, Math.min(p[0], x + r));
  const cy = Math.max(y, Math.min(p[1], y + h));
  const cz = Math.max(z - r, Math.min(p[2], z + r));
  return Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz);
}
