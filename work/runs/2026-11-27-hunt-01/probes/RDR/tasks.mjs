const md = '﻿# 😀 héllo\r\n\r\n> - [ ] quoted 😀\r\n> - [x] second\r\n\r\n1. [ ] ordered\r\n   - [ ] nested é\r\n   - [X] cap\r\n\r\n| a | b |\r\n|---|---|\r\n| 日本 | - [ ] x |\r\n\r\n- [ ] 日本語 *emph* [l](http://x.y)\r\n\r\n    - [ ] indented code\r\n\r\n- [ ] last\r\n';
const race = (p, ms, label) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL ' + label)), ms))]);
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/t.md', md);
  await open(page, '/demo/t.md');
  const bytes = () => page.evaluate(() => { const h = window.marxy.handle; const d = h.panes().panes[0].content.store().snapshot(); return Array.from(d.buffer.bytes); });
  const n = await page.evaluate(() => document.querySelectorAll('.marxy-article input[type=checkbox]').length);
  console.log('boxes', n);
  for (let i = 0; i < n; i++) {
    const before = await race(bytes(), 10000, 'bytes');
    const [x, y] = await page.evaluate((i) => { const el = document.querySelectorAll('.marxy-article input[type=checkbox]')[i]; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, i);
    await page.mouse.click(x, y); await page.waitForTimeout(400);
    const after = await race(bytes(), 10000, 'bytes2');
    const diff = []; for (let k = 0; k < Math.max(before.length, after.length); k++) if (before[k] !== after[k]) diff.push(k);
    console.log('box', i, 'len', before.length, after.length, 'changed at', diff.join(','), diff.map(k => String.fromCharCode(after[k])).join(''));
  }
};
