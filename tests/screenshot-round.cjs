// Headless round check: a browser player + a socket.io bot play a round. Screenshots of HUD, flashlight,
// spectator mode, end screen and the seeker blackout. Fails on console errors.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { io } = require('socket.io-client');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const root = path.resolve(__dirname, '..');
const PORT = 3980 + Math.floor(Math.random() * 9);
const URL = `http://localhost:${PORT}`;
const outDir = path.join(root, 'screenshots');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `round-${name}.png`) }).then(() => console.log('screenshot', name));

function makeBot(name) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  const bot = { s, seq: 0, pos: [0, 0, 0] };
  s.on('teleport', (d) => { bot.seq = d.seq; bot.pos = d.pos; });
  s.on('correct', (d) => { bot.seq = d.seq; bot.pos = d.pos; });
  bot.join = () => new Promise((r) => s.emit('join', { name, color: '#3cb44b' }, r));
  bot.tp = (x, y, z, yaw = 0, crouch = false) => s.emit('debug:teleport', { x, y, z, yaw, crouch });
  bot.look = (yaw, pitch = 0) => s.emit('move', { x: bot.pos[0], y: bot.pos[1], z: bot.pos[2], yaw, pitch, seq: bot.seq });
  return bot;
}

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'server/index.js')], {
    env: { ...process.env, PORT: String(PORT), HS_TEST: '1' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('listening') && r()));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const errors = [];
  let bot;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
    await page.goto(URL, { waitUntil: 'load' });
    await sleep(800);
    await page.fill('#nameInput', 'Viewer');
    await page.click('#joinBtn');
    await sleep(400);
    bot = makeBot('Seeky');
    await bot.join();
    await sleep(300);
    const myId = await page.evaluate(() => window.__game.myId);
    // host (page) picks the bot as seeker, everyone ready, start
    await page.selectOption('#setSeeker', await page.evaluate(() => window.__game.lobby.players[1].id));
    await page.fill('#setHide', '20'); await page.dispatchEvent('#setHide', 'change');
    await page.click('#readyBtn');
    bot.s.emit('ready', true);
    await sleep(400);
    await shot(page, 'lobby2');
    await page.click('#startBtn');
    await sleep(1200);
    await page.evaluate(() => window.__debug.lockless());
    // hider looks at the frozen seeker in the atrium
    await page.evaluate(() => window.__debug.view(20, 0, 17.0, 0, 0.05));
    await sleep(1500);
    await shot(page, 'hider-hiding');
    if (await page.evaluate(() => window.__game.phase) === 'hiding') bot.s.emit('debug:setTime', { seconds: 0 });
    await sleep(600);
    // seeker walks up and shines the flashlight at the hider
    bot.tp(21.5, 0, 14.5, 0); await sleep(300);
    bot.look(-0.6, -0.1);
    await page.evaluate(() => window.__debug.view(20, 0, 17.0, 0.15, 0.05));
    await sleep(1200);
    await shot(page, 'hider-seeking');
    // catch the page player
    await page.evaluate(() => window.__debug.view(20, 0, 15.6, 0, 0));
    bot.tp(20, 0, 14.6, Math.PI); await sleep(400);
    const res = await new Promise((r) => bot.s.emit('catch', { yaw: Math.PI }, r));
    console.log('catch result', res);
    await sleep(1500);
    await shot(page, 'end');
    const endTitle = await page.textContent('#endTitle');
    console.log('end title:', endTitle);
    // play again -> seeker rotates to... order [page, bot]; last seeker bot -> page is seeker now
    await page.click('#againBtn');
    await sleep(1200);
    await shot(page, 'seeker-blackout');
    const blackout = await page.isVisible('#blackout');
    console.log('blackout visible for seeker:', blackout);
    // seeker view while seeking (flashlight)
    await page.evaluate(() => window.__game.socket.emit('debug:setTime', { seconds: 0 }));
    await sleep(500);
    await page.evaluate(() => window.__debug.lockless());
    bot.tp(20, 0, 16, 0);
    await page.evaluate(() => window.__debug.view(20, 0, 12.5, Math.PI, -0.05));
    await sleep(1500);
    await shot(page, 'seeker-seeking');
    if (!(res && res.ok && /SEEKER/.test(endTitle) && blackout)) errors.push('round flow assertions failed');
    void myId;
  } finally {
    bot?.s.close();
    await browser.close();
    server.kill('SIGTERM');
  }
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors.');
  process.exit(errors.length ? 1 : 0);
})();
