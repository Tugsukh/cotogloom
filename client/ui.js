// DOM side of the game: join screen, lobby, HUD, end screen, task overlay, toasts.
import { CONFIG } from '/shared/config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtTime = (s) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function show(id, v = true) { $(id).classList.toggle('hidden', !v); }
export function isShown(id) { return !$(id).classList.contains('hidden'); }

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.selectedColor = null;
    this.lobby = null;
    this.myId = null;

    // join
    const saved = (() => { try { return JSON.parse(localStorage.getItem('cotogloom') || '{}'); } catch { return {}; } })();
    $('nameInput').value = saved.name ?? '';
    this.selectedColor = saved.color ?? null;
    this.renderColors();
    $('joinBtn').onclick = () => this.doJoin();
    $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.doJoin(); });

    // lobby
    $('readyBtn').onclick = () => this.h.ready(!this.me()?.ready);
    $('startBtn').onclick = () => this.h.start();
    $('walkBtn').onclick = () => this.h.walk();
    const pushSettings = () => this.h.settings({
      roundTime: Math.round(parseFloat($('setRound').value) * 60),
      hideTime: parseInt($('setHide').value, 10),
      tasksNeeded: parseInt($('setTasks').value, 10),
      seekerMode: $('setSeeker').value === 'random' ? 'random' : 'chosen',
      seekerId: $('setSeeker').value === 'random' ? null : $('setSeeker').value,
    });
    for (const id of ['setRound', 'setHide', 'setTasks', 'setSeeker']) $(id).addEventListener('change', pushSettings);

    // end
    $('againBtn').onclick = () => this.h.playAgain();
    $('toLobbyBtn').onclick = () => this.h.backToLobby();
    $('taskClose').onclick = () => this.h.closeTask();
  }

  me() { return this.lobby?.players.find((p) => p.id === this.myId); }
  get isHost() { return this.lobby && this.lobby.hostId === this.myId; }

  doJoin() {
    const name = $('nameInput').value.trim();
    try { localStorage.setItem('cotogloom', JSON.stringify({ name, color: this.selectedColor })); } catch { /* ignore */ }
    this.h.join(name, this.selectedColor);
  }

  joinError(msg) { $('joinError').textContent = msg ?? ''; }

  renderColors() {
    const taken = new Set((this.lobby?.players ?? []).filter((p) => p.id !== this.myId).map((p) => p.color));
    if (!this.selectedColor || taken.has(this.selectedColor)) this.selectedColor = CONFIG.COLORS.find((c) => !taken.has(c)) ?? CONFIG.COLORS[0];
    const el = $('colorPicker');
    el.innerHTML = '';
    CONFIG.COLORS.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'swatch' + (c === this.selectedColor ? ' sel' : '') + (taken.has(c) ? ' taken' : '');
      d.style.background = c;
      d.title = CONFIG.COLOR_NAMES[i];
      d.onclick = () => { if (!taken.has(c)) { this.selectedColor = c; this.renderColors(); } };
      el.appendChild(d);
    });
  }

  renderLobby(state, myId) {
    this.lobby = state;
    this.myId = myId;
    if (isShown('join')) {
      this.renderColors();
      $('joinInfo').textContent = `${state.players.length}/${state.maxPlayers} players in lobby` +
        (state.phase !== 'lobby' ? ' — a round is in progress, you will spectate until the next one' : '');
    }
    $('lobbyCount').textContent = `(${state.players.length}/${state.maxPlayers})`;
    const ul = $('playerList');
    ul.innerHTML = '';
    for (const p of state.players) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="dot" style="background:${esc(p.color)}"></span><span class="pname">${esc(p.name)}${p.id === myId ? ' (you)' : ''}</span>` +
        (p.id === state.hostId ? '<span class="tag host">HOST</span>' : '') +
        `<span class="tag ${p.ready ? 'ready' : ''}">${p.ready ? 'READY' : 'not ready'}</span>`;
      ul.appendChild(li);
    }
    const me = state.players.find((p) => p.id === myId);
    $('readyBtn').textContent = me?.ready ? 'Ready ✓ (click to unready)' : 'Ready';
    $('readyBtn').classList.toggle('on', !!me?.ready);

    const host = state.hostId === myId;
    const st = state.settings;
    $('hostNote').textContent = host ? '(you are the host)' : '(host only)';
    for (const id of ['setRound', 'setHide', 'setTasks', 'setSeeker']) $(id).disabled = !host;
    if (document.activeElement?.id !== 'setRound') $('setRound').value = st.roundTime / 60;
    if (document.activeElement?.id !== 'setHide') $('setHide').value = st.hideTime;
    $('setTasks').max = Math.max(1, state.stationCount || 10);
    if (document.activeElement?.id !== 'setTasks') $('setTasks').value = st.tasksNeeded;
    const sel = $('setSeeker');
    sel.innerHTML = '<option value="random">Random</option>' +
      state.players.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    sel.value = st.seekerMode === 'chosen' && st.seekerId ? st.seekerId : 'random';

    const allReady = state.players.length >= CONFIG.MIN_PLAYERS && state.players.every((p) => p.ready);
    $('startBtn').disabled = !(host && allReady);
    $('startBtn').style.display = host ? '' : 'none';
    $('startHint').textContent = state.players.length < CONFIG.MIN_PLAYERS ? 'Need at least 2 players.'
      : !allReady ? 'Waiting for everyone to be ready…'
      : host ? 'Everyone is ready!' : 'Waiting for the host to start…';
  }

  // ---------------------------------------------------------------- HUD
  hud(d) {
    const role = $('hudRole');
    role.textContent = d.roleText ?? '';
    role.className = d.role ?? '';
    const timer = $('hudTimer');
    timer.textContent = d.timer ?? '';
    timer.classList.toggle('low', !!d.timerLow);
    $('hudTasks').textContent = d.tasks ?? '';
    $('hudRemaining').textContent = d.remaining ?? '';
    $('staminaFill').style.width = `${Math.round(d.stamina ?? 100)}%`;
    show('stamina', d.showStamina !== false);
    show('crouchIcon', !!d.crouched);
    show('crosshair', d.crosshair !== false);
    const pr = $('prompt');
    pr.textContent = d.prompt ?? '';
    show('prompt', !!d.prompt);
  }

  alert(text, ms = 3000) {
    const a = $('alert');
    a.textContent = text;
    show('alert', true);
    clearTimeout(this._alertT);
    this._alertT = setTimeout(() => show('alert', false), ms);
  }

  toast(html) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = html;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 5200);
  }

  // ---------------------------------------------------------------- end screen
  renderEnd(r, myId, hostId) {
    const title = $('endTitle');
    title.textContent = r.winner === 'hiders' ? 'HIDERS WIN' : 'SEEKER WINS';
    title.className = r.winner === 'hiders' ? 'win-h' : 'win-s';
    $('endReason').textContent = `${r.reason} · Round time ${fmtTime(r.roundTime)}`;
    const rows = r.players.map((p) => {
      let outcome = '';
      if (p.role === 'seeker') outcome = `Caught ${p.catches ?? 0}`;
      else if (p.status === 'escaped') outcome = `Escaped at ${fmtTime(p.at ?? 0)}`;
      else if (p.status === 'caught') outcome = `Caught by ${esc(p.caughtBy ?? '?')} at ${fmtTime(p.at ?? 0)}`;
      else if (p.status === 'left') outcome = 'Left the game';
      else outcome = 'Still hiding';
      return `<tr><td><span class="dot" style="display:inline-block;background:${esc(p.color)}"></span> ${esc(p.name)}${p.id === myId ? ' (you)' : ''}</td>` +
        `<td>${p.role === 'seeker' ? 'Seeker' : 'Hider'}</td><td>${p.tasks ?? 0} tasks</td><td>${outcome}</td></tr>`;
    }).join('');
    $('endTable').innerHTML = `<tr><th>Player</th><th>Role</th><th>Tasks</th><th>Result</th></tr>${rows}`;
    const host = hostId === myId;
    $('againBtn').style.display = host ? '' : 'none';
    $('toLobbyBtn').style.display = host ? '' : 'none';
    $('endWait').textContent = host ? 'Next seeker: the next player in the list.' : 'Waiting for the host…';
  }
}
