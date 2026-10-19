const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('./load-core.cjs');
const rates = { ...core.REFERENCE_RATES, trash: '45' };
function example() { return { ...core.makeDraft(), gasPrev: '1250', gasCurrent: '1278', waterPrev: '320', waterCurrent: '327', dayPrev: '4800', dayCurrent: '4960', nightPrev: '1200', nightCurrent: '1270', deliveryAnnual: '240', residents: '2', zone: 'dual' }; }

test('п’ять послуг: точний підсумок прикладу та двозонна електроенергія', () => {
  const result = core.calculate(example(), rates);
  assert.equal(result.complete, true);
  assert.deepEqual(Object.fromEntries(result.lines.map(l => [l.id, l.amount])), { gas: 222.88, water: 394.66, electricity: 842.4, delivery: 40.56, trash: 90 });
  assert.equal(result.total, 1590.5);
});
test('одна зона не потребує нічних показників і тарифу', () => {
  const d = example(); d.zone = 'single'; d.nightPrev = ''; d.nightCurrent = '';
  const r = core.calculate(d, { ...rates, electricityNight: '' });
  assert.equal(r.complete, true); assert.equal(r.lines.find(l => l.id === 'electricity').amount, 691.2);
});
test('десяткова кома, нуль, від’ємні та некоректні числа', () => {
  assert.equal(core.parseNumber('12,345').value, 12.345);
  assert.equal(core.parseNumber('0').value, 0);
  for (const value of ['', '-2', '1e5', '12abc', 'Infinity', 'NaN', '1,2,3', '2.1234567', '100000001', '1 000']) assert.ok(core.parseNumber(value).error, value);
  assert.ok(core.parseNumber('2.5', { integer: true }).error);
});
test('зворотні показники не дають від’ємного рахунку', () => {
  const d = example(); d.gasCurrent = '100'; const r = core.calculate(d, rates);
  assert.equal(r.complete, false); assert.equal(r.lines[0].amount, null); assert.match(r.errors.gasCurrent, /менший/);
});
test('порожні показники та відсутній тариф на сміття не вважаються нулем', () => {
  const r = core.calculate(core.makeDraft(), core.REFERENCE_RATES); assert.equal(r.ready, 0); assert.equal(r.complete, false); assert.equal(r.total, 0);
  const r2 = core.calculate(example(), core.REFERENCE_RATES); assert.equal(r2.ready, 4); assert.ok(r2.errors['rate-trash']);
});
test('відключені послуги не блокують збереження; нульові обсяги допустимі', () => {
  const d = core.makeDraft(); d.includes = { gas: true, water: false, electricity: false, delivery: false, trash: false }; d.gasPrev = '0'; d.gasCurrent = '0';
  assert.equal(core.calculate(d, rates).complete, true); assert.equal(core.calculate(d, rates).total, 0);
  d.includes.gas = false; assert.equal(core.calculate(d, rates).complete, false);
});
test('доставка враховує річну потужність без передчасного округлення', () => {
  const d = example(); d.deliveryAnnual = '123.45'; assert.equal(core.calculate(d, rates).lines.find(l => l.id === 'delivery').amount, 20.86);
});
test('захист від переповнення грошових обчислень', () => {
  const d = example(); d.gasPrev = '0'; d.gasCurrent = '100000000';
  const r = core.calculate(d, { ...rates, gas: '100000000' }); assert.equal(r.complete, false); assert.equal(r.lines[0].amount, null); assert.ok(r.errors['amount-gas']);
});
test('імпорт старої копії не надає серверний Premium і не втрачає дані', () => {
  const state = core.makeState(); state.activationKey = 'LVIV-2026-HOME-7K2P';
  const restored = core.normalizeState(state);
  assert.equal(restored.activationKey, ''); assert.equal(restored.profiles[0].id, state.profiles[0].id);
});
test('імпорт відкидає некоректні схеми, дублікати, тарифи та зламану історію', () => {
  const state = core.makeState(); const p = state.profiles[0]; p.rates = rates; p.history.push({ period: state.period, savedAt: new Date().toISOString(), draft: example(), rates });
  assert.equal(core.normalizeState(state).profiles[0].history[0].result.total, 1590.5);
  assert.throws(() => core.normalizeState({ ...state, version: 99 }));
  assert.throws(() => core.normalizeState({ ...state, profiles: [p, p] }));
  const bad = JSON.parse(JSON.stringify(state)); bad.profiles[0].rates.gas = '-10'; assert.throws(() => core.normalizeState(bad));
  bad.profiles[0].rates = rates; bad.profiles[0].history[0].draft.gasCurrent = ''; assert.throws(() => core.normalizeState(bad));
  const manipulated = JSON.parse(JSON.stringify(state)); manipulated.profiles[0].history[0].result = { total: 1 }; assert.equal(core.normalizeState(manipulated).profiles[0].history[0].result.total, 1590.5);
});
test('побутовий тариф не плутається з оптовим; неоднозначні відповіді відхиляються', () => {
  const text = 'Для споживачів, які є суб’єктами господарювання Загальний тариф становить 22,23 грн/м³ з ПДВ. Для споживачів, які не є суб’єктами господарювання (населення) водопостачання — 36,04 грн/м³. Загальний тариф становить 56,38 грн/м³ з ПДВ.';
  assert.deepEqual(core.parseProviderText('water', text), { water: '56.38' });
  assert.deepEqual(core.parseProviderText('gas', 'Тарифний план «Фіксований» Ціна за м³ грн: 7,96 грн'), { gas: '7.96' });
  assert.equal(core.parseProviderText('water', 'Тариф для бізнесу 99,99'), null); assert.equal(core.parseProviderText('electricityDay', 'Enable JavaScript'), null);
});
test('безпечний HTML та місяці', () => {
  assert.equal(core.escapeHTML('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(core.validPeriod('2026-10'), true); for (const month of ['2026-13', '2026-00', '2019-12', '2026-1', '__proto__']) assert.equal(core.validPeriod(month), false);
});

const transferExample = () => ({ channel: 'grmu', account: '0900123456', surnamePrefix: '', phone: '', previous: '1250', current: '1278', readingDate: '2026-10-01', period: '2026-09', profileName: 'Моя оселя', address: '' });
test('газова передача готує накопичений показник, а не спожиті куби', () => {
  const { payload, errors } = core.prepareGasTransfer(transferExample(), '2026-10-19');
  assert.deepEqual(errors, {}); assert.equal(payload.current, '1278');
  assert.match(core.gasTransferText(payload), /Поточний показник: 1278 м³/);
  assert.equal(core.GAS_CHANNELS.grmu.url, 'https://my.grmu.com.ua/login');
  assert.equal(core.GAS_CHANNELS.naftogaz.url, 'https://gas.ua/uk/indicators');
});
test('окремі реквізити Нафтогазу: прізвище і телефон нормалізуються', () => {
  const r = core.prepareGasTransfer({ ...transferExample(), channel: 'naftogaz', account: '123456789', surnamePrefix: 'іва', phone: '067 123-45-67' }, '2026-10-19');
  assert.deepEqual(r.errors, {}); assert.equal(r.payload.surnamePrefix, 'ІВА'); assert.equal(r.payload.phone, '+380671234567');
  const missing = core.prepareGasTransfer({ ...transferExample(), channel: 'naftogaz' }, '2026-10-19');
  assert.ok(missing.errors.account); assert.ok(missing.errors.phone); assert.ok(missing.errors.surnamePrefix);
});
test('передача відкидає дробові, зворотні показники, неправильні рахунки й майбутні дати', () => {
  for (const patch of [{ current: '1278.1' }, { current: '1' }, { current: '-1' }, { account: 'meter-1234' }, { readingDate: '2026-02-30' }, { readingDate: '2026-10-20' }, { period: '2026-11' }, { channel: '__proto__' }]) {
    const r = core.prepareGasTransfer({ ...transferExample(), ...patch }, '2026-10-19'); assert.equal(r.payload, null, JSON.stringify(patch));
  }
  const zero = core.prepareGasTransfer({ ...transferExample(), current: '00000', previous: '0' }, '2026-10-19'); assert.equal(zero.payload.current, '00000');
});
test('старі v1-копії мігрують без втрати помешкань, показників і місячних записів', () => {
  const state = core.makeState(), p = state.profiles[0]; delete p.gasTransfer;
  p.drafts[state.period] = example(); p.history.push({ period: state.period, savedAt: new Date().toISOString(), draft: example(), rates });
  const restored = core.normalizeState(state).profiles[0]; assert.deepEqual(restored.gasTransfer, core.makeGasTransfer()); assert.equal(restored.history[0].result.total, 1590.5); assert.equal(restored.drafts[state.period].gasCurrent, '1278');
});
test('журнал не приймає статус прийняття від провайдера або підроблену послідовність', () => {
  const transfer = core.makeGasTransfer(), payload = core.prepareGasTransfer(transferExample(), '2026-10-19').payload;
  const record = { id: 'record-1', payload, status: 'prepared', createdAt: '2026-10-19T12:00:00.000Z', openedAt: null, confirmedAt: null, confirmationRef: '' };
  transfer.records.push(record); assert.equal(core.normalizeGasTransfer(transfer).records.length, 1);
  for (const status of ['accepted', 'sent', 'success', 'confirmed-by-user']) { record.status = status; assert.throws(() => core.normalizeGasTransfer(transfer)); }
  record.status = 'opened'; record.openedAt = '2026-10-19T12:01:00.000Z'; assert.equal(core.normalizeGasTransfer(transfer).records[0].status, 'opened');
  record.status = 'confirmed-by-user'; record.confirmedAt = '2026-10-19T12:02:00.000Z'; record.confirmationRef = 'Власна примітка'; assert.equal(core.normalizeGasTransfer(transfer).records[0].confirmationRef, 'Власна примітка');
  record.confirmedAt = '2026-10-19T11:00:00.000Z'; assert.throws(() => core.normalizeGasTransfer(transfer));
  transfer.channel = '__proto__'; assert.throws(() => core.normalizeGasTransfer(transfer));
});

test('вода зберігає точний накопичений показник, рахунок і номер водоміра', () => {
  const r = core.prepareTransfer({ ...transferExample(), service: 'water', channel: 'infolviv', account: '00012345', meterNumber: 'W-42', current: '1278,125' }, '2026-10-19');
  assert.deepEqual(r.errors, {}); assert.equal(r.payload.current, '1278.125'); assert.equal(r.payload.account, '00012345'); assert.equal(r.payload.meterNumber, 'W-42');
  assert.match(core.transferText(r.payload), /Поточний показник: 1278.125 м³/);
  assert.equal(core.TRANSFER_SERVICES.water.channels.infolviv.url, 'https://infolviv.com.ua/');
});
test('електрика: два регістри не сумуються і не підміняються споживанням', () => {
  const input = { ...transferExample(), service: 'electricity', channel: 'loe', account: '0012345678', previous: '4800', current: '4960', zone: 'dual', nightPrevious: '1200', nightCurrent: '1270' };
  const r = core.prepareTransfer(input, '2026-10-19'); assert.deepEqual(r.errors, {});
  assert.match(core.transferText(r.payload), /День · поточний: 4960 кВт·год/); assert.match(core.transferText(r.payload), /Ніч · поточний: 1270 кВт·год/);
  assert.equal(core.transferReadingSummary(r.payload), 'День 4960 / ніч 1270 кВт·год');
  assert.ok(core.prepareTransfer({ ...input, nightCurrent: '' }, '2026-10-19').errors.nightCurrent);
  assert.ok(core.prepareTransfer({ ...input, nightCurrent: '1100' }, '2026-10-19').errors.nightCurrent);
  assert.ok(core.prepareTransfer({ ...input, current: '4960.2' }, '2026-10-19').errors.current);
  const single = core.prepareTransfer({ ...input, zone: 'single', nightCurrent: 'wrong' }, '2026-10-19'); assert.equal(single.payload.nightCurrent, ''); assert.doesNotMatch(core.transferText(single.payload), /Ніч/);
});
test('міграція газового журналу до трьох послуг зберігає реквізити та власні підтвердження', () => {
  const state = core.makeState(), p = state.profiles[0]; delete p.waterTransfer; delete p.electricityTransfer; delete p.transferService; delete p.gasTransfer.meterNumber;
  p.gasTransfer.accounts.grmu = '0900123456';
  p.gasTransfer.records.push({ id: 'legacy-gas', status: 'confirmed-by-user', createdAt: '2026-10-19T12:00:00.000Z', openedAt: '2026-10-19T12:01:00.000Z', confirmedAt: '2026-10-19T12:02:00.000Z', confirmationRef: 'Власна стара примітка', payload: transferExample() });
  const restored = core.normalizeState(state).profiles[0];
  assert.equal(restored.gasTransfer.records[0].payload.service, 'gas'); assert.equal(restored.gasTransfer.records[0].status, 'confirmed-by-user'); assert.equal(restored.gasTransfer.records[0].confirmationRef, 'Власна стара примітка');
  assert.equal(restored.gasTransfer.accounts.grmu, '0900123456'); assert.deepEqual(restored.waterTransfer, core.makeTransfer('water')); assert.deepEqual(restored.electricityTransfer, core.makeTransfer('electricity'));
});
test('імпорт відхиляє змішані послуги, дублікати ID й невідомі напрямки', () => {
  const state = core.makeState(), p = state.profiles[0], water = core.prepareTransfer({ ...transferExample(), service: 'water', channel: 'infolviv', account: '1234' }, '2026-10-19').payload;
  const record = { id: 'same-id', status: 'prepared', createdAt: '2026-10-19T12:00:00.000Z', openedAt: null, confirmedAt: null, confirmationRef: '', payload: water };
  p.waterTransfer.records.push(record); assert.equal(core.normalizeState(state).profiles[0].waterTransfer.records.length, 1);
  p.gasTransfer.records.push({ ...record, payload: core.prepareGasTransfer(transferExample(), '2026-10-19').payload }); assert.throws(() => core.normalizeState(state), /Повторний ID/);
  p.gasTransfer.records = []; p.waterTransfer.records[0].payload = { ...water, service: 'gas' }; assert.throws(() => core.normalizeState(state), /Послуга/);
  assert.equal(core.prepareTransfer({ ...transferExample(), service: 'trash' }, '2026-10-19').payload, null);
});
