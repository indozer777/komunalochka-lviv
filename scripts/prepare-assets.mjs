import { mkdir, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
await mkdir(new URL('public/', root), { recursive: true });
for (const file of ['app.js', 'styles.css', 'favicon.svg', 'premium.js', 'admin-panel.js', 'admin.css', 'view-mode.js', 'view-mode.css', 'email-account.css', 'motion.js', 'motion.css']) {
  await copyFile(new URL(file, root), new URL('public/' + file, root));
}

await build({ entryPoints: [fileURLToPath(new URL('email-account.js', root))], outfile: fileURLToPath(new URL('public/email-account.js', root)), bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, legalComments: 'eof' });
