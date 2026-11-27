// Stare the creature down: it must flee rather than kill you.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.text().startsWith('ST:')) console.log(m.text()); });
  await page.goto(process.argv[2]);
  await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 240000 });
  await page.evaluate(() => {
    const g = window.__game; g.debugDt = 0.1;
    g.ui.el.title.classList.add('hidden'); g.state = 'playing'; g.input.enabled = true; g.ui.fade(0, 0.01);
    g.power.main = false; g.flashlight.give(); g.flashlight.on = true;
    g.player.teleport(-1.8, 0, -3.0, Math.PI / 2, -0.15);           // kitchen, facing west
    const V = g.camera.position.constructor;
    g.entity.placeAt(new V(-4.8, 0, -3.6), 'stand');
    g.entity.startHunt({ interval: [3.8, 5.5], step: 2.2, killDist: 1.4, lunge: 1.0, react: 0.55, firstDelay: 2 });
    let t = 0;
    const iv = setInterval(() => {
      t++;
      const d = g.entity.pos.distanceTo(g.player.pos);
      if (t % 5 === 0) console.log(`ST: t=${g.time.toFixed(1)} dread=${g.dread.toFixed(2)} seen=${g.entity.seenAmt.toFixed(2)} dist=${d.toFixed(1)} state=${g.state}`);
      if (d > 7 || g.state !== 'playing') { console.log(`ST: END dist=${d.toFixed(1)} state=${g.state}`); clearInterval(iv); window.__done = true; }
    }, 1000);
  });
  await page.waitForFunction(() => window.__done, null, { timeout: 500000, polling: 1000 });
  console.log(errs.join('\n'));
  await browser.close();
})();
