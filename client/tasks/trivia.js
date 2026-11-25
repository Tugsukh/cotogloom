// Trivia: answer 2 multiple-choice questions (questions live in client/tasks/questions.json; the server checks).
let st = null;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render(note, cls = '') {
  const { container, data } = st;
  container.innerHTML = `
    <div class="progress">Question ${data.index + 1} / ${data.total}</div>
    <div style="font-size:1.25em;margin:12px 0;text-align:center">${esc(data.question)}</div>
    <div class="choices">${data.choices.map((c, i) => `<button data-i="${i}">${esc(c)}</button>`).join('')}</div>
    <div class="taskMsg ${cls}">${note ?? ''}</div>`;
  container.querySelectorAll('.choices button').forEach((b) => {
    b.onclick = async () => {
      if (st.busy) return;
      st.busy = true;
      const r = await st.submit(Number(b.dataset.i));
      if (!st) return;
      st.busy = false;
      if (r.result === 'complete') { render('Correct — task done!', 'good'); st.busy = true; }
      else if (r.result === 'progress') { st.data = r.data; render('Correct!', 'good'); }
      else { if (r.data) st.data = r.data; render(r.message ?? 'Wrong!', 'bad'); }
    };
  });
}

export default {
  title: 'Trivia',
  open(container, data, submit) { st = { container, data, submit, busy: false }; render(); },
  close() { st = null; },
};
