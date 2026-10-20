const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const target = process.env.TEST_URL || 'http://127.0.0.1:4173';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: 'reduce' });
    await context.route('https://**/*', r => r.abort()); await require('./premium-fixture.cjs')(context, { active: true });
    let state = { authenticated: false, configured: true, schedulerReady: true, botUsername: 'KomunalOchka_bot', binding: null, pending: null, reminders: [] }, unavailable = false, writes = 0;
    await context.route('**/api/telegram/**', async route => {
      if (unavailable) return route.fulfill({ status: 503, json: { error: 'Тимчасово недоступно.' } });
      const req = route.request(), url = new URL(req.url());
      if (req.method() === 'POST') {
        writes++; assert.equal(req.headers()['x-komunalochka-request'], '1'); assert.equal(req.headers()['content-type'], 'application/json');
        const body = req.postDataJSON();
        if (url.pathname.endsWith('/link')) return route.fulfill({ json: { url: 'https://t.me/KomunalOchka_bot?start=' + 'a'.repeat(64), expiresAt: Date.now() + 600000 } });
        if (url.pathname.endsWith('/confirm')) { state.binding = { name: state.pending.name, connectedAt: Date.now() }; state.pending = null; }
        else if (url.pathname.endsWith('/disconnect')) { state.binding = null; state.reminders.forEach(r => { r.enabled = 0; }); }
        else if (url.pathname.endsWith('/reminders')) state.reminders.push({ id: 'caaadaba-1234-4123-9123-abababababab', ...body, enabled: 1, completed: 0, nextDue: Date.now() + 86400000 });
        else if (url.pathname.includes('/reminders/')) {
          if (body.action === 'remove') state.reminders = [];
          else if (body.action === 'done') state.reminders[0].completed = 1;
          else state.reminders[0].enabled = body.action === 'enable' ? 1 : 0;
        }
      }
      return route.fulfill({ json: { ...state, serverTime: Date.now() } });
    });
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(target + '/#reminders'); await page.getByRole('button', { name: 'Увійти за поштою', exact: true }).waitFor();
    state.authenticated = true; await page.evaluate(() => dispatchEvent(new Event('komunal-auth-change')));
    await page.getByRole('button', { name: 'Підключити Telegram', exact: true }).click();
    const link = page.getByRole('link', { name: /Відкрити бота в Telegram/ }); await link.waitFor(); assert.match(await link.getAttribute('href'), /^https:\/\/t.me\/KomunalOchka_bot\?start=a{64}$/); assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    state.pending = { name: '<img src=x onerror=alert(1)>', expiresAt: Date.now() + 600000 };
    await page.getByRole('button', { name: 'Я натиснув «Почати»', exact: true }).click();
    await page.getByRole('button', { name: 'Так, це мій Telegram', exact: true }).waitFor(); assert.equal(await page.locator('#view-reminders img').count(), 0);
    await page.getByRole('button', { name: 'Так, це мій Telegram', exact: true }).click(); await page.locator('#telegram-form').waitFor();
    await page.selectOption('#tg-service', 'trash'); assert.equal(await page.locator('#tg-kind option').count(), 1);
    await page.selectOption('#tg-service', 'electricity'); await page.selectOption('#tg-kind', 'readings'); await page.selectOption('#tg-day', '28'); await page.fill('#tg-time', '10:30');
    await page.getByRole('button', { name: 'Зберегти нагадування' }).click(); await page.locator('.telegram-reminder').waitFor();
    assert.match(await page.locator('.telegram-reminder').innerText(), /Передати показники · 28 числа о 10:30/);
    await page.getByRole('button', { name: 'Пауза', exact: true }).click(); await page.getByRole('button', { name: 'Увімкнути', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Увімкнути', exact: true }).click(); await page.getByRole('button', { name: 'Я передав показники', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Я передав показники', exact: true }).click(); await page.getByText('Цього місяця позначено вами як передане.').waitFor();
    const screenshots = path.resolve(__dirname, '../test-results/telegram'); await fs.mkdir(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, 'desktop.png'), fullPage: false });
    await page.locator('[data-display-open]').click(); await page.getByRole('radio', { name: /Зручний перегляд/ }).check(); await page.keyboard.press('Escape');
    await page.locator('[data-action=theme]').click();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px Telegram overflow`);
      assert(await page.locator('#telegram-form button').evaluate(e => e.getBoundingClientRect().height >= 54));
      if (width === 390) await page.screenshot({ path: path.join(screenshots, 'comfortable-dark-mobile.png'), fullPage: false });
    }
    await page.getByRole('button', { name: 'Прибрати', exact: true }).click(); await page.locator('.telegram-empty').waitFor();
    const beforeLogout = writes; state.authenticated = false; state.binding = null; await page.evaluate(() => dispatchEvent(new Event('komunal-auth-change')));
    await page.getByRole('button', { name: 'Увійти за поштою', exact: true }).waitFor(); assert.equal(await page.locator('#telegram-form').count(), 0); assert.equal(writes, beforeLogout);
    unavailable = true; await page.reload(); await page.getByRole('button', { name: 'Повторити', exact: true }).waitFor();
    unavailable = false; await page.getByRole('button', { name: 'Повторити', exact: true }).click(); await page.getByRole('button', { name: 'Увійти за поштою', exact: true }).waitFor();
    assert.deepEqual(errors, []); await context.close();
    console.log('Telegram UI: login, private link, confirmation, safe text, schedule, pause, done, removal, logout, recovery, responsive comfortable dark mode — OK');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
