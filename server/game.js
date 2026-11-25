// Authoritative game state. One lobby per server.
import { CONFIG, bodyHeight, eyeHeight } from '../shared/config.js';
import { MAP } from '../shared/map.js';
import { moveBody, overlapsAny, groundHeight } from '../shared/collision.js';

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
    if (inRound) this.sendRound(p);
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
    for (const p of this.players.values()) this.sendRound(p);
    this.broadcastLobby();
  }

  roundInfo() {
    return {
      phase: this.phase,
      seekerId: this.round?.seekerId ?? null,
      tasksNeeded: this.round?.tasksNeeded ?? this.settings.tasksNeeded,
      settings: this.settings,
    };
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

  afterMove(_p) { /* phase 4: escape check */ }

  // ------------------------------------------------------------------ leaving
  onLeave(socket) {
    const p = this.players.get(socket.id);
    if (!p) return;
    this.players.delete(socket.id);
    this.order = this.order.filter((id) => id !== socket.id);
    if (this.settings.seekerId === socket.id) this.settings.seekerId = null;
    this.io.emit('left', { id: socket.id, name: p.name });
    if (this.players.size === 0) this.resetToLobby();
    this.broadcastLobby();
  }

  resetToLobby() {
    this.phase = 'lobby';
    this.round = null;
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
