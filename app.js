/* КомуналОчка. Buildless ES2020; no runtime dependencies. */
(function () {
  'use strict';

  const STORAGE_KEY = 'komunalochka.lviv.v1';
  const MAX_VALUE = 100000000;
  const KEYS = Object.freeze(['LVIV-2026-HOME-7K2P', 'KOMU-NALO-CHKA-9X4Q', 'TEPL-ODIM-LVIV-3R8N', 'ECOH-OME2-026L-6W5M']);
  const RATE_KEYS = ['gas', 'delivery', 'water', 'electricityDay', 'electricityNight', 'trash'];
  const SERVICES = [
    { id: 'gas', name: 'Газ', provider: 'ГК «Нафтогаз України»', icon: 'flame', unit: 'м³' },
    { id: 'water', name: 'Вода та водовідведення', provider: 'ЛМКП «Львівводоканал»', icon: 'drop', unit: 'м³' },
    { id: 'electricity', name: 'Електроенергія', provider: 'Побутове споживання · Львів', icon: 'bolt', unit: 'кВт·год' },
    { id: 'delivery', name: 'Доставка газу', provider: 'Львівська філія «Газмережі»', icon: 'pipe', unit: 'м³ потужності' },
    { id: 'trash', name: 'Вивіз сміття', provider: 'Ваш перевізник', icon: 'leaf', unit: 'осіб' }
  ];
  const SOURCES = Object.freeze({
    gas: 'https://gas.ua/uk/home/tariffs/tariffdetails?id=21',
    water: 'https://lvivvodokanal.com.ua/residents/rates/',
    electricityDay: 'https://info.loe.lviv.ua/Pages/Tariffs',
    electricityNight: 'https://info.loe.lviv.ua/Pages/Tariffs',
    delivery: 'https://lv.grmu.com.ua/'
  });
  // All reference prices include VAT. Trash is deliberately unset: no universal Lviv rate.
  const REFERENCE_RATES = Object.freeze({ gas: '7.96', delivery: '2.028', water: '56.38', electricityDay: '4.32', electricityNight: '2.16', trash: '' });
  const GAS_CHANNELS = Object.freeze({
    grmu: Object.freeze({ name: 'Газмережі · Львів', url: 'https://my.grmu.com.ua/login', accountDigits: 10, accountHelp: '10 цифр із платіжки за доставку газу', requiresIdentity: false }),
    naftogaz: Object.freeze({ name: 'Нафтогаз України', url: 'https://gas.ua/uk/indicators', accountDigits: 9, accountHelp: '9 цифр із платіжки Нафтогазу за газ', requiresIdentity: true })
  });
  function todayKyiv() {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
  }
  function validReadingDate(value) {
    return typeof value === 'string' && /^(20\d{2}|2100)-\d{2}-\d{2}$/.test(value) && value >= '2020-01-01' && Number.isFinite(Date.parse(value)) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
  }
  function makeGasTransfer() { return { channel: 'grmu', accounts: { grmu: '', naftogaz: '' }, surnamePrefix: '', phone: '', readingDate: '', records: [] }; }
  function prepareGasTransfer(input, today = todayKyiv()) {
    const errors = {}, channel = Object.hasOwn(GAS_CHANNELS, input.channel) ? GAS_CHANNELS[input.channel] : null;
    const account = String(input.account ?? '').trim(), surnamePrefix = String(input.surnamePrefix ?? '').trim().normalize('NFC').toUpperCase();
    const rawPhone = String(input.phone ?? '').trim(); let phone = rawPhone.replace(/[\s()+-]/g, '');
    if (/^0\d{9}$/.test(phone)) phone = '38' + phone;
    const previous = String(input.previous ?? '').trim(), current = String(input.current ?? '').trim();
    if (!channel) errors.channel = 'Оберіть офіційний сервіс';
    if (channel && !new RegExp(`^\\d{${channel.accountDigits}}$`).test(account)) errors.account = `Вкажіть особовий рахунок: ${channel.accountDigits} цифр`;
    if ((channel?.requiresIdentity || surnamePrefix) && !/^\p{L}{3}$/u.test(surnamePrefix)) errors.surnamePrefix = 'Вкажіть перші три літери прізвища власника';
    if ((channel?.requiresIdentity || rawPhone) && !/^380\d{9}$/.test(phone)) errors.phone = 'Вкажіть український номер: +380 та 9 цифр';
    const readingOK = value => /^\d{1,9}$/.test(value) && Number(value) <= MAX_VALUE;
    if (!readingOK(current)) errors.current = 'Вкажіть цілі м³ з лічильника, без цифр після коми';
    if (previous && !readingOK(previous)) errors.previous = 'Попередній показник має бути цілим невід’ємним числом';
    if (readingOK(current) && readingOK(previous) && Number(current) < Number(previous)) errors.current = 'Поточний показник менший за попередній';
    if (!validReadingDate(input.readingDate) || input.readingDate > today) errors.readingDate = 'Оберіть коректну дату зняття показника, не пізніше сьогодні';
    if (!validPeriod(input.period) || input.period > today.slice(0, 7)) errors.period = 'Оберіть поточний або минулий місяць';
    const profileName = String(input.profileName ?? '').trim(), address = String(input.address ?? '').trim();
    if (!profileName || profileName.length > 60 || address.length > 160) errors.profile = 'Перевірте назву й адресу помешкання';
    return { errors, payload: Object.keys(errors).length ? null : { channel: input.channel, account, surnamePrefix, phone: phone ? '+' + phone : '', previous, current, readingDate: input.readingDate, period: input.period, profileName, address } };
  }
  function gasTransferText(payload) {
    return [`Показники газу · ${GAS_CHANNELS[payload.channel].name}`, `Помешкання: ${payload.profileName}${payload.address ? ', Львів, ' + payload.address : ', Львів'}`, `Особовий рахунок: ${payload.account}`, ...(payload.surnamePrefix ? [`Перші три літери прізвища: ${payload.surnamePrefix}`] : []), ...(payload.phone ? [`Телефон: ${payload.phone}`] : []), `Місяць обліку: ${payload.period}`, `Дата зняття: ${payload.readingDate}`, ...(payload.previous ? [`Попередній показник: ${payload.previous} м³`] : []), `Поточний показник: ${payload.current} м³`].join('\n');
  }
  function normalizeGasTransfer(raw) {
    if (raw === undefined) return makeGasTransfer(); // Backward-compatible with existing v1 backups.
    if (!raw || !Object.hasOwn(GAS_CHANNELS, raw.channel) || !raw.accounts || !Array.isArray(raw.records) || raw.records.length > 200) throw new Error('Некоректні дані передачі газу');
    const normalized = makeGasTransfer(); normalized.channel = raw.channel;
    for (const key of ['grmu', 'naftogaz']) { if (typeof raw.accounts[key] !== 'string' || raw.accounts[key].length > 16) throw new Error('Некоректний особовий рахунок'); normalized.accounts[key] = raw.accounts[key]; }
    for (const [key, max] of [['surnamePrefix', 3], ['phone', 24], ['readingDate', 10]]) { if (typeof raw[key] !== 'string' || raw[key].length > max) throw new Error('Некоректні реквізити передачі'); normalized[key] = raw[key]; }
    const ids = new Set(), isTimestamp = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
    normalized.records = raw.records.map(record => {
      if (!record || typeof record.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(record.id) || ids.has(record.id) || !['prepared', 'opened', 'confirmed-by-user'].includes(record.status) || !isTimestamp(record.createdAt) || typeof record.confirmationRef !== 'string' || record.confirmationRef.length > 120 || !record.payload || typeof record.payload !== 'object') throw new Error('Некоректний журнал передачі');
      ids.add(record.id); const validated = prepareGasTransfer(record.payload, '2100-12-31'); if (!validated.payload) throw new Error('Некоректні показники в журналі передачі');
      if ((record.openedAt !== null && !isTimestamp(record.openedAt)) || (record.confirmedAt !== null && !isTimestamp(record.confirmedAt)) || (record.status !== 'prepared' && !record.openedAt) || (record.status === 'confirmed-by-user' && !record.confirmedAt)) throw new Error('Некоректний статус передачі');
      if ((record.status === 'prepared' && (record.openedAt || record.confirmedAt || record.confirmationRef)) || (record.status === 'opened' && (record.confirmedAt || record.confirmationRef)) || (record.openedAt && Date.parse(record.openedAt) < Date.parse(record.createdAt)) || (record.confirmedAt && Date.parse(record.confirmedAt) < Date.parse(record.openedAt))) throw new Error('Некоректна послідовність передачі');
      return { id: record.id, status: record.status, createdAt: record.createdAt, openedAt: record.openedAt, confirmedAt: record.confirmedAt, confirmationRef: record.confirmationRef, payload: validated.payload };
    });
    return normalized;
  }
  const FIELD_KEYS = ['gasPrev', 'gasCurrent', 'waterPrev', 'waterCurrent', 'dayPrev', 'dayCurrent', 'nightPrev', 'nightCurrent', 'deliveryAnnual', 'residents'];
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const money = value => new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const number = value => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 3 }).format(value);
  const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;
  function parseNumber(raw, { integer = false } = {}) {
    const value = String(raw ?? '').trim();
    if (value === '') return { value: null, error: 'Внесіть значення' };
    if (!/^\d+(?:[.,]\d{1,6})?$/.test(value)) return { value: null, error: 'Вкажіть невід’ємне число, до 6 знаків після коми' };
    const n = Number(value.replace(',', '.'));
    if (!Number.isFinite(n) || n > MAX_VALUE) return { value: null, error: 'Значення завелике (максимум 100 000 000)' };
    if (integer && !Number.isInteger(n)) return { value: null, error: 'Кількість мешканців має бути цілою' };
    return { value: n, error: '' };
  }
  function validateKey(raw) { return /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/.test(String(raw).trim().toUpperCase()) && KEYS.includes(String(raw).trim().toUpperCase()); }
  function currentPeriod() {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
    return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
  }
  function validPeriod(value) { return typeof value === 'string' && /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(value) && value >= '2020-01' && value <= '2100-12'; }
  function monthLabel(value) { return new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric', timeZone: 'Europe/Kyiv' }).format(new Date(`${value}-15T12:00:00Z`)); }
  function makeDraft() {
    return { ...Object.fromEntries(FIELD_KEYS.map(key => [key, ''])), zone: 'single', includes: Object.fromEntries(SERVICES.map(s => [s.id, true])) };
  }
  const uid = () => globalThis.crypto?.randomUUID?.() || `home-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  function makeProfile(name = 'Моя оселя', address = '') { return { id: uid(), name, address, manual: false, rates: { ...REFERENCE_RATES }, drafts: {}, history: [], gasTransfer: makeGasTransfer() }; }
  function makeState() { const p = makeProfile(); return { version: 1, period: currentPeriod(), activeId: p.id, profiles: [p], activationKey: '', theme: 'light', lastFetch: null }; }

  function calculate(draft, rates) {
    const errors = {};
    const read = (key, opts) => { const parsed = parseNumber(draft[key], opts); if (parsed.error) errors[key] = parsed.error; return parsed.value; };
    const rate = key => { const parsed = parseNumber(rates[key]); if (parsed.error) errors[`rate-${key}`] = key === 'trash' ? 'Вкажіть тариф вашого перевізника в налаштуваннях' : 'Перевірте тариф у налаштуваннях'; return parsed.value; };
    const consumed = (prevKey, currentKey) => {
      const previous = read(prevKey), current = read(currentKey);
      if (previous === null || current === null) return null;
      if (current < previous) { errors[currentKey] = 'Поточний показник менший за попередній'; return null; }
      return Math.round((current - previous) * 1000000) / 1000000;
    };
    const lines = SERVICES.map(service => {
      const line = { id: service.id, name: service.name, unit: service.unit, excluded: draft.includes?.[service.id] === false, amount: null, quantity: null, detail: '' };
      if (line.excluded) return line;
      if (service.id === 'gas' || service.id === 'water') {
        const quantity = consumed(`${service.id}Prev`, `${service.id}Current`), price = rate(service.id);
        if (quantity !== null && price !== null) { line.quantity = quantity; line.amount = roundMoney(quantity * price); line.detail = `${number(quantity)} м³ × ${number(price)} грн/м³`; }
      } else if (service.id === 'electricity') {
        const day = consumed('dayPrev', 'dayCurrent'), dayRate = rate('electricityDay');
        const night = draft.zone === 'dual' ? consumed('nightPrev', 'nightCurrent') : 0;
        const nightRate = draft.zone === 'dual' ? rate('electricityNight') : 0;
        if ([day, night, dayRate, nightRate].every(v => v !== null)) {
          line.quantity = day + night; line.amount = roundMoney(day * dayRate + night * nightRate);
          line.detail = draft.zone === 'dual' ? `День: ${number(day)} × ${number(dayRate)} + ніч: ${number(night)} × ${number(nightRate)} грн` : `${number(day)} кВт·год × ${number(dayRate)} грн/кВт·год`;
          line.day = day; line.night = night;
        }
      } else if (service.id === 'delivery') {
        const annual = read('deliveryAnnual'), price = rate('delivery');
        if (annual !== null && price !== null) { line.quantity = annual / 12; line.amount = roundMoney(annual / 12 * price); line.detail = `${number(annual)} м³/рік ÷ 12 × ${number(price)} грн`; }
      } else {
        const residents = read('residents', { integer: true }), price = rate('trash');
        if (residents !== null && price !== null) { line.quantity = residents; line.amount = roundMoney(residents * price); line.detail = `${number(residents)} осіб × ${number(price)} грн/особу`; }
      }
      if (line.amount !== null && (!Number.isFinite(line.amount) || line.amount > 1000000000000)) {
        line.amount = null; errors[`amount-${service.id}`] = 'Сума перевищує допустимий ліміт. Перевірте показники й тариф.';
      }
      return line;
    });
    const enabled = lines.filter(l => !l.excluded), ready = enabled.filter(l => l.amount !== null);
    return { lines, errors, total: roundMoney(ready.reduce((sum, line) => sum + line.amount, 0)), complete: enabled.length > 0 && ready.length === enabled.length, ready: ready.length, enabled: enabled.length };
  }

  function sanitizeDraft(raw) {
    if (!raw || typeof raw !== 'object' || !['single', 'dual'].includes(raw.zone)) throw new Error('Некоректні показники');
    const draft = makeDraft(); draft.zone = raw.zone;
    for (const key of FIELD_KEYS) { if (typeof raw[key] !== 'string' || raw[key].length > 24) throw new Error('Некоректне поле показників'); draft[key] = raw[key]; }
    for (const s of SERVICES) { if (typeof raw.includes?.[s.id] !== 'boolean') throw new Error('Некоректний перелік послуг'); draft.includes[s.id] = raw.includes[s.id]; }
    return draft;
  }
  function sanitizeRates(raw) {
    const rates = {};
    for (const key of RATE_KEYS) { if (typeof raw?.[key] !== 'string' || raw[key].length > 24 || (raw[key] !== '' && parseNumber(raw[key]).error)) throw new Error('Некоректні тарифи'); rates[key] = raw[key]; }
    return rates;
  }
  function normalizeState(raw) {
    if (!raw || raw.version !== 1 || !validPeriod(raw.period) || !Array.isArray(raw.profiles) || raw.profiles.length < 1 || raw.profiles.length > 5) throw new Error('Непідтримуваний формат даних');
    const ids = new Set();
    const profiles = raw.profiles.map(p => {
      if (!p || typeof p.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(p.id) || ids.has(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60 || typeof p.address !== 'string' || p.address.length > 160 || typeof p.manual !== 'boolean') throw new Error('Некоректне помешкання');
      ids.add(p.id);
      const drafts = {};
      if (!p.drafts || typeof p.drafts !== 'object' || Object.keys(p.drafts).length > 972) throw new Error('Забагато чернеток');
      for (const [period, draft] of Object.entries(p.drafts)) { if (!validPeriod(period)) throw new Error('Некоректний місяць'); drafts[period] = sanitizeDraft(draft); }
      if (!Array.isArray(p.history) || p.history.length > 972) throw new Error('Некоректна історія');
      const months = new Set();
      const history = p.history.map(h => {
        if (!validPeriod(h.period) || months.has(h.period) || !Number.isFinite(Date.parse(h.savedAt))) throw new Error('Некоректний запис історії');
        months.add(h.period); const draft = sanitizeDraft(h.draft), rates = sanitizeRates(h.rates), result = calculate(draft, rates);
        if (!result.complete) throw new Error('Історія містить незавершений розрахунок');
        return { period: h.period, savedAt: h.savedAt, draft, rates, result };
      });
      return { id: p.id, name: p.name.trim(), address: p.address, manual: p.manual, rates: sanitizeRates(p.rates), drafts, history, gasTransfer: normalizeGasTransfer(p.gasTransfer) };
    });
    if (!ids.has(raw.activeId)) throw new Error('Помешкання не знайдено');
    return { version: 1, period: raw.period, activeId: raw.activeId, profiles, activationKey: validateKey(raw.activationKey) ? raw.activationKey.trim().toUpperCase() : '', theme: raw.theme === 'dark' ? 'dark' : 'light', lastFetch: typeof raw.lastFetch === 'string' && Number.isFinite(Date.parse(raw.lastFetch)) ? raw.lastFetch : null };
  }

  // Conservative provider adapters. Ambiguous, unlabeled or wholesale prices are rejected.
  // Fetch results are suggestions only; the user reviews and applies them in Tariffs.
  function parseProviderText(provider, input) {
    const text = input.replace(/\s+/g, ' ');
    let match;
    if (provider === 'gas' && /Фіксований/i.test(text)) {
      match = text.match(/Ціна за м\s*[³3]\s*(?:грн)?\s*:?\s*(\d+[,.]\d{2,3})\s*грн/i) || text.match(/Ціна за м\s*[³3]\s*грн\s*:?\s*(\d+[,.]\d{2,3})/i);
      if (match) return { gas: match[1].replace(',', '.') };
    }
    if (provider === 'water') {
      // Match the total after the explicit household (non-wholesale) category.
      match = text.match(/Для споживачів, які не є суб[’'ʼ]єктами господарювання.{0,950}?Загальний тариф становить\s*(\d+[,.]\d{2,3})\s*грн.{0,20}з ПДВ/i);
      if (match) return { water: match[1].replace(',', '.') };
    }
    if (provider === 'electricityDay') {
      // A static, explicit household rate only. JS-only pages safely return no value.
      match = text.match(/(?:Ціна|Тариф) для (?:населення|побутових споживачів)\s*[:—–-]\s*(\d+[,.]\d{2,3})\s*грн\s*\/?\s*кВт[·⋅.]?\s*год\s*\(?з ПДВ/i);
      if (match) return { electricityDay: match[1].replace(',', '.') };
    }
    return null;
  }
  const Core = { STORAGE_KEY, KEYS, SERVICES, REFERENCE_RATES, GAS_CHANNELS, parseNumber, validateKey, calculate, makeDraft, makeState, normalizeState, parseProviderText, validPeriod, escapeHTML, roundMoney, makeGasTransfer, prepareGasTransfer, gasTransferText, normalizeGasTransfer, validReadingDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  if (typeof document === 'undefined') return;
  window.KomunalCore = Core;

  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    chart: '<path d="M3 3v18h18M7 14l4-5 4 3 5-7"/>',
    sliders: '<path d="M4 7h8m5 0h3M4 17h3m5 0h8"/><circle cx="14" cy="7" r="3"/><circle cx="9" cy="17" r="3"/>',
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    spark: '<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3zM20 2v4m-2-2h4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 2m0 3h.01"/>',
    pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
    moon: '<path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    receipt: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM9 7h6m-6 4h6m-6 4h3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    leaf: '<path d="M20 3c-1 9-1 15-8 15a6 6 0 0 1-6-6c0-6 8-7 14-9Z M4 21l11-11"/>',
    shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z"/><path d="m8 12 3 3 5-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    flame: '<path d="M12 2c1 6 7 7 7 13a7 7 0 1 1-14 0c0-3 2-5 4-7 0 4 2 4 2 4s3-5 1-10Z"/><path d="M12 14c-4 4-1 7 1 6s3-3-1-6Z"/>',
    drop: '<path d="M12 2S5 10 5 15a7 7 0 1 0 14 0c0-5-7-13-7-13Z"/><path d="M8 15a4 4 0 0 0 4 4"/>',
    bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7z"/>',
    pipe: '<path d="M3 7h8a5 5 0 0 1 5 5v8M3 12h6a2 2 0 0 1 2 2v6M2 5v9m7 7h9M18 6h4m-2-2v4"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    send: '<path d="m22 2-7 20-4-9-9-4zM22 2 11 13"/>'
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.info}</svg>`;
  function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
  const $ = selector => document.querySelector(selector);
  let state, storageOK = true, storageError = '', currentView = 'dashboard', fetchBusy = false, candidates = {}, fetchResults = [], chartMetric = 'total', toastTimer, dialogReturnFocus;
  try { const raw = localStorage.getItem(STORAGE_KEY); state = raw ? normalizeState(JSON.parse(raw)) : makeState(); }
  catch (error) { state = makeState(); storageOK = false; storageError = 'Збережені дані недоступні або пошкоджені. Оригінал не перезаписано. Завантажте резервну копію через «Мої помешкання» або дозвольте браузеру зберігати дані.'; }
  const premium = () => validateKey(state.activationKey);
  const profile = () => state.profiles.find(p => p.id === state.activeId);
  const draft = () => { const p = profile(); if (!p.drafts[state.period]) p.drafts[state.period] = makeDraft(); return p.drafts[state.period]; };
  const rates = () => profile().manual ? profile().rates : REFERENCE_RATES;
  const result = () => calculate(draft(), rates());

  function persist({ force = false } = {}) {
    try {
      if (!storageOK && !force) throw new Error('Збереження недоступне');
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); storageOK = true; storageError = '';
    } catch (error) { storageOK = false; storageError ||= 'Браузер не зберігає дані: сховище недоступне або заповнене. Зміни залишаться лише до закриття вкладки. Експортуйте резервну копію.'; }
    updateStorageStatus(); return storageOK;
  }
  function updateStorageStatus() {
    const warning = $('#storage-warning'); warning.hidden = storageOK; warning.textContent = storageError;
    $('#save-indicator').innerHTML = `${icon(storageOK ? 'check-circle' : 'info')}${storageOK ? 'Зміни збережено' : 'Лише в цій вкладці'}`;
  }
  function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4200); }
  function showDialog(selector) { dialogReturnFocus = document.activeElement; $(selector).showModal(); }
  function closeDialog(dialog) { dialog.close(); (dialogReturnFocus?.isConnected ? dialogReturnFocus : $('#main')).focus({ preventScroll: true }); }
  function generalDialog(content) {
    const dialog = $('#general-dialog'), alreadyOpen = dialog.open;
    if (!alreadyOpen) dialogReturnFocus = document.activeElement;
    $('#general-content').innerHTML = content; hydrateIcons(dialog);
    if (!alreadyOpen) dialog.showModal();
    else (dialog.querySelector('#general-content input, #general-content button, #general-content a') || dialog.querySelector('[data-close]')).focus({ preventScroll: true });
  }
  function requirePremium(action) { if (!premium()) { $('#key-feedback').textContent = ''; showDialog('#premium-dialog'); return; } action(); }

  function field(key, label, placeholder, value = draft()[key]) {
    return `<div class="field"><label for="${key}">${label}</label><input id="${key}" data-field="${key}" type="text" inputmode="${key === 'residents' ? 'numeric' : 'decimal'}" maxlength="24" value="${escapeHTML(value)}" placeholder="${placeholder}" autocomplete="off" aria-describedby="error-${key}"><div id="error-${key}" class="field-error" aria-live="polite"></div></div>`;
  }
  function readingPair(prefix, examples) { return `<div class="readings">${field(`${prefix}Prev`, 'Попередній показник', examples[0])}${field(`${prefix}Current`, 'Поточний показник', examples[1])}</div>`; }
  function tariffText(id) {
    const r = rates(); const key = id === 'electricity' ? 'electricityDay' : id;
    if (r[key] === '') return 'Вкажіть тариф перевізника';
    const price = number(parseNumber(r[key]).value);
    return id === 'trash' ? `${price} грн / особу` : `${price} грн / ${id === 'electricity' ? 'кВт·год' : 'м³'}`;
  }
  function renderServices() {
    const d = draft();
    $('#service-grid').innerHTML = SERVICES.map(s => {
      let fields;
      if (s.id === 'gas' || s.id === 'water') fields = readingPair(s.id, s.id === 'gas' ? ['1 250', '1 278'] : ['320', '327']);
      if (s.id === 'electricity') fields = `<div class="electricity-readings"><div>${d.zone === 'dual' ? `<div class="zone-label">${icon('sun')}День · ${escapeHTML(rates().electricityDay)} грн/кВт·год</div>` : ''}${readingPair('day', ['4 800', '4 960'])}</div>${d.zone === 'dual' ? `<div><div class="zone-label">${icon('moon')}Ніч · ${escapeHTML(rates().electricityNight)} грн/кВт·год</div>${readingPair('night', ['1 200', '1 270'])}</div>` : `<div class="field-help">Однозонний лічильник: одна ставка протягом доби.<br>Маєте двозонний? Перемкніть на «День / ніч».</div>`}</div>`;
      if (s.id === 'delivery') fields = `${field('deliveryAnnual', 'Річна замовлена потужність, м³', 'Наприклад, 240')}<div class="field-help">Річна потужність ÷ 12 × тариф. Візьміть потужність із рахунку «Газмережі».</div>`;
      if (s.id === 'trash') fields = `${field('residents', 'Зареєстровано мешканців', 'Наприклад, 2')}<div class="field-help">Тариф за особу встановлює ваш перевізник. Вкажіть його у розділі «Тарифи».</div>`;
      const header = `<div class="service-head"><span class="service-icon">${icon(s.icon)}</span><div><h3>${s.name}</h3><div class="service-provider">${s.provider}</div></div><label class="service-toggle"><span class="sr-only">Врахувати: ${s.name}</span><input type="checkbox" data-include="${s.id}" ${d.includes[s.id] ? 'checked' : ''}></label></div>`;
      return `<article class="service-card ${s.id}${d.includes[s.id] ? '' : ' excluded'}" id="card-${s.id}">${s.id === 'electricity' ? `<div class="electricity-header">${header}<div class="zone-switch" aria-label="Тип електролічильника"><button data-zone="single" aria-pressed="${d.zone === 'single'}">Одна зона</button><button data-zone="dual" aria-pressed="${d.zone === 'dual'}">День / ніч</button></div></div>` : header}<div class="tariff-line">Тариф: <strong>${tariffText(s.id)}</strong><span class="rate-status" title="${profile().manual ? 'Власний тариф' : 'Довідкова ставка: звірте з рахунком'}"></span></div><div class="service-fields">${fields}</div><div class="card-result"><span class="consumption" id="quantity-${s.id}">Додайте показники</span><strong><span id="amount-${s.id}">—</span><small>грн</small></strong></div><div class="field-error" id="service-error-${s.id}" aria-live="polite"></div></article>`;
    }).join('');
    updateCalculation();
  }
  function updateCalculation() {
    const calc = result();
    $('#total-value').textContent = money(calc.total);
    $('#complete-count').textContent = `${calc.ready} з ${calc.enabled}`;
    $('#summary-period').textContent = monthLabel(state.period);
    $('#calculation-status').textContent = calc.complete ? 'Усе готово. Збережіть цей місяць для вашого обліку.' : calc.enabled === 0 ? 'Увімкніть хоча б одну послугу.' : `Заповніть показники й тарифи: готово ${calc.ready} із ${calc.enabled} послуг. Підсумок поки частковий.`;
    $('#breakdown').innerHTML = calc.lines.map(line => `<div class="breakdown-row"><span><i class="service-dot" style="--dot:var(--${line.id})"></i>${line.name === 'Вода та водовідведення' ? 'Вода та каналізація' : line.name}</span><strong>${line.excluded ? 'Не враховано' : line.amount === null ? '—' : money(line.amount) + ' ₴'}</strong></div>`).join('');
    $('#cost-stack').innerHTML = calc.lines.filter(l => l.amount > 0).map(l => `<span style="--dot:var(--${l.id});width:${calc.total ? l.amount / calc.total * 100 : 0}%"></span>`).join('');
    for (const key of FIELD_KEYS) {
      const input = $(`#${key}`), feedback = $(`#error-${key}`); if (!input || !feedback) continue;
      const hasValue = String(draft()[key]).trim() !== '';
      const error = hasValue ? calc.errors[key] || '' : '';
      input.setAttribute('aria-invalid', String(Boolean(error))); feedback.textContent = error;
    }
    for (const line of calc.lines) {
      const card = $(`#card-${line.id}`); card.classList.toggle('excluded', line.excluded);
      card.querySelectorAll('[data-field]').forEach(el => { el.disabled = line.excluded; });
      $(`#amount-${line.id}`).textContent = line.excluded || line.amount === null ? '—' : money(line.amount);
      $(`#quantity-${line.id}`).textContent = line.excluded ? 'Не враховано' : line.quantity === null ? 'Додайте показники' : `${number(line.quantity)} ${line.unit}${line.id === 'delivery' ? ' / міс.' : ''}`;
      $(`#service-error-${line.id}`).textContent = line.excluded ? '' : calc.errors[`amount-${line.id}`] || calc.errors[`rate-${line.id === 'electricity' ? 'electricityDay' : line.id}`] || calc.errors[`rate-${line.id === 'electricity' ? 'electricityNight' : line.id}`] || '';
    }
  }
  function renderDashboard() {
    $('#period').value = state.period;
    $('#period-display').textContent = monthLabel(state.period);
    $('#active-profile-name').textContent = profile().name;
    $('#active-profile-address').textContent = profile().address ? `Львів · ${profile().address}` : 'Львів · основне помешкання';
    const outsideReferencePeriod = !profile().manual && (state.period < '2026-08' || state.period > '2026-10');
    $('#tariff-period-warning').hidden = !outsideReferencePeriod;
    $('#tariff-period-warning').textContent = 'Для обраного місяця довідкові ставки можуть бути нечинними. Відкрийте «Тарифи», звірте період дії та внесіть ставки вашого рахунку.';
    renderServices(); updateStorageStatus();
  }
  function pageHeading(title, subtitle, action = '') { return `<div class="page-heading"><div><div class="eyebrow">ВАШ ДОМАШНІЙ ПРОСТІР</div><h1>${title}<span class="heading-dot">.</span></h1><p>${subtitle}</p></div>${action}</div>`; }

  function renderTariffs() {
    const p = profile();
    const labels = { gas: ['Газ', 'грн за м³', 'flame', 'gas'], delivery: ['Доставка газу', 'грн за м³ місячної потужності', 'pipe', 'delivery'], water: ['Вода та водовідведення', 'грн за м³ разом', 'drop', 'water'], electricityDay: ['Електроенергія · день / одна зона', 'грн за кВт·год', 'bolt', 'electricity'], electricityNight: ['Електроенергія · ніч', 'грн за кВт·год', 'moon', 'electricity'], trash: ['Вивіз сміття', 'грн за особу на місяць', 'leaf', 'trash'] };
    $('#view-tariffs').innerHTML = `${pageHeading('Тарифи для вашого дому', 'Ставки з ПДВ. Перевіряйте їх для свого постачальника та обраного місяця.')}<div class="notice warning">${icon('info')}<span>Базові ставки — довідкові, перевірені під час розробки 19.10.2026. Вода: 56,38 грн/м³ з 01.08.2026. Газ: 7,96 грн/м³ до 30.04.2027. Електроенергія 4,32 грн/кВт·год — базова ставка до 31.10.2026; ніч 2,16 грн/кВт·год. Пізніші періоди потребують перевірки. Для інших періодів введіть відповідні тарифи вручну.</span></div><div class="panel"><div class="panel-heading"><h2>Ваші тарифи · ${escapeHTML(p.name)}</h2><label class="switch"><input type="checkbox" id="manual-toggle" ${p.manual ? 'checked' : ''}><span>Власні тарифи</span></label></div><p>Увімкніть перемикач, щоб редагувати й зберігати ставки. Вимкнення повертає довідкові ставки, а ваші власні значення залишаються збереженими.</p><div class="tariff-grid" style="margin-top:22px">${RATE_KEYS.map(key => { const [name, unit, symbol, color] = labels[key]; return `<div class="rate-editor ${color}"><div class="rate-editor-head"><span class="service-icon">${icon(symbol)}</span><h3>${name}</h3></div><label for="rate-${key}">${unit}</label><input type="text" inputmode="decimal" maxlength="24" id="rate-${key}" data-rate="${key}" value="${escapeHTML(p.manual ? p.rates[key] : REFERENCE_RATES[key])}" ${p.manual ? '' : 'disabled'} placeholder="Введіть ставку" aria-describedby="rate-error-${key}"><div class="field-error" id="rate-error-${key}" aria-live="polite"></div>${SOURCES[key] ? `<a href="${SOURCES[key]}" target="_blank" rel="noopener noreferrer">Джерело постачальника ↗</a>` : '<small>Уточніть суму за особу у вашого перевізника.</small>'}<div class="source-status">${p.manual ? 'Власна ставка · зберігається автоматично' : 'Довідкова ставка · звірте період дії'}</div></div>`; }).join('')}</div><div class="settings-actions"><button class="button primary" data-action="refresh" ${fetchBusy ? 'disabled' : ''}>${icon('refresh')}${fetchBusy ? 'Перевіряємо джерела…' : 'Перевірити онлайн'}</button><span class="tariff-stamp">${state.lastFetch ? 'Остання спроба: ' + new Date(state.lastFetch).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' }) : 'Автоматична спроба при першому відкритті'}</span></div><div id="fetch-feedback"></div></div><div class="panel"><h2>Як працює перевірка?</h2><p style="margin-top:12px">Застосунок запитує офіційні сторінки Нафтогазу, Львівводоканалу та Львівобленерго. Якщо сайт забороняє запити з браузера (CORS), потребує JavaScript або має неоднозначні дані, ставка не змінюється. Знайдені ставки з’являться нижче для перевірки та застосування. Дату дії потрібно звірити на сторінці постачальника.</p><p style="margin-top:10px">Двохзонний облік: день 07:00–23:00, ніч 23:00–07:00. Нічна довідкова ставка — 50% денної. Для спеціальних тарифів, пільг та електроопалення потрібен окремий розрахунок постачальника.</p></div>`;
    renderFetchFeedback();
  }
  function renderFetchFeedback() {
    const target = $('#fetch-feedback'); if (!target) return;
    const names = { gas: 'Нафтогаз', water: 'Львівводоканал', electricityDay: 'Львівобленерго' };
    const labels = { gas: 'Газ', water: 'Вода', electricityDay: 'Електроенергія · день' };
    target.innerHTML = fetchResults.length ? `<div class="notice ${Object.keys(candidates).length ? 'success' : 'warning'}"><div>${fetchResults.map(r => `<div>${names[r.provider]}: ${r.ok ? 'отримано ставку для перевірки' : escapeHTML(r.reason)}</div>`).join('')}${Object.keys(candidates).length ? `<div style="margin-top:12px">${Object.entries(candidates).map(([key, value]) => `${labels[key]}: <strong>${escapeHTML(value)}</strong> грн/од.`).join(' · ')}<p>Звірте дату дії в джерелах. Нічна ставка не виводиться автоматично.</p><button class="button secondary" data-action="apply-rates" style="margin-top:10px">Застосувати знайдені ставки</button></div>` : '<div style="margin-top:8px">Чинні ставки не змінено. Увімкніть «Власні тарифи» та внесіть значення з вашого рахунку.</div>'}</div></div>` : '';
  }
  async function refreshRates({ silent = false } = {}) {
    if (fetchBusy) return; fetchBusy = true; candidates = {}; fetchResults = []; if (currentView === 'tariffs') renderTariffs();
    const pending = await Promise.allSettled(['gas', 'water', 'electricityDay'].map(async provider => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 6500);
      try {
        const response = await fetch(SOURCES[provider], { signal: controller.signal, mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
        if (!response.ok) return { provider, ok: false, reason: `джерело повернуло HTTP ${response.status}` };
        const html = await response.text(); if (html.length > 3000000) throw new Error('oversize');
        const doc = new DOMParser().parseFromString(html, 'text/html'); doc.querySelectorAll('script,style,noscript').forEach(el => el.remove());
        const found = parseProviderText(provider, doc.body.textContent || '');
        if (!found || Object.values(found).some(value => parseNumber(value).error || Number(value) <= 0 || Number(value) > 10000)) return { provider, ok: false, reason: 'не вдалося однозначно розпізнати побутовий тариф' };
        return { provider, ok: true, rates: found };
      } catch (error) { return { provider, ok: false, reason: error.name === 'AbortError' ? 'джерело не відповіло за 6,5 с' : 'запит недоступний (CORS або мережа)' }; }
      finally { clearTimeout(timeout); }
    }));
    fetchResults = pending.map((r, i) => r.status === 'fulfilled' ? r.value : { provider: ['gas', 'water', 'electricityDay'][i], ok: false, reason: 'помилка перевірки' });
    for (const row of fetchResults) if (row.ok) Object.assign(candidates, row.rates);
    state.lastFetch = new Date().toISOString(); fetchBusy = false; persist(); if (currentView === 'tariffs') renderTariffs();
    if (!silent) toast(Object.keys(candidates).length ? 'Знайдені ставки готові до перевірки' : 'Онлайн-перевірка недоступна. Власні тарифи працюють.');
  }

  const transferStatus = record => ({ prepared: 'Підготовлено', opened: 'Перехід до форми', 'confirmed-by-user': 'Позначено вами як передане' }[record.status]);
  const findTransfer = id => profile().gasTransfer.records.find(r => r.id === id);
  const maskAccount = account => '•••• ' + account.slice(-4);
  function transferField(key, label, value, { type = 'text', max = 24, hint = '', required = false, reading = '', setting = '' } = {}) {
    return `<div class="transfer-field"><label for="transfer-${key}">${label}${required ? ' *' : ''}</label><input id="transfer-${key}" type="${type}" value="${escapeHTML(value)}" maxlength="${max}" ${type === 'text' && ['account', 'phone', 'previous', 'current'].includes(key) ? 'inputmode="numeric"' : ''} ${type === 'date' ? `min="2020-01-01" max="${todayKyiv()}"` : ''} ${required ? 'required' : ''} ${reading ? `data-transfer-reading="${reading}"` : ''} ${setting ? `data-transfer-setting="${setting}"` : ''} autocomplete="off" aria-describedby="transfer-error-${key}${hint ? ' transfer-hint-' + key : ''}">${hint ? `<small id="transfer-hint-${key}">${hint}</small>` : ''}<div class="field-error" id="transfer-error-${key}" aria-live="polite"></div></div>`;
  }
  function renderTransferJournal() {
    const container = $('#transfer-journal'); if (!container) return;
    const records = [...profile().gasTransfer.records].reverse();
    container.innerHTML = records.length ? records.map(record => `<article class="transfer-journal-row"><span class="service-icon gas">${icon(record.status === 'confirmed-by-user' ? 'check' : 'send')}</span><div class="transfer-journal-main"><h3>${escapeHTML(record.payload.current)} м³ <span>· ${escapeHTML(record.payload.period)}</span></h3><p>${GAS_CHANNELS[record.payload.channel].name} · ${maskAccount(record.payload.account)} · знято ${escapeHTML(record.payload.readingDate)}</p><span class="transfer-status ${record.status === 'confirmed-by-user' ? 'user-confirmed' : ''}">${transferStatus(record)}</span></div><div class="transfer-journal-actions"><button class="text-button" data-transfer-record="${record.id}">Деталі</button><button class="icon-button" data-transfer-delete="${record.id}" aria-label="Видалити запис ${escapeHTML(record.payload.period)}">${icon('close')}</button></div></article>`).join('') : '<div class="transfer-empty">Тут з’являться підготовлені показники та ваші відмітки про передачу.</div>';
  }
  function renderTransfer() {
    const p = profile(), config = p.gasTransfer, channel = GAS_CHANNELS[config.channel], d = draft();
    $('#view-transfer').innerHTML = `${pageHeading('Передача показників', 'Підготуйте дані тут. Завершіть відправлення на офіційному сайті.')}<div class="transfer-steps"><span><b>1</b>Підготуйте показники</span><span><b>2</b>Передайте на сайті сервісу</span><span><b>3</b>Збережіть власну відмітку</span></div><div class="transfer-layout"><div><div class="panel"><div class="panel-heading"><h2>${icon('flame')} Газ · ${escapeHTML(p.name)}</h2><span class="pill">ДОСТУПНО БЕЗ PREMIUM</span></div><form id="gas-transfer-form" novalidate><label for="transfer-channel">Де передати показники</label><select id="transfer-channel">${Object.entries(GAS_CHANNELS).map(([id, c]) => `<option value="${id}" ${id === config.channel ? 'selected' : ''}>${c.name}</option>`).join('')}</select><p class="transfer-channel-help">${config.channel === 'grmu' ? 'Для Львова: кабінет оператора розподілу. Увійдіть у свій кабінет, оберіть особовий рахунок і внесіть показник.' : 'Офіційна форма Нафтогазу. Можливість подання для вашого оператора перевіряється на стороні Нафтогазу.'}</p><div class="transfer-form-grid">${transferField('account', 'Особовий рахунок', config.accounts[config.channel], { max: 16, hint: channel.accountHelp + '. Це не заводський номер лічильника.', required: true, setting: 'account' })}${transferField('surnamePrefix', 'Перші три літери прізвища', config.surnamePrefix, { max: 3, hint: config.channel === 'grmu' ? 'Для прив’язки рахунку в кабінеті, якщо знадобиться.' : 'Прізвище власника особового рахунку.', required: channel.requiresIdentity, setting: 'surnamePrefix' })}${transferField('phone', 'Номер телефона', config.phone, { hint: channel.requiresIdentity ? 'Для форми Нафтогазу: +380XXXXXXXXX.' : 'Необов’язково для підготовки в кабінет «Газмережі».', required: channel.requiresIdentity, setting: 'phone' })}${transferField('readingDate', 'Дата зняття показника', config.readingDate || todayKyiv(), { type: 'date', required: true, setting: 'readingDate' })}<div class="transfer-field"><label for="transfer-period">Місяць обліку *</label><div class="transfer-month-control"><span aria-hidden="true">${escapeHTML(monthLabel(state.period))}</span><input id="transfer-period" type="month" value="${state.period}" min="2020-01" max="${todayKyiv().slice(0, 7)}" aria-describedby="transfer-error-period"></div><div class="field-error" id="transfer-error-period" aria-live="polite"></div></div><div class="transfer-readings-note">Показники взято з калькулятора цього місяця. Їх можна виправити тут; зміни збережуться і в розрахунку.</div>${transferField('previous', 'Попередній показник, м³', d.gasPrev, { hint: 'Необов’язково: офіційний кабінет може вже містити його.', reading: 'gasPrev' })}${transferField('current', 'Поточний показник, м³', d.gasCurrent, { required: true, hint: 'Лише цілі м³ — цифри до коми або кольорового поля.', reading: 'gasCurrent' })}</div><p id="transfer-form-feedback" class="form-feedback" role="status"></p><button class="button primary full" type="submit">${icon('send')}Підготувати передачу</button><p class="transfer-local-note">Реквізити зберігаються тільки в цьому браузері для цього помешкання. Паролі та SMS-коди тут не потрібні.</p><button type="button" class="text-button muted" data-action="clear-transfer-details">Очистити збережені реквізити</button></form></div></div><aside><div class="panel transfer-guide"><span class="transfer-guide-icon">${icon('shield')}</span><h2>Офіційний сайт — останній крок</h2><p>Скопіюйте потрібні значення, відкрийте сервіс, внесіть дані та дочекайтеся його підтвердження.</p><div class="notice">Перехід за посиланням не передає показники. «КомуналОчка» не отримує відповіді постачальника й не може сама підтвердити прийняття.</div><p>Звичайний період подання газових показників — 1–5 числа. Доступні дати й виправлення перевіряйте на сайті вашого оператора.</p><a href="https://lv.grmu.com.ua/" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Правила Львівської філії «Газмережі» ↗</a></div></aside></div><div class="panel"><div class="panel-heading"><h2>Журнал передачі</h2><span class="tariff-stamp">${escapeHTML(p.name)}</span></div><p>Відмітки нижче ведете ви. Вони не є квитанціями постачальника.</p><div id="transfer-journal"></div></div>`;
    renderTransferJournal();
    $('#gas-transfer-form').addEventListener('submit', e => { e.preventDefault(); prepareTransferFromForm(); });
  }
  function prepareTransferFromForm() {
    const p = profile(), config = p.gasTransfer;
    const validated = prepareGasTransfer({ channel: config.channel, account: config.accounts[config.channel], surnamePrefix: config.surnamePrefix, phone: config.phone, previous: draft().gasPrev, current: draft().gasCurrent, readingDate: $('#transfer-readingDate').value, period: state.period, profileName: p.name, address: p.address });
    for (const key of ['account', 'surnamePrefix', 'phone', 'previous', 'current', 'readingDate', 'period']) { $(`#transfer-${key}`).setAttribute('aria-invalid', String(Boolean(validated.errors[key]))); $(`#transfer-error-${key}`).textContent = validated.errors[key] || ''; }
    if (!validated.payload) { $('#transfer-form-feedback').textContent = 'Перевірте виділені поля. Дані нікуди не надіслано.'; $(`#transfer-${Object.keys(validated.errors)[0]}`)?.focus(); return; }
    const existing = config.records.find(r => JSON.stringify(r.payload) === JSON.stringify(validated.payload));
    if (existing) { showTransferRecord(existing.id); return; }
    if (config.records.length >= 200) { $('#transfer-form-feedback').textContent = 'У журналі вже 200 записів. Видаліть непотрібні перед підготовкою нових.'; return; }
    const record = { id: uid(), payload: validated.payload, status: 'prepared', createdAt: new Date().toISOString(), openedAt: null, confirmedAt: null, confirmationRef: '' };
    config.readingDate = validated.payload.readingDate; config.records.push(record); persist(); renderTransferJournal(); showTransferRecord(record.id);
  }
  function showTransferRecord(id) {
    const record = findTransfer(id); if (!record) { toast('Запис не знайдено'); return; }
    const p = record.payload, channel = GAS_CHANNELS[p.channel];
    const values = [['account', 'Особовий рахунок', p.account], ['surnamePrefix', 'Перші три літери прізвища', p.surnamePrefix], ['phone', 'Телефон', p.phone], ['previous', 'Попередній показник, м³', p.previous], ['current', 'Поточний показник, м³', p.current]].filter(v => v[2] !== '');
    generalDialog(`<span class="eyebrow">ГАЗ · ${channel.name}</span><h2 id="general-title">Показники готові до передачі</h2><p>${escapeHTML(p.profileName)} · місяць ${escapeHTML(p.period)} · знято ${escapeHTML(p.readingDate)}</p><div id="transfer-record-status" class="transfer-status ${record.status === 'confirmed-by-user' ? 'user-confirmed' : ''}">${transferStatus(record)}</div><div class="transfer-copy-list">${values.map(([key, label, value]) => `<div class="transfer-copy-row"><div><small>${label}</small><strong>${escapeHTML(value)}</strong></div><button class="text-button" data-transfer-copy="${key}" data-record-id="${id}" aria-label="Скопіювати: ${label}">Копіювати</button></div>`).join('')}</div><button class="button secondary full" data-transfer-copy="all" data-record-id="${id}">${icon('download')}Скопіювати всі дані</button><textarea id="transfer-copy-fallback" class="transfer-copy-fallback" readonly hidden aria-label="Дані для ручного копіювання"></textarea><div class="notice">Перенесіть значення у форму й натисніть відправлення на офіційному сайті. Вхід або перевірку виконуйте там.</div><a class="button primary full transfer-official-link" href="${channel.url}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" data-transfer-open="${id}">Відкрити ${channel.name} ↗</a><p class="transfer-modal-note">Жодні реквізити не додаються до посилання. Відкриття сторінки не надсилає показники.</p><button id="transfer-confirm-button" class="button secondary full" data-transfer-confirm="${id}" ${record.status === 'prepared' || record.status === 'confirmed-by-user' ? 'disabled' : ''}>${icon('check')}Я отримав підтвердження на сайті</button>${record.confirmedAt ? `<p class="transfer-confirmed-note">Позначено вами ${new Date(record.confirmedAt).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}${record.confirmationRef ? '<br>Ваша примітка: ' + escapeHTML(record.confirmationRef) : ''}</p>` : ''}`);
  }
  async function copyTransferValue(id, key) {
    const record = findTransfer(id); if (!record) return;
    const value = key === 'all' ? gasTransferText(record.payload) : ['account', 'surnamePrefix', 'phone', 'previous', 'current'].includes(key) ? record.payload[key] : '';
    if (!value) return;
    try { await navigator.clipboard.writeText(value); toast(key === 'all' ? 'Дані скопійовано. Вставте їх у поля офіційної форми.' : 'Значення скопійовано'); }
    catch { const area = $('#transfer-copy-fallback'); if (!area) return; area.hidden = false; area.value = value; area.focus(); area.select(); toast('Виділіть і скопіюйте текст вручну — доступ до буфера недоступний.'); }
  }
  function confirmTransferByUser(id) {
    const record = findTransfer(id); if (!record || record.status !== 'opened') return;
    generalDialog(`<h2 id="general-title">Зберегти власну відмітку</h2><p>Показник ${escapeHTML(record.payload.current)} м³ · рахунок ${maskAccount(record.payload.account)}. Перевірте, що офіційний сервіс справді підтвердив прийняття.</p><form id="transfer-confirm-form"><label class="transfer-ack"><input id="transfer-ack" type="checkbox" required><span>Я побачив підтвердження прийняття на сайті постачальника.</span></label><label for="transfer-confirmation-ref">Номер або примітка до підтвердження (необов’язково)</label><input id="transfer-confirmation-ref" maxlength="120" autocomplete="off" placeholder="Наприклад, номер звернення"><p class="transfer-local-note">Буде збережено статус «Позначено вами як передане». Автоматичної перевірки постачальника немає.</p><button class="button primary full" type="submit">Зберегти відмітку</button></form>`);
    $('#transfer-confirm-form').addEventListener('submit', e => {
      e.preventDefault(); if (!$('#transfer-ack').checked) return;
      const liveRecord = findTransfer(id); if (!liveRecord || liveRecord.status !== 'opened') { toast('Запис змінився в іншій вкладці. Відкрийте його ще раз.'); return; }
      liveRecord.status = 'confirmed-by-user'; liveRecord.confirmedAt = new Date().toISOString(); liveRecord.confirmationRef = $('#transfer-confirmation-ref').value.trim(); persist(); closeDialog($('#general-dialog')); renderTransferJournal(); toast(storageOK ? 'Позначено вами як передане. Відмітку збережено.' : 'Відмітка лише в пам’яті вкладки: збереження недоступне.');
    });
  }

  function renderHistory() {
    const history = [...profile().history].sort((a, b) => a.period.localeCompare(b.period));
    $('#view-history').innerHTML = `${pageHeading('Історія витрат', `Збережені місяці · ${escapeHTML(profile().name)}`, `<span class="pill">PREMIUM</span>`)}${history.length ? `<div class="panel"><div class="panel-heading"><h2>Як змінюються витрати</h2><div class="metric-tabs">${[['total', 'Всього, грн'], ['electricity', 'Світло, кВт·год'], ['gas', 'Газ, м³'], ['water', 'Вода, м³']].map(([id, name]) => `<button data-metric="${id}" class="${id === chartMetric ? 'active' : ''}">${name}</button>`).join('')}</div></div><div id="history-chart" class="chart-wrap"></div><p>Графік показує фактично збережені місяці. Пропущені місяці не прирівнюються до нуля.</p></div><div class="panel"><div class="panel-heading"><h2>Ваші розрахунки</h2><span class="tariff-stamp">${history.length} збережено</span></div><div class="history-table-wrap"><table class="history-table"><thead><tr><th>Місяць</th><th>Світло</th><th>Газ</th><th>Вода</th><th>Всього</th><th>Дії</th></tr></thead><tbody>${[...history].reverse().map(h => { const quantity = id => { const l = h.result.lines.find(s => s.id === id); return l.excluded ? '—' : number(l.quantity); }; return `<tr><td>${escapeHTML(monthLabel(h.period))}</td><td>${quantity('electricity')} кВт·год</td><td>${quantity('gas')} м³</td><td>${quantity('water')} м³</td><td><strong>${money(h.result.total)} ₴</strong></td><td><button data-history-open="${h.period}" aria-label="Відкрити ${escapeHTML(monthLabel(h.period))}">Відкрити</button> · <button data-history-print="${h.period}" aria-label="Квитанція ${escapeHTML(monthLabel(h.period))}">PDF</button> · <button class="danger" data-history-delete="${h.period}" aria-label="Видалити ${escapeHTML(monthLabel(h.period))}">×</button></td></tr>`; }).join('')}</tbody></table></div></div>` : `<div class="panel empty-state"><div class="empty-icon">${icon('chart')}</div><h2>Тут починається ваша історія</h2><p>Збережіть перший розрахунок на головній. Додайте наступні місяці — і побачите, як змінюється споживання.</p><button class="button primary" data-view="dashboard">До розрахунку</button></div>`}`;
    if (history.length) drawChart(history);
  }
  function drawChart(history) {
    // Last twelve actual months; accessible SVG, no chart CDN or generated history.
    const rows = history.slice(-12).map(h => ({ period: h.period, value: chartMetric === 'total' ? h.result.total : (h.result.lines.find(l => l.id === chartMetric)?.quantity ?? null) }));
    const width = 800, height = 270, left = 65, top = 20, bottom = 215, plotWidth = width - left - 20;
    const max = Math.max(1, ...rows.map(r => r.value ?? 0)) * 1.15, step = plotWidth / rows.length;
    const grid = Array.from({ length: 5 }, (_, i) => { const y = bottom - (bottom - top) * i / 4; return `<line class="chart-grid" x1="${left}" y1="${y}" x2="780" y2="${y}"/><text class="chart-label" text-anchor="end" x="${left - 10}" y="${y + 4}">${number(max * i / 4)}</text>`; }).join('');
    const bars = rows.map((r, i) => { const h = (r.value ?? 0) / max * (bottom - top), x = left + step * i + step * .23, bw = step * .54; return `<g><title>${escapeHTML(monthLabel(r.period))}: ${r.value === null ? 'Не враховано' : number(r.value)}</title><rect x="${x}" y="${bottom - h}" width="${bw}" height="${Math.max(0, h)}" rx="5" fill="${chartMetric === 'water' ? '#51b7d4' : chartMetric === 'gas' ? '#6b9cf4' : chartMetric === 'electricity' ? '#e6ba55' : '#6686ef'}"/><text class="chart-label" text-anchor="middle" x="${x + bw / 2}" y="237">${r.period.slice(5)}.${r.period.slice(2, 4)}</text></g>`; }).join('');
    $('#history-chart').innerHTML = `<svg class="history-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Графік збережених місяців: ${rows.map(r => `${r.period}: ${r.value === null ? 'не враховано' : number(r.value)}`).join('; ')}">${grid}${bars}</svg>`;
  }
  function renderProfiles() {
    $('#view-profiles').innerHTML = `${pageHeading('Мої помешкання', 'Кожен дім має свої показники, тарифи та історію.')}<div class="panel"><div class="panel-heading"><h2>Ваші адреси <span class="count">${state.profiles.length}/5</span></h2><button class="button primary" data-action="add-profile">${icon('plus')}Додати помешкання</button></div><div class="profile-list">${state.profiles.map(p => `<article class="profile-card ${p.id === state.activeId ? 'selected' : ''}"><span class="small-icon">${icon('home')}</span><h3>${escapeHTML(p.name)}</h3><p>Львів${p.address ? ' · ' + escapeHTML(p.address) : ''}</p><small class="tariff-stamp">${p.history.length} збережених місяців</small><div class="profile-actions">${p.id !== state.activeId ? `<button class="text-button" data-profile-select="${p.id}">Обрати</button>` : '<span class="text-button">Поточне помешкання</span>'}<button class="text-button muted" data-profile-edit="${p.id}">Змінити</button>${state.profiles.length > 1 ? `<button class="text-button muted" data-profile-delete="${p.id}">Видалити</button>` : ''}</div></article>`).join('')}</div></div><div class="panel"><div class="panel-heading"><h2>Резервні копії</h2><span class="pill">PREMIUM</span></div><p>Локальні дані прив’язані до браузера та адреси сайту. Збережіть JSON-копію для перенесення на інший пристрій. Копія містить адреси й показники: зберігайте її у себе.</p><div class="settings-actions"><button class="button secondary" data-action="export">${icon('download')}Завантажити JSON</button><button class="button secondary" data-action="import">Відновити з копії</button></div></div>`;
  }
  function switchView(view, { focus = false } = {}) {
    if (!['dashboard', 'tariffs', 'history', 'profiles', 'transfer'].includes(view)) return;
    if (['history', 'profiles'].includes(view) && !premium()) { requirePremium(() => {}); return; }
    currentView = view; document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== `view-${view}`; });
    document.querySelectorAll('.nav-item').forEach(el => { const active = el.dataset.view === view; el.classList.toggle('active', active); if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
    if (view === 'dashboard') renderDashboard(); if (view === 'tariffs') renderTariffs(); if (view === 'history') renderHistory(); if (view === 'profiles') renderProfiles();
    if (view === 'transfer') renderTransfer();
    history.replaceState(null, '', `#${view}`);
    if (focus) { $('#main').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }
  }
  function saveCalculation() {
    const calc = result();
    if (!calc.complete) { toast('Заповніть показники й тарифи для всіх увімкнених послуг.'); const key = Object.keys(calc.errors).find(k => !k.startsWith('rate-')); if (key) $(`#${key}`)?.focus(); else switchView('tariffs'); return; }
    const p = profile(), existing = p.history.find(h => h.period === state.period);
    const save = () => {
      const report = { period: state.period, savedAt: new Date().toISOString(), draft: structuredClone(draft()), rates: { ...rates() }, result: calc };
      p.history = p.history.filter(h => h.period !== state.period); p.history.push(report); persist(); toast(storageOK ? 'Розрахунок збережено. Ваш дім під контролем.' : 'Розрахунок лише в пам’яті. Збережіть резервну копію.');
    };
    if (existing) confirmAction('Оновити цей місяць?', 'Збережений розрахунок за цей місяць буде замінено поточними показниками й тарифами.', save); else save();
  }
  function confirmAction(title, description, callback, label = 'Підтвердити') {
    generalDialog(`<h2 id="general-title">${title}</h2><p>${description}</p><div class="settings-actions"><button class="button primary" id="confirm-action">${label}</button><button class="button secondary" data-close>Скасувати</button></div>`);
    $('#confirm-action').addEventListener('click', () => { closeDialog($('#general-dialog')); callback(); }, { once: true });
  }
  function demo() {
    confirmAction('Спробувати на прикладі?', 'Поточна чернетка цього місяця буде замінена демонстраційними показниками. Історія залишиться. Тариф на сміття 45 грн — умовний приклад.', () => {
      profile().drafts[state.period] = { ...makeDraft(), gasPrev: '1250', gasCurrent: '1278', waterPrev: '320', waterCurrent: '327', dayPrev: '4800', dayCurrent: '4960', nightPrev: '1200', nightCurrent: '1270', deliveryAnnual: '240', residents: '2', zone: 'dual' };
      profile().manual = true; profile().rates = { ...REFERENCE_RATES, trash: '45' }; persist(); renderDashboard(); toast('Демонстраційні дані заповнено. Ставки можна змінити.');
    }, 'Заповнити приклад');
  }
  function profileForm(id) {
    const p = state.profiles.find(p => p.id === id);
    if (!p && state.profiles.length >= 5) { toast('Можна додати до 5 помешкань.'); return; }
    generalDialog(`<h2 id="general-title">${p ? 'Налаштування помешкання' : 'Ще один дім'}</h2><p>Розрахунки доступні для помешкань у Львові.</p><form id="profile-form"><div class="form-grid"><div><label for="profile-name">Назва помешкання</label><input id="profile-name" maxlength="60" required value="${escapeHTML(p?.name || '')}" placeholder="Наприклад, Дім на Франка"></div><div><label for="profile-address">Адреса у Львові (необов’язково)</label><input id="profile-address" maxlength="160" value="${escapeHTML(p?.address || '')}" placeholder="Вулиця, будинок, квартира"></div></div><button class="button primary full" type="submit">Зберегти помешкання</button><p class="form-feedback" id="profile-feedback"></p></form>`);
    $('#profile-form').addEventListener('submit', e => {
      e.preventDefault(); const name = $('#profile-name').value.trim(), address = $('#profile-address').value.trim();
      if (!name) { $('#profile-feedback').textContent = 'Вкажіть назву помешкання'; return; }
      if (p) { p.name = name; p.address = address; } else { const created = makeProfile(name, address); state.profiles.push(created); state.activeId = created.id; }
      persist(); closeDialog($('#general-dialog')); renderDashboard(); switchView('profiles'); toast('Помешкання збережено');
    });
  }
  function printReceipt(report) {
    const calc = report?.result || result(), d = report?.draft || draft(), period = report?.period || state.period;
    if (!calc.complete) { toast('Для квитанції спочатку завершіть розрахунок.'); return; }
    const rows = calc.lines.filter(l => !l.excluded);
    $('#print-receipt').innerHTML = `<h1 class="receipt-title">КомуналОчка</h1><p>Особистий розрахунок комунальних послуг · Львів</p><div class="receipt-meta"><h2>${escapeHTML(monthLabel(period))}</h2><p>${escapeHTML(profile().name)}${profile().address ? ' · ' + escapeHTML(profile().address) : ''}</p><p>Облік електроенергії: ${d.zone === 'dual' ? 'день / ніч' : 'одна зона'}</p></div><table class="receipt-table"><thead><tr><th>Послуга</th><th>Розрахунок</th><th>Сума, грн</th></tr></thead><tbody>${rows.map(l => `<tr><td>${l.name}</td><td>${escapeHTML(l.detail)}</td><td>${money(l.amount)}</td></tr>`).join('')}</tbody></table><p class="receipt-total"><strong>Всього: ${money(calc.total)} грн</strong></p><p class="receipt-note">Особистий попередній розрахунок. Не є платіжним документом і не підтверджує оплату. Без боргів, субсидій, пільг, опалення та абонплат. Звірте з рахунками постачальників. Щоб отримати PDF, оберіть «Зберегти як PDF» у діалозі друку.</p>`;
    window.print();
  }
  function showInsights() {
    const calc = result(), electricity = calc.lines.find(l => l.id === 'electricity'), water = calc.lines.find(l => l.id === 'water');
    const tips = [{ title: 'Світло там, де ви є', text: 'Вимикайте освітлення у порожніх кімнатах. Для робочого столу часто достатньо локальної лампи.' }];
    const dayPrice = parseNumber(rates().electricityDay), nightPrice = parseNumber(rates().electricityNight);
    if (electricity?.amount !== null && !electricity.excluded && !dayPrice.error && !nightPrice.error) {
      const saving = roundMoney(electricity.quantity * .2 * Math.max(0, dayPrice.value - nightPrice.value));
      tips.unshift({ title: draft().zone === 'dual' ? 'Дайте ночі попрацювати' : 'Придивіться до двозонного обліку', text: `Перенесення 20% вашого місячного споживання на ніч за поточними ставками дає орієнтир до ${money(saving)} грн економії. Фактичний ефект залежить від графіка й витрат на лічильник; це сценарій, а не прогноз.` });
    }
    if (water?.amount !== null && !water.excluded) tips.push({ title: 'Перевірте, чи не тече кран', text: `Скорочення вашого споживання води на 10% за внесеним тарифом означало б близько ${money(water.amount * .1)} грн на місяць. Порівняйте показники лічильника, коли всі крани закриті.` });
    const previous = [...profile().history].filter(h => h.period < state.period).sort((a, b) => b.period.localeCompare(a.period))[0];
    if (previous && calc.complete && previous.result.total > 0) tips.push({ title: 'Ваш бюджет у динаміці', text: `Поточна сума ${calc.total >= previous.result.total ? 'більша' : 'менша'} на ${money(Math.abs(calc.total - previous.result.total))} грн за останній збережений місяць (${monthLabel(previous.period)}). На зміну впливають і споживання, і тарифи, і перелік послуг.` });
    generalDialog(`<h2 id="general-title">Трохи більше економії</h2><p>Поради за вашими даними. Локальні формули, без зовнішнього ШІ.</p>${tips.map(t => `<div class="insight-item"><h3>${t.title}</h3><p>${escapeHTML(t.text)}</p></div>`).join('')}`);
  }
  function exportBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `komunalochka-backup-${currentPeriod()}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Резервну копію завантажено');
  }
  function importBackup() {
    generalDialog(`<h2 id="general-title">Відновити ваші дані</h2><p>Оберіть JSON-копію КомуналОчки (до 5 МБ). Після перевірки ви зможете замінити поточні дані. Спочатку збережіть поточну копію.</p><input class="backup-input" id="backup-file" type="file" accept=".json,application/json" aria-label="Файл резервної копії"><p id="import-feedback" class="form-feedback" role="status"></p>`);
    $('#backup-file').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      try {
        if (file.size > 5 * 1024 * 1024) throw new Error('Файл більший за 5 МБ');
        const imported = normalizeState(JSON.parse(await file.text()));
        // Keep the currently active demo license when importing an older free backup.
        if (premium()) imported.activationKey = state.activationKey;
        closeDialog($('#general-dialog'));
        confirmAction('Замінити поточні дані?', `Перевірено: ${imported.profiles.length} помешкань. Поточні чернетки та історія будуть замінені даними з копії.`, () => { state = imported; persist({ force: true }); applyTheme(); renderDashboard(); switchView('profiles'); toast(storageOK ? 'Резервну копію відновлено' : 'Копію відкрито лише в пам’яті вкладки'); }, 'Відновити');
      } catch (error) { $('#import-feedback').textContent = `Копію не завантажено: ${error instanceof SyntaxError ? 'файл не містить коректний JSON' : error.message}`; }
    });
  }
  function applyTheme() {
    document.body.dataset.theme = premium() ? state.theme : 'light';
    document.querySelectorAll('.tiny-lock').forEach(el => { el.hidden = premium(); });
    if (premium()) { $('.premium-teaser h3').innerHTML = 'Ваш Premium<br>уже з вами.'; $('.premium-teaser p').innerHTML = 'Більше можливостей<br>для вашого домашнього спокою.'; $('.premium-button').innerHTML = 'Premium активовано ' + icon('check'); }
  }
  function help() {
    generalDialog(`<h2 id="general-title">Рахунки без зайвих турбот</h2><p>КомуналОчка допомагає мешканцям Львова вести власний облік.</p><div class="help-steps"><div><h3>01 · Звірте тарифи</h3><p>Перевірте ставки постачальників. Для сміття обов’язково вкажіть тариф перевізника. Усі ставки вводяться з ПДВ.</p></div><div><h3>02 · Внесіть показники</h3><p>Оберіть місяць, додайте попередні та поточні показники. Для доставки газу візьміть річну замовлену потужність з рахунку, для сміття — кількість мешканців. Непотрібну послугу можна вимкнути.</p></div><div><h3>03 · Збережіть місяць</h3><p>Чернетка зберігається автоматично. Кнопка «Зберегти розрахунок» створює місячний запис. Premium відкриває перегляд історії, кілька адрес та друк у PDF.</p></div></div><div class="notice">Дані зберігаються в localStorage цього браузера. Облікового запису та приймання платежів немає. Зміна домену чи очищення сховища приховає дані; переносьте їх через JSON-копію.</div>`);
  }

  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.transferSetting || el.dataset.transferReading) {
      if (el.dataset.transferSetting === 'account') profile().gasTransfer.accounts[profile().gasTransfer.channel] = el.value;
      else if (el.dataset.transferSetting) profile().gasTransfer[el.dataset.transferSetting] = el.value;
      if (el.dataset.transferReading) draft()[el.dataset.transferReading] = el.value;
      persist(); updateCalculation();
      el.setAttribute('aria-invalid', 'false'); const feedback = $(`#transfer-error-${el.id.replace('transfer-', '')}`); if (feedback) feedback.textContent = '';
      $('#transfer-form-feedback').textContent = '';
    }
    if (el.dataset.field) { draft()[el.dataset.field] = el.value; persist(); updateCalculation(); }
    if (el.dataset.rate) {
      const key = el.dataset.rate, parsed = parseNumber(el.value);
      const error = el.value === '' ? '' : parsed.error; $(`#rate-error-${key}`).textContent = error; el.setAttribute('aria-invalid', String(Boolean(error)));
      // Invalid in-progress tariff strings are shown but never replace the last saved valid rate.
      if (!error) { profile().rates[key] = el.value; persist(); renderServices(); }
    }
    if (el.id === 'activation-key') { const chars = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16); const formatted = chars.match(/.{1,4}/g)?.join('-') || ''; if (formatted !== el.value) el.value = formatted; }
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'transfer-channel' && Object.hasOwn(GAS_CHANNELS, el.value)) { profile().gasTransfer.channel = el.value; persist(); renderTransfer(); }
    if (el.id === 'transfer-period') {
      if (!validPeriod(el.value) || el.value > todayKyiv().slice(0, 7)) { el.value = state.period; toast('Оберіть поточний або минулий місяць'); return; }
      state.period = el.value; draft(); persist(); renderDashboard(); renderTransfer();
    }
    if (el.dataset.include) { draft().includes[el.dataset.include] = el.checked; persist(); updateCalculation(); }
    if (el.id === 'manual-toggle') { profile().manual = el.checked; persist(); renderTariffs(); renderDashboard(); }
    if (el.id === 'period') {
      if (!validPeriod(el.value)) { el.value = state.period; toast('Оберіть місяць від січня 2020 до грудня 2100.'); return; }
      state.period = el.value; draft(); persist(); renderDashboard();
    }
  });
  document.addEventListener('click', e => {
    const officialLink = e.target.closest('[data-transfer-open]');
    if (officialLink) {
      const record = findTransfer(officialLink.dataset.transferOpen); if (!record) { e.preventDefault(); toast('Запис не знайдено'); return; }
      if (record.status === 'prepared') { record.status = 'opened'; record.openedAt = new Date().toISOString(); persist(); }
      $('#transfer-record-status').textContent = transferStatus(record); $('#transfer-confirm-button').disabled = record.status !== 'opened'; renderTransferJournal();
      return; // Native anchor opens only the constant official URL, without account data.
    }
    const button = e.target.closest('button'); if (!button) return;
    if (button.dataset.transferRecord) { showTransferRecord(button.dataset.transferRecord); return; }
    if (button.dataset.transferCopy) { copyTransferValue(button.dataset.recordId, button.dataset.transferCopy); return; }
    if (button.dataset.transferConfirm) { confirmTransferByUser(button.dataset.transferConfirm); return; }
    if (button.dataset.transferDelete) { confirmAction('Видалити запис передачі?', 'Це видалить локальний запис і його реквізити з журналу цього помешкання.', () => { profile().gasTransfer.records = profile().gasTransfer.records.filter(r => r.id !== button.dataset.transferDelete); persist(); renderTransferJournal(); }, 'Видалити запис'); return; }
    if (button.hasAttribute('data-close')) { closeDialog(button.closest('dialog')); return; }
    if (button.dataset.view) { switchView(button.dataset.view, { focus: true }); return; }
    if (button.dataset.zone) { draft().zone = button.dataset.zone; persist(); renderServices(); return; }
    if (button.dataset.metric) { chartMetric = button.dataset.metric; renderHistory(); return; }
    if (button.dataset.profileSelect) { requirePremium(() => { state.activeId = button.dataset.profileSelect; persist(); renderDashboard(); renderProfiles(); toast('Помешкання обрано'); }); return; }
    if (button.dataset.profileEdit) { requirePremium(() => profileForm(button.dataset.profileEdit)); return; }
    if (button.dataset.profileDelete) { requirePremium(() => confirmAction('Видалити помешкання?', 'Усі його показники, тарифи та історію буде видалено з цього браузера. Цю дію не можна скасувати.', () => { state.profiles = state.profiles.filter(p => p.id !== button.dataset.profileDelete); if (!state.profiles.some(p => p.id === state.activeId)) state.activeId = state.profiles[0].id; persist(); renderDashboard(); renderProfiles(); }, 'Видалити')); return; }
    if (button.dataset.historyOpen) { requirePremium(() => { const report = profile().history.find(h => h.period === button.dataset.historyOpen); if (!report) return; state.period = report.period; profile().drafts[report.period] = structuredClone(report.draft); profile().rates = { ...report.rates }; profile().manual = true; persist(); switchView('dashboard', { focus: true }); }); return; }
    if (button.dataset.historyPrint) { requirePremium(() => printReceipt(profile().history.find(h => h.period === button.dataset.historyPrint))); return; }
    if (button.dataset.historyDelete) { requirePremium(() => confirmAction('Видалити місяць з історії?', 'Збережений розрахунок буде видалено. Чернетка місяця залишиться.', () => { profile().history = profile().history.filter(h => h.period !== button.dataset.historyDelete); persist(); renderHistory(); }, 'Видалити')); return; }
    const actions = {
      premium: () => premium() ? toast('Premium уже активовано. Усі можливості доступні.') : showDialog('#premium-dialog'),
      theme: () => requirePremium(() => { state.theme = state.theme === 'light' ? 'dark' : 'light'; applyTheme(); persist(); }),
      profiles: () => switchView('profiles', { focus: true }),
      'add-profile': () => requirePremium(() => profileForm()),
      demo, save: saveCalculation, print: () => requirePremium(() => printReceipt()), insights: () => requirePremium(showInsights), help,
      refresh: () => refreshRates(),
      'apply-rates': () => { if (!Object.keys(candidates).length) return; if (!profile().manual) profile().rates = { ...REFERENCE_RATES }; Object.assign(profile().rates, candidates); profile().manual = true; persist(); renderDashboard(); renderTariffs(); toast('Ставки застосовано. Звірте нічний тариф і період дії.'); },
      export: () => requirePremium(exportBackup), import: () => requirePremium(importBackup),
      'clear-transfer-details': () => confirmAction('Очистити реквізити форми?', 'Буде очищено обидва особові рахунки, літери прізвища та телефон у формі. Записи журналу з їхніми реквізитами можна видалити окремо.', () => { const records = profile().gasTransfer.records; profile().gasTransfer = { ...makeGasTransfer(), records }; persist(); renderTransfer(); }, 'Очистити')
    };
    actions[button.dataset.action]?.();
  });
  $('#premium-form').addEventListener('submit', e => {
    e.preventDefault(); const key = $('#activation-key').value.trim().toUpperCase();
    if (!validateKey(key)) { $('#key-feedback').textContent = 'Ключ не знайдено. Перевірте символи та формат XXXX-XXXX-XXXX-XXXX.'; $('#activation-key').setAttribute('aria-invalid', 'true'); return; }
    state.activationKey = key; persist(); applyTheme(); $('#activation-key').setAttribute('aria-invalid', 'false'); closeDialog($('#premium-dialog')); toast('Ласкаво просимо до Premium! Усі можливості відкрито.');
  });
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog(dialog); } });
  });
  window.addEventListener('storage', e => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try { state = normalizeState(JSON.parse(e.newValue)); applyTheme(); switchView(currentView); toast('Дані оновлено з іншої вкладки'); } catch { toast('Дані іншої вкладки не вдалося прочитати'); }
  });
  window.addEventListener('hashchange', () => switchView(location.hash.slice(1)));
  hydrateIcons(); applyTheme(); renderDashboard();
  $('#copyright-year').textContent = new Date().getFullYear();
  switchView(['dashboard', 'tariffs', 'history', 'profiles', 'transfer'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard');
  // An immediate write probes actual quota/access instead of displaying false "saved" status.
  persist();
  if (!state.lastFetch) refreshRates({ silent: true });
})();
