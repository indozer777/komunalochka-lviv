/* Synthetic readings only. All provider pages are intercepted; nothing is submitted. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const core = require('./load-core.cjs');
const target = process.env.TEST_URL || pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const shots = process.env.SCREENSHOT_DIR || path.resolve(__dirname, '../test-results/networks');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  try {
    const context = await browser.newContext({ locale: 'uk-UA', viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' });
    const external = [], errors = [];
    await context.route('https://**/*', route => {
      external.push({ url: route.request().url(), method: route.request().method(), body: route.request().postData() });
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Контрольована сторінка</title><p>Тест. Показники не приймаються.</p>' });
    });
    await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copied = value; } } }));
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const click = selector => page.locator(selector).click();
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('komunalochka.lviv.v1')));
    const service = name => click(`#view-transfer [data-transfer-service="${name}"]`);
    const prepare = () => click('#readings-transfer-form button[type="submit"]');
    const close = () => click('#general-dialog [data-close]');
    const copy = async key => { await click(`[data-transfer-copy="${key}"]`); return page.evaluate(() => window.__copied); };
    const confirm = async href => {
      assert.equal(await page.locator('[data-transfer-open]').getAttribute('href'), href);
      const popupEvent = context.waitForEvent('page'); await click('[data-transfer-open]'); const popup = await popupEvent;
      await popup.waitForLoadState(); assert.equal(popup.url(), href); await popup.close();
      assert.match(await page.locator('#transfer-record-status').textContent(), /Перехід до форми/);
      await click('#transfer-confirm-button'); await page.locator('#transfer-ack').check(); await click('#transfer-confirm-form button[type="submit"]');
    };
    const screenshot = async name => {
      await page.evaluate(() => { document.activeElement?.blur(); document.querySelector('#toast').classList.remove('visible'); window.scrollTo({ top: 0, behavior: 'instant' }); });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true });
    };
    await fs.mkdir(shots, { recursive: true });
    await page.goto(target); await click('[data-action="demo"]'); await click('#confirm-action');
    await click('#view-dashboard [data-transfer-service="water"]');
    assert.equal(await page.inputValue('#transfer-current'), '327'); assert.equal(await page.inputValue('#transfer-previous'), '320');
    await prepare(); assert.match(await page.locator('#transfer-error-account').textContent(), /рахунок/);
    await page.fill('#transfer-account', '00012345'); await page.fill('#transfer-meterNumber', 'W-42'); await page.fill('#transfer-current', '327,125'); await prepare();
    let state = await saved(), p = state.profiles[0];
    assert.equal(state.activationKey, ''); assert.equal(p.waterTransfer.records.length, 1); assert.equal(p.gasTransfer.records.length, 0);
    assert.equal(p.waterTransfer.records[0].payload.service, 'water'); assert.equal(p.waterTransfer.records[0].payload.current, '327.125');
    assert.equal(await copy('current'), '327.125'); assert.equal(await copy('meterNumber'), 'W-42');
    assert.match(await copy('all'), /Поточний показник: 327.125 м³/);
    await confirm('https://infolviv.com.ua/'); assert.equal((await saved()).profiles[0].waterTransfer.records[0].status, 'confirmed-by-user');
    await prepare(); assert.equal((await saved()).profiles[0].waterTransfer.records.length, 1); await close();
    await page.fill('#transfer-current', '327.5'); await click('[data-transfer-record]'); assert.equal(await copy('current'), '327.125'); await close();
    await screenshot('water-desktop');

    await service('electricity'); assert.equal(await page.inputValue('#transfer-current'), '4960'); assert.equal(await page.inputValue('#transfer-nightCurrent'), '1270');
    await page.fill('#transfer-account', '0012345678'); await page.fill('#transfer-meterNumber', 'EL-007');
    await page.fill('#transfer-nightCurrent', ''); await prepare(); assert.match(await page.locator('#transfer-error-nightCurrent').textContent(), /нічний/);
    await page.fill('#transfer-nightCurrent', '1270'); await page.fill('#transfer-current', '4700'); await prepare(); assert.match(await page.locator('#transfer-error-current').textContent(), /менший/);
    await page.fill('#transfer-current', '4960'); await prepare();
    assert.equal(await copy('current'), '4960'); assert.equal(await copy('nightCurrent'), '1270');
    const text = await copy('all'); assert.match(text, /День · поточний: 4960 кВт·год/); assert.match(text, /Ніч · поточний: 1270 кВт·год/);
    await confirm('https://loe.lviv.ua/send-pokaz');
    p = (await saved()).profiles[0]; assert.equal(p.electricityTransfer.records[0].status, 'confirmed-by-user'); assert.equal(p.waterTransfer.records[0].status, 'confirmed-by-user');
    await screenshot('electricity-desktop');
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 }); await screenshot(`electricity-${width}`);
      await service('water'); await screenshot(`water-${width}`); await service('electricity');
    }
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.selectOption('#transfer-zone', 'single'); assert.equal(await page.locator('#transfer-nightCurrent').count(), 0);
    await page.selectOption('#transfer-channel', 'loeCabinet'); assert.equal(await page.inputValue('#transfer-account'), '0012345678'); await prepare();
    assert.equal(await page.locator('[data-transfer-open]').getAttribute('href'), 'https://info.loe.lviv.ua/'); assert.doesNotMatch(await copy('all'), /Ніч/); await close();
    p = (await saved()).profiles[0]; assert.equal(p.electricityTransfer.records.length, 2); assert.equal(p.electricityTransfer.records[0].payload.zone, 'dual'); assert.equal(p.electricityTransfer.records[0].payload.nightCurrent, '1270'); assert.equal(p.electricityTransfer.records[1].payload.nightCurrent, '');
    await page.selectOption('#transfer-zone', 'dual'); assert.equal(await page.inputValue('#transfer-nightCurrent'), '1270');
    await page.reload(); assert.equal(await page.inputValue('#transfer-account'), '0012345678');
    await service('water'); assert.equal(await page.inputValue('#transfer-account'), '00012345'); assert.equal(await page.inputValue('#transfer-meterNumber'), 'W-42');
    const restored = core.normalizeState(await saved()); assert.equal(restored.profiles[0].waterTransfer.records[0].payload.current, '327.125'); assert.equal(restored.profiles[0].electricityTransfer.records[0].payload.nightCurrent, '1270');
    await click('[data-action="clear-transfer-details"]'); await click('#confirm-action'); assert.equal(await page.inputValue('#transfer-account'), '');
    p = (await saved()).profiles[0]; assert.equal(p.waterTransfer.records.length, 1); assert.equal(p.electricityTransfer.accounts.loe, '0012345678');
    await service('gas'); assert.equal(await page.inputValue('#transfer-account'), ''); assert.equal(await page.locator('.transfer-journal-row').count(), 0);
    assert.match(await page.locator('.transfer-no-meter').textContent(), /Доставка газу/); assert.match(await page.locator('.transfer-no-meter').textContent(), /Вивіз сміття/);
    for (const request of external) { assert.equal(request.method, 'GET'); assert.equal(request.body, null); assert.equal(/00012345|0012345678|W-42|EL-007/.test(request.url), false); }
    assert.deepEqual(errors, []);
    await context.close();

    // Load an actual pre-multiservice shape and ensure its gas record is not duplicated.
    const legacy = core.makeState(), home = legacy.profiles[0], period = legacy.period;
    const dateParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const today = ['year', 'month', 'day'].map(type => dateParts.find(value => value.type === type).value).join('-');
    delete home.waterTransfer; delete home.electricityTransfer; delete home.transferService; delete home.gasTransfer.meterNumber;
    home.drafts[period] = { ...core.makeDraft(), gasPrev: '1250', gasCurrent: '1278' }; home.gasTransfer.readingDate = today; home.gasTransfer.accounts.grmu = '0900123456';
    home.gasTransfer.records.push({ id: 'legacy-gas', status: 'prepared', createdAt: new Date().toISOString(), openedAt: null, confirmedAt: null, confirmationRef: '', payload: { channel: 'grmu', account: '0900123456', surnamePrefix: '', phone: '', previous: '1250', current: '1278', readingDate: today, period, profileName: home.name, address: '' } });
    const oldContext = await browser.newContext(); await oldContext.route('https://**/*', route => route.abort());
    await oldContext.addInitScript(value => localStorage.setItem('komunalochka.lviv.v1', JSON.stringify(value)), legacy);
    const migrated = await oldContext.newPage(); await migrated.goto(target.split('#')[0] + '#transfer');
    assert.equal(await migrated.locator('.transfer-journal-row').count(), 1); await migrated.locator('#readings-transfer-form button[type="submit"]').click();
    assert.equal(await migrated.locator('#general-dialog').isVisible(), true);
    assert.equal(await migrated.evaluate(() => JSON.parse(localStorage.getItem('komunalochka.lviv.v1')).profiles[0].gasTransfer.records.length), 1);
    await oldContext.close();
    console.log('Networks E2E: water, one/two electricity zones, provider/account isolation, snapshots, clipboard, official URLs, migration, mobile layouts and no external submission — OK');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
