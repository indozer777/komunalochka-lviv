import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
await import('./prepare-assets.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run-framework.mjs', import.meta.url)), 'build'], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
