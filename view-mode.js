/* Display preference is independent of account, Premium and utility records. */
(() => {
  'use strict';
  const key = 'komunalochka.view-mode.v1';
  const root = document.documentElement;
  const normalize = value => value === 'comfortable' ? 'comfortable' : 'standard';
  let mode = 'standard', returnFocus;
  try { mode = normalize(localStorage.getItem(key)); } catch { /* Still usable without storage. */ }
  root.dataset.viewMode = mode;

  document.addEventListener('DOMContentLoaded', () => {
    const dialog = document.createElement('dialog');
    dialog.id = 'view-mode-dialog';
    dialog.className = 'view-mode-modal';
    dialog.setAttribute('aria-labelledby', 'view-mode-title');
    dialog.innerHTML = `<div class="view-mode-heading"><span class="view-mode-symbol" aria-hidden="true">Aa</span><button type="button" class="view-mode-close" aria-label="Закрити налаштування вигляду">×</button></div>
      <h2 id="view-mode-title">Як вам зручніше?</h2><p class="view-mode-intro">Оберіть розмір тексту й кнопок. Можна змінити будь-коли.</p>
      <fieldset class="view-mode-options"><legend class="sr-only">Режим перегляду</legend>
        <label class="view-mode-option"><input type="radio" name="view-mode" value="standard"><span><strong>Стандартний</strong><small>Звичний вигляд сайту та компактні картки.</small></span></label>
        <label class="view-mode-option"><input type="radio" name="view-mode" value="comfortable"><span><strong>Зручний перегляд</strong><small>Великий шрифт, великі кнопки, чіткі підписи й більше простору.</small></span></label>
      </fieldset><p id="view-mode-feedback" class="view-mode-feedback" role="status" aria-live="polite"></p>
      <button type="button" class="view-mode-done">Готово, до розрахунків</button><p class="view-mode-note">Безкоштовно, без входу та Premium. Показники не змінюються.</p>`;
    document.body.append(dialog);
    const feedback = dialog.querySelector('#view-mode-feedback');
    function update() {
      root.dataset.viewMode = mode;
      dialog.querySelectorAll('input[name="view-mode"]').forEach(input => { input.checked = input.value === mode; });
      document.querySelectorAll('[data-display-open]').forEach(button => {
        button.setAttribute('aria-label', `Вигляд і розмір: ${mode === 'comfortable' ? 'зручний перегляд' : 'стандартний'}`);
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-controls', dialog.id);
        button.setAttribute('aria-expanded', String(dialog.open));
      });
    }
    function close() { dialog.close(); }
    document.querySelectorAll('[data-display-open]').forEach(button => button.addEventListener('click', () => {
      returnFocus = button;
      feedback.textContent = '';
      dialog.showModal(); update();
      dialog.querySelector('input:checked').focus({ preventScroll: true });
    }));
    dialog.querySelectorAll('.view-mode-close, .view-mode-done').forEach(button => button.addEventListener('click', close));
    dialog.addEventListener('change', event => {
      if (event.target.name !== 'view-mode') return;
      mode = normalize(event.target.value); update();
      try { localStorage.setItem(key, mode); feedback.textContent = 'Вигляд змінено й збережено в цьому браузері.'; }
      catch { feedback.textContent = 'Вигляд змінено. Браузер не дозволив зберегти вибір: після закриття вкладки оберіть його знову.'; }
    });
    dialog.addEventListener('close', () => { update(); returnFocus?.focus({ preventScroll: true }); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
    });
    window.addEventListener('storage', event => {
      if (event.key !== key && event.key !== null) return;
      mode = normalize(event.newValue); update();
      if (dialog.open) feedback.textContent = 'Вигляд оновлено з іншої вкладки.';
    });
    update();
  }, { once: true });
})();
