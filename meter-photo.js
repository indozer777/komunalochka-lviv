/* Meter vision + OCR run in same-origin workers. Images stay on this device. */
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
    s.vision?.terminate(); s.pendingVision?.reject(new Error('cancelled')); s.pendingVision = null;
    if (s.url) URL.revokeObjectURL(s.url);
    if (s.image) s.image.src = '';
    if (s.source) { s.source.width = 1; s.source.height = 1; }
  }
  function busy(s, value) {
    s.busy = value; dialog.setAttribute('aria-busy', String(value));
    dialog.querySelectorAll('[data-photo-pick],#photo-read,#photo-reset,#photo-center,#photo-find,#photo-ignore-red,#photo-regions button').forEach(el => { el.disabled = value; });
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
    s.manual = false; s.angle = 0; s.detected = false;
    draw(s);
  }
  function vision(s, action, canvas) {
    if (!s.vision) {
      s.vision = new Worker('/meter-vision-worker.js');
      s.vision.onmessage = ({ data }) => {
        const pending = s.pendingVision;
        if (!pending || pending.id !== data.id) return;
        s.pendingVision = null;
        if (data.error) pending.reject(new Error('vision')); else pending.resolve(data.result);
      };
      s.vision.onerror = () => { s.pendingVision?.reject(new Error('vision')); s.pendingVision = null; s.vision?.terminate(); s.vision = null; };
    }
    const image = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
      const id = (s.visionId || 0) + 1; s.visionId = id; s.pendingVision = { id, resolve, reject };
      s.vision.postMessage({ id, action, image: { width: image.width, height: image.height, data: image.data }, options: { ignoreRed: $('#photo-ignore-red').checked } }, [image.data.buffer]);
    });
  }
  async function findDisplay(s) {
    status('Шукаю рядок табло на фото…');
    const small = document.createElement('canvas'), scale = Math.min(1, 900 / s.source.width, 700 / s.source.height);
    small.width = Math.round(s.source.width * scale); small.height = Math.round(s.source.height * scale);
    small.getContext('2d').drawImage(s.source, 0, 0, small.width, small.height);
    let found;
    try { found = await vision(s, 'analyze', small); } finally { small.width = small.height = 1; }
    if (!current(s)) return;
    s.regions = found.regions.map(r => ({ ...r, x: r.x / scale, y: r.y / scale, w: r.w / scale, h: r.h / scale }));
    const container = $('#photo-regions'); container.replaceChildren();
    s.detected = s.regions.length > 0; s.manual = false;
    if (s.detected) { s.crop = { ...s.regions[0] }; s.angle = s.regions[0].angle; draw(s); }
    else resetCrop(s);
    if (s.regions.length > 1) for (const [i, region] of s.regions.entries()) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary';
      button.textContent = `Рядок ${i + 1}`; button.setAttribute('aria-pressed', String(i === 0));
      button.addEventListener('click', () => {
        if (s.busy || !current(s)) return;
        s.crop = { ...region }; s.angle = region.angle; s.manual = true; s.detected = true;
        container.querySelectorAll('button').forEach(el => el.setAttribute('aria-pressed', String(el === button)));
        draw(s); read(s);
      }); container.append(button);
    }
    $('#photo-detection').textContent = s.detected ? `${s.regions.length > 1 ? 'Знайдено кілька рядків — перевірте, який є показником.' : 'Знайдено ділянку табло — звірте рамку.'}${Math.abs(s.angle) > 1 ? ' Нахил вирівнюється під час читання.' : ''}` : 'Табло не визначено. Виділіть рядок цифр рамкою, щоб уточнити пошук.';
  }
  function cropCanvas(s) {
    const r = s.crop, crop = document.createElement('canvas'), scale = Math.min(3, 1600 / r.w, 850 / r.h);
    crop.width = Math.max(1, Math.round(r.w * scale)); crop.height = Math.max(1, Math.round(r.h * scale));
    const ctx = crop.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, crop.width, crop.height);
    ctx.translate(crop.width / 2, crop.height / 2); ctx.rotate(-(s.angle || 0) * Math.PI / 180); ctx.scale(scale, scale);
    ctx.drawImage(s.source, -r.x - r.w / 2, -r.y - r.h / 2);
    return crop;
  }
  function preparedCanvas(prepared, key) {
    const canvas = document.createElement('canvas'); canvas.width = prepared.width; canvas.height = prepared.height;
    const ctx = canvas.getContext('2d'), image = ctx.createImageData(canvas.width, canvas.height), binary = key !== 'normalized';
    for (let i = 0; i < prepared[key].length; i++) {
      const value = binary ? (prepared[key][i] ? 0 : 255) : prepared[key][i];
      image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = value; image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0); return canvas;
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
  async function read(s, find = false) {
    if (!current(s) || s.busy || !s.source) return;
    busy(s, true); $('#photo-choices').replaceChildren(); $('#photo-result').hidden = true;
    status('Готую машинне бачення на вашому пристрої. Перший запуск може тривати довше…');
    let timedOut = false;
    try {
      await Promise.race([(async () => {
        if (find) await findDisplay(s);
        if (!current(s) || timedOut) return;
        const crop = cropCanvas(s);
        let prepared;
        try { prepared = await vision(s, 'prepare', crop); } finally { crop.width = crop.height = 1; }
        if (!current(s) || timedOut) return;
        const evidence = [];
        if (prepared.segments) evidence.push(prepared.segments);
        $('#photo-processing').textContent = `Контраст підсилено · ${s.manual || s.detected ? 'рядок табло' : 'усе фото'}${prepared.redPixels && $('#photo-ignore-red').checked ? ' · червоні цифри пропущено' : ''}`;
        const engine = await loadEngine(); if (!current(s) || timedOut) return;
        if (!s.worker) {
          const worker = await engine.createWorker('eng', 1, {
            workerPath: '/vendor/ocr/worker.min.js', corePath: '/vendor/ocr/core', langPath: '/vendor/ocr/lang', workerBlobURL: false,
            logger: message => { if (current(s) && s.busy && message.status === 'recognizing text') {
              $('#photo-progress').value = ((s.pass || 0) + message.progress) / 2; status(`Звіряю цифри, прохід ${(s.pass || 0) + 1} із 2: ${Math.round(message.progress * 100)}%`);
            } }
          });
          if (!current(s) || timedOut) { await worker.terminate(); return; }
          s.worker = worker;
          await worker.setParameters({ preserve_interword_spaces: '1' });
        }
        // Keep letters enabled: removing them could turn a serial label into a reading.
        await s.worker.setParameters({ tessedit_pageseg_mode: s.manual || s.detected ? '7' : '6' });
        for (const [pass, variant] of ['normalized', 'adaptive'].entries()) {
          if (!current(s) || timedOut) return;
          s.pass = pass; const image = preparedCanvas(prepared, variant);
          let data;
          try { ({ data } = await s.worker.recognize(image, {}, { text: true, blocks: true })); } finally { image.width = image.height = 1; }
          for (const item of window.KomunalMeterOCR.candidates(data)) evidence.push({ ...item, engine: variant });
        }
        if (!current(s) || timedOut) return;
        const { choices, automatic } = window.KomunalMeterVision.decide(evidence, { manual: s.manual, regionCount: s.manual ? 1 : s.detected ? s.regions.length : 2 });
        const checkFractions = s.options.unit === 'м³' && prepared.redPixels > 8 && !$('#photo-ignore-red').checked;
        if (automatic && !checkFractions) { apply(s, choices[0].value); return; }
        if (choices.length) {
          status(checkFractions ? 'На фото є червоні цифри: перевірте дробову частину й кому. Для цілих одиниць увімкніть «пропускати червоні дробові цифри» та повторіть читання.' : choices.length > 1 ? 'Є різні варіанти прочитання. Звірте цифри з табло та оберіть правильний.' : 'Прочитано число. Перевірте, що це показник, а не номер лічильника, і підтвердьте заповнення.');
          for (const item of choices) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary';
            button.textContent = 'Заповнити ' + item.value.replace('.', ',') + ' ' + s.options.unit;
            button.addEventListener('click', () => apply(s, item.value)); $('#photo-choices').append(button);
          }
        } else status('Цифри прочитано неоднозначно. Виділіть усі цифри табло рамкою або зробіть ближче фото без відблисків.');
      })(), new Promise((_, reject) => { s.timeout = setTimeout(() => { timedOut = true; reject(new Error('timeout')); }, 90000); })]);
    } catch (_) {
      if (current(s)) {
        s.worker?.terminate().catch(() => {}); s.worker = null;
        s.vision?.terminate(); s.vision = null; s.pendingVision?.reject(new Error('cancelled')); s.pendingVision = null;
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
      $('#photo-preview').hidden = false; $('#photo-result').hidden = true; $('#photo-processing').textContent = ''; resetCrop(s); loaded = true;
    } catch (_) { if (current(s)) status('Не вдалося відкрити фото. Оберіть інше зображення або зробіть нове фото.'); }
    finally { if (current(s)) busy(s, false); }
    if (current(s) && loaded) await read(s, true);
  }
  function init() {
    if (dialog) return;
    dialog = document.createElement('dialog'); dialog.className = 'modal meter-photo-modal'; dialog.id = 'meter-photo-dialog';
    dialog.setAttribute('aria-labelledby', 'photo-title');
    dialog.innerHTML = `<button type="button" class="icon-button modal-close" id="photo-close" aria-label="Закрити фото">×</button>
      <div class="photo-eyebrow">МАШИННЕ БАЧЕННЯ · НА ПРИСТРОЇ</div><h2 id="photo-title"></h2><p id="photo-target"></p>
      <p class="photo-hint">Сфотографуйте лічильник зблизька без відблисків. Спробуємо знайти табло, вирівняти нахил і прочитати цифри.</p>
      <div class="photo-pickers"><button type="button" class="button primary" data-photo-pick="camera">Зробити фото</button><button type="button" class="button secondary" data-photo-pick="gallery">Обрати фото</button></div>
      <input type="file" id="photo-camera" accept="image/jpeg,image/png,image/webp" capture="environment" hidden><input type="file" id="photo-gallery" accept="image/jpeg,image/png,image/webp" hidden>
      <label class="photo-red-option"><input type="checkbox" id="photo-ignore-red">Цілі одиниці: пропускати червоні дробові цифри</label>
      <div id="photo-preview" hidden><p id="photo-detection"></p><div id="photo-regions" aria-label="Знайдені рядки табло"></div><canvas id="photo-canvas" tabindex="0" role="img" aria-label="Фото лічильника та рамка розпізнавання" aria-describedby="photo-crop-help"></canvas>
      <p id="photo-crop-help">За потреби виділіть пальцем або мишею лише цифри. Клавіатура: стрілки переміщують рамку, + та − змінюють її розмір.</p>
      <div class="photo-crop-actions"><button type="button" class="button secondary" id="photo-find">Знайти табло</button><button type="button" class="button secondary" id="photo-center">Рамка по центру</button><button type="button" class="button secondary" id="photo-reset">Усе фото</button><button type="button" class="button primary" id="photo-read">Прочитати рамку</button></div><p id="photo-processing"></p></div>
      <progress id="photo-progress" max="1" value="0" aria-label="Розпізнавання фото" hidden></progress>
      <p id="photo-status" role="status" aria-live="polite"></p><output id="photo-result" hidden></output><div id="photo-choices"></div>
      <div class="photo-bottom"><button type="button" class="button secondary" id="photo-undo" hidden>Скасувати заповнення</button><button type="button" class="button primary" id="photo-done">Готово</button></div>
      <p class="photo-privacy">Фото обробляється на цьому пристрої й не надсилається на сервер. Автозаповнення працює за узгодженого результату; сумнівні цифри потребують підтвердження. Для дня й ночі фотографуйте відповідний регістр окремо.</p>`;
    document.body.append(dialog);
    $('#photo-close').onclick = $('#photo-done').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { const old = session; session = null; release(old); $('#photo-canvas').width = $('#photo-canvas').height = 1; $('#photo-camera').value = $('#photo-gallery').value = ''; (old?.trigger?.isConnected ? old.trigger : document.querySelector('#main'))?.focus({ preventScroll: true }); });
    dialog.querySelectorAll('[data-photo-pick]').forEach(button => button.addEventListener('click', () => {
      const input = $('#photo-' + button.dataset.photoPick); input.value = ''; input.click();
    }));
    for (const id of ['#photo-camera', '#photo-gallery']) $(id).addEventListener('change', event => imageSelected(event.target.files?.[0]));
    $('#photo-read').onclick = () => read(session);
    $('#photo-find').onclick = () => read(session, true);
    $('#photo-ignore-red').onchange = () => { if (session?.source && !session.busy) read(session, true); };
    $('#photo-reset').onclick = () => { if (session?.source && !session.busy) resetCrop(session); };
    $('#photo-center').onclick = () => { if (session?.source && !session.busy) resetCrop(session, true); };
    $('#photo-undo').onclick = () => { const result = session?.options.undo(); if (!result) return; status(result.ok ? 'Попереднє значення відновлено.' : result.error); if (result.ok) { $('#photo-result').hidden = true; $('#photo-undo').hidden = true; } };
    const canvas = $('#photo-canvas'); let start;
    const point = event => { const box = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(canvas.width, (event.clientX - box.left) * canvas.width / box.width)), y: Math.max(0, Math.min(canvas.height, (event.clientY - box.top) * canvas.height / box.height)) }; };
    canvas.addEventListener('pointerdown', event => { if (!session?.source || session.busy) return; start = point(event); canvas.setPointerCapture(event.pointerId); });
    canvas.addEventListener('pointermove', event => { if (!start || !session || session.busy) return; const p = point(event); session.crop = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.max(1, Math.abs(p.x - start.x)), h: Math.max(1, Math.abs(p.y - start.y)) }; session.manual = true; session.angle = 0; draw(session); });
    const end = () => { if (!start || !session) return; start = null; if (session.crop.w < 30 || session.crop.h < 15) resetCrop(session); };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('keydown', event => {
      const s = session; if (!s?.source || s.busy || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(event.key)) return;
      event.preventDefault(); const r = s.crop, w = s.source.width, h = s.source.height, step = Math.max(2, w * .02);
      s.manual = true; s.angle = 0;
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
    $('#photo-ignore-red').checked = options.unit === 'м³'; $('#photo-regions').replaceChildren();
    $('#photo-choices').replaceChildren(); busy(session, false); status('Оберіть фото — знайдемо табло та спробуємо заповнити поточний показник.'); dialog.showModal();
  } });
})();
