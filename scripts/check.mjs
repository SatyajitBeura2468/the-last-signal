import { readFile, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const required = [
  'index.html',
  'src/app.js',
  'src/styles.css',
  'src/styles/part-11.css',
  'src/core/observatory-store.js',
  'src/core/event-bus.js',
  'src/core/simulation-clock.js',
  'src/core/render-scheduler.js',
  'src/core/persistence.js',
  'src/simulation/observatory-engine.js',
  'src/simulation/astronomy.js',
  'src/simulation/incident-engine.js',
  'src/simulation/mission-engine.js',
  'src/data/space-weather-client.js',
  'public/black-hole-observatory.png',
  'api/_session-token.js',
  'api/space-weather.js',
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
const data = await readFile(join(root, 'src/modules/observatory-data.js'), 'utf8');
const clientConfig = await readFile(join(root, 'src/modules/config.js'), 'utf8');
const signalApi = await readFile(join(root, 'api/signals.js'), 'utf8');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

const requiredIds = ['frequency-track', 'frequency-canvas', 'waterfall-canvas', 'decode-button', 'detection-log', 'overlay'];
for (const id of requiredIds) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing DOM id: ${id}`);
  if (!app.includes(`#${id}`) && !['frequency-canvas', 'waterfall-canvas'].includes(id)) {
    console.warn(`DOM id not directly referenced: ${id}`);
  }
}

for (const destination of ['live-ops', 'receiver', 'lab', 'sky', 'evidence', 'systems']) {
  if (!html.includes(`data-destination="${destination}"`)) throw new Error(`Missing authoritative destination: ${destination}`);
}
for (const label of ['LIVE OPS', 'SIGNAL FORENSICS', 'SKY CONTROL', 'EVIDENCE', 'SYSTEMS']) {
  if (!data.includes(label)) throw new Error(`Missing observatory world: ${label}`);
}
if (!html.includes('/src/modules/observatory-expansion.js')) throw new Error('Observatory surface module is not loaded');
if (!styles.includes('part-11.css')) throw new Error('Living Observatory styles are not loaded');
if (clientConfig.includes('fragments:')) throw new Error('Client fallback catalogue must not contain hidden decode fragments');
if (signalApi.includes('fragments:')) throw new Error('/api/signals must not return hidden decode fragments');
if (packageJson.engines?.node !== '22.x') throw new Error('Node runtime must be pinned to 22.x');

async function collectJavaScript(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectJavaScript(path));
    else if (extname(entry.name) === '.js' || extname(entry.name) === '.mjs') files.push(path);
  }
  return files;
}

for (const directory of ['src', 'api', 'scripts']) {
  for (const path of await collectJavaScript(join(root, directory))) {
    execFileSync(process.execPath, ['--check', path], { stdio: 'inherit' });
  }
}

console.log(`Static, architecture and syntax checks passed (${required.length} required files, ${requiredIds.length} critical UI targets, 6 destinations).`);
