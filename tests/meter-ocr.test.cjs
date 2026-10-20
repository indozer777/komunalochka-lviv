const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const sandbox = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../meter-ocr-core.js'), 'utf8'), sandbox);
const { numericRow, candidates } = sandbox.module.exports;
test('meter rows preserve leading zeroes and explicit decimals', () => {
  assert.equal(numericRow('001278'), '001278'); assert.equal(numericRow('001278,456 m³'), '001278.456');
  assert.equal(numericRow('T1 004960 kWh'), '004960'); assert.equal(numericRow('1.8.2 001270'), '001270');
  assert.equal(numericRow('000 1278'), '0001278'); assert.equal(numericRow('0'), '0');
});
test('model, serial labels, dates and guesses never become readings', () => {
  for (const text of ['№ 12345678','SN12345678','12345678 serial','2026-10-21','230 V','5(60)A','00127B','NaN','-10','100000000','1.2.3','0012/34']) assert.equal(numericRow(text), null, text);
});
test('ambiguous rows are kept separate and low confidence is discarded', () => {
  const values = candidates({ text: '001278\n22233344\n1278', confidence: 95 });
  assert.equal(values.length, 2); assert.equal(values[0].value, '001278');
  assert.equal(candidates({ text: '1278', confidence: 20 }).length, 0);
});
