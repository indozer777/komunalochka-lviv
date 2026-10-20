/* OCR runs in a same-origin Web Worker. Images never leave this device. */
(() => {
  'use strict';
  let dialog, session, enginePromise;
  const $ = selector => dialog.querySelector(selector);
  function status(text) { $('#photo-status').textContent = text; }
  function loadEngine() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!enginePromise) enginePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = '/vendor/ocr/tesseract.min.js'; script.async = true;
      script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('engine'));
      script.onerror = () => { script.remove(); enginePromise = null; reject(new Error('engine')); };
      document.head.append(script);
    });
    return enginePromise;
  }
  function current(s) { return session === s && dialog.open; }
  function release(s) {
    if (!s) return;
    clearTimeout(s.timeout);
    s.worker?.terminate().catch(() => {});
    if (s.url) URL.revokeObjectURL(s.url);
    if (s.image) s.image.src = '';
    if (s.source) { s.source.width = 1; s.source.height = 1; }
  }
  function busy(s, value) {
    s.busy = value; dialog.setAttribute('aria-busy', String(value));
    dialog.querySelectorAll('[data-photo-pick],#photo-read,#photo-reset,#photo-center').forEach(el => { el.disabled = value; });
    $('#photo-progress').hidden = !value;
  }
  function draw(s) {
    if (!s.source || !current(s)) return;
    const canvas = $('#photo-canvas'), ctx = canvas.getContext('2d'), r = s.crop;
    canvas.width = s.source.width; canvas.height = s.source.height;
    ctx.drawImage(s.source, 0, 0);
    ctx.fillStyle = '#0b152b99';
    ctx.fillRect(0, 0, canvas.width, r.y); ctx.fillRect(0, r.y + r.h, canvas.width, canvas.height - r.y - r.h);
    ctx.fillRect(0, r.y, r.x, r.h); ctx.fillRect(r.x + r.w, r.y, canvas.width - r.x - r.w, r.h);
    ctx.strokeStyle = '#6accca'; ctx.lineWidth = Math.max(3, canvas.width / 220); ctx.strokeRect(r.x, r.y, r.w, r.h);
  }
  function resetCrop(s, center = false) {
    const { width: w, height: h } = s.source;
    s.crop = center ? { x: w * .08, y: h * .32, w: w * .84, h: h * .36 } : { x: 0, y: 0, w, h };
    draw(s);
  }
  function apply(s, value) {
    if (!current(s)) return;
    const outcome = s.options.apply(value);
    if (!outcome.ok) { status(outcome.error); return; }
    $('#photo-result').textContent = value.replace('.', ',') + ' ' + s.options.unit;
    $('#photo-result').hidden = false; $('#photo-undo').hidden = false;
    $('#photo-choices').replaceChildren();
    status('Поле вже заповнено. Звірте цифри з фото — їх можна виправити у калькуляторі.');
  }
  async function read(s) {
    if (!current(s) || s.busy || !s.source) return;
    busy(s, true); $('#photo-choices').replaceChildren(); $('#photo-result').hidden = true;
    status('Готую розпізнавання на вашому пристрої. Перший запуск може тривати довше…');
    let timedOut = false;
    try {
      await Promise.race([(async () => {
        const engine = await loadEngine(); if (!current(s) || timedOut) return;
        if (!s.worker) {
          const worker = await engine.createWorker('eng', 1, {
            workerPath: '/vendor/ocr/worker.min.js', corePath: '/vendor/ocr/core', langPath: '/vendor/ocr/lang', workerBlobURL: false,
            logger: message => { if (current(s) && s.busy && message.status === 'recognizing text') {
              $('#photo-progress').value = message.progress; status(`Читаю цифри: ${Math.round(message.progress * 100)}%`);
            } }
          });
          if (!current(s) || timedOut) { await worker.terminate(); return; }
          s.worker = worker;
          await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
        }
        const crop = document.createElement('canvas'), r = s.crop;
        const scale = Math.min(3, 1600 / r.w, 1000 / r.h);
        crop.width = Math.round(r.w * scale); crop.height = Math.round(r.h * scale);
        const ctx = crop.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, crop.width, crop.height);
        ctx.drawImage(s.source, r.x, r.y, r.w, r.h, 0, 0, crop.width, crop.height);
        const { data } = await s.worker.recognize(crop, {}, { text: true, blocks: true });
        crop.width = crop.height = 1;
        if (!current(s) || timedOut) return;
        const choices = window.KomunalMeterOCR.candidates(data);
        if (choices.length === 1 && choices[0].confidence >= 80) { apply(s, choices[0].value); return; }
        if (choices.length) {
          status(choices.length > 1 ? 'На фото кілька чисел. Оберіть саме показник або виділіть його рамкою й повторіть.' : 'Цифри видно нечітко. Звірте запропоноване число з фото перед заповненням.');
          for (const item of choices) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary';
            button.textContent = 'Використати ' + item.value.replace('.', ',');
            button.addEventListener('click', () => apply(s, item.value)); $('#photo-choices').append(button);
          }
        } else status('Не вдалося впевнено прочитати показник. Виділіть лише рядок цифр рамкою або зробіть чіткіше фото без відблисків.');
      })(), new Promise((_, reject) => { s.timeout = setTimeout(() => { timedOut = true; reject(new Error('timeout')); }, 90000); })]);
    } catch (_) {
      if (current(s)) {
        s.worker?.terminate().catch(() => {}); s.worker = null;
        status(timedOut ? 'Розпізнавання триває надто довго. Звузьте рамку до цифр і спробуйте ще раз.' : 'Розпізнавання не завантажилось. Перевірте інтернет і повторіть або внесіть показник вручну.');
      }
    } finally { clearTimeout(s.timeout); if (current(s)) busy(s, false); }
  }
  async function imageSelected(file) {
    const s = session; if (!s || s.busy || !file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) {
      status('Оберіть фото JPEG, PNG або WebP до 20 МБ. На телефоні можна одразу зробити нове фото.'); return;
    }
    let loaded = false; busy(s, true); status('Відкриваю фото…');
    try {
      if (s.url) URL.revokeObjectURL(s.url);
      s.url = URL.createObjectURL(file); const img = new Image(); s.image = img;
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = s.url; });
      if (!current(s)) return;
      if (img.naturalWidth * img.naturalHeight > 60000000 || img.naturalWidth < 80 || img.naturalHeight < 30) throw new Error('image size');
      const scale = Math.min(1, 1600 / img.naturalWidth, 1200 / img.naturalHeight);
      const source = document.createElement('canvas'); source.width = Math.round(img.naturalWidth * scale); source.height = Math.round(img.naturalHeight * scale);
      const ctx = source.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, source.width, source.height); ctx.drawImage(img, 0, 0, source.width, source.height);
      if (s.source) s.source.width = s.source.height = 1;
      s.source = source; URL.revokeObjectURL(s.url); s.url = null; img.src = ''; s.image = null;
      $('#photo-preview').hidden = false; $('#photo-result').hidden = true; resetCrop(s); loaded = true;
    } catch (_) { if (current(s)) status('Не вдалося відкрити фото. Оберіть інше зображення або зробіть нове фото.'); }
    finally { if (current(s)) busy(s, false); }
    if (current(s) && loaded) await read(s);
  }
  function init() {
    if (dialog) return;
    dialog = document.createElement('dialog'); dialog.className = 'modal meter-photo-modal'; dialog.id = 'meter-photo-dialog';
    dialog.setAttribute('aria-labelledby', 'photo-title');
    dialog.innerHTML = `<button type="button" class="icon-button modal-close" id="photo-close" aria-label="Закрити фото">×</button>
      <div class="photo-eyebrow">ЗАПОВНЕННЯ З ФОТО</div><h2 id="photo-title"></h2><p id="photo-target"></p>
      <p class="photo-hint">Зніміть крупно рядок цифр без відблисків. Якщо передаєте цілі одиниці, червоні дробові цифри залиште поза рамкою.</p>
      <div class="photo-pickers"><button type="button" class="button primary" data-photo-pick="camera">Зробити фото</button><button type="button" class="button secondary" data-photo-pick="gallery">Обрати фото</button></div>
      <input type="file" id="photo-camera" accept="image/jpeg,image/png,image/webp" capture="environment" hidden><input type="file" id="photo-gallery" accept="image/jpeg,image/png,image/webp" hidden>
      <div id="photo-preview" hidden><canvas id="photo-canvas" tabindex="0" role="img" aria-label="Фото лічильника та рамка розпізнавання" aria-describedby="photo-crop-help"></canvas>
      <p id="photo-crop-help">За потреби виділіть пальцем або мишею лише цифри. Клавіатура: стрілки переміщують рамку, + та − змінюють її розмір.</p>
      <div class="photo-crop-actions"><button type="button" class="button secondary" id="photo-center">Рамка по центру</button><button type="button" class="button secondary" id="photo-reset">Усе фото</button><button type="button" class="button primary" id="photo-read">Прочитати рамку</button></div></div>
      <progress id="photo-progress" max="1" value="0" aria-label="Розпізнавання фото" hidden></progress>
      <p id="photo-status" role="status" aria-live="polite"></p><output id="photo-result" hidden></output><div id="photo-choices"></div>
      <div class="photo-bottom"><button type="button" class="button secondary" id="photo-undo" hidden>Скасувати заповнення</button><button type="button" class="button primary" id="photo-done">Готово</button></div>
      <p class="photo-privacy">Фото обробляється лише на цьому пристрої й не зберігається на сайті. Показник автоматично потрапляє в чернетку розрахунку.</p>`;
    document.body.append(dialog);
    $('#photo-close').onclick = $('#photo-done').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { const old = session; session = null; release(old); $('#photo-canvas').width = $('#photo-canvas').height = 1; $('#photo-camera').value = $('#photo-gallery').value = ''; (old?.trigger?.isConnected ? old.trigger : document.querySelector('#main'))?.focus({ preventScroll: true }); });
    dialog.querySelectorAll('[data-photo-pick]').forEach(button => button.addEventListener('click', () => {
      const input = $('#photo-' + button.dataset.photoPick); input.value = ''; input.click();
    }));
    for (const id of ['#photo-camera', '#photo-gallery']) $(id).addEventListener('change', event => imageSelected(event.target.files?.[0]));
    $('#photo-read').onclick = () => read(session);
    $('#photo-reset').onclick = () => { if (session?.source && !session.busy) resetCrop(session); };
    $('#photo-center').onclick = () => { if (session?.source && !session.busy) resetCrop(session, true); };
    $('#photo-undo').onclick = () => { const result = session?.options.undo(); if (!result) return; status(result.ok ? 'Попереднє значення відновлено.' : result.error); if (result.ok) { $('#photo-result').hidden = true; $('#photo-undo').hidden = true; } };
    const canvas = $('#photo-canvas'); let start;
    const point = event => { const box = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(canvas.width, (event.clientX - box.left) * canvas.width / box.width)), y: Math.max(0, Math.min(canvas.height, (event.clientY - box.top) * canvas.height / box.height)) }; };
    canvas.addEventListener('pointerdown', event => { if (!session?.source || session.busy) return; start = point(event); canvas.setPointerCapture(event.pointerId); });
    canvas.addEventListener('pointermove', event => { if (!start || !session || session.busy) return; const p = point(event); session.crop = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.max(1, Math.abs(p.x - start.x)), h: Math.max(1, Math.abs(p.y - start.y)) }; draw(session); });
    const end = () => { if (!start || !session) return; start = null; if (session.crop.w < 30 || session.crop.h < 15) resetCrop(session); };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('keydown', event => {
      const s = session; if (!s?.source || s.busy || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(event.key)) return;
      event.preventDefault(); const r = s.crop, w = s.source.width, h = s.source.height, step = Math.max(2, w * .02);
      if (event.key === 'ArrowLeft') r.x -= step; if (event.key === 'ArrowRight') r.x += step;
      if (event.key === 'ArrowUp') r.y -= step; if (event.key === 'ArrowDown') r.y += step;
      if (['+','=','-'].includes(event.key)) { const scale = event.key === '-' ? 1.12 : .88, nw = Math.min(w, Math.max(40, r.w * scale)), nh = Math.min(h, Math.max(20, r.h * scale)); r.x += (r.w - nw) / 2; r.y += (r.h - nh) / 2; r.w = nw; r.h = nh; }
      r.x = Math.max(0, Math.min(w - r.w, r.x)); r.y = Math.max(0, Math.min(h - r.h, r.y)); draw(s);
    });
  }
  window.KomunalMeterPhoto = Object.freeze({ open(options) {
    init(); if (dialog.open) return;
    session = { options, trigger: document.activeElement, busy: false };
    $('#photo-title').textContent = options.title; $('#photo-target').textContent = options.target;
    $('#photo-preview').hidden = $('#photo-result').hidden = $('#photo-undo').hidden = true;
    $('#photo-choices').replaceChildren(); busy(session, false); status('Оберіть фото — показник заповниться автоматично, якщо цифри розпізнаються однозначно.'); dialog.showModal();
  } });
})();
