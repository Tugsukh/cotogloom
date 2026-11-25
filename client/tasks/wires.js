// Wires: drag each coloured wire on the left to the matching colour on the right.
const HEX = { red: '#e53935', blue: '#1e88e5', yellow: '#fdd835', green: '#43a047', purple: '#8e24aa', orange: '#fb8c00' };
const W = 440, H = 300, LX = 50, RX = 390;
const ys = [55, 120, 185, 250];

let state = null;

function render() {
  const { g, data, links, drag } = state;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#0b0d12'; g.fillRect(0, 0, W, H);
  g.lineCap = 'round';
  // finished links
  links.forEach((ri, li) => {
    if (ri == null) return;
    g.strokeStyle = HEX[data.left[li]]; g.lineWidth = 10;
    g.beginPath(); g.moveTo(LX, ys[li]); g.lineTo(RX, ys[ri]); g.stroke();
  });
  if (drag) {
    g.strokeStyle = HEX[data.left[drag.li]]; g.lineWidth = 10;
    g.beginPath(); g.moveTo(LX, ys[drag.li]); g.lineTo(drag.x, drag.y); g.stroke();
  }
  for (let i = 0; i < 4; i++) {
    for (const [x, c, side] of [[LX, data.left[i], -1], [RX, data.right[i], 1]]) {
      g.fillStyle = HEX[c];
      g.fillRect(side < 0 ? 0 : x, ys[i] - 9, side < 0 ? x : W - x, 18);
      g.beginPath(); g.arc(x, ys[i], 14, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#000'; g.lineWidth = 3; g.stroke();
    }
  }
}

function pos(e) {
  const r = state.canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
}
const near = (p, x, y) => Math.hypot(p.x - x, p.y - y) < 26;

function setData(data) {
  state.data = data;
  state.links = [null, null, null, null];
  state.drag = null;
  state.busy = false;
  render();
}

export default {
  title: 'Fix the wiring',
  open(container, data, submit) {
    container.innerHTML = '<div class="progress">Drag each wire to the matching colour.</div>';
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.style.cssText = 'display:block;margin:10px auto;max-width:100%;touch-action:none;cursor:pointer;border-radius:10px';
    const msg = document.createElement('div');
    msg.className = 'taskMsg';
    container.append(canvas, msg);
    state = { canvas, g: canvas.getContext('2d'), msg, submit };
    setData(data);

    canvas.onpointerdown = (e) => {
      if (state.busy) return;
      const p = pos(e);
      const li = ys.findIndex((y) => near(p, LX, y));
      if (li >= 0) { state.links[li] = null; state.drag = { li, ...p }; canvas.setPointerCapture(e.pointerId); render(); }
    };
    canvas.onpointermove = (e) => { if (state.drag) { Object.assign(state.drag, pos(e)); render(); } };
    canvas.onpointerup = async (e) => {
      const d = state.drag;
      if (!d) return;
      state.drag = null;
      const p = pos(e);
      const ri = ys.findIndex((y) => near(p, RX, y));
      if (ri >= 0) {
        const other = state.links.indexOf(ri);
        if (other >= 0) state.links[other] = null;
        state.links[d.li] = ri;
      }
      render();
      if (state.links.every((v) => v != null)) {
        state.busy = true;
        const r = await state.submit([...state.links]);
        if (!state) return;
        if (r.result === 'complete') { msg.className = 'taskMsg good'; msg.textContent = 'Power restored!'; }
        else { msg.className = 'taskMsg bad'; msg.textContent = r.message ?? 'Wrong!'; if (r.data) setData(r.data); else state.busy = false; }
      }
    };
  },
  close() { state = null; },
};
