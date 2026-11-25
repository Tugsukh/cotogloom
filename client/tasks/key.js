// Find the key: pick the key whose shape matches the one shown.
let st = null;

/** key = { bow: 0 circle | 1 square | 2 triangle, teeth: [5 heights 1..3] } */
export function drawKey(canvas, key, color = '#e0b84a') {
  const g = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#0b0d12'; g.fillRect(0, 0, w, h);
  const s = w / 200;
  g.save(); g.scale(s, s);
  g.fillStyle = color; g.strokeStyle = '#5a4210'; g.lineWidth = 3;
  // bow
  g.beginPath();
  if (key.bow === 0) g.arc(40, 50, 26, 0, Math.PI * 2);
  else if (key.bow === 1) g.rect(16, 26, 48, 48);
  else { g.moveTo(14, 78); g.lineTo(40, 20); g.lineTo(66, 78); g.closePath(); }
  g.fill(); g.stroke();
  g.fillStyle = '#0b0d12';
  g.beginPath(); g.arc(40, 52, 9, 0, Math.PI * 2); g.fill();
  // shaft + teeth
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(64, 42); g.lineTo(186, 42); g.lineTo(186, 56);
  for (let i = 4; i >= 0; i--) {
    const x = 96 + i * 18, d = key.teeth[i] * 9;
    g.lineTo(x + 14, 56); g.lineTo(x + 14, 56 + d); g.lineTo(x + 2, 56 + d); g.lineTo(x + 2, 56);
  }
  g.lineTo(64, 56); g.closePath();
  g.fill(); g.stroke();
  g.restore();
}

function render() {
  const { container, data } = st;
  container.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'progress';
  label.textContent = 'This is the lock\'s key shape. Find the identical key:';
  const target = document.createElement('canvas');
  target.width = 240; target.height = 120;
  target.style.cssText = 'display:block;margin:8px auto 12px;border:2px solid #7dffb0;border-radius:10px';
  drawKey(target, data.target, '#9ffff0');
  const keys = document.createElement('div');
  keys.className = 'keys';
  data.options.forEach((k, i) => {
    const b = document.createElement('button');
    const c = document.createElement('canvas');
    c.width = 160; c.height = 80; c.style.width = '100%';
    drawKey(c, k);
    b.appendChild(c);
    b.onclick = async () => {
      if (st.busy) return;
      st.busy = true;
      const r = await st.submit(i);
      if (!st) return;
      st.busy = false;
      if (r.result === 'complete') { st.msg.className = 'taskMsg good'; st.msg.textContent = 'Click! It fits.'; st.busy = true; }
      else { if (r.data) { st.data = r.data; render(); } st.msg.className = 'taskMsg bad'; st.msg.textContent = r.message ?? 'Wrong key'; }
    };
    keys.appendChild(b);
  });
  st.msg = st.msg ?? document.createElement('div');
  st.msg.className = 'taskMsg';
  container.append(label, target, keys, st.msg);
}

export default {
  title: 'Find the key',
  open(container, data, submit) { st = { container, data, submit, busy: false }; render(); },
  close() { st = null; },
};
