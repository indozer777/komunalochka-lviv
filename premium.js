(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = value => new Date(value).toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Kyiv' });
  let state = { ready: false, user: null, isAdmin: false, access: { active: false }, request: null, error: '', signIn: '/signin-with-chatgpt?return_to=%2F%3Fpremium%3D1', signOut: '/signout-with-chatgpt?return_to=%2F' };
  let refreshGeneration = 0;
  let pending, tab = 'code', codeDraft = '', messageDraft = '', formBusy = false, signature = '', verifiedAt = 0, serverOffset = 0;
  const isActive = () => Boolean(state.ready && !state.error && state.access?.active && Date.now() - verifiedAt < 5 * 60000 && (state.access.expiresAt === null || state.access.expiresAt > Date.now() + serverOffset));
  async function api(path, { method = 'GET', body } = {}) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const authHeaders = await window.KomunalAccount?.headers() || {};
      const response = await fetch('/api/premium' + path, { method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { ...authHeaders, ...(method === 'POST' ? { 'Content-Type': 'application/json', 'X-Komunalochka-Request': '1' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      let data; try { data = await response.json(); } catch { throw new Error('Сервіс Premium тимчасово недоступний.'); }
      if (!response.ok) { const error = new Error(data.error || 'Не вдалося завершити дію.'); error.status = response.status; throw error; }
      return data;
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('Немає зв’язку із сервісом Premium. Спробуйте ще раз.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function update(data) {
    state = { ...data, ready: true, error: '' }; verifiedAt = Date.now(); serverOffset = (data.serverTime || verifiedAt) - verifiedAt;
    render(); window.dispatchEvent(new Event('komunal-premium-change'));
  }
  async function refresh({ force = false } = {}) {
    if (pending && !force) return pending;
    const generation = ++refreshGeneration;
    const operation = (async () => {
      try { const data = await api('/session'); if (generation === refreshGeneration) update(data); }
      catch (error) { if (generation === refreshGeneration) { state = { ...state, ready: true, error: error.message, access: { active: false } }; render(); window.dispatchEvent(new Event('komunal-premium-change')); } }
      finally { if (generation === refreshGeneration) pending = null; }
      return generation === refreshGeneration ? state : pending || state;
    })();
    pending = operation;
    return operation;
  }
  function render(force = false) {
    const account = $('#account-button');
    if (account) { account.textContent = state.user ? (isActive() ? 'Premium ✓' : 'Мій акаунт') : 'Увійти'; account.title = state.user?.email || 'Отримати безкоштовний Premium'; }
    const content = $('#premium-content'); if (!content) return;
    const nextSignature = JSON.stringify([state.ready, state.user, state.access, state.request, state.error, state.isAdmin, window.KomunalAccount?.isEnabled(), tab]);
    if (!force && (signature === nextSignature || formBusy)) return;
    signature = nextSignature;
    const title = $('#premium-title'); if (title) title.textContent = isActive() ? 'Premium уже з вами.' : 'Більше можливостей — безкоштовно.';
    if (!state.ready) { content.innerHTML = '<p class="premium-loading">Перевіряємо акаунт…</p>'; return; }
    if (state.error) { content.innerHTML = `<div class="premium-state warning"><strong>Не вдалося перевірити доступ</strong><p>${esc(state.error)}</p><button type="button" class="button secondary full" data-premium-refresh>Спробувати ще раз</button>${window.KomunalAccount?.isEnabled() ? '<button class="button secondary full premium-email-retry" data-email-login>Увійти знову за поштою</button>' : ''}</div>`; return; }
    if (!state.user) {
      content.innerHTML = `<div class="premium-state"><span class="premium-free-label">0 грн · за промокодом або заявкою</span><h3>Почнімо з вашого акаунта</h3><p>${window.KomunalAccount?.isEnabled() ? 'Увійдіть за поштою, щоб активувати промокод або подати заявку. Ми надішлемо одноразовий код — пароль не потрібен.' : 'Увійдіть через ChatGPT, щоб активувати промокод або подати заявку. Premium відновиться на інших пристроях після входу в цей самий акаунт.'}</p>${window.KomunalAccount?.isEnabled() ? '<button id="premium-email-sign-in" class="button primary full" data-email-login>Увійти за поштою</button>' : `<a id="premium-sign-in" class="button primary full" href="${esc(state.signIn)}" target="_top">Увійти через ChatGPT <span>↗</span></a>`}<small>Базовий калькулятор і передача показників доступні без входу.</small></div>`;
      return;
    }
    const identity = `<div class="premium-account"><div><small>ВИ УВІЙШЛИ ЯК</small><strong>${esc(state.user.name)}</strong><span>${esc(state.user.email)}</span></div>${state.authProvider === 'email' ? '<button type="button" data-email-signout>Вийти</button>' : `<a href="${esc(state.signOut)}" target="_top">Вийти</a>`}</div>`;
    const request = state.request;
    const requestState = request ? `<div class="premium-request-state ${request.status}"><strong>${{ pending: 'Заявка очікує розгляду', approved: 'Заявку схвалено', declined: 'Заявку відхилено' }[request.status] || 'Ваша заявка'}</strong><small>${date(request.createdAt)}</small>${request.note ? `<p>${esc(request.note)}</p>` : ''}${request.status === 'pending' ? '<p>Рішення з’явиться тут після розгляду адміністратором.</p><button type="button" class="text-button" data-premium-refresh>Перевірити рішення ↻</button>' : ''}</div>` : '';
    const form = `<form id="premium-form" novalidate><label for="activation-key">Ваш промокод</label><input id="activation-key" class="key-input" placeholder="XXXX-XXXX-XXXX-XXXX" value="${esc(codeDraft)}" maxlength="19" autocomplete="off" spellcheck="false" aria-describedby="key-feedback" required><p id="key-feedback" class="form-feedback" role="status"></p><button class="button primary full" type="submit">${isActive() ? 'Застосувати промокод' : 'Активувати Premium'}</button><small class="premium-form-hint">Кожен промокод можна використати один раз для свого акаунта. Умови доступу задає адміністратор.</small></form>`;
    if (isActive()) {
      content.innerHTML = identity + `<div class="premium-state success"><span class="premium-free-label">PREMIUM АКТИВНИЙ</span><h3>Ваш дім може більше</h3><p>${state.access.source === 'owner' ? 'Доступ власника сайту.' : state.access.expiresAt === null ? 'Безстроковий доступ для вашого акаунта.' : 'Доступ до ' + date(state.access.expiresAt) + ' (Київ).'}</p>${state.isAdmin ? '<a id="premium-admin-link" class="button primary full" href="/admin">Керувати Premium ↗</a>' : '<button type="button" class="button secondary full" data-premium-close>Повернутися до розрахунків</button>'}</div>` + (state.isAdmin ? '' : `<details class="premium-extend"><summary>Маєте ще один промокод?</summary>${form}</details>`);
      return;
    }
    const waiting = request?.status === 'pending';
    const cooldown = request && request.createdAt + 86400000 > Date.now() + serverOffset;
    const requestForm = waiting ? '' : `<form id="premium-request-form" novalidate><label for="premium-request-message">Коротко розкажіть, для чого вам Premium</label><textarea id="premium-request-message" minlength="10" maxlength="600" rows="3" placeholder="Наприклад, хочу вести історію витрат своєї родини…" required aria-describedby="request-feedback">${esc(messageDraft)}</textarea><small>Від 10 до 600 символів. Звернення побачить адміністратор разом із вашим ім’ям та email.</small><p id="request-feedback" class="form-feedback" role="status">${cooldown ? 'Наступну заявку можна надіслати після ' + date(request.createdAt + 86400000) + '.' : ''}</p><button class="button primary full" type="submit" ${cooldown ? 'disabled' : ''}>Подати безкоштовну заявку</button></form>`;
    content.innerHTML = identity + requestState + `<div class="premium-tabs" role="group" aria-label="Спосіб отримання Premium"><button type="button" data-premium-tab="code" aria-pressed="${tab === 'code'}">Маю промокод</button><button type="button" data-premium-tab="request" aria-pressed="${tab === 'request'}">Подати заявку</button></div>` + (tab === 'code' ? form : requestForm || '<p class="premium-form-hint">Повторно надсилати заявку не потрібно. Перевірте рішення кнопкою вище.</p>');
  }
  document.addEventListener('input', event => {
    const el = event.target;
    if (el.id === 'activation-key') {
      const raw = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
      codeDraft = (raw.match(/.{1,4}/g) || []).join('-'); el.value = codeDraft;
      el.setAttribute('aria-invalid', 'false'); if ($('#key-feedback')) $('#key-feedback').textContent = '';
    }
    if (el.id === 'premium-request-message') messageDraft = el.value;
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.premiumTab) { tab = button.dataset.premiumTab; render(true); $(`[data-premium-tab="${tab}"]`)?.focus(); }
    if (button.hasAttribute('data-premium-refresh')) { button.disabled = true; const original = button.textContent; button.textContent = 'Перевіряємо…'; await refresh(); if (button.isConnected) { button.disabled = false; button.textContent = original; } }
    if (button.hasAttribute('data-premium-close')) $('#premium-dialog [data-close]')?.click();
  });
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!['premium-form', 'premium-request-form'].includes(form.id)) return;
    event.preventDefault(); if (formBusy) return;
    const isCode = form.id === 'premium-form', feedback = $(isCode ? '#key-feedback' : '#request-feedback');
    const value = $(isCode ? '#activation-key' : '#premium-request-message').value.trim();
    if (isCode ? !/^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/.test(value) : value.length < 10) { feedback.textContent = isCode ? 'Введіть усі 16 символів промокоду.' : 'Напишіть звернення, щонайменше 10 символів.'; return; }
    const button = form.querySelector('button[type="submit"]'), original = button.textContent;
    formBusy = true; button.disabled = true; button.textContent = 'Зберігаємо…'; feedback.textContent = '';
    try {
      const result = await api(isCode ? '/redeem' : '/requests', { method: 'POST', body: isCode ? { code: value } : { message: value } });
      if (isCode) codeDraft = ''; else messageDraft = '';
      formBusy = false; update(result); render(true);
      if (isCode && result.access.active) window.dispatchEvent(new Event('komunal-premium-granted'));
    } catch (error) { feedback.textContent = error.message; if (isCode) $('#activation-key')?.setAttribute('aria-invalid', 'true'); }
    finally { formBusy = false; if (button.isConnected) { button.disabled = false; button.textContent = original; } }
  });
  window.KomunalPremium = { refresh, render, isActive, api, getState: () => structuredClone(state) };
  window.addEventListener('komunal-auth-change', () => { verifiedAt = 0; state = { ...state, ready: false, user: null, isAdmin: false, access: { active: false }, request: null }; render(true); window.dispatchEvent(new Event('komunal-premium-change')); refresh({ force: true }); });
  window.addEventListener('komunal-email-ready', () => render(true));
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
