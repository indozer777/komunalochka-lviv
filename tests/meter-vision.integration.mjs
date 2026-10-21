import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

function load(file) {
  return readFile(new URL('../' + file, import.meta.url), 'utf8').then(source => {
    const context = { module: { exports: {} } }; vm.runInNewContext(source, context); return context.module.exports;
  });
}
const vision = await load('meter-vision-core.js'), ocr = await load('meter-ocr-core.js');
test('real local LSTM recognition after display detection, red filtering and deskew', { timeout: 120000 }, async () => {
  const worker = await createWorker('eng', 1, { langPath: fileURLToPath(new URL('../public/vendor/ocr/lang', import.meta.url)), cacheMethod: 'none' });
  try {
    for (const name of ['mechanical','red','tilted','multiple','blank']) {
      const file = new URL(`./fixtures/meter-vision/${name}.png`, import.meta.url);
      const { data, info } = await sharp(await readFile(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const image = { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
      const analysis = vision.analyze(image, { ignoreRed: true });
      if (name === 'blank') { assert.equal(analysis.regions.length, 0); continue; }
      assert(analysis.regions.length, name + ': no display');
      if (name === 'multiple') { assert(analysis.regions.length > 1); continue; }
      const r = analysis.regions[0];
      if (name === 'tilted') assert(Math.abs(r.angle) > 2);
      // Sharp and Canvas rotate clockwise for positive angles.
      const cropped = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
        .extract({ left: r.x, top: r.y, width: r.w, height: r.h })
        .rotate(-r.angle, { background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const prepared = vision.prepare({ data: new Uint8ClampedArray(cropped.data), width: cropped.info.width, height: cropped.info.height }, { ignoreRed: true });
      await worker.setParameters({ tessedit_pageseg_mode: '7', preserve_interword_spaces: '1' });
      const evidence = [];
      for (const variant of ['normalized','adaptive']) {
        const gray = Uint8Array.from(prepared[variant], v => variant === 'normalized' ? v : v ? 0 : 255);
        const png = await sharp(gray, { raw: { width: prepared.width, height: prepared.height, channels: 1 } }).png().toBuffer();
        const { data: result } = await worker.recognize(png, {}, { text: true, blocks: true });
        for (const item of ocr.candidates(result)) evidence.push({ ...item, engine: variant });
      }
      const decision = vision.decide(evidence);
      assert(decision.choices.some(item => Number(item.value) === 1278), name + ': ' + JSON.stringify(decision));
      assert.equal(decision.automatic, false, 'automatic crop needs independent segment agreement');
      if (name === 'red') assert(decision.choices.every(item => Number(item.value) !== 1278456));
      console.log(`${name}: local vision + LSTM found 1278`);
    }
  } finally { await worker.terminate(); }
});
