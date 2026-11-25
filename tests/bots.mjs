// Bot test suite: spawns its own server in test mode and drives fake players with socket.io-client.
// Usage: node tests/bots.mjs            (all phases)
//        node tests/bots.mjs 1 3        (only some phases)
import { spawn } from 'child_process';
import { io } from 'socket.io-client';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../shared/config.js';
import { MAP } from '../shared/map.js';
import { moveBody, canStand, lineOfSight } from '../shared/collision.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log(`  \x1b[32m✔\x1b[0m ${msg}`); }
  else { failed++; console.log(`  \x1b[31m✘ ${msg}\x1b[0m`); }
  return !!cond;
}

// ------------------------------------------------------------------ server
let server;
async function startServer() {
  server = spawn(process.execPath, [path.join(root, 'server/index.js')], {
    env: { ...process.env, PORT: String(PORT), HS_TEST: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errOut = '';
  server.stderr.on('data', (d) => { errOut += d; process.stderr.write('[server] ' + d); });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 8000);
    server.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(t); resolve(); } });
    server.on('exit', (c) => reject(new Error('server exited ' + c + errOut)));
  });
}

// ------------------------------------------------------------------ bot
export class Bot {
  constructor(name, color) {
    this.name = name; this.color = color;
    this.lobby = null; this.snap = null; this.round = null; this.you = null; this.results = null;
    this.seq = 0; this.pos = [0, 0, 0]; this.corrections = 0; this.events = [];
  }
  connect() {
    this.s = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false });
    this.s.on('lobby', (l) => { this.lobby = l; });
    this.s.on('snap', (s) => { this.snap = s; });
    this.s.on('round', (r) => { this.round = r; });
    this.s.on('you', (y) => { this.you = y; });
    this.s.on('results', (r) => { this.results = r; });
    this.s.on('event', (e) => this.events.push(e));
    this.s.on('teleport', (d) => { this.seq = d.seq; this.pos = [...d.pos]; });
    this.s.on('correct', (d) => { this.seq = d.seq; this.pos = [...d.pos]; this.corrections++; });
    return new Promise((r) => this.s.on('connect', () => { this.id = this.s.id; r(); }));
  }
  ack(ev, data) {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve({ timeout: true }), 3000);
      const cb = (r) => { clearTimeout(t); resolve(r); };
      if (data === undefined) this.s.emit(ev, cb); else this.s.emit(ev, data, cb);
    });
  }
  emit(ev, data) { this.s.emit(ev, data); }
  async join() { const r = await this.ack('join', { name: this.name, color: this.color }); await sleep(80); return r; }
  waitFor(ev, pred = () => true, ms = 3000) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.s.off(ev, h); resolve(null); }, ms);
      const h = (d) => { if (pred(d)) { clearTimeout(t); this.s.off(ev, h); resolve(d); } };
      this.s.on(ev, h);
    });
  }
  move(x, y, z, extra = {}) {
    this.s.emit('move', { x, y, z, yaw: extra.yaw ?? 0, pitch: extra.pitch ?? 0, crouch: !!extra.crouch, sprint: !!extra.sprint, seq: this.seq });
  }
  /** Walk legitimately in a straight line at `speed` m/s, 20 Hz. */
  async walkTo(x, z, { speed = 3.5, y = null, crouch = false, yaw } = {}) {
    const [sx, sy, sz] = this.pos;
    const dist = Math.hypot(x - sx, z - sz);
    const steps = Math.max(1, Math.ceil(dist / (speed / 20)));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const p = [sx + (x - sx) * k, y ?? sy, sz + (z - sz) * k];
      this.move(p[0], p[1], p[2], { crouch, yaw: yaw ?? Math.atan2(-(x - sx), -(z - sz)) });
      this.pos = p;
      await sleep(50);
    }
    await sleep(60);
  }
  /** Walk using the real shared physics (like the browser does), sending 20 Hz updates. */
  async walkSim(dirX, dirZ, seconds, { speed = CONFIG.WALK_SPEED, crouch = false } = {}) {
    const st = { x: this.pos[0], y: this.pos[1], z: this.pos[2], vy: 0, onGround: true };
    const h = crouch ? CONFIG.HEIGHT_CROUCH : CONFIG.HEIGHT_STAND;
    const len = Math.hypot(dirX, dirZ) || 1;
    const dt = 1 / 60;
    let acc = 0;
    for (let t = 0; t < seconds; t += dt) {
      moveBody(st, dirX / len * speed * dt, dirZ / len * speed * dt, dt, h, MAP.boxes);
      acc += dt;
      if (acc >= 0.05) { acc = 0; this.move(st.x, st.y, st.z, { crouch }); this.pos = [st.x, st.y, st.z]; await sleep(50); }
    }
    this.move(st.x, st.y, st.z, { crouch }); this.pos = [st.x, st.y, st.z];
    await sleep(80);
    return st;
  }
  async teleport(x, y, z, yaw = 0, crouch) {
    const w = this.waitFor('teleport');
    this.emit('debug:teleport', { x, y, z, yaw, crouch });
    await w;
  }
  serverPos(id = this.id) { return this.snap?.players.find((p) => p.id === id); }
  close() { this.s?.close(); }
}

async function makeBots(n, names = ['Alice', 'Bob', 'Cara', 'Dan', 'Eve']) {
  const colors = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231'];
  const bots = [];
  for (let i = 0; i < n; i++) { const b = new Bot(names[i], colors[i]); await b.connect(); bots.push(b); }
  return bots;
}

// ================================================================== PHASE 1
async function phase1() {
  console.log('\nPhase 1 — lobby, host, ready, start, movement sync');
  const [a, b, c] = await makeBots(3);
  const ra = await a.join(); const rb = await b.join(); const rc = await c.join();
  check(ra.ok && rb.ok && rc.ok, '3 bots joined');
  await sleep(100);
  check(a.lobby.players.length === 3, 'lobby lists 3 players');
  check(a.lobby.hostId === a.id, 'first player is host');
  check(new Set(a.lobby.players.map((p) => p.color)).size === 3, 'colors are unique');

  // duplicate color gets reassigned
  const d = new Bot('Dupe', '#e6194b'); await d.connect(); const rd = await d.join();
  check(rd.ok && rd.color !== '#e6194b', 'taken color is reassigned');
  d.close(); await sleep(150);

  // settings: host only
  b.emit('settings', { roundTime: 999 }); await sleep(100);
  check(a.lobby.settings.roundTime === 300, 'non-host cannot change settings');
  a.emit('settings', { roundTime: 120, hideTime: 10, tasksNeeded: 2 }); await sleep(100);
  check(b.lobby.settings.roundTime === 120 && b.lobby.settings.hideTime === 10, 'host changes settings, everyone sees them');
  a.emit('settings', { hideTime: 1 }); await sleep(100);
  check(a.lobby.settings.hideTime === 5, 'settings are clamped to valid ranges');

  // movement sync in the lobby phase
  await sleep(100);
  const start = [...a.pos];
  await a.walkTo(start[0] + 1.5, start[2] + 1.0);
  await sleep(150);
  const seen = b.serverPos(a.id);
  check(seen && Math.abs(seen.x - (start[0] + 1.5)) < 0.05 && Math.abs(seen.z - (start[2] + 1)) < 0.05, 'other players see the walk in snapshots');

  // speed hack -> correction
  const before = a.corrections;
  const w = a.waitFor('correct');
  a.move(a.pos[0] + 8, a.pos[1], a.pos[2]);
  await w;
  check(a.corrections === before + 1, 'impossible speed is rejected with a position correction');
  await sleep(100);
  const after = b.serverPos(a.id);
  check(after && Math.abs(after.x - (start[0] + 1.5)) < 0.05, 'server kept the last valid position');

  // starting rules
  let r = await a.ack('start');
  check(!r.ok, 'cannot start while players are not ready');
  for (const x of [a, b, c]) x.emit('ready', true);
  await sleep(150);
  r = await b.ack('start');
  check(!r.ok, 'non-host cannot start');
  const roundWait = c.waitFor('round');
  r = await a.ack('start');
  check(r.ok, 'host starts when everyone is ready');
  const round = await roundWait;
  check(round && round.phase === 'hiding', 'round begins with the hiding phase');
  await sleep(100);
  const seekers = c.lobby.players.filter((p) => p.role === 'seeker');
  check(seekers.length === 1 && c.lobby.players.filter((p) => p.role === 'hider').length === 2, 'exactly 1 seeker and 2 hiders');

  // host migration
  a.close(); await sleep(300);
  check(b.lobby.hostId === b.id, 'when the host leaves, the next player becomes host');
  for (const x of [b, c]) x.close();
  await sleep(300);
}

// ================================================================== PHASE 2
function simulate(start, dir, seconds, crouch = false, speed = CONFIG.WALK_SPEED) {
  const st = { x: start[0], y: start[1], z: start[2], vy: 0, onGround: true };
  const h = crouch ? CONFIG.HEIGHT_CROUCH : CONFIG.HEIGHT_STAND;
  const len = Math.hypot(dir[0], dir[1]);
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) moveBody(st, dir[0] / len * speed * dt, dir[1] / len * speed * dt, dt, h, MAP.boxes);
  return st;
}

async function phase2() {
  console.log('\nPhase 2 — map, collision, stairs, crouching, anti-cheat walls');
  check(MAP.boxes.length > 150, `map has ${MAP.boxes.length} boxes`);
  check(MAP.stations.length >= 8 && MAP.stations.length <= 10, `${MAP.stations.length} task stations`);
  // every spawn must be free and on the ground
  const spawnsOk = [...MAP.spawns, MAP.seekerSpawn, ...MAP.lobbySpawns].every((p) => canStand(p[0], p[1] + 0.01, p[2], MAP.boxes));
  check(spawnsOk, 'all spawn points are free');
  // stations reachable: a free standing spot within task distance
  const reach = MAP.stations.every((s) => [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]].some(([dx, dz]) => canStand(s.pos[0] + dx, s.pos[1] + 0.01, s.pos[2] + dz, MAP.boxes)));
  check(reach, 'every station has free floor next to it');

  // falling + gravity: drop from 1.2 m lands on the floor
  const fall = simulate([20, 1.2, 26.5], [1, 0], 1.0);
  check(Math.abs(fall.y) < 0.01 && fall.onGround, 'gravity + landing on the floor');

  // stairs: walk from the atrium floor up the staircase to the balcony
  const up = simulate([12.8, 0, 20.8], [0, -1], 4.0);
  check(up.y > 3.15 && up.z < 10.3, `stairs climb to the mezzanine (y=${up.y.toFixed(2)}, z=${up.z.toFixed(2)})`);
  const down = simulate([12.8, 3.2, 9.5], [0, 1], 4.0);
  check(down.y < 0.05 && down.z > 19.5, `walk back down the stairs (y=${down.y.toFixed(2)})`);
  // the balcony railing holds you
  const rail = simulate([20, 3.2, 9], [0, 1], 2.0);
  check(rail.z < 9.7 && rail.y > 3.1, 'balcony railing blocks falling into the atrium');

  // crouch under the office desk at (5, 7.5) (spans z 6.9..8.1)
  const standing = simulate([5, 0, 9.4], [0, -1], 1.5);
  check(standing.z > 8.3, `standing player is blocked by the desk (z=${standing.z.toFixed(2)})`);
  const crouched = simulate([5, 0, 9.4], [0, -1], 1.2, true, CONFIG.CROUCH_SPEED);
  check(crouched.z < 7.8, `crouched player fits under the desk (z=${crouched.z.toFixed(2)})`);
  check(!canStand(5, 0, 7.5, MAP.boxes), 'cannot stand up under the desk');
  // walls
  const wall = simulate([8, 0, 5], [1, 0], 2);
  check(wall.x < 9.9 - 0.29 && wall.x > 9.5, 'walls stop movement');
  // line of sight through a wall is blocked, across an open room is clear
  check(!lineOfSight([5, 1.5, 5], [11, 1.5, 3], MAP.boxes), 'line of sight blocked by a wall');
  check(lineOfSight([3, 1.5, 5.2], [8, 1.5, 5.2], MAP.boxes), 'line of sight clear inside a room');

  // ---- server-side validation with a bot
  const [a, b] = await makeBots(2);
  await a.join(); await b.join();
  await sleep(150);
  // legit stair climb via physics: no corrections
  await a.teleport(12.8, 0, 20.8, 0);
  const c0 = a.corrections;
  await a.walkSim(0, -1, 3.6);
  await sleep(100);
  const sp = b.serverPos(a.id);
  check(a.corrections === c0 && sp && sp.y > 3.1, `server accepts a legit stair climb (corrections ${a.corrections - c0}, y=${sp?.y})`);
  // walking through a wall -> correction
  await a.teleport(9.5, 0, 3, 0);
  const c1 = a.corrections;
  for (let x = 9.6; x <= 10.9; x += 0.15) { a.move(x, 0, 3); await sleep(50); }
  await sleep(150);
  check(a.corrections > c1, 'server rejects walking through a wall');
  const pw = b.serverPos(a.id);
  check(pw && pw.x < 9.8, `server kept the player inside the room (x=${pw?.x})`);
  // flying -> correction
  await a.teleport(5, 0, 4.8, 0);
  const c2 = a.corrections;
  for (let y = 0.2; y <= 1.6; y += 0.2) { a.move(5, y, 4.8); await sleep(50); }
  await sleep(100);
  check(a.corrections > c2, 'server rejects flying');
  // standing up under a table is refused by the server (stays crouched)
  await a.teleport(5, 0, 7.5, 0, true);
  a.move(5, 0, 7.5, { crouch: false });
  await sleep(150);
  check(b.serverPos(a.id)?.c === 1, 'server keeps a player crouched under a table');
  a.close(); b.close();
  await sleep(300);
}

// ------------------------------------------------------------------ run
const PHASES = { 1: phase1, 2: phase2 };
const pick = process.argv.slice(2).map(Number).filter((n) => PHASES[n]);
(async () => {
  try {
    await startServer();
    for (const n of pick.length ? pick : Object.keys(PHASES).map(Number)) {
      await PHASES[n]();
    }
  } catch (e) {
    failed++;
    console.error(e);
  } finally {
    server?.kill('SIGTERM');
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
