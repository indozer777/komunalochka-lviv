const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const target = process.env.TEST_URL || 'http://127.0.0.1:4173';
const shots = process.env.SCREENSHOT_DIR || path.resolve(__dirname, '../test-results/view-mode');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  try {
    await fs.mkdir(shots, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, locale: 'uk-UA', reducedMotion: 'reduce' });
    await context.route('https://**/*', r => r.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(target); await page.waitForFunction(() => window.KomunalPremium?.getState().ready);
    assert.equal(await page.locator('html').getAttribute('data-view-mode'), 'standard');
    assert.equal(await page.locator('.comfortable-guide').isVisible(), false);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('komunalochka.lviv.v1')).lastFetch);
    await page.fill('#gasPrev', '1250'); await page.fill('#gasCurrent', '1278');
    const before = await page.evaluate(() => localStorage.getItem('komunalochka.lviv.v1'));
    await page.locator('[data-display-open]').focus(); await page.keyboard.press('Enter');
    await page.getByRole('radio', { name: /Стандартний/ }).focus(); await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.documentElement.dataset.viewMode === 'comfortable');
    assert.equal(await page.getByRole('radio', { name: /Зручний перегляд/ }).isChecked(), true);
    assert.match(await page.locator('#view-mode-feedback').innerText(), /збережено/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-display-open]').evaluate(e => e === document.activeElement), true);
    assert.equal(await page.locator('.comfortable-guide').isVisible(), true);
    assert.equal(await page.evaluate(() => localStorage.getItem('komunalochka.lviv.v1')), before);
    const sizes = await page.evaluate(() => ({ input: parseFloat(getComputedStyle(document.querySelector('#gasCurrent')).fontSize),
      label: parseFloat(getComputedStyle(document.querySelector('label[for=gasCurrent]')).fontSize),
      button: document.querySelector('#save-calculation').getBoundingClientRect().height }));
    assert(sizes.input >= 22 && sizes.label >= 18 && sizes.button >= 54, JSON.stringify(sizes));
    await page.reload(); assert.equal(await page.locator('html').getAttribute('data-view-mode'), 'comfortable');
    assert.equal(await page.inputValue('#gasCurrent'), '1278');
    assert.equal(await page.locator('#premium-dialog').isVisible(), false); // Free and anonymous.
    const sibling = await context.newPage(); await sibling.goto(target);
    await page.locator('[data-display-open]').click(); await page.getByRole('radio', { name: /Стандартний/ }).check();
    await page.getByRole('button', { name: 'Готово, до розрахунків' }).click();
    await sibling.waitForFunction(() => document.documentElement.dataset.viewMode === 'standard');
    assert.equal(await page.inputValue('#gasCurrent'), '1278'); await sibling.close();
    await page.locator('[data-display-open]').click(); await page.getByRole('radio', { name: /Зручний перегляд/ }).check();
    await page.getByRole('button', { name: 'Готово, до розрахунків' }).click();
    await page.screenshot({ path: path.join(shots, 'comfortable-desktop.png'), fullPage: false });
    await page.locator('#card-gas').screenshot({ path: path.join(shots, 'comfortable-service.png') });
    // Exercise dynamic sections and both themes at small widths using Premium UI fixtures.
    await require('./premium-fixture.cjs')(context, { active: true });
    await page.reload(); await page.waitForFunction(() => window.KomunalPremium?.isActive());
    const fits = async label => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, label);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const view of ['dashboard','tariffs','transfer','history','profiles']) {
        await page.locator(`#navigation [data-view="${view}"]`).click();
        await fits(`${width}px ${view}`);
      }
      await page.locator('#navigation [data-view="transfer"]').click();
      await page.locator('#view-transfer [data-transfer-service="electricity"]').click(); await fits(`${width}px electricity`);
      await page.locator('#view-transfer [data-transfer-service="water"]').click(); await fits(`${width}px water`);
      await page.locator('#navigation [data-view="dashboard"]').click();
      if (width === 390) {
        await page.locator('#card-gas').screenshot({ path: path.join(shots, 'comfortable-mobile-service.png') });
        await page.screenshot({ path: path.join(shots, 'comfortable-mobile.png'), fullPage: false });
        await page.locator('#account-button').click(); await fits('mobile Premium dialog');
        await page.locator('#premium-dialog [data-close]').click();
      }
    }
    await page.locator('[data-action="theme"]').click(); await fits('dark mode');
    await page.locator('#card-gas').screenshot({ path: path.join(shots, 'comfortable-dark.png') });
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.comfortable-guide').isVisible(), false);
    await page.emulateMedia({ media: 'screen' });
    await page.goto(target + '/admin'); await page.locator('[data-display-open]').click();
    assert.equal(await page.getByRole('radio', { name: /Зручний перегляд/ }).isChecked(), true);
    await page.getByRole('radio', { name: /Стандартний/ }).check(); await page.keyboard.press('Escape');
    await page.goto(target); assert.equal(await page.locator('html').getAttribute('data-view-mode'), 'standard');
    assert.equal(await page.inputValue('#gasCurrent'), '1278');
    assert.deepEqual(errors, []); await context.close();
    const blocked = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await blocked.route('https://**/*', r => r.abort());
    await blocked.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('Storage denied'); }; });
    const b = await blocked.newPage(); await b.goto(target); await b.locator('[data-display-open]').click();
    await b.getByRole('radio', { name: /Зручний перегляд/ }).check();
    assert.match(await b.locator('#view-mode-feedback').innerText(), /не дозволив зберегти/);
    assert.equal(await b.locator('html').getAttribute('data-view-mode'), 'comfortable'); await blocked.close();
    console.log('View modes E2E: anonymous access, keyboard, storage, cross-tab, input preservation, responsive sections, themes, print and admin — OK');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
