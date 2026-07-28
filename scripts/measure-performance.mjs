import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const baselineUrl = process.env.BASELINE_URL;
const rebuiltUrl = process.env.REBUILT_URL;
const outputPath = process.env.PERFORMANCE_OUTPUT;

if (!baselineUrl || !rebuiltUrl) {
  throw new Error('Set BASELINE_URL and REBUILT_URL before running this comparison.');
}

async function sample(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const startedAt = performance.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.locator('#boot-screen').waitFor({ state: 'detached' });
  const interactiveMs = performance.now() - startedAt;
  const measurement = await page.evaluate(async () => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const frames = [];
    let previous = null;
    await new Promise((resolve) => {
      let count = 0;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
      const timeout = setTimeout(finish, 5_000);
      const step = (timestamp) => {
        if (finished) return;
        if (previous !== null) frames.push(timestamp - previous);
        previous = timestamp;
        count += 1;
        if (count < 62) requestAnimationFrame(step);
        else {
          clearTimeout(timeout);
          finish();
        }
      };
      requestAnimationFrame(step);
    });
    const sorted = [...frames].sort((a, b) => a - b);
    return {
      domContentLoadedMs: navigation.domContentLoadedEventEnd,
      loadEventMs: navigation.loadEventEnd,
      meanFrameMs: frames.reduce((sum, value) => sum + value, 0) / frames.length,
      p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
      slowFrames: frames.filter((value) => value > 20).length,
      frameSamples: frames.length,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  await page.close();
  return { interactiveMs, ...measurement };
}

function average(samples, key) {
  return Number((samples.reduce((sum, sample) => sum + Number(sample[key]), 0) / samples.length).toFixed(2));
}

async function measure(browser, label, url) {
  const samples = [];
  for (let index = 0; index < 2; index += 1) samples.push(await sample(browser, url));
  return {
    label,
    url,
    runs: samples.length,
    interactiveMs: average(samples, 'interactiveMs'),
    domContentLoadedMs: average(samples, 'domContentLoadedMs'),
    loadEventMs: average(samples, 'loadEventMs'),
    meanFrameMs: average(samples, 'meanFrameMs'),
    p95FrameMs: average(samples, 'p95FrameMs'),
    slowFrames: average(samples, 'slowFrames'),
    frameSamples: average(samples, 'frameSamples'),
    overflowX: samples.some((sample) => sample.overflowX),
    samples,
  };
}

const browser = await chromium.launch({ headless: true });
try {
  const report = {
    capturedAt: new Date().toISOString(),
    viewport: '1440x900',
    baseline: await measure(browser, 'baseline-c57f42e', baselineUrl),
    rebuilt: await measure(browser, 'living-observatory-v2', rebuiltUrl),
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) await writeFile(outputPath, serialized);
  process.stdout.write(serialized);
} finally {
  await browser.close();
}
