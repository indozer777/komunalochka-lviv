(() => {
  'use strict';
  const root = () => document.getElementById('view-reminders');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const services = { gas: 'Газ', water: 'Вода', electricity: 'Електроенергія', delivery: 'Доставка газу', trash: 'Вивіз сміття', housing: 'Квартплата' };
  const date = value => new Date(value).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  let state, generation = 0, busy = false, link, timer, signature = '', draft = { service: 'gas', kind: 'payment', day: '20', time: '09:00' };
  const visible = () => root() && !root().hidden;
  const feedback = text => { const el = root()?.querySelector('#telegram-feedback'); if (el) el.textContent = text; };
  async function api(path, body) {
    const auth = await window.KomunalAccount?.headers() || {};
    const response = await fetch('/api/telegram' + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(12000),
      headers: { ...auth, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Komunalochka-Request': '1' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let data; try { data = await response.json(); } catch { throw new Error('Нагадування тимчасово недоступні. Спробуйте ще раз.'); }
    if (!response.ok) { const error = new Error(data.error || 'Не вдалося зберегти зміну.'); error.status = response.status; throw error; } return data;
  }
  function rememberDraft() {
    const form = root()?.querySelector('#telegram-form');
    if (form) for (const key of ['service','kind','day','time']) draft[key] = form.elements.namedItem(key).value;
  }
  function schedulePoll() {
    clearTimeout(timer);
    if (visible() && !document.hidden && !state?.binding && (state?.pending || (link && link.expiresAt > Date.now()))) timer = setTimeout(() => load(true), 5000);
  }
  function render() {
    if (!visible() || !state) return;
    rememberDraft();
    const heading = '<div class="page-heading"><div><div class="eyebrow">КОМУНАЛОЧКА ПОРУЧ</div><h1>Нагадування<span class="heading-dot">.</span></h1><p>Щоб вчасно оплатити послуги й передати показники.</p></div></div>';
    let body;
    if (!state.authenticated) body = `<div class="panel telegram-intro"><span class="telegram-symbol" aria-hidden="true">↗</span><h2>Комунальні — без забутих дат</h2><p>Увійдіть за поштою, підключіть Telegram і виберіть дату. Бот нагадає, навіть коли сайт закритий.</p><button class="button primary" data-tg="login">Увійти за поштою</button><p class="telegram-note">Нагадування безкоштовні та не потребують Premium.</p></div>`;
    else if (!state.configured) body = '<div class="panel"><h2>Підключення бота завершується</h2><p>Telegram-нагадування скоро стануть доступними. Спробуйте оновити цей розділ трохи пізніше.</p><button class="button secondary" data-tg="refresh">Перевірити ще раз</button></div>';
    else if (!state.binding) body = `<div class="panel telegram-intro"><span class="telegram-symbol" aria-hidden="true">↗</span><h2>Підключіть свій Telegram</h2><p>Бот <strong>@${esc(state.botUsername)}</strong> надсилатиме лише обрані вами нагадування.</p><ol class="telegram-steps"><li>Відкрийте бота за кнопкою нижче.</li><li>Натисніть «Почати» в Telegram.</li><li>Поверніться сюди й підтвердьте свій акаунт.</li></ol>
      ${state.pending ? `<div class="telegram-pending"><h3>Це ваш Telegram?</h3><p>${esc(state.pending.name)}</p><button class="button primary" data-tg="confirm">Так, це мій Telegram</button></div>` : link && link.expiresAt > Date.now() ? `<a class="button primary" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">Відкрити бота в Telegram ↗</a><p class="telegram-note">Посилання діє 10 хвилин. Після «Почати» поверніться на цю сторінку.</p><button class="button secondary" data-tg="refresh">Я натиснув «Почати»</button>` : '<button class="button primary" data-tg="link">Підключити Telegram</button>'}
      <button class="text-button" data-tg="link">Створити нове посилання</button><p class="telegram-note">Підключення можна скасувати будь-коли. Номер телефону вводити не потрібно.</p></div>`;
    else body = `<div class="panel telegram-connected"><div><span class="telegram-connected-label">Telegram підключено</span><h2>${esc(state.binding.name)}</h2><p>Час нагадувань — за Києвом.</p></div><div class="telegram-connection-actions"><button class="button primary" data-tg="test">Перевірити бота</button><button class="button secondary" data-tg="disconnect">Від’єднати Telegram</button></div></div>
      ${state.schedulerReady ? '' : '<div class="notice warning">Розклад ще активується. Налаштування можна зберегти; надсилання почнеться після завершення підключення.</div>'}
      <div class="telegram-layout"><section class="panel"><h2>Додати нагадування</h2><form id="telegram-form" class="telegram-form">
      <div><label for="tg-service">Послуга</label><select id="tg-service" name="service">${Object.entries(services).map(([key, name]) => `<option value="${key}" ${draft.service === key ? 'selected' : ''}>${name}</option>`).join('')}</select></div>
      <div><label for="tg-kind">Про що нагадати</label><select id="tg-kind" name="kind"><option value="payment" ${draft.kind === 'payment' ? 'selected' : ''}>Оплатити послугу</option>${['gas','water','electricity'].includes(draft.service) ? `<option value="readings" ${draft.kind === 'readings' ? 'selected' : ''}>Передати показники</option>` : ''}</select></div>
      <div class="telegram-date-fields"><div><label for="tg-day">День місяця</label><select id="tg-day" name="day">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${Number(draft.day) === i + 1 ? 'selected' : ''}>${i + 1} число</option>`).join('')}</select></div><div><label for="tg-time">Час за Києвом</label><input id="tg-time" name="time" type="time" value="${esc(draft.time)}" required></div></div>
      <p class="telegram-note">Якщо обраного числа немає в місяці, нагадаємо в останній день. Дату оплати й подання показників оберіть за правилами свого постачальника.</p><button class="button primary full" type="submit">Зберегти нагадування</button></form></section>
      <section class="panel"><h2>Мої нагадування <span class="count">${state.reminders.length}</span></h2><div class="telegram-list">${state.reminders.length ? state.reminders.map(r => `<article class="telegram-reminder ${r.enabled ? '' : 'paused'}"><div class="telegram-reminder-heading"><h3>${esc(services[r.service])}</h3><span>${r.enabled ? 'Увімкнено' : 'На паузі'}</span></div><p>${r.kind === 'payment' ? 'Оплатити послугу' : 'Передати показники'} · ${r.day} числа о ${esc(r.time)}</p><p class="telegram-next">${r.completed ? (r.kind === 'payment' ? 'Цього місяця позначено вами як оплачене.' : 'Цього місяця позначено вами як передане.') : r.enabled ? 'Наступне: ' + esc(date(r.nextDue)) : 'Повідомлення не надсилатимуться.'}</p><div class="telegram-reminder-actions"><button class="button secondary" data-tg-action="${r.enabled ? 'pause' : 'enable'}" data-tg-id="${r.id}">${r.enabled ? 'Пауза' : 'Увімкнути'}</button>${r.enabled && !r.completed ? `<button class="button secondary" data-tg-action="done" data-tg-id="${r.id}">${r.kind === 'payment' ? 'Я оплатив' : 'Я передав показники'}</button>` : ''}<button class="text-button" data-tg-action="remove" data-tg-id="${r.id}">Прибрати</button></div></article>`).join('') : '<p class="telegram-empty">Тут будуть ваші нагадування. Додайте перше — наприклад, оплату газу.</p>'}</div></section></div>
      <p class="telegram-note">Кнопки «Я оплатив» і «Показники передано» зберігають вашу відмітку. У повідомленнях немає адрес, особових рахунків чи показників. Команда /stop у боті вимикає всі нагадування.</p>`;
    root().innerHTML = heading + body + '<p id="telegram-feedback" class="telegram-feedback" role="status" aria-live="polite"></p>';
    root().setAttribute('aria-busy', String(busy)); root().querySelectorAll('button').forEach(b => { b.disabled = busy; });
    schedulePoll();
  }
  async function load(quiet = false) {
    const current = ++generation;
    if (!quiet && visible()) root().innerHTML = '<div class="panel"><p role="status">Завантажую налаштування нагадувань…</p></div>';
    try {
      const data = await api('/status'); if (current !== generation || !visible()) return;
      const nextSignature = JSON.stringify({ ...data, serverTime: 0 }); state = data;
      if (!quiet || nextSignature !== signature) { signature = nextSignature; render(); } else schedulePoll();
    } catch { if (current === generation && visible()) { if (quiet) { feedback('Не вдалося перевірити підключення. Натисніть «Я натиснув Почати» ще раз.'); return; } root().innerHTML = '<div class="panel"><h2>Немає зв’язку з нагадуваннями</h2><p>Перевірте інтернет і спробуйте ще раз.</p><button class="button secondary" data-tg="refresh">Повторити</button></div>'; } }
  }
  async function mutate(path, body, message) {
    if (busy) return; rememberDraft(); busy = true; const current = ++generation; clearTimeout(timer);
    root().querySelectorAll('button').forEach(b => { b.disabled = true; }); feedback('Зберігаю…');
    try {
      const data = await api(path, body); if (current !== generation || !visible()) return;
      if (path === '/link') {
        const url = new URL(data.url);
        if (url.origin !== 'https://t.me' || url.pathname !== '/' + state.botUsername || !/^[a-f0-9]{64}$/.test(url.searchParams.get('start') || '')) throw new Error('Не вдалося створити посилання.');
        link = data; state.pending = null;
      } else { state = data; if (state.binding || path === '/disconnect') link = null; }
      busy = false; render(); feedback(message);
    } catch (error) { if (current !== generation) return; busy = false; render(); feedback(error instanceof TypeError || error.name === 'TimeoutError' ? 'Немає зв’язку. Спробуйте ще раз.' : error.message); if (error.status === 401) load(); }
    finally { if (current === generation) busy = false; }
  }
  document.addEventListener('submit', event => { if (event.target.id !== 'telegram-form') return; event.preventDefault(); rememberDraft(); mutate('/reminders', { ...draft, day: Number(draft.day) }, 'Нагадування збережено.'); });
  document.addEventListener('change', event => { if (event.target.id === 'tg-service') { rememberDraft(); if (!['gas','water','electricity'].includes(draft.service)) draft.kind = 'payment'; render(); } });
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-tg],[data-tg-action]'); if (!button || !visible() || busy) return;
    if (button.dataset.tgAction) return mutate('/reminders/' + button.dataset.tgId, { action: button.dataset.tgAction }, button.dataset.tgAction === 'done' ? 'Вашу відмітку збережено.' : 'Налаштування оновлено.');
    const action = button.dataset.tg;
    if (action === 'refresh') return load();
    if (action === 'login') { await window.KomunalAccount?.ready; if (window.KomunalAccount?.isEnabled()) window.KomunalAccount.open(); else location.assign('/signin-with-chatgpt?return_to=%2F%23reminders'); return; }
    if (action === 'link') return mutate('/link', {}, 'Відкрийте бота й натисніть «Почати».');
    if (action === 'confirm') return mutate('/confirm', {}, 'Telegram підключено. Тепер можна додати нагадування.');
    if (action === 'test') return mutate('/test', {}, 'Тестове повідомлення надіслано. Перевірте Telegram.');
    if (action === 'disconnect' && confirm('Від’єднати Telegram і вимкнути всі нагадування?')) return mutate('/disconnect', {}, 'Telegram від’єднано. Нагадування вимкнено.');
  });
  window.addEventListener('komunal-view-change', event => { clearTimeout(timer); if (event.detail.view === 'reminders') { busy = false; load(); } });
  window.addEventListener('komunal-auth-change', () => { ++generation; clearTimeout(timer); state = null; link = null; signature = ''; busy = false; if (visible()) load(); });
  document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden && visible() && !busy) load(true); });
})();
