/* Complete UI flow with the real provider SDK and controlled Auth HTTP replies.
   No real mail is sent, and no production session is created. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const target = process.env.TEST_URL || 'http://127.0.0.1:4173';
const shots = process.env.SCREENSHOT_DIR || path.resolve(__dirname, '../test-results/email');
const id = 'a38cec6b-7826-44de-bd5f-987b331ca50c';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  try {
    await fs.mkdir(shots, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA', reducedMotion: 'reduce' });
    await context.route('https://**/*', r => r.abort());
    await context.route('**/api/account/config', r => r.fulfill({ json: { enabled: true, url: 'https://email-fixture.supabase.co', publishableKey: 'sb_publishable_' + 'a'.repeat(32), otpLength: 6 } }));
    let otpRequests = 0, verificationAttempts = 0, active = false, pendingRequest = null, verifiedEmail = null, lastToken = null, accountUnavailable = false;
    const user = () => ({ id, aud: 'authenticated', role: 'authenticated', email: verifiedEmail, email_confirmed_at: new Date().toISOString(), phone: '', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], created_at: new Date().toISOString() });
    await context.route('https://email-fixture.supabase.co/auth/v1/**', async route => {
      const req = route.request(), url = new URL(req.url()), body = req.postDataJSON();
      if (url.pathname.endsWith('/otp')) { otpRequests++; assert.equal(body.email, 'older@example.test'); assert.equal(body.create_user, true); return route.fulfill({ json: {} }); }
      if (url.pathname.endsWith('/verify')) {
        verificationAttempts++;
        if (body.token !== '024681') return route.fulfill({ status: 403, json: { code: 'otp_expired', msg: 'Token has expired or is invalid' } });
        assert.equal(body.email, 'older@example.test'); assert.equal(body.type, 'email'); verifiedEmail = body.email;
        const payload = Buffer.from(JSON.stringify({ sub: id, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
        lastToken = 'eyJhbGciOiJIUzI1NiJ9.' + payload + '.test-signature';
        return route.fulfill({ json: { access_token: lastToken, token_type: 'bearer', expires_in: 3600, refresh_token: 'fixture-refresh-token', user: user() } });
      }
      if (url.pathname.endsWith('/logout')) { verifiedEmail = null; return route.fulfill({ status: 204, body: '' }); }
      if (url.pathname.endsWith('/user')) return route.fulfill({ json: user() });
      return route.fulfill({ status: 400, json: { msg: 'Unexpected test endpoint' } });
    });
    await context.route('**/api/premium/**', route => {
      const signedIn = verifiedEmail && route.request().headers().authorization === 'Bearer ' + lastToken;
      const p = new URL(route.request().url()).pathname;
      if (signedIn && accountUnavailable) return route.fulfill({ status: 503, json: { error: 'Сервіс входу тимчасово зайнятий.' } });
      if (p.endsWith('/requests')) { assert(signedIn); pendingRequest = { id: 'email-qa', status: 'pending', message: route.request().postDataJSON().message, createdAt: Date.now(), note: '' }; }
      if (p.endsWith('/redeem')) { assert(signedIn); active = true; }
      return route.fulfill({ json: { user: signedIn ? { id: 'email:' + id, name: verifiedEmail, email: verifiedEmail } : null, authProvider: signedIn ? 'email' : null, hasSiteSession: false,
        isAdmin: false, access: { active: Boolean(signedIn && active), expiresAt: null, source: active ? 'promo' : null }, request: signedIn ? pendingRequest : null,
        signIn: '/signin-with-chatgpt?return_to=%2F%3Fpremium%3D1', signOut: '/signout-with-chatgpt?return_to=%2F', serverTime: Date.now() } });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.install(); await page.goto(target); await page.waitForFunction(() => window.KomunalAccount?.isEnabled() && window.KomunalPremium?.getState().ready);
    await page.fill('#gasPrev', '1250'); await page.fill('#gasCurrent', '1278');
    await page.locator('#account-button').click(); await page.waitForSelector('#email-login-address');
    assert.equal(await page.locator('#premium-dialog').isVisible(), false);
    await page.locator('#email-auth-form button').click(); assert.match(await page.locator('#email-auth-feedback').innerText(), /Введіть пошту повністю/);
    await page.fill('#email-login-address', 'older@example.test');
    await page.screenshot({ path: path.join(shots, 'email-step-mobile.png'), fullPage: false });
    await page.locator('#email-auth-form button').click(); await page.waitForSelector('#email-login-code');
    assert.equal(otpRequests, 1); assert(await page.locator('#email-resend').isDisabled());
    await page.fill('#email-login-code', '12'); await page.locator('#email-auth-form button').click();
    assert.match(await page.locator('#email-auth-feedback').innerText(), /усі 6 цифр/); assert.equal(verificationAttempts, 0);
    await page.fill('#email-login-code', '111111'); await page.locator('#email-auth-form button').click();
    await page.waitForFunction(() => document.querySelector('#email-auth-feedback').textContent.includes('Код не підійшов'));
    assert.equal(await page.locator('#email-login-code').getAttribute('aria-invalid'), 'true');
    await page.clock.fastForward(61000); assert.equal(await page.locator('#email-resend').isDisabled(), false);
    await page.locator('#email-resend').click(); await page.waitForFunction(() => document.querySelector('#email-auth-feedback').textContent.includes('Новий код надіслано'));
    assert.equal(otpRequests, 2);
    await page.screenshot({ path: path.join(shots, 'email-code-mobile.png'), fullPage: false });
    accountUnavailable = true;
    await page.fill('#email-login-code', '024681'); await page.locator('#email-auth-form button').click();
    await page.getByRole('button', { name: 'Завершити вхід', exact: true }).waitFor();
    assert.match(await page.locator('#email-auth-feedback').innerText(), /Повторно вводити цей код не потрібно/);
    assert.equal(await page.locator('#email-login-code').count(), 0);
    accountUnavailable = false;
    await page.getByRole('button', { name: 'Завершити вхід', exact: true }).click();
    await page.waitForSelector('#email-auth-dialog', { state: 'hidden' });
    await page.waitForFunction(() => window.KomunalPremium.getState().authProvider === 'email');
    assert.equal(verificationAttempts, 2); assert.match(await page.locator('#premium-content').innerText(), /older@example.test/);
    assert.equal(await page.inputValue('#gasCurrent'), '1278');
    await page.locator('[data-premium-tab="request"]').click(); await page.fill('#premium-request-message', 'Хочу зберігати історію витрат нашої родини.');
    await page.locator('#premium-request-form button').click(); await page.waitForSelector('.premium-request-state.pending');
    await page.locator('[data-premium-tab="code"]').click(); await page.fill('#activation-key', 'TEST-ONLY-FREE-CODE'); await page.locator('#premium-form button').click();
    await page.waitForFunction(() => window.KomunalPremium.isActive());
    await page.reload(); await page.waitForFunction(() => window.KomunalPremium?.isActive());
    assert.equal(await page.inputValue('#gasCurrent'), '1278'); assert.equal(await page.locator('#email-auth-dialog').count(), 0);
    await page.locator('#account-button').click(); await page.locator('[data-email-signout]').click();
    await page.waitForFunction(() => window.KomunalPremium.getState().ready && !window.KomunalPremium.getState().user);
    assert.equal(await page.evaluate(() => localStorage.getItem('komunalochka.email-auth.v1')), null);
    await page.locator('#premium-dialog [data-close]').click();
    await page.locator('[data-display-open]').click(); await page.getByRole('radio', { name: /Зручний перегляд/ }).check(); await page.keyboard.press('Escape');
    await page.locator('#account-button').click();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `page ${width}`);
      assert.equal(await page.locator('#email-auth-dialog').evaluate(e => e.scrollWidth <= e.clientWidth + 2), true, `dialog ${width}`);
    }
    await page.screenshot({ path: path.join(shots, 'email-step-desktop.png'), fullPage: false });
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#account-button').evaluate(e => e === document.activeElement), true);
    assert.deepEqual(errors, []); await context.close();
    // Disabled integration preserves the current production sign-in and sends no Auth requests.
    const legacy = await browser.newContext(); await legacy.route('https://**/*', r => r.abort());
    await legacy.route('**/api/account/config', r => r.fulfill({ json: { enabled: false } }));
    const l = await legacy.newPage(); await l.goto(target); await l.waitForFunction(() => window.KomunalPremium?.getState().ready);
    await l.locator('#account-button').click(); assert.equal(await l.locator('#premium-sign-in').isVisible(), true); assert.equal(await l.locator('#email-auth-dialog').count(), 0); await legacy.close();
    console.log('Email E2E: SDK send/verify, leading-zero OTP, retry/resend, requests, Premium, reload/logout, local readings, keyboard, responsive and disabled fallback — OK');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
