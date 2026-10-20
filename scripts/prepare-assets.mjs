import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
await mkdir(new URL('public/', root), { recursive: true });
for (const file of ['app.js', 'styles.css', 'favicon.svg', 'premium.js', 'admin-panel.js', 'admin.css', 'view-mode.js', 'view-mode.css', 'email-account.css', 'motion.js', 'motion.css', 'meter-ocr-core.js', 'meter-photo.js', 'meter-photo.css', 'telegram.js', 'telegram.css']) {
  await copyFile(new URL(file, root), new URL('public/' + file, root));
}

await build({ entryPoints: [fileURLToPath(new URL('email-account.js', root))], outfile: fileURLToPath(new URL('public/email-account.js', root)), bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, legalComments: 'eof' });

// Lazy-loaded OCR stays on this origin, including its WASM engine and language data.
for (const directory of ['public/vendor/ocr/core/', 'public/vendor/ocr/lang/']) await mkdir(new URL(directory, root), { recursive: true });
for (const file of ['tesseract.min.js', 'worker.min.js', 'tesseract.min.js.LICENSE.txt', 'worker.min.js.LICENSE.txt']) {
  await copyFile(new URL('node_modules/tesseract.js/dist/' + file, root), new URL('public/vendor/ocr/' + file, root));
}
for (const file of await readdir(new URL('node_modules/tesseract.js-core/', root))) {
  if (/\.wasm(?:\.js)?$/.test(file)) await copyFile(new URL('node_modules/tesseract.js-core/' + file, root), new URL('public/vendor/ocr/core/' + file, root));
}
await copyFile(new URL('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', root), new URL('public/vendor/ocr/lang/eng.traineddata.gz', root));
await copyFile(new URL('licenses/tessdata-Apache-2.0.txt', root), new URL('public/vendor/ocr/LICENSE-language.txt', root));
for (const [from, to] of [['tesseract.js/LICENSE.md', 'LICENSE-tesseract.txt'], ['tesseract.js-core/LICENSE', 'LICENSE-core.txt']]) {
  await copyFile(new URL('node_modules/' + from, root), new URL('public/vendor/ocr/' + to, root));
}
