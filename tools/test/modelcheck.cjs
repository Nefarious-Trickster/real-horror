const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  const errs = []; page.on('console', (m) => { if (/model fail|entity model fallback|Refused|CSP|Content Security/i.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await page.goto(process.argv[2]);
  await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 240000 });
  const r = await page.evaluate(() => ({ failed: window.__game.props.failed || 0, cached: window.__game.props.cache.size, entityBones: !!window.__game.entity.model.bones }));
  console.log(JSON.stringify(r)); console.log(errs.slice(0, 5).join('\n'));
  await browser.close();
})();
