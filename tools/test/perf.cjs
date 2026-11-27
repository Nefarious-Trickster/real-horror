const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  const t0 = Date.now();
  await page.goto(process.argv[2] || 'http://localhost:5180/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 240000 });
  console.log('boot ms', Date.now() - t0);
  const r = await page.evaluate(() => new Promise((res) => { const g = window.__game; const r = g.renderer.info; let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s > 5000) res({ fps: n / 5, calls: r.render.calls, tris: r.render.triangles, progs: r.programs.length }); else requestAnimationFrame(f); }; f(); }));
  console.log(JSON.stringify(r));
  console.log(errs.slice(0, 20).join('\n'));
  await browser.close();
})();
