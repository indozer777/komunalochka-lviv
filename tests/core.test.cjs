const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../app.js');
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
test('чотири ключі активують Premium, довільні ключі відхиляються', () => {
  assert.equal(core.KEYS.length, 4); for (const key of core.KEYS) { assert.equal(core.validateKey(key), true); assert.equal(core.validateKey(key.toLowerCase()), true); }
  for (const key of ['AAAA-BBBB-CCCC-DDDD', 'LVIV2026HOME7K2P', '', core.KEYS[0] + 'A']) assert.equal(core.validateKey(key), false);
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
