// Bot test suite: spawns its own server in test mode and drives fake players with socket.io-client.
// Usage: node tests/bots.mjs            (all phases)
//        node tests/bots.mjs 1 3        (only some phases)
import { spawn } from 'child_process';
import { io } from 'socket.io-client';
import path from 'path';
import { fileURLToPath } from 'url';

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

// ------------------------------------------------------------------ run
const PHASES = { 1: phase1 };
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
