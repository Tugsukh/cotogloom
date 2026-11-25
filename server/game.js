// Authoritative game state. One lobby per server.
import { CONFIG, bodyHeight, eyeHeight } from '../shared/config.js';
import { MAP } from '../shared/map.js';
import { TASKS, rollStationTasks, randomCode } from './tasks.js';
import { moveBody, overlapsAny, groundHeight, lineOfSight, distToBody } from '../shared/collision.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;

export class Game {
  constructor(io, { testMode = false } = {}) {
    this.io = io;
    this.testMode = testMode;
    this.players = new Map();      // socket.id -> player (joined only)
    this.order = [];               // join order of ids (host = first)
    this.settings = { ...CONFIG.DEFAULT_SETTINGS };
    this.phase = 'lobby';          // lobby | hiding | seeking | ended
    this.round = null;
    this.lastSeekerId = null;
    this.tickHandle = setInterval(() => this.tick(), 1000 / CONFIG.TICK_RATE);
  }

  stop() { clearInterval(this.tickHandle); }

  // ------------------------------------------------------------------ connection
  attach(socket) {
    socket.emit('hello', { id: socket.id, testMode: this.testMode });
    socket.emit('lobby', this.lobbyState());
    socket.on('join', (d, ack) => this.onJoin(socket, d, ack));
    socket.on('ready', (v) => this.onReady(socket, v));
    socket.on('settings', (s) => this.onSettings(socket, s));
    socket.on('start', (ack) => this.onStart(socket, ack));
    socket.on('move', (d) => this.onMove(socket, d));
    socket.on('catch', (d, ack) => this.onCatch(socket, d, ack));
    socket.on('playAgain', () => this.onPlayAgain(socket));
    socket.on('backToLobby', () => this.onBackToLobby(socket));
    socket.on('task:open', (d, ack) => this.onTaskOpen(socket, d, ack));
    socket.on('task:submit', (d, ack) => this.onTaskSubmit(socket, d, ack));
    socket.on('task:close', () => { const p = this.players.get(socket.id); if (p) p.activeTask = null; });
    socket.on('disconnect', () => this.onLeave(socket));
    if (this.testMode) this.attachDebug(socket);
  }

  attachDebug(socket) {
    socket.on('debug:teleport', (d) => {
      const p = this.players.get(socket.id); if (!p) return;
      this.teleport(p, [d.x, d.y, d.z], d.yaw ?? p.yaw);
      if (typeof d.crouch === 'boolean') p.crouch = d.crouch;
      if (typeof d.yaw === 'number') p.yaw = d.yaw;
    });
    socket.on('debug:state', (ack) => typeof ack === 'function' && ack(this.debugState()));
    // force station task types (in station order, cycling) so tests can reach every type
    socket.on('debug:forceTypes', (d) => {
      if (!this.round || !Array.isArray(d?.types)) return;
      this.round.stations.forEach((st, i) => {
        st.type = d.types[i % d.types.length];
        st.code = st.type === 'codelock' ? randomCode() : null;
      });
      for (const p of this.players.values()) this.sendRound(p);
    });
    // shorten the current phase to `seconds`
    socket.on('debug:setTime', (d) => { if (this.round) this.round.phaseEndsAt = Date.now() + (+d.seconds || 0) * 1000; });
  }

  debugState() {
    return {
      phase: this.phase,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, pos: p.pos, role: p.role, status: p.status })),
    };
  }

  // ------------------------------------------------------------------ lobby
  get hostId() { return this.order[0] ?? null; }

  lobbyState() {
    return {
      phase: this.phase,
      hostId: this.hostId,
      settings: this.settings,
      players: this.order.map((id) => {
        const p = this.players.get(id);
        return { id, name: p.name, color: p.color, ready: p.ready, role: p.role, status: p.status };
      }),
      maxPlayers: CONFIG.MAX_PLAYERS,
      stationCount: MAP.stations.length,
    };
  }

  broadcastLobby() { this.io.emit('lobby', this.lobbyState()); }

  onJoin(socket, d = {}, ack) {
    const reply = (r) => typeof ack === 'function' && ack(r);
    if (this.players.has(socket.id)) return reply({ ok: false, error: 'Already joined' });
    if (this.players.size >= CONFIG.MAX_PLAYERS) return reply({ ok: false, error: 'Lobby is full' });
    let name = String(d.name ?? '').replace(/[<>]/g, '').trim().slice(0, CONFIG.NAME_MAX_LENGTH);
    if (!name) name = 'Player' + (this.players.size + 1);
    const taken = new Set([...this.players.values()].map((p) => p.color));
    let color = CONFIG.COLORS.includes(d.color) && !taken.has(d.color) ? d.color : CONFIG.COLORS.find((c) => !taken.has(c));

    const inRound = this.phase !== 'lobby';
    const spawn = MAP.lobbySpawns[this.players.size % MAP.lobbySpawns.length];
    const p = {
      id: socket.id, socket, name, color, ready: false,
      role: null, status: inRound ? 'spectator' : 'lobby',
      pos: [...spawn], yaw: 0, pitch: 0, crouch: false, sprint: false,
      vy: 0, lastMoveAt: Date.now(), tpSeq: 1,
      lastCatchAt: 0, tasksDone: new Set(), activeTask: null,
      caughtBy: null, outcomeAt: null,
    };
    this.players.set(socket.id, p);
    this.order.push(socket.id);
    reply({ ok: true, id: socket.id, color, name });
    socket.emit('teleport', { pos: p.pos, yaw: p.yaw, seq: p.tpSeq });
    if (inRound) { this.sendRound(p); this.sendYou(p); }
    if (this.phase === 'ended' && this.results) socket.emit('results', this.results);
    this.broadcastLobby();
  }

  onReady(socket, v) {
    const p = this.players.get(socket.id);
    if (!p || this.phase !== 'lobby') return;
    p.ready = !!v;
    this.broadcastLobby();
  }

  onSettings(socket, s = {}) {
    if (socket.id !== this.hostId || this.phase !== 'lobby') return;
    const st = this.settings;
    if (Number.isFinite(+s.roundTime)) st.roundTime = clamp(Math.round(+s.roundTime), ...CONFIG.ROUND_TIME_RANGE);
    if (Number.isFinite(+s.hideTime)) st.hideTime = clamp(Math.round(+s.hideTime), ...CONFIG.HIDE_TIME_RANGE);
    if (Number.isFinite(+s.tasksNeeded)) {
      const maxTasks = Math.max(1, Math.min(CONFIG.TASKS_NEEDED_RANGE[1], MAP.stations.length || CONFIG.TASKS_NEEDED_RANGE[1]));
      st.tasksNeeded = clamp(Math.round(+s.tasksNeeded), CONFIG.TASKS_NEEDED_RANGE[0], maxTasks);
    }
    if (s.seekerMode === 'random' || s.seekerMode === 'chosen') st.seekerMode = s.seekerMode;
    if ('seekerId' in s) st.seekerId = this.players.has(s.seekerId) ? s.seekerId : null;
    this.broadcastLobby();
  }

  canStart() {
    const ps = [...this.players.values()];
    return this.phase === 'lobby' && ps.length >= CONFIG.MIN_PLAYERS && ps.every((p) => p.ready);
  }

  onStart(socket, ack) {
    const reply = (r) => typeof ack === 'function' && ack(r);
    if (socket.id !== this.hostId) return reply({ ok: false, error: 'Only the host can start' });
    if (!this.canStart()) return reply({ ok: false, error: 'Need 2+ players and everyone ready' });
    let seekerId;
    if (this.settings.seekerMode === 'chosen' && this.players.has(this.settings.seekerId)) seekerId = this.settings.seekerId;
    else seekerId = this.order[Math.floor(Math.random() * this.order.length)];
    this.startRound(seekerId);
    reply({ ok: true });
  }

  // ------------------------------------------------------------------ round
  startRound(seekerId) {
    const now = Date.now();
    this.lastSeekerId = seekerId;
    this.phase = 'hiding';
    this.round = {
      seekerId,
      startedAt: now,
      phaseEndsAt: now + this.settings.hideTime * 1000,
      seekStartedAt: null,
      hiderIds: [],
      tasksNeeded: this.settings.tasksNeeded,
      departed: [],   // players who left mid-round (for the results screen)
      stations: rollStationTasks(MAP.stations),
      catches: 0,
      over: false,
    };
    let i = 0;
    for (const id of this.order) {
      const p = this.players.get(id);
      p.ready = false;
      p.crouch = false; p.sprint = false;
      p.tasksDone = new Set(); p.activeTask = null; p.caughtBy = null; p.outcomeAt = null;
      if (id === seekerId) {
        p.role = 'seeker'; p.status = 'alive';
        this.teleport(p, MAP.seekerSpawn, Math.PI);
      } else {
        p.role = 'hider'; p.status = 'alive';
        this.round.hiderIds.push(id);
        this.teleport(p, MAP.spawns[i++ % MAP.spawns.length], 0);
      }
    }
    for (const p of this.players.values()) { this.sendRound(p); this.sendYou(p); }
    this.broadcastLobby();
  }

  roundInfo() {
    return {
      phase: this.phase,
      seekerId: this.round?.seekerId ?? null,
      tasksNeeded: this.round?.tasksNeeded ?? this.settings.tasksNeeded,
      settings: this.settings,
      // codes are public: they are painted on signs in the 3D world
      stations: (this.round?.stations ?? []).map((s) => ({ id: s.id, type: s.type, code: s.code })),
    };
  }

  sendYou(p) {
    const needed = this.round?.tasksNeeded ?? this.settings.tasksNeeded;
    p.socket.emit('you', { tasksDone: [...p.tasksDone], needed, unlocked: p.role === 'hider' && p.tasksDone.size >= needed });
  }

  // ------------------------------------------------------------------ tasks
  stationInReach(p, def) {
    return Math.hypot(p.pos[0] - def.pos[0], p.pos[2] - def.pos[2]) <= CONFIG.TASK_DISTANCE && Math.abs(p.pos[1] - def.pos[1]) < 1.0;
  }

  onTaskOpen(socket, d = {}, ack) {
    const reply = (r) => typeof ack === 'function' && ack(r);
    const p = this.players.get(socket.id);
    if (!p || !this.round || (this.phase !== 'hiding' && this.phase !== 'seeking')) return reply({ ok: false, error: 'No round running' });
    if (p.role !== 'hider' || p.status !== 'alive') return reply({ ok: false, error: 'Only hiders do tasks' });
    const def = MAP.stations.find((s) => s.id === d.stationId);
    const st = this.round.stations.find((s) => s.id === d.stationId);
    if (!def || !st) return reply({ ok: false, error: 'No such station' });
    if (p.tasksDone.has(st.id)) return reply({ ok: false, error: 'Already done' });
    if (!this.stationInReach(p, def)) return reply({ ok: false, error: 'Too far from the station' });
    const t = TASKS[st.type].create({ station: st });
    p.activeTask = { stationId: st.id, type: st.type, data: t.data, secret: t.secret };
    reply({ ok: true, type: st.type, data: t.data });
  }

  onTaskSubmit(socket, d = {}, ack) {
    const reply = (r) => typeof ack === 'function' && ack(r);
    const p = this.players.get(socket.id);
    const task = p?.activeTask;
    if (!task || p.status !== 'alive' || (this.phase !== 'hiding' && this.phase !== 'seeking')) return reply({ result: 'error', message: 'No task open' });
    const st = this.round.stations.find((s) => s.id === task.stationId);
    const def = MAP.stations.find((s) => s.id === task.stationId);
    if (!this.stationInReach(p, def)) { p.activeTask = null; return reply({ result: 'error', message: 'Too far from the station' }); }
    const r = TASKS[task.type].check(task, d.answer, { station: st });
    if (r.result === 'complete') {
      p.tasksDone.add(task.stationId);
      p.activeTask = null;
      this.sendYou(p);
      this.broadcastLobby();
    }
    reply(r);
  }

  sendRound(p) { p.socket.emit('round', this.roundInfo()); }

  timeLeft() {
    if (!this.round || (this.phase !== 'hiding' && this.phase !== 'seeking')) return 0;
    return Math.max(0, (this.round.phaseEndsAt - Date.now()) / 1000);
  }

  // ------------------------------------------------------------------ movement
  teleport(p, pos, yaw = 0) {
    p.pos = [pos[0], pos[1], pos[2]];
    p.yaw = yaw; p.vy = 0;
    p.lastMoveAt = Date.now();
    p.tpSeq++;
    p.socket.emit('teleport', { pos: p.pos, yaw, seq: p.tpSeq });
  }

  correct(p) {
    p.tpSeq++;
    p.lastMoveAt = Date.now();
    p.socket.emit('correct', { pos: p.pos, seq: p.tpSeq });
  }

  /** Can this player move right now? */
  canMove(p) {
    if (p.status !== 'alive' && p.status !== 'lobby') return false;
    if (this.phase === 'ended') return false;
    if (this.phase === 'hiding' && p.role === 'seeker') return false;
    if (p.activeTask) return false;
    return true;
  }

  onMove(socket, d) {
    const p = this.players.get(socket.id);
    if (!p || !d || typeof d !== 'object') return;
    if (d.seq !== p.tpSeq) return; // stale packet from before a teleport/correction
    const x = +d.x, y = +d.y, z = +d.z;
    if (![x, y, z].every(Number.isFinite)) return;
    if (Number.isFinite(+d.yaw)) p.yaw = +d.yaw;
    if (Number.isFinite(+d.pitch)) p.pitch = clamp(+d.pitch, -1.6, 1.6);
    p.sprint = !!d.sprint;

    const now = Date.now();
    const [ox, oy, oz] = p.pos;
    const horiz = Math.hypot(x - ox, z - oz);

    if (!this.canMove(p)) {
      if (horiz > 0.05 || Math.abs(y - oy) > 0.3) this.correct(p);
      return;
    }

    const wantCrouch = !!d.crouch;
    // Standing up under a low ceiling is not allowed.
    let crouch = wantCrouch;
    if (!wantCrouch && p.crouch && overlapsAny(x, y, z, CONFIG.HEIGHT_STAND, MAP.boxes)) crouch = true;
    const h = bodyHeight(crouch);

    const dt = clamp((now - p.lastMoveAt) / 1000, 0.03, 1.0);
    const maxSpeed = CONFIG.SPRINT_SPEED * (p.role === 'seeker' ? CONFIG.SEEKER_SPEED_MULT : 1);
    const allowed = maxSpeed * CONFIG.SPEED_TOLERANCE * dt + CONFIG.MOVE_SLACK;

    let bad = null;
    if (horiz > allowed) bad = 'speed';
    else if (overlapsAny(x, y, z, h, MAP.boxes, CONFIG.PLAYER_RADIUS - 0.05)) bad = 'inside';
    else {
      // Re-simulate the horizontal move with the shared physics: walls must stop you.
      const s = { x: ox, y: oy, z: oz, vy: 0, onGround: true };
      moveBody(s, x - ox, z - oz, 0, h, MAP.boxes, false);
      if (Math.hypot(s.x - x, s.z - z) > CONFIG.WALL_TOLERANCE) bad = 'wall';
      else {
        const g = groundHeight(x, z, y + 0.05, MAP.boxes);
        if (y - g > CONFIG.FLY_TOLERANCE && y > oy + 0.02) bad = 'fly';
      }
    }
    if (bad) {
      p.rejects = (p.rejects ?? 0) + 1;
      this.correct(p);
      return;
    }
    p.pos = [x, y, z];
    p.crouch = crouch;
    p.lastMoveAt = now;
    this.afterMove(p);
  }

  /** Escape: a hider with enough tasks done walks into the exit door. */
  afterMove(p) {
    if (!this.round || (this.phase !== 'hiding' && this.phase !== 'seeking')) return;
    if (p.role !== 'hider' || p.status !== 'alive' || p.tasksDone.size < this.round.tasksNeeded) return;
    const ex = MAP.exit.pos;
    if (Math.hypot(p.pos[0] - ex[0], p.pos[2] - ex[2]) > CONFIG.EXIT_DISTANCE || p.pos[1] > ex[1] + 1) return;
    p.status = 'escaped';
    p.outcomeAt = this.elapsed();
    p.activeTask = null;
    this.io.emit('event', { kind: 'escaped', id: p.id, name: p.name });
    this.broadcastLobby();
    this.checkWin();
  }

  // ------------------------------------------------------------------ catching
  /** Server-side catch check: range, line of sight and facing. Returns the caught hider or null. */
  findCatchTarget(seeker, yaw) {
    const eye = [seeker.pos[0], seeker.pos[1] + eyeHeight(seeker.crouch), seeker.pos[2]];
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bestD = Infinity;
    for (const h of this.players.values()) {
      if (h.role !== 'hider' || h.status !== 'alive') continue;
      const hh = bodyHeight(h.crouch);
      const d = distToBody(eye, h.pos[0], h.pos[1], h.pos[2], hh);
      if (d > CONFIG.CATCH_DISTANCE) continue;
      // facing (horizontal): hider must be in front of the seeker
      const vx = h.pos[0] - seeker.pos[0], vz = h.pos[2] - seeker.pos[2];
      const hl = Math.hypot(vx, vz);
      if (hl > CONFIG.PLAYER_RADIUS && (vx * fx + vz * fz) / hl < CONFIG.CATCH_FACING_DOT) continue;
      // line of sight to the body centre or the head
      const targets = [[h.pos[0], h.pos[1] + hh * 0.5, h.pos[2]], [h.pos[0], h.pos[1] + hh - 0.1, h.pos[2]]];
      if (!targets.some((t) => lineOfSight(eye, t, MAP.boxes))) continue;
      if (d < bestD) { bestD = d; best = h; }
    }
    return best;
  }

  onCatch(socket, d = {}, ack) {
    const reply = (r) => typeof ack === 'function' && ack(r);
    const s = this.players.get(socket.id);
    if (!s || this.phase !== 'seeking' || s.role !== 'seeker' || s.status !== 'alive') return reply({ ok: false, error: 'not allowed' });
    const now = Date.now();
    if (now - s.lastCatchAt < CONFIG.CATCH_COOLDOWN_MS) return reply({ ok: false, error: 'cooldown' });
    s.lastCatchAt = now;
    const yaw = Number.isFinite(+d.yaw) ? +d.yaw : s.yaw;
    const h = this.findCatchTarget(s, yaw);
    if (!h) return reply({ ok: false, error: 'miss' });
    h.status = 'caught';
    h.caughtBy = s.name;
    h.outcomeAt = this.elapsed();
    h.activeTask = null;
    this.round.catches++;
    reply({ ok: true, id: h.id, name: h.name });
    this.io.emit('event', { kind: 'caught', hiderId: h.id, hiderName: h.name, seekerId: s.id, seekerName: s.name });
    this.broadcastLobby();
    this.checkWin();
  }

  /** Seconds since the seeking phase started (0 during hiding). */
  elapsed() {
    if (!this.round?.seekStartedAt) return 0;
    return Math.round((Date.now() - this.round.seekStartedAt) / 1000);
  }

  // ------------------------------------------------------------------ win conditions
  hiderCounts() {
    let total = 0, escaped = 0, caught = 0, alive = 0;
    for (const id of this.round?.hiderIds ?? []) {
      const p = this.players.get(id);
      if (!p) continue;      // left the game: no longer counts
      total++;
      if (p.status === 'escaped') escaped++;
      else if (p.status === 'caught') caught++;
      else if (p.status === 'alive') alive++;
    }
    return { total, escaped, caught, alive, needed: Math.ceil(total / 2) };
  }

  /** Hiders win if at least half of them escape; the seeker wins when that becomes impossible or time runs out. */
  checkWin() {
    if (!this.round || this.round.over || (this.phase !== 'hiding' && this.phase !== 'seeking')) return;
    const c = this.hiderCounts();
    if (c.total === 0) return this.endRound('seeker', 'No hiders left');
    if (c.escaped >= c.needed) return this.endRound('hiders', `${c.escaped} of ${c.total} hiders escaped`);
    if (c.escaped + c.alive < c.needed) {
      return this.endRound('seeker', c.alive === 0 ? 'Every hider was caught' : 'Not enough hiders can escape anymore');
    }
  }

  endRound(winner, reason) {
    if (!this.round || this.round.over) return;
    this.round.over = true;
    this.phase = 'ended';
    const roundTime = this.round.seekStartedAt ? (Date.now() - this.round.seekStartedAt) / 1000 : 0;
    const players = [];
    for (const id of this.order) {
      const p = this.players.get(id);
      if (!p.role) continue; // spectators who joined mid-round
      players.push({
        id, name: p.name, color: p.color, role: p.role, status: p.status,
        caughtBy: p.caughtBy, at: p.outcomeAt, tasks: p.tasksDone.size,
        catches: p.role === 'seeker' ? this.round.catches : undefined,
      });
    }
    players.push(...this.round.departed);
    for (const p of this.players.values()) { p.activeTask = null; p.ready = false; }
    this.results = { winner, reason, roundTime, players, seekerId: this.round.seekerId };
    this.io.emit('results', this.results);
    this.broadcastLobby();
  }

  /** Host: start the next round right away; the seeker rotates to the next player in join order. */
  onPlayAgain(socket) {
    if (socket.id !== this.hostId || this.phase !== 'ended') return;
    if (this.players.size < CONFIG.MIN_PLAYERS) {
      this.resetToLobby(); this.broadcastLobby();
      socket.emit('event', { kind: 'info', text: 'Need at least 2 players — back to the lobby' });
      return;
    }
    const i = this.order.indexOf(this.lastSeekerId);
    const next = this.order[(i + 1) % this.order.length]; // i === -1 (seeker left) -> first player
    this.startRound(next);
  }

  onBackToLobby(socket) {
    if (socket.id !== this.hostId || this.phase !== 'ended') return;
    this.resetToLobby();
    let k = 0;
    for (const id of this.order) this.teleport(this.players.get(id), MAP.lobbySpawns[k++ % MAP.lobbySpawns.length], 0);
    this.broadcastLobby();
  }

  // ------------------------------------------------------------------ leaving
  onLeave(socket) {
    const p = this.players.get(socket.id);
    if (!p) return;
    this.players.delete(socket.id);
    this.order = this.order.filter((id) => id !== socket.id);
    if (this.settings.seekerId === socket.id) this.settings.seekerId = null;
    this.io.emit('left', { id: socket.id, name: p.name });
    if (this.players.size === 0) { this.resetToLobby(); return; }
    if (this.round && !this.round.over && (this.phase === 'hiding' || this.phase === 'seeking') && p.role) {
      this.round.departed.push({ id: p.id, name: p.name, color: p.color, role: p.role, status: 'left', tasks: p.tasksDone.size });
      if (p.role === 'seeker') this.endRound('hiders', 'Seeker left');
      else this.checkWin();
    }
    this.broadcastLobby();
  }

  resetToLobby() {
    this.phase = 'lobby';
    this.round = null;
    this.results = null;
    for (const p of this.players.values()) {
      p.role = null; p.status = 'lobby'; p.ready = false; p.activeTask = null;
    }
  }

  // ------------------------------------------------------------------ tick
  tick() {
    if (this.round && (this.phase === 'hiding') && Date.now() >= this.round.phaseEndsAt) {
      this.phase = 'seeking';
      this.round.seekStartedAt = Date.now();
      this.round.phaseEndsAt = Date.now() + this.settings.roundTime * 1000;
      for (const p of this.players.values()) this.sendRound(p);
    }
    if (this.round && this.phase === 'seeking' && Date.now() >= this.round.phaseEndsAt) {
      this.endRound('seeker', 'Time ran out');
    }
    if (this.players.size === 0) return;
    const snap = {
      t: Date.now(),
      phase: this.phase,
      timeLeft: r2(this.timeLeft()),
      players: [],
    };
    for (const p of this.players.values()) {
      snap.players.push({
        id: p.id, x: r2(p.pos[0]), y: r2(p.pos[1]), z: r2(p.pos[2]),
        yaw: r2(p.yaw), pitch: r2(p.pitch), c: p.crouch ? 1 : 0, s: p.sprint ? 1 : 0, st: p.status,
      });
    }
    this.io.emit('snap', snap);
  }
}

export { eyeHeight };
