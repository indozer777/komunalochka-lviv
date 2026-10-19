/* Optional end-to-end checks. Install Playwright separately; see README. */
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const target = process.env.TEST_URL || pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const screenshotDir = process.env.SCREENSHOT_DIR || path.resolve(__dirname, '../test-results');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  try {
    const context = await browser.newContext({ locale: 'uk-UA', viewport: { width: 1440, height: 1080 }, reducedMotion: 'reduce' });
    // Deterministic provider fixtures: exercise both successful parsing and CORS failure.
    await context.route('https://**/*', route => {
      const url = route.request().url();
      if (url.startsWith('https://gas.ua/')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Тарифний план «Фіксований» Ціна за м³ грн: 8,10 грн</body></html>' });
      if (url.startsWith('https://lvivvodokanal.com.ua/')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Для споживачів, які не є суб’єктами господарювання (населення). Загальний тариф становить 60,00 грн/м³ з ПДВ.</body></html>' });
      return route.abort();
    });
    await require('./premium-fixture.cjs')(context);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(target); await page.waitForFunction(() => window.KomunalPremium?.getState().ready);
    await page.waitForFunction(() => Boolean(localStorage.getItem('komunalochka.lviv.v1')));
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('komunalochka.lviv.v1')));
    const click = selector => page.locator(selector).click();
    assert.equal(await page.locator('.service-card').count(), 5);
    assert.match(await page.locator('#period-display').textContent(), /[а-яіїєґ]/i);
    assert.equal((await saved()).profiles[0].history.length, 0);

    await click('.nav-item[data-view="history"]');
    assert.equal(await page.locator('#premium-dialog').isVisible(), true);
    await page.fill('#activation-key', 'AAAA-BBBB-CCCC-DDDD'); await click('#premium-form button');
    assert.match(await page.locator('#key-feedback').textContent(), /Промокод недоступний/);
    await page.fill('#activation-key', 'TEST-ONLY-FREE-CODE'); await click('#premium-form button');
    await page.waitForSelector('#premium-dialog', { state: 'hidden' });

    await click('[data-action="demo"]'); await click('#confirm-action');
    assert.equal(await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('komunalochka.lviv.v1')), p = s.profiles[0]; return KomunalCore.calculate(p.drafts[s.period], p.rates).total; }), 1590.5);
    await page.fill('#gasCurrent', '1');
    assert.equal(await page.locator('#gasCurrent').getAttribute('aria-invalid'), 'true');
    await page.fill('#gasCurrent', '1278');

    await click('.nav-item[data-view="tariffs"]');
    await page.fill('#rate-gas', '8,50'); assert.equal((await saved()).profiles[0].rates.gas, '8,50');
    await page.fill('#rate-gas', '-1'); assert.match(await page.locator('#rate-error-gas').textContent(), /число/);
    assert.equal((await saved()).profiles[0].rates.gas, '8,50');
    await page.fill('#rate-gas', '7.96');
    await page.locator('#manual-toggle').uncheck(); assert.equal((await saved()).profiles[0].manual, false);
    await page.locator('#manual-toggle').check(); assert.equal((await saved()).profiles[0].rates.trash, '45');
    await click('[data-action="refresh"]'); await page.waitForFunction(() => document.querySelector('[data-action="refresh"]')?.disabled === false);
    assert.match(await page.locator('#fetch-feedback').textContent(), /CORS/);
    assert.equal((await saved()).profiles[0].rates.gas, '7.96'); // No silent application.
    await click('[data-action="apply-rates"]');
    assert.equal((await saved()).profiles[0].rates.gas, '8.10');
    assert.equal((await saved()).profiles[0].rates.water, '60.00');
    assert.equal((await saved()).profiles[0].rates.electricityNight, '2.16');
    await page.fill('#rate-gas', '7.96'); await page.fill('#rate-water', '56.38');

    await click('.nav-item[data-view="dashboard"]'); await click('#save-calculation');
    assert.equal((await saved()).profiles[0].history.length, 1);
    await click('#save-calculation'); assert.equal(await page.locator('#general-dialog').isVisible(), true); await click('#confirm-action');
    assert.equal((await saved()).profiles[0].history.length, 1);
    await click('.nav-item[data-view="history"]'); assert.equal(await page.locator('.history-chart').count(), 1);
    await click('[data-metric="electricity"]');
    assert.match(await page.locator('.history-chart').getAttribute('aria-label'), /230/);

    await click('.nav-item[data-view="profiles"]'); await click('[data-action="add-profile"]');
    await page.fill('#profile-name', 'Оселя <тест>'); await page.fill('#profile-address', 'вул. Франка, 10'); await click('#profile-form button');
    let state = await saved(); assert.equal(state.profiles.length, 2); assert.equal(state.profiles[1].history.length, 0);
    assert.match(await page.locator('.profile-list').textContent(), /Оселя <тест>/);
    assert.equal(await page.locator('.profile-list тест').count(), 0);
    await click(`[data-profile-select="${state.profiles[0].id}"]`);
    await click('[data-action="theme"]'); assert.equal(await page.locator('body').getAttribute('data-theme'), 'dark');
    await page.reload(); await page.waitForFunction(() => window.KomunalPremium?.isActive()); assert.equal(await page.locator('body').getAttribute('data-theme'), 'dark'); assert.equal((await saved()).profiles.length, 2);

    const backupEvent = page.waitForEvent('download'); await click('[data-action="export"]'); const backup = await backupEvent;
    assert.match(backup.suggestedFilename(), /komunalochka-backup/);
    await click('[data-action="import"]');
    await page.locator('#backup-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":99}') });
    await page.waitForFunction(() => document.querySelector('#import-feedback').textContent.includes('не завантажено'));
    assert.equal((await saved()).profiles.length, 2);
    await page.locator('#backup-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(await saved())) });
    await page.waitForSelector('#confirm-action'); await click('#confirm-action'); assert.equal((await saved()).profiles.length, 2);

    await click('.nav-item[data-view="dashboard"]');
    await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
    await click('[data-action="print"]'); assert.equal(await page.evaluate(() => window.__printed), true);
    assert.match(await page.locator('#print-receipt').textContent(), /1\s?590,50/);
    await click('[data-action="theme"]');
    await fs.mkdir(screenshotDir, { recursive: true });
    await page.evaluate(() => document.querySelector('#toast').classList.remove('visible'));
    await page.screenshot({ path: path.join(screenshotDir, 'desktop.png'), fullPage: true });
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}px`);
      await page.screenshot({ path: path.join(screenshotDir, `layout-${width}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);

    const blocked = await browser.newContext();
    await blocked.route('https://**/*', route => route.abort());
    await blocked.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota', 'QuotaExceededError'); }; });
    const fallback = await blocked.newPage(); await fallback.goto(target);
    assert.equal(await fallback.locator('#storage-warning').isVisible(), true);
    assert.match(await fallback.locator('#save-indicator').textContent(), /Лише в цій вкладці/);
    await blocked.close(); await context.close();
    console.log('E2E: формули, Premium, тарифи, CORS, історія, профілі, XSS, PDF, JSON, теми, адаптивність та недоступне сховище — OK');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
