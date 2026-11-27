// usage: node tools/test/shot.mjs <outdir> '<json array of shots>'
// shot: {name, pos:[x,y,z], yaw, pitch, setup: "js code run in page with g=window.__game", wait}
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [, , out = 'shots', json = '[]', url = 'http://localhost:5173/'] = process.argv;
const shots = JSON.parse(json);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto(url);
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 180000 });
await page.evaluate(() => { const g = window.__game; g.ui.el.title.classList.add('hidden'); g.ui.el.hud.classList.remove('hidden'); g.state = 'playing'; g.input.enabled = true; g.ui.fade(0, 0.01); g.startAmbience(); });
for (const s of shots) {
  await page.evaluate((s) => {
    const g = window.__game;
    if (s.setup) new Function('g', s.setup)(g);
    if (s.pos) g.player.teleport(s.pos[0], s.pos[1], s.pos[2], s.yaw ?? 0, s.pitch ?? 0);
  }, s);
  await page.waitForTimeout(s.wait ?? 1500);
  await page.screenshot({ path: `${out}/${s.name}.png`, timeout: 180000 });
}
console.log(errors.slice(0, 40).join('\n'));
await browser.close();
