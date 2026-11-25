// Client entry: networking, game loop, camera/spectator, glue between world, players, UI, tasks, audio.
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { CONFIG } from '/shared/config.js';
import { MAP } from '/shared/map.js';
import { buildWorld } from './world.js';
import { LocalPlayer } from './controls.js';
import { RemotePlayers } from './players.js';
import { UI, show, isShown, fmtTime } from './ui.js';
import { TASKS } from './tasks/index.js';
import { Audio } from './audio.js';

// ------------------------------------------------------------------ three.js setup
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 80);
scene.add(camera);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const world = buildWorld(scene);
const remote = new RemotePlayers(scene);
const local = new LocalPlayer(camera);
const controls = new PointerLockControls(camera, renderer.domElement);
const audio = new Audio();

// Personal lights carried by the local player (only this client renders them).
const hiderLight = new THREE.PointLight('#ffd9a0', 0, CONFIG.HIDER_LIGHT_DISTANCE, 1.5);
hiderLight.position.set(0, 0.1, 0);
camera.add(hiderLight);
const flashlight = new THREE.SpotLight('#fff4d6', 0, CONFIG.FLASHLIGHT_DISTANCE, CONFIG.FLASHLIGHT_ANGLE, 0.45, 1.2);
flashlight.position.set(0.15, -0.15, 0);
const flashTarget = new THREE.Object3D();
flashTarget.position.set(0.1, -0.1, -1);
camera.add(flashlight, flashTarget);
flashlight.target = flashTarget;

// ------------------------------------------------------------------ state
const G = {
  myId: null, joined: false, testMode: false,
  lobby: null, round: null,
  phase: 'lobby', timeLeft: 0,
  tasksDone: new Set(), unlocked: false,
  myStatus: 'lobby', myRole: null,
  tpSeq: 0,
  results: null,
  spectateId: null,
  taskOpen: null,     // { stationId, module }
  lastSend: 0,
  heartbeatAt: 0,
};
window.__game = G; // handy for debugging / headless checks

const keys = {};
const input = () => ({
  f: keys.KeyW || keys.ArrowUp, b: keys.KeyS || keys.ArrowDown,
  l: keys.KeyA || keys.ArrowLeft, r: keys.KeyD || keys.ArrowRight,
  sprint: keys.ShiftLeft || keys.ShiftRight,
  crouch: keys.KeyC || keys.ControlLeft || keys.ControlRight,
});

const ui = new UI({
  join: (name, color) => {
    audio.init();
    socket.emit('join', { name, color }, (r) => {
      if (!r?.ok) return ui.joinError(r?.error ?? 'Could not join');
      G.joined = true;
      G.myId = r.id;
      show('join', false);
      refreshScreens();
    });
  },
  ready: (v) => socket.emit('ready', v),
  settings: (s) => socket.emit('settings', s),
  start: () => socket.emit('start', (r) => { if (!r?.ok) ui.toast(r?.error ?? 'Cannot start'); }),
  walk: () => tryLock(),
  playAgain: () => socket.emit('playAgain'),
  backToLobby: () => socket.emit('backToLobby'),
  closeTask: () => closeTask(true),
});

// ------------------------------------------------------------------ networking
const socket = io();
G.socket = socket;

socket.on('hello', (d) => { G.myId = d.id; G.testMode = d.testMode; });
socket.on('lobby', (s) => {
  G.lobby = s;
  if (!G.joined) G.phase = s.phase;
  remote.setInfo(s.players);
  const me = s.players.find((p) => p.id === G.myId);
  if (me && G.joined) { G.myStatus = me.status; G.myRole = me.role; }
  ui.renderLobby(s, G.myId);
  refreshScreens();
});
socket.on('teleport', (d) => { G.tpSeq = d.seq; local.setPosition(d.pos, d.yaw); local.crouched = false; });
socket.on('correct', (d) => { G.tpSeq = d.seq; local.setPosition(d.pos); });
socket.on('snap', (snap) => {
  remote.pushSnapshot(snap, performance.now());
  G.timeLeft = snap.timeLeft;
  if (snap.phase !== G.phase) { G.phase = snap.phase; refreshScreens(); }
  const me = snap.players.find((p) => p.id === G.myId);
  if (me && me.st !== G.myStatus) {
    G.myStatus = me.st;
    if (me.st !== 'alive' && me.st !== 'lobby') closeTask(false);
    refreshScreens();
  }
});
socket.on('round', (r) => {
  const prevPhase = G.round?.phase;
  G.round = r;
  G.phase = r.phase;
  G.myRole = r.seekerId === G.myId ? 'seeker' : (G.myStatus === 'spectator' ? null : 'hider');
  world.setSigns(r.stations);
  if (r.phase === 'hiding' && prevPhase !== 'hiding') {
    G.tasksDone = new Set(); G.unlocked = false; G.results = null;
    for (const s of MAP.stations) world.setStationState(s.id, { done: false });
    world.setExitUnlocked(false);
    closeTask(false);
    if (G.myRole === 'seeker') ui.alert('You are the SEEKER', 2500);
    else if (G.myRole === 'hider') ui.alert('Hide! Do tasks, then escape.', 3000);
  }
  if (r.phase === 'seeking' && prevPhase === 'hiding') {
    ui.alert(G.myRole === 'seeker' ? 'GO! Find them.' : 'The seeker is coming…', 2500);
    audio.chime('start');
  }
  refreshScreens();
});
socket.on('you', (d) => {
  const wasUnlocked = G.unlocked;
  G.tasksDone = new Set(d.tasksDone);
  G.unlocked = d.unlocked;
  for (const s of MAP.stations) world.setStationState(s.id, { done: G.tasksDone.has(s.id) });
  world.setExitUnlocked(G.unlocked);
  if (G.unlocked && !wasUnlocked) { ui.alert('Door unlocked! Find the EXIT', 4000); audio.chime('unlock'); }
});
socket.on('event', (e) => {
  const name = (id, fallback) => G.lobby?.players.find((p) => p.id === id)?.name ?? fallback ?? '?';
  if (e.kind === 'caught') {
    ui.toast(`<b>${escapeHtml(e.hiderName)}</b> was caught by <b>${escapeHtml(e.seekerName)}</b>`);
    audio.chime('caught');
    if (e.hiderId === G.myId) ui.alert('You were caught!', 2500);
  } else if (e.kind === 'escaped') {
    ui.toast(`<b>${escapeHtml(e.name)}</b> escaped!`);
    audio.chime('escape');
    if (e.id === G.myId) ui.alert('You escaped!', 2500);
  } else if (e.kind === 'info') {
    ui.toast(escapeHtml(e.text));
  }
  void name;
});
socket.on('left', (d) => { ui.toast(`${escapeHtml(d.name)} left`); remote.remove(d.id); });
socket.on('results', (r) => {
  G.results = r;
  G.phase = 'ended';
  closeTask(false);
  if (controls.isLocked) controls.unlock();
  ui.renderEnd(r, G.myId, G.lobby?.hostId);
  audio.chime(r.winner === 'hiders' ? 'escape' : 'caught');
  refreshScreens();
});
socket.on('disconnect', () => ui.toast('Disconnected from server — reconnecting…'));
socket.on('connect', () => { if (G.joined) { G.joined = false; show('join', true); ui.joinError('Connection lost. Please join again.'); refreshScreens(); } });

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ------------------------------------------------------------------ screens
const inRound = () => G.phase === 'hiding' || G.phase === 'seeking';
const amPlaying = () => G.joined && inRound() && G.myStatus === 'alive';
const amSpectating = () => G.joined && inRound() && G.myStatus !== 'alive';
const seekerFrozen = () => G.phase === 'hiding' && G.myRole === 'seeker';

function refreshScreens() {
  const joined = G.joined;
  show('join', !joined);
  show('lobby', joined && G.phase === 'lobby' && !controls.isLocked);
  show('end', joined && G.phase === 'ended' && !!G.results);
  show('hud', joined && (inRound() || (G.phase === 'lobby' && controls.isLocked)));
  show('blackout', joined && seekerFrozen() && G.myStatus === 'alive');
  show('pause', amPlaying() && !controls.isLocked && !G.taskOpen && !seekerFrozen());
  show('spectate', amSpectating());
  if (amSpectating() && controls.isLocked) controls.unlock();
}

function tryLock() {
  if (!G.joined || G.taskOpen || amSpectating() || G.phase === 'ended') return;
  try { audio.init(); controls.lock(); } catch { /* headless / unsupported */ }
}

controls.addEventListener('lock', refreshScreens);
controls.addEventListener('unlock', refreshScreens);
renderer.domElement.addEventListener('click', () => { if (!controls.isLocked) tryLock(); });
document.getElementById('pause').addEventListener('click', tryLock);
document.getElementById('spectate').addEventListener('click', () => cycleSpectate(1));
document.getElementById('game').addEventListener('mousedown', (e) => {
  if (amSpectating()) { cycleSpectate(e.button === 2 ? -1 : 1); return; }
  if (controls.isLocked && e.button === 0) tryCatch();
});

document.addEventListener('keydown', (e) => {
  if (G.taskOpen) {
    if (e.code === 'Escape') closeTask(true);
    return;
  }
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  keys[e.code] = true;
  if (controls.isLocked && (e.ctrlKey || e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault();
  if (e.code === 'KeyE' && controls.isLocked) interact();
  if (amSpectating()) {
    if (e.code === 'ArrowRight' || e.code === 'KeyD') cycleSpectate(1);
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') cycleSpectate(-1);
  }
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ------------------------------------------------------------------ actions
function tryCatch() {
  if (G.myRole !== 'seeker' || G.phase !== 'seeking' || G.myStatus !== 'alive') return;
  const { yaw, pitch } = local.yawPitch;
  audio.swoosh();
  socket.emit('catch', { yaw, pitch }, (r) => { if (r?.ok) ui.alert(`Caught ${r.name}!`, 1500); });
}

function nearestStation() {
  // same rule as the server: horizontal distance within TASK_DISTANCE, same floor
  let best = null, bd = Infinity;
  for (const st of MAP.stations) {
    if (Math.abs(local.s.y - st.pos[1]) >= 1.0) continue;
    const d = Math.hypot(local.s.x - st.pos[0], local.s.z - st.pos[2]);
    if (d < bd) { bd = d; best = st; }
  }
  return bd <= CONFIG.TASK_DISTANCE - 0.05 ? best : null;
}

function stationType(id) { return G.round?.stations?.find((s) => s.id === id)?.type ?? null; }

function interact() {
  if (!amPlaying() || G.myRole !== 'hider') return;
  const st = nearestStation();
  if (!st || G.tasksDone.has(st.id)) return;
  socket.emit('task:open', { stationId: st.id }, (r) => {
    if (!r?.ok) { ui.toast(escapeHtml(r?.error ?? 'Cannot use that')); return; }
    openTask(st.id, r.type, r.data);
  });
}

function openTask(stationId, type, data) {
  const mod = TASKS[type];
  if (!mod) { ui.toast('Unknown task ' + escapeHtml(type)); socket.emit('task:close'); return; }
  if (controls.isLocked) controls.unlock();
  for (const k in keys) keys[k] = false;
  G.taskOpen = { stationId, mod };
  document.getElementById('taskTitle').textContent = mod.title;
  const body = document.getElementById('taskBody');
  body.innerHTML = '';
  show('task', true);
  const submit = (answer) => new Promise((resolve) => {
    socket.emit('task:submit', { answer }, (r) => {
      r = r ?? { result: 'error' };
      resolve(r);
      if (r.result === 'complete') {
        audio.chime('task');
        setTimeout(() => closeTask(false), 700);
      } else if (r.result === 'wrong') audio.chime('wrong');
    });
  });
  mod.open(body, data, submit);
  refreshScreens();
}

function closeTask(notifyServer) {
  if (!G.taskOpen) return;
  try { G.taskOpen.mod.close(); } catch { /* ignore */ }
  G.taskOpen = null;
  show('task', false);
  document.getElementById('taskBody').innerHTML = '';
  if (notifyServer) socket.emit('task:close');
  if (amPlaying()) tryLock();
  refreshScreens();
}

function spectateCandidates() {
  return [...remote.avatars.values()].filter((a) => a.cur && a.cur.st === 'alive' && a.id !== G.myId).map((a) => a.id);
}
function cycleSpectate(dir) {
  const c = spectateCandidates();
  if (!c.length) { G.spectateId = null; return; }
  const i = c.indexOf(G.spectateId);
  G.spectateId = c[(i + dir + c.length) % c.length];
}

// ------------------------------------------------------------------ loop
let last = performance.now();
const clock0 = performance.now();
const tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = (now - clock0) / 1000;

  const playing = G.joined && (G.myStatus === 'alive' || G.myStatus === 'lobby') && G.phase !== 'ended';
  const frozen = !controls.isLocked || !!G.taskOpen || seekerFrozen() || !playing;
  local.speedMult = G.myRole === 'seeker' && inRound() ? CONFIG.SEEKER_SPEED_MULT : 1;
  if (G.joined && playing) local.update(dt, input(), frozen);

  // spectator camera
  if (amSpectating()) {
    const c = spectateCandidates();
    if (!c.includes(G.spectateId)) G.spectateId = c[0] ?? null;
    const s = G.spectateId && remote.get(G.spectateId);
    if (s) {
      camera.position.set(s.x, s.y + (s.c ? CONFIG.EYE_CROUCH : CONFIG.EYE_STAND), s.z);
      tmpEuler.set(s.pitch, s.yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(tmpEuler);
      const name = G.lobby?.players.find((p) => p.id === G.spectateId)?.name ?? '?';
      const role = G.spectateId === G.round?.seekerId ? 'Seeker' : 'Hider';
      document.getElementById('spectate').innerHTML = `${G.myStatus === 'spectator' ? 'Waiting for the next round · ' : ''}Spectating <b>${escapeHtml(name)}</b> (${role})<br><span class="muted">Click / ← → to switch</span>`;
    } else {
      document.getElementById('spectate').innerHTML = 'Nobody left to spectate';
    }
  } else {
    G.spectateId = null;
  }
  if (!G.joined) {
    // attract-mode camera before joining
    const c = MAP.bounds;
    const cx = (c.min[0] + c.max[0]) / 2, cz = (c.min[2] + c.max[2]) / 2;
    camera.position.set(cx + Math.cos(t * 0.1) * 6, 2.2, cz + Math.sin(t * 0.1) * 6);
    camera.lookAt(cx, 1.2, cz);
  }

  remote.update(now, dt, {
    localId: G.myId, localRole: inRound() ? G.myRole : null, phase: G.phase,
    seekerId: G.round?.seekerId, spectateId: G.spectateId,
  });
  world.update(t);

  // lights carried by the local player
  const alive = G.myStatus === 'alive' || G.myStatus === 'lobby';
  hiderLight.intensity = G.joined && alive && G.myRole !== 'seeker' ? CONFIG.HIDER_LIGHT_INTENSITY : 0;
  flashlight.intensity = G.joined && inRound() && G.myRole === 'seeker' && G.myStatus === 'alive' ? CONFIG.FLASHLIGHT_INTENSITY : 0;

  updateHud();
  updateAudio(dt, now);

  // 20 Hz position updates
  if (G.joined && playing && now - G.lastSend >= 1000 / CONFIG.SEND_RATE) {
    G.lastSend = now;
    const { yaw, pitch } = local.yawPitch;
    socket.emit('move', {
      x: +local.s.x.toFixed(3), y: +local.s.y.toFixed(3), z: +local.s.z.toFixed(3),
      yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3),
      crouch: local.crouched, sprint: local.sprinting, seq: G.tpSeq,
    });
  }

  renderer.render(scene, camera);
}

function updateHud() {
  if (!G.joined) return;
  if (G.phase === 'lobby') {
    ui.hud({ roleText: 'LOBBY — Esc for menu', stamina: local.stamina, crouched: local.crouched });
    return;
  }
  if (!inRound()) return;
  if (seekerFrozen()) document.getElementById('blackoutTimer').textContent = Math.ceil(G.timeLeft);
  const seeker = G.myRole === 'seeker';
  const d = {
    role: seeker ? 'seeker' : 'hider',
    roleText: G.myStatus === 'spectator' ? 'SPECTATOR' : seeker ? 'SEEKER' : G.myStatus === 'escaped' ? 'ESCAPED' : G.myStatus === 'caught' ? 'CAUGHT' : 'HIDER',
    timer: (G.phase === 'hiding' ? 'Hiding ' : '') + fmtTime(G.timeLeft),
    timerLow: G.phase === 'seeking' && G.timeLeft < 30,
    stamina: local.stamina,
    showStamina: G.myStatus === 'alive',
    crouched: G.myStatus === 'alive' && local.crouched,
    crosshair: G.myStatus === 'alive',
  };
  const needed = G.round?.tasksNeeded ?? 0;
  if (!seeker && G.myStatus === 'alive') d.tasks = `Tasks ${Math.min(G.tasksDone.size, needed)}/${needed}${G.unlocked ? ' · EXIT OPEN' : ''}`;
  if (seeker) {
    const left = [...remote.avatars.values()].filter((a) => a.cur?.st === 'alive' && a.id !== G.round?.seekerId).length;
    d.remaining = `Hiders left: ${left}`;
  }
  if (amPlaying() && !seeker && !G.taskOpen) {
    const st = nearestStation();
    if (st) {
      const type = stationType(st.id);
      d.prompt = G.tasksDone.has(st.id) ? 'Task done ✓' : `Press E — ${TASKS[type]?.title ?? 'Task'}`;
    } else if (G.unlocked) {
      const ex = MAP.exit.pos;
      if (Math.hypot(local.s.x - ex[0], local.s.z - ex[2]) < 4) d.prompt = 'Walk into the EXIT to escape!';
    }
  }
  if (amPlaying() && seeker && G.phase === 'seeking') d.prompt = '';
  ui.hud(d);
}

function updateAudio(dt, now) {
  if (!audio.ready) return;
  const { yaw } = local.yawPitch;
  const lp = { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: amSpectating() ? new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y : yaw };
  // own footsteps
  if (G.joined && (G.myStatus === 'alive' || G.myStatus === 'lobby')) {
    const stride = local.crouched ? CONFIG.STRIDE_CROUCH : local.sprinting ? CONFIG.STRIDE_SPRINT : CONFIG.STRIDE_WALK;
    if (local.moved >= stride) {
      local.moved = 0;
      const v = local.crouched ? CONFIG.FOOTSTEP_VOL_CROUCH : local.sprinting ? CONFIG.FOOTSTEP_VOL_SPRINT : CONFIG.FOOTSTEP_VOL_WALK;
      audio.footstep(0, 0, v * CONFIG.LOCAL_FOOTSTEP_VOL);
    }
  }
  // remote footsteps with positional panning
  for (const av of remote.avatars.values()) {
    const s = av.cur;
    if (!s || av.id === G.myId || !(s.st === 'alive' || s.st === 'lobby')) { av.stepAcc = 0; continue; }
    const stride = s.c ? CONFIG.STRIDE_CROUCH : s.s ? CONFIG.STRIDE_SPRINT : CONFIG.STRIDE_WALK;
    if (av.stepAcc >= stride) {
      av.stepAcc = 0;
      const dx = s.x - lp.x, dz = s.z - lp.z, dy = s.y - lp.y;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > CONFIG.FOOTSTEP_RANGE) continue;
      const vol = (s.c ? CONFIG.FOOTSTEP_VOL_CROUCH : s.s ? CONFIG.FOOTSTEP_VOL_SPRINT : CONFIG.FOOTSTEP_VOL_WALK) * Math.pow(1 - dist / CONFIG.FOOTSTEP_RANGE, 2);
      // listener right vector = (cos yaw, 0, -sin yaw)
      const pan = dist > 0.01 ? (dx * Math.cos(lp.yaw) - dz * Math.sin(lp.yaw)) / Math.hypot(dx, dz || 0.001) : 0;
      audio.footstep(pan, dist, vol);
    }
  }
  // heartbeat when the seeker is near a living hider
  if (amPlaying() && G.myRole === 'hider' && G.phase === 'seeking') {
    const sk = remote.get(G.round?.seekerId);
    if (sk) {
      const d = Math.hypot(sk.x - local.s.x, sk.y - local.s.y, sk.z - local.s.z);
      if (d < CONFIG.HEARTBEAT_RANGE) {
        const k = 1 - d / CONFIG.HEARTBEAT_RANGE;     // 0 far .. 1 close
        const interval = 1150 - 800 * k;              // ms between beats
        if (now - G.heartbeatAt >= interval) { G.heartbeatAt = now; audio.heartbeat(0.35 + 0.65 * k); }
      }
    }
  }
}

// Debug helpers (headless screenshots). Server only honours debug:* events in HS_TEST mode.
window.__debug = {
  view(x, y, z, yaw, pitch = 0) {
    socket.emit('debug:teleport', { x, y, z, yaw });
    local.setPosition([x, y, z], yaw);
    tmpEuler.set(pitch, yaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(tmpEuler);
  },
  crouch(v) { keys.KeyC = v; },
  lockless() { controls.isLocked = true; refreshScreens(); },
  input: keys,
};

frame();
