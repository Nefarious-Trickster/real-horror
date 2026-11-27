// Drives the whole script headless to catch logic/runtime errors.
const { chromium } = require('playwright');
const OUT = process.argv[2] || '.';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  const errs = [];
  page.on('console', (m) => { const t = m.text(); if ((m.type() === 'error' || m.type() === 'warning') && !t.includes('GPU stall')) errs.push(`[${m.type()}] ${t}`); if (t.startsWith('PT:')) console.log(t); });
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message + '\n' + e.stack));
  await page.goto(process.argv[3] || 'http://localhost:5180/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 240000 });
  await page.evaluate(() => {
    const g = window.__game;
    g.debugDt = 0.25;
    g.audio.ctx.resume();
    g.ui.el.title.classList.add('hidden'); g.state = 'playing'; g.input.enabled = true; g.startAmbience(); g.director.start();
    window.V = (x, y, z) => new g.camera.position.constructor(x, y, z);
    window.useLabel = (re, filter) => { for (const it of g.interact.list) { if (!it.enabled) continue; const l = it.label(); if (l && new RegExp(re).test(l) && (!filter || filter(it))) { it.use(); return l; } } return null; };
    window.log = (m) => console.log('PT: ' + m + ' | stage=' + g.director.stage + ' ' + g.director.stages[g.director.stage] + ' obj=' + (g.ui.currentObjective || ''));
  });
  const step = async (desc, fn, until, timeout = 120000) => {
    await page.evaluate(fn);
    if (until) {
      try { await page.waitForFunction(until, null, { timeout, polling: 250 }); }
      catch (e) { console.log('TIMEOUT at: ' + desc); await page.evaluate(() => log('state')); throw e; }
    }
    await page.evaluate((d) => log(d), desc);
  };
  const FROM = process.argv[4] || '';
  try {
    if (FROM) {
      await page.evaluate((cp) => { const g = __game; g.director.gen++; g.director.checkpoint = cp; g.director.restoreCheckpoint(); }, FROM);
      await page.waitForTimeout(2000);
    }
    if (!FROM) {
    await step('read note', () => { __game.director.read('casket'); __game.ui.closeNote(); }, () => /candles/.test(__game.ui.currentObjective || ''));
    await step('matches', () => { useLabel('Take the matches'); }, () => __game.inventory.has('matches'));
    await step('candles', () => { useLabel('Light the candle'); useLabel('Light the candle'); useLabel('Light the candle'); }, () => __game.director.stage === 1);
    await step('go to door', () => { __game.player.teleport(0, 0, 5.0, 0); }, () => /knocking/.test(__game.ui.currentObjective || ''));
    await step('open door', () => { useLabel('^Open', (it) => it.door && it.door.id === 'front'); }, () => __game.house.doors.get('front').open);
    await step('turn away', () => { __game.player.teleport(-0.3, 0, 3.5, 0); }, () => /Return/.test(__game.ui.currentObjective || ''));
    await step('to parlor', () => { __game.player.teleport(-3, 0, 3, Math.PI / 2); }, () => __game.director.stage === 2);
    await step('phone rings', () => { __game.player.teleport(-2.0, 0, -3.3, -Math.PI / 2); }, () => __game.director.flags.ringing);
    await step('answer', () => { useLabel('Answer'); }, () => /flashlight/.test(__game.ui.currentObjective || ''), 200000);
    await step('drawer', () => { __game.player.teleport(-6.1, 0, -4.4, 0); useLabel('Open the drawer'); __game.flashlight.toggle(); }, () => /Restore/.test(__game.ui.currentObjective || ''));
    await step('hall (entity appears)', () => { __game.player.teleport(-0.4, 0, -1.0, Math.PI); }, () => __game.director.stage === 3);
    await step('cellar', () => { useLabel('^Open', (it) => it.door && it.door.id === 'cellar'); __game.player.teleport(4, -3, -4, Math.PI); }, () => /spare fuse/.test(__game.ui.currentObjective || ''));
    await step('take fuse', () => { __game.player.teleport(-1.6, -3, 4.6, Math.PI); useLabel('Take the fuse'); }, () => /Fit the fuse/.test(__game.ui.currentObjective || ''), 200000);
    await step('fit fuse', () => { __game.player.teleport(-6.2, -3, -3.8, Math.PI / 2); useLabel('Fit the fuse'); }, () => /upstairs/.test(__game.ui.currentObjective || ''), 200000);
    await step('up from cellar', () => { __game.player.teleport(4, 0, -2, 0); }, () => /Check on her/.test(__game.ui.currentObjective || ''));
    await step('see casket', () => { __game.player.teleport(-2.2, 0, 3.25, Math.PI / 2, -0.4); }, () => /Get out/.test(__game.ui.currentObjective || ''), 200000);
    await step('try front door', () => { __game.player.teleport(0, 0, 5.3, 0); useLabel('Locked'); }, () => /Her room/.test(__game.ui.currentObjective || ''));
    await step('bedroom', () => { __game.player.teleport(-3.5, 3, 2.0, Math.PI / 2); }, () => /diary/.test(__game.ui.currentObjective || ''));
    await step('read diary', () => { __game.player.teleport(-5.9, 3, 1.5, Math.PI / 2); useLabel('Read her diary'); __game.ui.closeNote(); }, () => __game.director.stage === 6, 200000);
    await page.evaluate(() => log('entity mode=' + __game.entity.mode + ' pos=' + __game.entity.pos.toArray().map((v) => v.toFixed(1))));
    await page.screenshot({ path: OUT + '/pt_hunt.png' });
    // test death + checkpoint: stand in dark with entity
    await step('wait in dark for death', () => { __game.flashlight.on = false; }, () => __game.state === 'dead', 200000);
    await page.evaluate(() => log('died: ' + __game.ui.el.deathText.textContent));
    await step('retry', () => { __game.retry(); }, () => __game.state === 'playing' && __game.director.stage === 6);
    await step('toy chest', () => { __game.entity.cfg.interval = [999, 999]; __game.player.teleport(3.0, 3, 1.3, -Math.PI / 2); useLabel('toy chest'); }, () => __game.inventory.has('pole'));
    await step('hatch', () => { __game.player.teleport(-0.5, 3, 2.6, 0, 0.9); useLabel('Hook the hatch'); }, () => __game.director.stage === 7);
    }
    await step('climb', () => { __game.player.teleport(0, 5.8, 3.0, 0); }, () => __game.house.zoneAt(__game.player.pos)?.id === 'attic');
    await step('approach shrine', () => { __game.player.teleport(0, 5.8, -1.5, 0); }, () => /key/.test(__game.ui.currentObjective || ''));
    await page.screenshot({ path: OUT + '/pt_attic.png' });
    await step('take key', () => { __game.player.teleport(0.0, 5.8, -3.2, 0); useLabel('Take the key'); }, () => __game.director.stage === 8, 200000);
    await page.evaluate(() => log('entity mode=' + __game.entity.mode + ' pos=' + __game.entity.pos.toArray().map((v) => v.toFixed(1))));
    await step('down to ground', () => { __game.entity.cfg.interval = [999, 999]; __game.entity.nextMove = 999; __game.player.teleport(-0.5, 3, 2.0, 0); }, () => true);
    await page.waitForTimeout(3000);
    await step('front door', () => { __game.player.teleport(0, 0, 5.2, 0); useLabel('Locked'); }, () => __game.house.doors.get('front').open, 200000);
    await step('out', () => { __game.player.teleport(0, 0, 7.4, 0); }, () => __game.state === 'end', 200000);
    console.log('PT: COMPLETE');
  } catch (e) { console.log('FAIL ' + e.message.split('\n')[0]); }
  console.log(errs.slice(0, 30).join('\n'));
  await browser.close();
})();
