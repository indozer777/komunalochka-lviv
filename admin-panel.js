/* Private administrative UI; authorization is enforced by the API. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s), esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = t => t === null ? 'Без кінцевої дати' : new Date(t).toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Kyiv' });
  const api = (path, options) => window.KomunalPremium.api('/admin' + path, options);
  let data, selected = 'requests', returnFocus;
  function feedback(message, error = false) { const el = $('#admin-feedback'); el.textContent = message; el.classList.toggle('error', error); if (error) el.focus(); }
  function showDialog(html) { returnFocus = document.activeElement; $('#admin-dialog-content').innerHTML = html; $('#admin-dialog').showModal(); }
  function closeDialog() { $('#admin-dialog').close(); if (returnFocus?.isConnected) returnFocus.focus(); }
  function selectTab(tab) {
    selected = tab;
    document.querySelectorAll('[data-admin-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.adminTab === tab)));
    document.querySelectorAll('.admin-section').forEach(el => { el.hidden = el.id !== 'admin-' + tab; });
  }
  function status(label, kind = '') { return `<span class="admin-status ${kind}">${esc(label)}</span>`; }
  function render() {
    $('#stat-pending').textContent = data.counts.pending; $('#stat-active').textContent = data.counts.active; $('#stat-codes').textContent = data.counts.codes;
    const rows = data.requests.filter(r => $('#request-filter').value === 'all' || r.status === 'pending');
    $('#request-list').innerHTML = rows.length ? rows.map(r => `<article class="admin-request-card"><div class="admin-card-heading"><div><h3>${esc(r.name)}</h3><span>${esc(r.email)}</span></div>${status({ pending: 'Очікує розгляду', approved: 'Схвалено', declined: 'Відхилено' }[r.status], r.status)}</div><p class="admin-message">${esc(r.message)}</p><small>Надіслано ${date(r.createdAt)} · час Києва</small>${r.note ? `<div class="admin-review-note">Ваша відповідь: ${esc(r.note)}</div>` : ''}${r.status === 'pending' ? `<div class="settings-actions"><button class="button primary" data-review="${r.id}" data-decision="approved">Схвалити</button><button class="button secondary" data-review="${r.id}" data-decision="declined">Відхилити</button></div>` : `<small class="admin-reviewed">Розглянуто ${date(r.reviewedAt)}</small>`}</article>`).join('') : '<div class="panel admin-empty">Заявок у цьому списку поки немає.</div>';
    $('#code-list').innerHTML = data.codes.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Промокод</th><th>Активації</th><th>Активувати до</th><th>Тривалість доступу</th><th>Стан</th><th>Дія</th></tr></thead><tbody>${data.codes.map(c => {
      const expired = c.expiresAt !== null && c.expiresAt <= data.serverTime, exhausted = c.usedCount >= c.maxUses;
      return `<tr><td><strong>${esc(c.label)}</strong><small>Створено ${date(c.createdAt)}</small></td><td>${c.usedCount} / ${c.maxUses}</td><td>${date(c.expiresAt)}</td><td>${c.accessDays === null ? 'Безстроково' : c.accessDays + ' днів'}</td><td>${status(!c.enabled ? 'Вимкнено' : expired ? 'Строк минув' : exhausted ? 'Ліміт вичерпано' : 'Доступний', c.enabled && !expired && !exhausted ? 'approved' : '')}</td><td><button class="text-button" data-code-toggle="${c.id}" data-enabled="${c.enabled ? '0' : '1'}">${c.enabled ? 'Вимкнути' : 'Увімкнути'}</button></td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="panel admin-empty">Створіть перший промокод у формі вище.</div>';
    $('#access-list').innerHTML = data.access.length ? data.access.map(a => {
      const active = !a.revoked && (a.expiresAt === null || a.expiresAt > data.serverTime);
      return `<article class="admin-request-card"><div class="admin-card-heading"><div><h3>${esc(a.name)}</h3><span>${esc(a.email)}</span></div>${status(a.revoked ? 'Відкликано' : active ? 'Активний' : 'Строк минув', active ? 'approved' : '')}</div><p>${a.expiresAt === null ? 'Безстроковий доступ' : 'Premium до ' + date(a.expiresAt)} · ${{ promo: 'за промокодом', request: 'за заявкою', admin: 'надано адміністратором' }[a.source] || 'наданий доступ'}</p><div class="settings-actions"><button class="button secondary" data-access="${esc(a.userId)}" data-access-action="grant">${active ? 'Продовжити' : 'Надати доступ'}</button>${active ? `<button class="text-button danger" data-access="${esc(a.userId)}" data-access-action="revoke">Відкликати</button>` : ''}</div></article>`;
    }).join('') : '<div class="panel admin-empty">Тут з’являться акаунти після активації промокоду або схвалення заявки. Ваш доступ власника активний автоматично.</div>';
    selectTab(selected);
  }
  async function load() {
    const button = $('#admin-refresh'); button.disabled = true;
    try {
      const session = await window.KomunalPremium.refresh();
      if (session.error) throw new Error(session.error);
      if (!session.user || !session.isAdmin) {
        $('#admin-workspace').hidden = true; $('#admin-gate').hidden = false;
        $('#admin-gate').innerHTML = `<span class="eyebrow">КЕРУВАННЯ PREMIUM</span><h1>${session.user ? 'Цей акаунт не є адміністратором' : 'Увійдіть як власник сайту'}</h1><p>Доступ перевіряється сервером для кожної дії.</p>${session.authProvider === 'email' ? '<p>Для керування сайтом увійдіть акаунтом власника через ChatGPT.</p><button class="button primary" data-email-signout>Вийти з цього акаунта</button>' : `<a class="button primary" href="${esc(session.user ? session.signOut : session.signIn.replace(encodeURIComponent('/?premium=1'), encodeURIComponent('/admin')))}" target="_top">${session.user ? 'Вийти з цього акаунта' : 'Увійти через ChatGPT'}</a>`}`;
        return;
      }
      data = await api('');
      $('#admin-gate').hidden = true; $('#admin-workspace').hidden = false;
      $('#admin-identity').innerHTML = `<span>Ви керуєте як <strong>${esc(session.user.email)}</strong></span><a href="${esc(session.signOut)}" target="_top">Вийти</a>`;
      render();
    } catch (error) { feedback(error.message, true); if (!data) { $('#admin-gate').innerHTML = `<h1>Не вдалося завантажити панель</h1><p>${esc(error.message)}</p><button class="button secondary" id="admin-retry">Спробувати ще раз</button>`; } }
    finally { button.disabled = false; }
  }
  function durationField() { return '<label for="decision-days">Надати Premium на</label><select id="decision-days"><option value="30">30 днів</option><option value="365">365 днів</option><option value="0">Безстроково</option></select>'; }
  async function submitAction(form, path, body) {
    const button = form.querySelector('button[type="submit"]'), old = button.textContent;
    button.disabled = true; button.textContent = 'Зберігаємо…';
    try { const result = await api(path, { method: 'POST', body }); closeDialog(); feedback(result.message); await load(); }
    catch (error) { $('#decision-error').textContent = error.message; }
    finally { if (button.isConnected) { button.disabled = false; button.textContent = old; } }
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.adminTab) selectTab(button.dataset.adminTab);
    if (button.id === 'admin-refresh' || button.id === 'admin-retry') await load();
    if (button.id === 'admin-dialog-close') closeDialog();
    if (button.dataset.review) {
      const request = data.requests.find(r => r.id === button.dataset.review), approve = button.dataset.decision === 'approved'; if (!request) return;
      showDialog(`<span class="eyebrow">РІШЕННЯ ЗА ЗАЯВКОЮ</span><h2 id="admin-dialog-title">${approve ? 'Надати Premium' : 'Відхилити заявку'}</h2><p>${esc(request.name)} · ${esc(request.email)}</p><form id="decision-form">${approve ? durationField() : ''}<label for="decision-note">Відповідь користувачу (необов’язково)</label><textarea id="decision-note" rows="3" maxlength="400" placeholder="Ця примітка з’явиться в акаунті користувача"></textarea><p id="decision-error" class="form-feedback" role="status"></p><button class="button primary full" type="submit">${approve ? 'Схвалити заявку' : 'Зберегти рішення'}</button></form>`);
      $('#decision-form').addEventListener('submit', event => { event.preventDefault(); submitAction(event.target, '/requests/' + request.id, { decision: button.dataset.decision, note: $('#decision-note').value, accessDays: approve ? Number($('#decision-days').value) || null : null }); });
    }
    if (button.dataset.codeToggle) {
      button.disabled = true;
      try { const result = await api('/codes/' + button.dataset.codeToggle, { method: 'POST', body: { enabled: button.dataset.enabled === '1' } }); feedback(result.message); await load(); }
      catch (error) { feedback(error.message, true); button.disabled = false; }
    }
    if (button.dataset.access) {
      const grant = button.dataset.accessAction === 'grant', person = data.access.find(a => a.userId === button.dataset.access); if (!person) return;
      showDialog(`<h2 id="admin-dialog-title">${grant ? 'Надати або продовжити Premium' : 'Відкликати Premium?'}</h2><p>${esc(person.email)}</p>${grant ? '' : '<p>Статус зміниться для цього акаунта. Його локальні показники та історія збережуться.</p>'}<form id="access-form">${grant ? durationField() : ''}<p id="decision-error" class="form-feedback" role="status"></p><button class="button primary full" type="submit">${grant ? 'Надати доступ' : 'Відкликати доступ'}</button></form>`);
      $('#access-form').addEventListener('submit', event => { event.preventDefault(); submitAction(event.target, '/access/' + encodeURIComponent(person.userId), { action: grant ? 'grant' : 'revoke', accessDays: grant ? Number($('#decision-days').value) || null : null }); });
    }
    if (button.id === 'copy-generated-code') {
      try { await navigator.clipboard.writeText($('#generated-code').value); button.textContent = 'Скопійовано ✓'; }
      catch { $('#generated-code').select(); $('#code-copy-status').textContent = 'Текст виділено. Скопіюйте його вручну.'; }
    }
  });
  $('#request-filter').addEventListener('change', render);
  $('#create-code-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.target.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const result = await api('/codes', { method: 'POST', body: { label: $('#code-label').value, maxUses: Number($('#code-max-uses').value), validityDays: $('#code-validity').value === '' ? null : Number($('#code-validity').value), accessDays: Number($('#code-access-days').value) || null } });
      feedback('Промокод створено. Збережіть його перед закриттям вікна.');
      await load();
      showDialog(`<span class="eyebrow">НОВИЙ ПРОМОКОД</span><h2 id="admin-dialog-title">Збережіть код</h2><p>${esc(result.message)}</p><label for="generated-code">Промокод</label><input id="generated-code" class="key-input" readonly value="${esc(result.code)}"><button id="copy-generated-code" type="button" class="button primary full">Скопіювати промокод</button><p id="code-copy-status" role="status"></p>`);
    } catch (error) { feedback(error.message, true); }
    finally { button.disabled = false; }
  });
  $('#admin-dialog').addEventListener('click', event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(); } });
  window.addEventListener('komunal-auth-change', () => load());
  load();
})();
