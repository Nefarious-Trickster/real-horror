// node tools/entity/shoot.cjs <outdir> pose:cam[:extra] ...   (needs `npx vite --port 5199` running)
const { chromium } = require('playwright');
(async () => {
  const [out, ...shots] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  for (const s of shots) {
    const [pose, cam, extra] = s.split(':');
    const url = `http://localhost:${process.env.PORT || 5199}/tools/entity/preview.html?pose=${pose}&cam=${cam || 'full'}${extra ? '&' + extra.replace(/,/g, '&') : ''}`;
    await page.goto(url);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
    await page.waitForTimeout(300);
    const f = `${out}/${pose}_${cam || 'full'}${extra ? '_' + extra.replace(/[^a-z0-9]+/gi, '') : ''}.png`;
    await page.screenshot({ path: f });
    console.log('shot', f);
  }
  await browser.close();
})();
