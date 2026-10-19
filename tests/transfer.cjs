/* Guided submission tests use fictional accounts and intercepted provider pages. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const target = process.env.TEST_URL || pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const shots = process.env.SCREENSHOT_DIR || path.resolve(__dirname, '../test-results/transfer');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  try {
    const context = await browser.newContext({ locale: 'uk-UA', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const external = [], errors = [];
    await context.route('https://**/*', route => {
      external.push({ url: route.request().url(), method: route.request().method(), body: route.request().postData() });
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Контрольована сторінка провайдера</title><p>Тестова сторінка. Дані не приймаються.</p>' });
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copiedTransfer = value; } } });
    });
    await require('./premium-fixture.cjs')(context);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const click = selector => page.locator(selector).click();
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('komunalochka.lviv.v1')));
    await page.goto(target); await page.waitForFunction(() => window.KomunalPremium?.getState().ready);
    await click('.nav-item[data-view="transfer"]');
    assert.equal(await page.locator('#readings-transfer-form').isVisible(), true); // Available without Premium.
    await click('#readings-transfer-form button[type="submit"]');
    assert.match(await page.locator('#transfer-error-account').textContent(), /10 цифр/);
    assert.match(await page.locator('#transfer-error-current').textContent(), /цілі м³/);
    await page.fill('#transfer-account', '0900123456');
    await page.fill('#transfer-previous', '1250'); await page.fill('#transfer-current', '1278,1');
    await click('#readings-transfer-form button[type="submit"]'); assert.equal((await saved()).profiles[0].gasTransfer.records.length, 0);
    await page.fill('#transfer-current', '1278');
    await click('#readings-transfer-form button[type="submit"]');
    let state = await saved(), transfer = state.profiles[0].gasTransfer;
    assert.equal(transfer.records.length, 1); assert.equal(transfer.records[0].status, 'prepared');
    assert.equal(await page.locator('#transfer-confirm-button').isDisabled(), true);
    await click('[data-transfer-copy="current"]'); assert.equal(await page.evaluate(() => window.__copiedTransfer), '1278');
    await click('[data-transfer-copy="all"]'); const copied = await page.evaluate(() => window.__copiedTransfer);
    assert.match(copied, /Особовий рахунок: 0900123456/); assert.match(copied, /Поточний показник: 1278 м³/);
    const href = await page.locator('[data-transfer-open]').getAttribute('href'); assert.equal(href, 'https://my.grmu.com.ua/login');
    const popupEvent = context.waitForEvent('page'); await click('[data-transfer-open]'); const popup = await popupEvent;
    await popup.waitForLoadState(); assert.equal(popup.url(), href); await popup.close();
    assert.equal((await saved()).profiles[0].gasTransfer.records[0].status, 'opened');
    assert.equal(await page.locator('#transfer-confirm-button').isDisabled(), false);
    assert.equal((await saved()).profiles[0].gasTransfer.records[0].confirmedAt, null);
    await click('#general-dialog [data-close]');
    await click('#readings-transfer-form button[type="submit"]'); assert.equal((await saved()).profiles[0].gasTransfer.records.length, 1); // No duplicate.
    await click('#general-dialog [data-close]');
    await page.fill('#transfer-current', '1279');
    await click('[data-transfer-record]'); await click('[data-transfer-copy="current"]');
    assert.equal(await page.evaluate(() => window.__copiedTransfer), '1278'); // Immutable snapshot.
    await click('#transfer-confirm-button');
    await click('#transfer-confirm-form button'); assert.equal((await saved()).profiles[0].gasTransfer.records[0].status, 'opened');
    await page.locator('#transfer-ack').check(); await page.fill('#transfer-confirmation-ref', '<примітка>'); await click('#transfer-confirm-form button');
    transfer = (await saved()).profiles[0].gasTransfer;
    assert.equal(transfer.records[0].status, 'confirmed-by-user'); assert.equal(transfer.records[0].confirmationRef, '<примітка>');
    assert.match(await page.locator('#transfer-journal').textContent(), /Позначено вами як передане/);
    await page.reload(); assert.equal((await saved()).profiles[0].gasTransfer.records[0].status, 'confirmed-by-user');
    await click('[data-transfer-record]'); assert.match(await page.locator('.transfer-confirmed-note').textContent(), /<примітка>/);
    assert.equal(await page.locator('#general-content примітка').count(), 0); await click('#general-dialog [data-close]');

    await click('#readings-transfer-form button[type="submit"]'); assert.equal((await saved()).profiles[0].gasTransfer.records.length, 2);
    await click('#general-dialog [data-close]');
    await page.selectOption('#transfer-channel', 'naftogaz'); assert.equal(await page.inputValue('#transfer-account'), '');
    await page.fill('#transfer-account', '123456789');
    await click('#readings-transfer-form button[type="submit"]'); assert.match(await page.locator('#transfer-error-phone').textContent(), /380/);
    await page.fill('#transfer-phone', '0671234567'); await page.fill('#transfer-surnamePrefix', 'іва');
    await click('#readings-transfer-form button[type="submit"]');
    state = await saved(); assert.equal(state.profiles[0].gasTransfer.records.length, 3);
    assert.equal(state.profiles[0].gasTransfer.records[2].payload.phone, '+380671234567');
    assert.equal(await page.locator('[data-transfer-open]').getAttribute('href'), 'https://gas.ua/uk/indicators');
    await click('#general-dialog [data-close]');
    await page.selectOption('#transfer-channel', 'grmu'); assert.equal(await page.inputValue('#transfer-account'), '0900123456');
    await page.reload(); assert.equal(await page.inputValue('#transfer-account'), '0900123456');
    assert.equal((await saved()).profiles[0].drafts[(await saved()).period].gasCurrent, '1279');

    await fs.mkdir(shots, { recursive: true }); await page.evaluate(() => { document.activeElement?.blur(); document.querySelector('#toast').classList.remove('visible'); window.scrollTo({ top: 0, behavior: 'instant' }); });
    await page.screenshot({ path: path.join(shots, 'transfer-desktop.png'), fullPage: true });
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
      await page.screenshot({ path: path.join(shots, `transfer-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.nav-item[data-view="profiles"]').click(); await page.fill('#activation-key', 'TEST-ONLY-FREE-CODE'); await click('#premium-form button');
    await click('.nav-item[data-view="profiles"]'); await click('[data-action="add-profile"]'); await page.fill('#profile-name', 'Інша оселя'); await click('#profile-form button');
    await click('.nav-item[data-view="transfer"]'); assert.equal(await page.inputValue('#transfer-account'), '');
    assert.equal(await page.locator('.transfer-journal-row').count(), 0);
    const first = (await saved()).profiles[0].id; await click('.nav-item[data-view="profiles"]'); await click(`[data-profile-select="${first}"]`);
    await click('.nav-item[data-view="transfer"]'); assert.equal(await page.locator('.transfer-journal-row').count(), 3);
    await click('[data-action="clear-transfer-details"]'); await click('#confirm-action'); assert.equal(await page.inputValue('#transfer-account'), '');
    assert.equal((await saved()).profiles[0].gasTransfer.accounts.naftogaz, ''); assert.equal(await page.locator('.transfer-journal-row').count(), 3);
    await page.locator('[data-transfer-delete]').first().click(); await click('#confirm-action'); assert.equal(await page.locator('.transfer-journal-row').count(), 2);
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }); });
    await page.locator('[data-transfer-record]').first().click(); await click('[data-transfer-copy="current"]');
    assert.equal(await page.locator('#transfer-copy-fallback').isVisible(), true); assert.equal(await page.inputValue('#transfer-copy-fallback'), '1279');

    for (const request of external) {
      assert.equal(request.method, 'GET'); assert.equal(request.body, null);
      assert.equal(request.url.includes('0900123456') || request.url.includes('123456789') || request.url.includes('0671234567'), false);
    }
    assert.deepEqual(errors, []);
    console.log('Gas transfer E2E: validation, snapshots, clipboard, official handoff, honest statuses, persistence, separate accounts/profiles, mobile layout and no external personal data — OK');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
