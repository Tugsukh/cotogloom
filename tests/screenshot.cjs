// Headless browser check: loads the game, joins, checks the console for errors, takes screenshots.
// Usage: node tests/screenshot.cjs [views]   (starts its own HS_TEST server)
//   views: comma list of names from VIEWS below, default all.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const root = path.resolve(__dirname, '..');
const PORT = 3990 + Math.floor(Math.random() * 9);
const outDir = path.join(root, 'screenshots');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// name: [x, y, z, yaw, pitch, crouch]
const VIEWS = {
  lobby: null, // the lobby UI
  spawn: [20, 0, 27.5, 0, -0.05],
  atrium: [24, 0, 20, 0.6, 0.05],
  stairs: [16, 0, 21, 0.35, 0.15],
  mezzanine: [22, 3.2, 9.0, -2.4, -0.25],
  office: [8.5, 0, 9, 0.75, -0.1],
  undertable: [5, 0, 7.5, 0, 0, true],
  library: [31, 0, 13.5, -1.2, 0],
  loft: [21, 3.2, 6, 1.2, -0.1],
};

(async () => {
  const want = (process.argv[2] || Object.keys(VIEWS).join(',')).split(',');
  const server = spawn(process.execPath, [path.join(root, 'server/index.js')], {
    env: { ...process.env, PORT: String(PORT), HS_TEST: '1' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('listening') && r()));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await sleep(1500);
    await page.screenshot({ path: path.join(outDir, 'join.png') });
    await page.fill('#nameInput', 'Shooter');
    await page.click('#joinBtn');
    await sleep(800);
    if (want.includes('lobby')) await page.screenshot({ path: path.join(outDir, 'lobby.png') });
    await page.evaluate(() => window.__debug.lockless());
    for (const name of want) {
      const v = VIEWS[name];
      if (!v) continue;
      await page.evaluate(([x, y, z, yaw, pitch, crouch]) => { window.__debug.crouch(!!crouch); window.__debug.view(x, y, z, yaw, pitch); }, v);
      await sleep(900);
      await page.evaluate(([x, y, z, yaw, pitch]) => window.__debug.view(x, y, z, yaw, pitch), v);
      await sleep(400);
      await page.screenshot({ path: path.join(outDir, `${name}.png`) });
      console.log('screenshot', name);
    }
    if (process.env.EXTRA_JS) {
      await page.evaluate(process.env.EXTRA_JS);
      await sleep(1200);
      await page.screenshot({ path: path.join(outDir, 'extra.png') });
    }
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
  const real = errors.filter((e) => !/GPU stall|WebGL|swiftshader|GroupMarkerNotSet|Automatic fallback/i.test(e));
  console.log(real.length ? 'CONSOLE ERRORS:\n' + real.join('\n') : 'No console errors.');
  if (errors.length !== real.length) console.log(`(${errors.length - real.length} GPU/driver warnings ignored)`);
  process.exit(real.length ? 1 : 0);
})();
