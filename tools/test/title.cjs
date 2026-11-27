// Screenshot the real title screen and the first seconds after clicking Begin (no shortcuts).
const { chromium } = require('playwright');
(async () => {
  const [, , url, out] = process.argv;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(url);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: out + '/title_loading.png', timeout: 120000 });
  await page.waitForSelector('#start:not(.hidden)', { timeout: 240000 });
  await page.screenshot({ path: out + '/title_ready.png', timeout: 120000 });
  await page.click('#start');
  await page.waitForTimeout(25000);
  await page.screenshot({ path: out + '/title_after.png', timeout: 120000 });
  console.log(errs.join('\n'));
  await browser.close();
})();
