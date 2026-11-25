// Headless task check: opens every task type in the browser (press E at a station), screenshots each overlay,
// solves the code lock through the UI, and checks the console for errors.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { io } = require('socket.io-client');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const root = path.resolve(__dirname, '..');
const PORT = 3970 + Math.floor(Math.random() * 9);
const URL = `http://localhost:${PORT}`;
const outDir = path.join(root, 'screenshots');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = ['wires', 'simon', 'key', 'math', 'trivia', 'codelock'];

(async () => {
  const { MAP } = await import(path.join(root, 'shared/map.js'));
  const { canStand } = await import(path.join(root, 'shared/collision.js'));
  const server = spawn(process.execPath, [path.join(root, 'server/index.js')], {
    env: { ...process.env, PORT: String(PORT), HS_TEST: '1' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('listening') && r()));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const errors = [];
  const bot = io(URL, { transports: ['websocket'], forceNew: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
    await page.goto(URL, { waitUntil: 'load' });
    await sleep(800);
    await page.fill('#nameInput', 'Tasker');
    await page.click('#joinBtn');
    await sleep(300);
    await new Promise((r) => bot.emit('join', { name: 'Seeker' }, r));
    await sleep(300);
    bot.emit('settings', {}); // no-op (not host)
    await page.evaluate((id) => window.__game.socket.emit('settings', { seekerMode: 'chosen', seekerId: id, tasksNeeded: 1, hideTime: 60 }), bot.id);
    await page.click('#readyBtn');
    bot.emit('ready', true);
    await sleep(300);
    await page.click('#startBtn');
    await sleep(800);
    await page.evaluate((types) => window.__game.socket.emit('debug:forceTypes', { types }), TYPES);
    await sleep(500);
    await page.evaluate(() => window.__debug.lockless());

    for (let i = 0; i < 6; i++) {
      const st = MAP.stations[i];
      const offs = [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8], [0.7, 0.7], [-0.7, -0.7]];
      const [dx, dz] = offs.find(([x, z]) => canStand(st.pos[0] + x, st.pos[1] + 0.01, st.pos[2] + z, MAP.boxes));
      const yaw = Math.atan2(dx, dz); // look back at the station
      await page.evaluate(([x, y, z, yaw]) => window.__debug.view(x, y, z, yaw, -0.35), [st.pos[0] + dx, st.pos[1], st.pos[2] + dz, yaw]);
      await sleep(600);
      if (i === 0) await page.screenshot({ path: path.join(outDir, 'task-station.png') });
      await page.evaluate(() => window.__debug.lockless());
      await page.keyboard.press('KeyE');
      let open = false;
      for (let k = 0; k < 30 && !open; k++) { await sleep(100); open = await page.evaluate(() => !!window.__game.taskOpen && !document.getElementById('task').classList.contains('hidden')); }
      await sleep(TYPES[i] === 'simon' ? 1400 : 400);
      if (!open) errors.push(`task ${TYPES[i]} did not open`);
      await page.screenshot({ path: path.join(outDir, `task-${TYPES[i]}.png`) });
      console.log('task', TYPES[i], open ? 'opened' : 'NOT OPEN', await page.evaluate(() => JSON.stringify({t: document.getElementById('toasts').innerText, open: !!window.__game.taskOpen, cls: document.getElementById('task').className, st: window.__game.myStatus, role: window.__game.myRole})));
      if (TYPES[i] === 'codelock') {
        const code = await page.evaluate(() => window.__game.round.stations[5].code);
        await page.keyboard.type(code);
        await page.keyboard.press('Enter');
        await sleep(1500);
        const done = await page.evaluate(() => window.__game.tasksDone.has(6));
        console.log('codelock solved via UI:', done);
        if (!done) errors.push('code lock not solved through the UI');
        await page.screenshot({ path: path.join(outDir, 'task-after.png') });
      } else {
        await page.keyboard.press('Escape');
        await sleep(300);
        if (await page.evaluate(() => !!window.__game.taskOpen)) errors.push(`Esc did not close ${TYPES[i]}`);
      }
    }
    // code sign in the world, then the unlocked exit
    const sign = MAP.stations[5].sign.pos; // library code sign on the east wall (faces -x)
    await page.evaluate(([x, y, z]) => window.__debug.view(x - 2.2, 0, z, Math.PI / 2 * -1 + Math.PI, 0), sign);
    await page.evaluate(([x, z]) => window.__debug.view(x - 2.2, 0, z, -Math.PI / 2, 0.15), [sign[0], sign[2]]);
    await sleep(800);
    await page.screenshot({ path: path.join(outDir, 'task-sign.png') });
    await page.evaluate(() => window.__debug.view(3.5, 0, 5, Math.PI / 2, 0));
    await sleep(800);
    await page.screenshot({ path: path.join(outDir, 'task-exit-open.png') });
  } finally {
    bot.close();
    await browser.close();
    server.kill('SIGTERM');
  }
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors.');
  process.exit(errors.length ? 1 : 0);
})();
