// Simon: watch a 5-step light pattern, then repeat it.
const COLORS = ['#e53935', '#43a047', '#1e88e5', '#fdd835'];
let st = null;

const wait = (ms) => new Promise((r) => { const t = setTimeout(r, ms); st?.timers.push(t); });

async function play() {
  const my = st;
  if (!my) return;
  my.playing = true; my.input = [];
  my.msg.className = 'taskMsg'; my.msg.textContent = 'Watch…';
  await wait(600);
  for (const i of my.data.sequence) {
    if (st !== my) return;
    my.pads[i].classList.add('lit');
    await wait(480);
    my.pads[i].classList.remove('lit');
    await wait(180);
  }
  if (st !== my) return;
  my.playing = false;
  my.msg.textContent = `Your turn (0/${my.data.sequence.length})`;
}

export default {
  title: 'Simon says',
  open(container, data, submit) {
    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'simon';
    const msg = document.createElement('div');
    msg.className = 'taskMsg';
    const again = document.createElement('button');
    again.textContent = 'Watch again';
    again.style.cssText = 'display:block;margin:10px auto 0';
    st = { data, submit, msg, pads: [], input: [], playing: false, timers: [] };
    COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.style.background = c; b.style.color = c;
      b.onclick = async () => {
        if (!st || st.playing || st.busy) return;
        b.classList.add('lit');
        setTimeout(() => b.classList.remove('lit'), 180);
        st.input.push(i);
        const n = st.data.sequence.length;
        msg.textContent = `Your turn (${st.input.length}/${n})`;
        if (st.input.length === n) {
          st.busy = true;
          const r = await submit(st.input);
          if (!st) return;
          st.busy = false;
          if (r.result === 'complete') { msg.className = 'taskMsg good'; msg.textContent = 'Perfect memory!'; st.playing = true; }
          else {
            msg.className = 'taskMsg bad'; msg.textContent = r.message ?? 'Wrong!';
            if (r.data) st.data = r.data;
            st.playing = true;
            await wait(1100);
            play();
          }
        }
      };
      st.pads.push(b);
      grid.appendChild(b);
    });
    again.onclick = () => { if (st && !st.playing && !st.busy) play(); };
    container.append(grid, msg, again);
    play();
  },
  close() { if (st) st.timers.forEach(clearTimeout); st = null; },
};
