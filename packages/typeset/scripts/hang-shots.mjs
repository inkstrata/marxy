// Before/after captures of hanging punctuation for the taste-review queue (MARXY-24).
import { mkdirSync } from 'node:fs';
import { startHarness } from '../test/harness.mjs';

const html = '<p data-marxy-s="0">“When the ice finally let go of the harbour wall the whole town seemed to exhale, and the first boats nosed out toward a horizon that had been a rumour all winter, carrying the same stores they had carried every spring and the same arguments about weather that nobody ever won.”</p>';
const out = new URL('../test/hang/', import.meta.url);
mkdirSync(out, { recursive: true });
const harness = await startHarness();
const page = await harness.open(html, { width: 960, height: 400 });
const p = page.locator('p').first();
const shot = async (name) => {
  const box = await p.boundingBox();
  await page.screenshot({
    path: new URL(name, out).pathname,
    clip: { x: Math.max(0, box.x - 24), y: Math.max(0, box.y - 8), width: box.width + 32, height: box.height + 16 },
  });
};
await shot('before.png');
await page.evaluate(async () => {
  const c = window.typeset.attach(document.getElementById('doc'), {
    lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: true, lastLineMinWidth: 0.33, hanging: 'left',
    scheduler: window.immediateScheduler(),
  });
  await c.done;
});
await shot('after.png');
await page.close();
await harness.close();
console.log(`wrote ${out.pathname}before.png and after.png`);
