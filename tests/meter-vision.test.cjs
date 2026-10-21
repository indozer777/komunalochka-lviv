const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const box = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../meter-vision-core.js'), 'utf8'), box);
const vision = box.module.exports;
// Independent geometric fixture: actual pixels, both display polarities and red fractions.
function display(value, { light = false, red = '', shift = 0, broken = false } = {}) {
  const w = 760, h = 300, data = new Uint8ClampedArray(w * h * 4), background = light ? 22 : 238, ink = light ? 245 : 18;
  for (let p = 0; p < w * h; p++) { data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = background; data[p * 4 + 3] = 255; }
  const rect = (x, y, rw, rh, color) => { for (let j = Math.max(0, Math.round(y)); j < Math.min(h, y + rh); j++) for (let i = Math.max(0, Math.round(x)); i < Math.min(w, x + rw); i++) { const p = (j * w + i) * 4; data[p] = color[0]; data[p + 1] = color[1]; data[p + 2] = color[2]; } };
  const segments = {
    0: 'ab cdef'.replace(/ /g, ''), 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg'
  };
  const shapes = { a: [7,0,36,9], b: [41,7,9,37], c: [41,48,9,37], d: [7,83,36,9], e: [0,48,9,37], f: [0,7,9,37], g: [7,41,36,9] };
  [...value + red].forEach((digit, i) => {
    for (const name of segments[digit]) { const [x,y,rw,rh] = shapes[name]; rect(80 + i * 67 + x, 90 + y + i * shift, rw, rh, i < value.length ? [ink,ink,ink] : [215,28,25]); }
  });
  if (broken) rect(80, 122, 50, 20, [background, background, background]);
  return { width: w, height: h, data };
}
test('finds a digit row in pixels and estimates its slope in either polarity', () => {
  for (const light of [false, true]) for (const shift of [0, 3, -3]) {
    const result = vision.analyze(display('028690', { light, shift }));
    assert(result.regions.length, `${light} / ${shift}`);
    const row = result.regions[0];
    assert(row.x < 90 && row.x + row.w > 460, JSON.stringify(row));
    assert(Math.abs(row.angle - Math.atan(shift / 67) * 180 / Math.PI) < 1.5);
  }
});
test('specialized segments preserve zeroes and damage prevents automatic fill', () => {
  for (const light of [false, true]) {
    const result = vision.sevenSegment(vision.prepare(display('028690', { light })));
    assert(result); assert.equal(result.value, '028690'); assert(result.confidence >= 92);
    const damaged = vision.sevenSegment(vision.prepare(display('028690', { light, broken: true })));
    assert(!damaged || !vision.decide([damaged, { value: '028690', confidence: 98, engine: 'normalized' }]).automatic);
  }
});
test('red fractional cells are omitted only under the explicit integer option', () => {
  const image = display('02869', { red: '458' });
  const integer = vision.prepare(image, { ignoreRed: true });
  assert(integer.redPixels > 0); assert.equal(vision.sevenSegment(integer)?.value, '02869');
  assert.equal(vision.sevenSegment(vision.prepare(image))?.value, '02869458');
});
test('empty and textureless images provide no display or guessed reading', () => {
  const image = display(''); assert.equal(vision.analyze(image).regions.length, 0); assert.equal(vision.sevenSegment(vision.prepare(image)), null);
  assert.throws(() => vision.prepare({ width: 1601, height: 1601, data: [] }), /image-size/);
});
test('automatic fill requires agreement and an unambiguous chosen region', () => {
  const a = { value: '001278', confidence: 96, engine: 'normalized' }, b = { ...a, engine: 'adaptive' }, segment = { ...a, engine: 'segments' };
  assert.equal(vision.decide([a]).automatic, false);
  assert.equal(vision.decide([a,b]).automatic, false);
  assert.equal(vision.decide([a,b], { manual: true }).automatic, true);
  assert.equal(vision.decide([a,segment]).automatic, true);
  assert.equal(vision.decide([a,segment], { regionCount: 2 }).automatic, false);
  assert.equal(vision.decide([a,segment,{ ...b, value: '001278.2' }]).automatic, false);
  assert.equal(vision.decide([{ ...a, value: 'SN1278' }, { ...b, confidence: 2 }]).choices.length, 0);
});
module.exports = { display, vision };
