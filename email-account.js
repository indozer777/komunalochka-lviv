import { createClient } from '@supabase/supabase-js';

/* Auth tokens and refresh are managed by the provider SDK, not utility storage. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let operationVersion = 0;
  let client, enabled = false, dialog, stage = 'email', email = '', busy = false, returnFocus, sessionPresent = false;
  const resendAt = new Map();
  const signal = () => { window.dispatchEvent(new Event('komunal-auth-change')); };
  async function boot() {
    try {
      const response = await fetch('/api/account/config', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(6000) });
      if (!response.ok) return;
      const config = await response.json();
      if (!config.enabled) return;
      client = createClient(config.url, config.publishableKey, { auth: {
        storageKey: 'komunalochka.email-auth.v1', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
      } });
      const { error } = await client.auth.getSession();
      if (error) throw error;
      enabled = true;
      client.auth.onAuthStateChange((_event, session) => {
        sessionPresent = Boolean(session?.user);
        if (session?.user?.email && !dialog?.open) email = session.user.email;
        // Never call another SDK method synchronously from this callback.
        setTimeout(signal, 0);
      });
    } catch { enabled = false; }
  }
  const ready = boot();
  function feedback(message, error = false) {
    const el = $('#email-auth-feedback'); if (!el) return;
    el.textContent = message; el.classList.toggle('error', error);
  }
  function errorText(error, verifying = false) {
    if (error?.status === 429 || /rate_limit|over_email_send_rate_limit|over_request_rate_limit/.test(error?.code || '')) return 'Забагато спроб. Зачекайте кілька хвилин і спробуйте ще раз.';
    if (error?.code === 'email_address_not_authorized' || error?.status >= 500) return 'Зараз не вдалося надіслати або перевірити лист. Спробуйте пізніше.';
    if (error?.name === 'AuthRetryableFetchError' || error instanceof TypeError) return 'Немає зв’язку. Перевірте інтернет і спробуйте ще раз.';
    return verifying ? 'Код не підійшов або строк його дії минув. Перевірте останній лист або отримайте новий код.' : 'Не вдалося надіслати код. Перевірте пошту та спробуйте пізніше.';
  }
  function remaining() { return Math.max(0, Math.ceil(((resendAt.get(email) || 0) - Date.now()) / 1000)); }
  function tick() {
    const button = $('#email-resend');
    if (button) { const seconds = remaining(); button.disabled = busy || seconds > 0; button.textContent = seconds ? `Надіслати знову через ${seconds} с` : 'Надіслати код ще раз'; }
  }
  function render() {
    if (!dialog) return;
    const confirmed = stage === 'confirmed', codeStep = stage !== 'email';
    $('#email-auth-content').innerHTML = `<span class="email-auth-kicker">КОМУНАЛОЧКА · ВАШ АКАУНТ</span><h2 id="email-auth-title">${confirmed ? 'Пошту підтверджено' : codeStep ? 'Перевірте вашу пошту' : 'Увійдіть за допомогою пошти'}</h2>
      <p class="email-auth-intro">${confirmed ? `Пошта <strong>${escape(email)}</strong> уже підтверджена. Завантажте акаунт, щоб завершити вхід.` : codeStep ? `Введіть 6 цифр із листа, який ми надіслали на <strong>${escape(email)}</strong>.` : 'Ми надішлемо вам одноразовий код. Пароль створювати не потрібно.'}</p>
      <div class="email-auth-steps" aria-label="Кроки входу"><span ${!codeStep ? 'aria-current="step"' : ''}><b>1</b>Ваша пошта</span><span ${codeStep ? 'aria-current="step"' : ''}><b>2</b>Код із листа</span></div>
      <form id="email-auth-form" novalidate>${confirmed ? '' : codeStep ? '<label for="email-login-code">Код із листа</label><input id="email-login-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000" aria-describedby="email-auth-feedback" required>' : `<label for="email-login-address">Ваша електронна пошта</label><input id="email-login-address" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254" placeholder="Наприклад, imia@gmail.com" aria-describedby="email-auth-feedback" value="${escape(email)}" required>`}
      <p id="email-auth-feedback" class="email-auth-feedback" role="status" aria-live="polite"></p><button type="submit" class="email-auth-primary">${confirmed ? 'Завершити вхід' : codeStep ? 'Підтвердити код і увійти' : 'Отримати код на пошту'}</button></form>
      ${confirmed ? '<button type="button" id="email-change" class="email-auth-link">Отримати новий код або змінити пошту</button>' : codeStep ? '<button type="button" id="email-resend" class="email-auth-secondary">Надіслати код ще раз</button><button type="button" id="email-change" class="email-auth-link">Змінити адресу пошти</button><p class="email-auth-tip">Немає листа? Перевірте «Спам» і правильність адреси. Використовуйте код з останнього листа. Нікому його не повідомляйте.</p>' : '<p class="email-auth-tip">Якщо ви тут уперше, акаунт створиться після підтвердження пошти. Вхід зберігається в цьому браузері; на спільному пристрої натискайте «Вийти» після роботи.</p><details class="email-auth-legacy"><summary>Раніше входили через ChatGPT?</summary><p>Старий акаунт і його Premium залишаються доступними через попередній спосіб входу. Вхід поштою створює окремий акаунт; автоматичного об’єднання немає.</p><a href="/signin-with-chatgpt?return_to=%2F%3Fpremium%3D1" target="_top">Продовжити через ChatGPT ↗</a></details>'}
      <p class="email-auth-local">Вхід використовується для акаунта та Premium. Ваші показники поки зберігаються лише в цьому браузері.</p>`;
    tick();
  }
  async function open() {
    await ready; if (!enabled) return false;
    if (dialog?.open) return true;
    returnFocus = document.activeElement;
    const premium = $('#premium-dialog'); if (premium?.open) premium.close();
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.id = 'email-auth-dialog'; dialog.className = 'email-auth-modal';
      dialog.setAttribute('aria-labelledby', 'email-auth-title');
      dialog.innerHTML = '<button type="button" id="email-auth-close" class="email-auth-close" aria-label="Закрити вхід">×</button><div id="email-auth-content"></div>';
      document.body.append(dialog);
      $('#email-auth-close').addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => { operationVersion++; busy = false; if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); });
      dialog.addEventListener('click', e => {
        if (e.target !== dialog) return;
        const r = dialog.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
      });
    }
    operationVersion++; stage = sessionPresent ? 'confirmed' : 'email'; busy = false; render(); dialog.showModal();
    ($('#email-login-address') || $('#email-auth-form button')).focus({ preventScroll: true });
    return true;
  }
  async function send(address = email) {
    const { error } = await client.auth.signInWithOtp({ email: address, options: { shouldCreateUser: true } });
    if (error) throw error;
    resendAt.set(address, Date.now() + 60000);
  }
  async function signOut() {
    await ready; if (!client) return;
    const nativeSession = window.KomunalPremium?.getState().hasSiteSession;
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw error;
    sessionPresent = false; signal();
    await window.KomunalPremium?.refresh({ force: true });
    if (nativeSession) location.assign('/signout-with-chatgpt?return_to=%2F');
  }
  async function headers() {
    await ready;
    if (!client || !enabled) return {};
    const { data, error } = await client.auth.getSession();
    if (error) throw new Error('Не вдалося відновити вхід. Спробуйте увійти знову.');
    return data.session?.access_token ? { Authorization: 'Bearer ' + data.session.access_token } : {};
  }
  async function finishSignIn(ownsView) {
    const result = await window.KomunalPremium?.refresh({ force: true });
    if (!ownsView()) return;
    if (result?.error || !result?.user) {
      stage = 'confirmed'; render();
      feedback('Пошту підтверджено, але акаунт поки не завантажився. Перевірте інтернет і натисніть «Завершити вхід». Повторно вводити цей код не потрібно.', true);
      $('#email-auth-form button').focus(); return;
    }
    dialog.close(); $('#account-button')?.click();
  }
  document.addEventListener('click', event => {
    const login = event.target.closest('[data-email-login]');
    const account = event.target.closest('#account-button');
    if (enabled && (login || (account && !window.KomunalPremium?.getState().user))) {
      event.preventDefault(); event.stopImmediatePropagation(); open(); return;
    }
    const logout = event.target.closest('[data-email-signout]');
    if (logout) {
      event.preventDefault(); event.stopImmediatePropagation(); logout.disabled = true;
      signOut().catch(() => { const error = $('#premium-content') || $('#admin-gate'); if (error) { const p = document.createElement('p'); p.setAttribute('role', 'alert'); p.textContent = 'Не вдалося вийти. Перевірте інтернет і спробуйте ще раз.'; error.append(p); } }).finally(() => { logout.disabled = false; });
    }
    if (event.target.closest('#email-change') && !busy) { stage = 'email'; render(); $('#email-login-address').focus(); }
    if (event.target.closest('#email-resend') && !busy && !remaining()) {
      const operation = ++operationVersion; busy = true; tick(); feedback('Надсилаємо новий код…');
      send(email).then(() => { if (operation === operationVersion) { const input = $('#email-login-code'); input.value = ''; input.removeAttribute('aria-invalid'); input.focus(); feedback('Новий код надіслано. Використовуйте останній лист.'); } }).catch(error => { if (operation === operationVersion) feedback(errorText(error), true); }).finally(() => { if (operation === operationVersion) { busy = false; tick(); } });
    }
  }, true);
  document.addEventListener('input', event => {
    if (event.target.id === 'email-login-code') event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6);
    if (['email-login-code','email-login-address'].includes(event.target.id)) { event.target.removeAttribute('aria-invalid'); feedback(''); }
  });
  document.addEventListener('submit', async event => {
    if (event.target.id !== 'email-auth-form') return;
    event.preventDefault(); if (busy || !client) return;
    const operation = ++operationVersion;
    const ownsView = () => operation === operationVersion && dialog.open;
    const confirmed = stage === 'confirmed', codeStep = stage === 'code', input = $(codeStep ? '#email-login-code' : '#email-login-address');
    const value = input?.value.trim() || '';
    if (!confirmed && (codeStep ? !/^\d{6}$/.test(value) : !input.validity.valid || !value || value.length > 254)) {
      feedback(codeStep ? 'Введіть усі 6 цифр із листа.' : 'Введіть пошту повністю, наприклад imia@gmail.com.', true); input.setAttribute('aria-invalid', 'true'); input.focus(); return;
    }
    const button = event.target.querySelector('button[type=submit]'), old = button.textContent;
    busy = true; button.disabled = true; button.textContent = confirmed ? 'Завантажуємо акаунт…' : codeStep ? 'Перевіряємо код…' : 'Надсилаємо код…'; feedback(''); tick();
    try {
      if (confirmed) {
        await finishSignIn(ownsView);
      } else if (!codeStep) {
        email = value.toLowerCase();
        if (!remaining()) await send(email);
        if (!ownsView()) return;
        stage = 'code'; render(); $('#email-login-code').focus();
      } else {
        const { error } = await client.auth.verifyOtp({ email, token: value, type: 'email' });
        if (error) throw error;
        if (!ownsView()) return;
        stage = 'confirmed';
        await finishSignIn(ownsView);
      }
    } catch (error) { if (ownsView()) { feedback(errorText(error, codeStep), true); input?.setAttribute('aria-invalid', 'true'); } }
    finally { if (operation !== operationVersion) return; busy = false; if (button.isConnected) { button.disabled = false; button.textContent = old; } tick(); }
  });
  setInterval(() => { if (dialog?.open && stage === 'code') tick(); }, 1000);
  window.KomunalAccount = { ready, open, headers, signOut, isEnabled: () => enabled, hasEmailSession: () => sessionPresent };
  ready.then(() => { window.dispatchEvent(new Event('komunal-email-ready')); });
})();
