// Quick math: 3 mental-arithmetic questions in a row. A wrong answer means new questions from the start.
let st = null;

function render(note, cls = '') {
  const { container, data } = st;
  container.innerHTML = `
    <div class="progress">Question ${data.index + 1} / ${data.total}</div>
    <div class="mathQ">${data.question} = ?</div>
    <div style="display:flex;gap:8px;justify-content:center">
      <input id="mathAns" type="text" inputmode="numeric" autocomplete="off" style="width:140px;font-size:1.4em;text-align:center">
      <button id="mathOk">OK</button>
    </div>
    <div class="taskMsg ${cls}">${note ?? ''}</div>`;
  const inp = container.querySelector('#mathAns');
  const go = async () => {
    if (st.busy || inp.value.trim() === '') return;
    st.busy = true;
    const r = await st.submit(Number(inp.value.trim()));
    if (!st) return;
    st.busy = false;
    if (r.result === 'complete') { render('All correct!', 'good'); st.busy = true; }
    else if (r.result === 'progress') { st.data = r.data; render('Correct!', 'good'); }
    else { if (r.data) st.data = r.data; render(r.message ?? 'Wrong!', 'bad'); }
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  container.querySelector('#mathOk').onclick = go;
  setTimeout(() => inp.focus(), 30);
}

export default {
  title: 'Quick math',
  open(container, data, submit) { st = { container, data, submit, busy: false }; render(); },
  close() { st = null; },
};
