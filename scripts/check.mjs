import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const required = ['index.html', 'src/app.js', 'src/styles.css', 'src/styles/part-7.css', 'src/modules/operations.js', 'src/modules/overlay-views.js', 'api/signals.js', 'api/decode.js', 'api/session.js', 'vercel.json', 'README.md'];
for (const path of required) await stat(join(root, path));
const html = await readFile(join(root, 'index.html'), 'utf8');
const app = await readFile(join(root, 'src/app.js'), 'utf8');
const requiredIds = ['frequency-track', 'frequency-canvas', 'waterfall-canvas', 'decode-button', 'detection-log', 'overlay'];
for (const id of requiredIds) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing DOM id: ${id}`);
  if (!app.includes(`#${id}`) && !['frequency-canvas', 'waterfall-canvas'].includes(id)) console.warn(`DOM id not directly referenced: ${id}`);
}
console.log(`Static checks passed (${required.length} files, ${requiredIds.length} critical UI targets).`);
