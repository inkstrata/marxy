export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const para = (i) => `## Section ${i}\n\nLorem ipsum dolor sit amet, consectetur *adipiscing* elit ${i}. `.padEnd(300, 'word ') + '\n\n- item one\n- item two\n\n';
  let big = ''; for (let i = 0; big.length < 4_000_000; i++) big += para(i);
  await plantText(page, '/demo/big-a.md', big);
  await plantText(page, '/demo/big-c.md', big);
  await plantText(page, '/demo/small-b.md', '# B\n\nsmall\n');
  const t = (label, fn) => Promise.race([fn(), new Promise(r => setTimeout(() => r('TIMEOUT'), 60000))]).then(v => console.log(label, v));
  await t('B alone ms', () => page.evaluate(async () => { const s = performance.now(); await window.marxy.handle.open('/demo/small-b.md'); return Math.round(performance.now() - s); }));
  await t('A alone ms', () => page.evaluate(async () => { const s = performance.now(); await window.marxy.handle.open('/demo/big-a.md'); return Math.round(performance.now() - s); }));
  await t('B alone2 ms', () => page.evaluate(async () => { const s = performance.now(); await window.marxy.handle.open('/demo/small-b.md'); return Math.round(performance.now() - s); }));
  await t('A then B(immediately) : B resolves after ms', () => page.evaluate(async () => {
    const s = performance.now();
    const a = window.marxy.handle.open('/demo/big-c.md').then(() => Math.round(performance.now() - s));
    await new Promise(r => setTimeout(r, 50));
    const b = await window.marxy.handle.open('/demo/small-b.md').then(() => Math.round(performance.now() - s));
    return JSON.stringify({ a: await a, b, path: document.title });
  }));
};
