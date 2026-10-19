const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const target = process.env.TEST_URL || 'http://127.0.0.1:4173';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(target)) throw new Error('This suite writes only to a disposable loopback preview.');
const shots = process.env.SCREENSHOT_DIR || path.resolve(__dirname, '../test-results/premium');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  try {
    await fs.mkdir(shots, { recursive: true });
    const context = await browser.newContext({ locale: 'uk-UA', viewport: { width: 1440, height: 1080 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
    await context.route('https://**/*', route => route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const click = s => page.locator(s).click();
    const shot = async (p, name, fullPage = true) => { await p.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); }); await p.screenshot({ path: path.join(shots, name), fullPage, animations: 'disabled' }); };
    await page.goto(target + '/admin');
    await page.waitForSelector('#admin-gate a');
    assert.match(await page.locator('#admin-gate').textContent(), /Увійдіть як власник/);
    assert.equal((await page.request.get(target + '/api/premium/admin')).status(), 401);
    assert.match(await page.locator('#admin-gate a').getAttribute('href'), /return_to=%2Fadmin/);
    await click('#admin-gate a');
    await page.waitForSelector('#admin-workspace:not([hidden])');
    assert.equal(await page.locator('#stat-pending').textContent(), '2');
    assert.match(await page.locator('#request-list').textContent(), /Олена <тест>/);
    assert.equal(await page.locator('#request-list тест').count(), 0);
    await shot(page, 'admin-requests-desktop.png');
    await click('[data-review="qa-request-approve"][data-decision="approved"]');
    await page.fill('#decision-note', 'Вітаємо <тест>!'); await click('#decision-form button[type="submit"]');
    await page.waitForSelector('#admin-dialog', { state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#stat-pending').textContent === '1');
    assert.equal(await page.locator('#stat-active').textContent(), '1');
    await click('[data-review="qa-request-decline"][data-decision="declined"]');
    await page.fill('#decision-note', 'Уточніть звернення, будь ласка.'); await click('#decision-form button[type="submit"]');
    await page.waitForSelector('#admin-dialog', { state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#stat-pending').textContent === '0');
    await page.selectOption('#request-filter', 'all');
    assert.match(await page.locator('#request-list').textContent(), /Вітаємо <тест>!/); assert.equal(await page.locator('#request-list тест').count(), 0);
    await click('[data-admin-tab="access"]');
    await click('[data-access="qa-person-approve"][data-access-action="revoke"]');
    await click('#access-form button[type="submit"]'); await page.waitForSelector('#admin-dialog', { state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#stat-active').textContent === '0');
    assert.match(await page.locator('#access-list').textContent(), /Відкликано/);
    await click('[data-access="qa-person-approve"][data-access-action="grant"]');
    await page.selectOption('#decision-days', '365'); await click('#access-form button[type="submit"]');
    await page.waitForSelector('#admin-dialog', { state: 'hidden' }); await page.waitForFunction(() => document.querySelector('#stat-active').textContent === '1');
    await click('[data-admin-tab="codes"]');
    await page.fill('#code-label', 'QA родина <код>'); await page.fill('#code-max-uses', '2'); await page.fill('#code-validity', '7');
    await click('#create-code-form button'); await page.waitForSelector('#generated-code');
    const code = await page.inputValue('#generated-code'); assert.match(code, /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/);
    await click('#copy-generated-code'); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code);
    await click('#admin-dialog-close');
    const row = page.locator('#code-list tr').filter({ hasText: 'QA родина <код>' }).first();
    await row.locator('[data-code-toggle]').click(); await page.waitForFunction(() => document.querySelector('#admin-feedback').textContent.includes('Нові активації вимкнено'));
    await page.waitForFunction(() => document.querySelector('#code-list tbody tr')?.textContent.includes('Вимкнено'));
    await row.locator('[data-code-toggle]').click(); await page.waitForFunction(() => document.querySelector('#code-list tbody tr')?.textContent.includes('Доступний'));
    assert.equal(await page.locator('#code-list код').count(), 0);
    await shot(page, 'admin-codes-desktop.png');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await shot(page, 'admin-mobile.png', false);
    await page.reload(); await page.waitForSelector('#admin-workspace:not([hidden])');
    await click('[data-admin-tab="codes"]'); assert.match(await page.locator('#code-list').textContent(), /QA родина <код>/);
    await page.goto(target + '/'); await page.waitForFunction(() => window.KomunalPremium?.isActive());
    await click('#account-button'); await page.waitForSelector('#premium-admin-link');
    assert.match(await page.locator('#premium-content').textContent(), /Доступ власника/);
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('komunalochka.lviv.v1')))).activationKey, '');
    await click('#premium-content .premium-account>a'); await page.waitForFunction(() => window.KomunalPremium?.getState().ready && !window.KomunalPremium.getState().user);
    assert.equal((await page.request.get(target + '/api/premium/admin')).status(), 401);
    assert.deepEqual(errors, []); await context.close();

    // Ordinary visitor UI uses controlled replies; server authorization and SQL are covered above and in premium.test.mjs.
    const visitor = await browser.newContext({ locale: 'uk-UA', viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await visitor.route('https://**/*', route => route.abort());
    let authenticated = false, active = false, request = null, outage = false, requestCount = 0;
    const session = () => ({ user: authenticated ? { id: 'visitor-fixture', email: 'person@example.test', name: 'Оселя <тест>' } : null, isAdmin: false,
      access: { active, expiresAt: active ? Date.now() + 30 * 86400000 : null, source: active ? 'request' : null }, request,
      signIn: '/signin-with-chatgpt?return_to=%2F%3Fpremium%3D1', signOut: '/signout-with-chatgpt?return_to=%2F', serverTime: Date.now() });
    await visitor.route('**/api/premium/**', route => {
      const p = new URL(route.request().url()).pathname;
      if (outage) return route.fulfill({ status: 503, json: { error: 'Сервіс тимчасово недоступний.' } });
      if (p.endsWith('/requests')) { requestCount++; request = { id: 'fixture-request', status: 'pending', createdAt: Date.now(), message: route.request().postDataJSON().message, note: '' }; }
      if (p.endsWith('/redeem')) {
        if (route.request().postDataJSON().code !== 'TEST-ONLY-FREE-CODE') return route.fulfill({ status: 400, json: { error: 'Промокод недоступний.' } });
        active = true;
      }
      return route.fulfill({ status: 200, json: session() });
    });
    const v = await visitor.newPage(), visitorErrors = []; v.on('pageerror', e => visitorErrors.push(e.message));
    await v.goto(target); await v.waitForFunction(() => window.KomunalPremium?.getState().ready);
    await v.evaluate(() => { const s = JSON.parse(localStorage.getItem('komunalochka.lviv.v1')); s.activationKey = 'LVIV-2026-HOME-7K2P'; localStorage.setItem('komunalochka.lviv.v1', JSON.stringify(s)); });
    await v.reload(); await v.waitForFunction(() => window.KomunalPremium?.getState().ready); assert.equal(await v.evaluate(() => window.KomunalPremium.isActive()), false);
    await v.locator('#account-button').click(); assert.equal(await v.locator('#premium-sign-in').getAttribute('target'), '_top');
    await shot(v, 'premium-signin-mobile.png', false);
    authenticated = true; await v.evaluate(() => window.KomunalPremium.refresh());
    assert.equal(await v.locator('#premium-content тест').count(), 0);
    await v.locator('[data-premium-tab="request"]').click(); await v.fill('#premium-request-message', 'Коротко'); await v.locator('#premium-request-form button').click(); assert.equal(requestCount, 0);
    await v.fill('#premium-request-message', 'Хочу зберігати історію витрат нашої родини.'); await v.locator('#premium-request-form button').click();
    await v.waitForSelector('.premium-request-state.pending'); assert.equal(requestCount, 1); assert.equal(await v.locator('#premium-request-form').count(), 0);
    assert.equal(await v.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await shot(v, 'premium-request-mobile.png', false);
    active = true; request.status = 'approved'; request.note = 'Вітаємо <тест>!';
    await v.locator('[data-premium-refresh]').click(); await v.waitForFunction(() => window.KomunalPremium.isActive());
    assert.match(await v.locator('#premium-content').textContent(), /PREMIUM АКТИВНИЙ/);
    await v.locator('[data-premium-close]').click();
    await v.locator('.nav-item[data-view="history"]').click(); assert.equal(await v.locator('#view-history').isVisible(), true);
    active = false; await v.evaluate(() => window.KomunalPremium.refresh()); assert.equal(await v.locator('#view-dashboard').isVisible(), true);
    await v.locator('#account-button').click(); await v.locator('[data-premium-tab="code"]').click();
    await v.fill('#activation-key', 'AAAA-BBBB-CCCC-DDDD'); await v.locator('#premium-form button').click(); await v.waitForFunction(() => document.querySelector('#key-feedback').textContent.includes('Промокод недоступний'));
    await v.fill('#activation-key', 'TEST-ONLY-FREE-CODE'); await v.locator('#premium-form button').click(); await v.waitForSelector('#premium-dialog', { state: 'hidden' });
    await v.reload(); await v.waitForFunction(() => window.KomunalPremium?.isActive());
    outage = true; await v.evaluate(() => window.KomunalPremium.refresh()); assert.equal(await v.evaluate(() => window.KomunalPremium.isActive()), false);
    await v.locator('#account-button').click(); assert.match(await v.locator('#premium-content').textContent(), /Спробувати ще раз/);
    outage = false; await v.locator('[data-premium-refresh]').click(); await v.waitForFunction(() => window.KomunalPremium.isActive());
    assert.deepEqual(visitorErrors, []); await visitor.close();
    console.log('Premium E2E: real local auth/D1 admin, request decisions, codes, grants/revocation, account UI, legacy rejection, errors and mobile — OK');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
