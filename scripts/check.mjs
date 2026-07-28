import { readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const required = [
  'index.html',
  'src/app.js',
  'src/styles.css',
  'src/styles/part-7.css',
  'src/styles/part-8.css',
  'src/styles/part-9.css',
  'src/styles/part-10.css',
  'src/modules/operations.js',
  'src/modules/overlay-views.js',
  'src/modules/observatory-data.js',
  'src/modules/observatory-expansion.js',
  'public/black-hole-observatory.png',
  'api/signals.js',
  'api/decode.js',
  'api/session.js',
  'vercel.json',
  'README.md',
];
for (const path of required) await stat(join(root, path));

const html = await readFile(join(root, 'index.html'), 'utf8');
const app = await readFile(join(root, 'src/app.js'), 'utf8');
const styles = await readFile(join(root, 'src/styles.css'), 'utf8');
const expansion = await readFile(join(root, 'src/modules/observatory-expansion.js'), 'utf8');
const requiredIds = ['frequency-track', 'frequency-canvas', 'waterfall-canvas', 'decode-button', 'detection-log', 'overlay'];
for (const id of requiredIds) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing DOM id: ${id}`);
  if (!app.includes(`#${id}`) && !['frequency-canvas', 'waterfall-canvas'].includes(id)) console.warn(`DOM id not directly referenced: ${id}`);
}

if (!html.includes('/src/modules/observatory-expansion.js')) throw new Error('Expansion module is not loaded by index.html');
if (!styles.includes('part-9.css') || !styles.includes('part-10.css')) throw new Error('Expansion styles are not loaded');
for (const marker of ['ARRAY CORE', 'SIGNAL FORENSICS', 'CELESTIAL NAVIGATION', 'EVIDENCE VAULT']) {
  if (!expansion.includes(marker)) throw new Error(`Missing expansion world: ${marker}`);
}

for (const path of ['src/modules/observatory-data.js', 'src/modules/observatory-expansion.js']) {
  execFileSync(process.execPath, ['--check', join(root, path)], { stdio: 'inherit' });
}

console.log(`Static and syntax checks passed (${required.length} files, ${requiredIds.length} critical UI targets, 4 observatory worlds).`);
