// NAV-05: per-key main-thread task time in find on a fully mounted page, 0.5/0.75/1/1.5 MB, 2 runs each.
import { bigFile } from '../gen.mjs';
import { cdpOf } from './lib.mjs';
export default async ({ boot, open, plantText }) => {
  console.log('uptime', (await import('node:child_process')).execSync('uptime').toString().trim());
  for (const mb of (process.env.SIZES || '0.5,0.75,1,1.5').split(',')) for (let run = 0; run < 2; run++) {
    const { name, text } = await bigFile('md-prose', Math.round(Number(mb) * 1e6));
    const page = await boot('plans/pg16-upgrade-plan.md');
    const get = await cdpOf(page);
    await plantText(page, '/demo/' + name, text);
    await open(page, '/demo/' + name);
    let prev = -1, same = 0; for (let w = 0; same < 3 && w < 120; w += 3) { await page.waitForTimeout(3000); const c = await page.evaluate(() => document.querySelector('.marxy-article').children.length); same = c === prev ? same + 1 : 0; prev = c; }
    await page.keyboard.press('Meta+f'); await page.waitForTimeout(500);
    const task = async (label, fn) => { const a = await get(); await fn(); await page.waitForTimeout(450); const b = await get(); return `${label} ${(((b.TaskDuration - a.TaskDuration) * 1000) | 0)}ms`; };
    const out = [];
    for (const ch of 'the ') out.push(await task('type', () => page.keyboard.type(ch)));
    for (let i = 0; i < 3; i++) out.push(await task('Enter', () => page.keyboard.press('Enter')));
    out.push(await task('Backspace', () => page.keyboard.press('Backspace')));
    console.log(`${mb} MB run${run} blocks ${prev}: ` + out.join(', '));
    await page.context().close();
  }
};
