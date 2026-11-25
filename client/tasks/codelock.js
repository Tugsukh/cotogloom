// Code lock: a 4-digit code is painted on a sign in the 3D world near the station. Find it, type it in.
let st = null;

function update() {
  st.display.textContent = (st.code + '____').slice(0, st.len).split('').join('');
}

async function enter() {
  if (st.busy || st.code.length !== st.len) return;
  st.busy = true;
  const r = await st.submit(st.code);
  if (!st) return;
  st.busy = false;
  if (r.result === 'complete') { st.msg.className = 'taskMsg good'; st.msg.textContent = 'Unlocked!'; st.busy = true; }
  else { st.msg.className = 'taskMsg bad'; st.msg.textContent = r.message ?? 'Wrong code'; st.code = ''; update(); }
}

function press(k) {
  if (!st || st.busy) return;
  if (k === 'C') st.code = '';
  else if (k === 'OK') return enter();
  else if (st.code.length < st.len) st.code += k;
  st.msg.textContent = '';
  update();
}

function onKey(e) {
  if (!st) return;
  if (/^[0-9]$/.test(e.key)) press(e.key);
  else if (e.key === 'Backspace') { st.code = st.code.slice(0, -1); update(); }
  else if (e.key === 'Enter') enter();
}

export default {
  title: 'Code lock',
  open(container, data, submit) {
    container.innerHTML = `<div class="progress">${data.hint}</div>`;
    const display = document.createElement('div');
    display.className = 'lockDisplay';
    display.style.marginTop = '12px';
    const pad = document.createElement('div');
    pad.className = 'keypad';
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK']) {
      const b = document.createElement('button');
      b.textContent = k;
      b.onclick = () => press(k);
      pad.appendChild(b);
    }
    const msg = document.createElement('div');
    msg.className = 'taskMsg';
    container.append(display, pad, msg);
    st = { display, msg, submit, code: '', len: data.length ?? 4, busy: false };
    update();
    document.addEventListener('keydown', onKey);
  },
  close() { document.removeEventListener('keydown', onKey); st = null; },
};
