import { mkdir, copyFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await mkdir(new URL('public/', root), { recursive: true });
for (const file of ['app.js', 'styles.css', 'favicon.svg', 'premium.js', 'admin-panel.js', 'admin.css']) {
  await copyFile(new URL(file, root), new URL('public/' + file, root));
}
