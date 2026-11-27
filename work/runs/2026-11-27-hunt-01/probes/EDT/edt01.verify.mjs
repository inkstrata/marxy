export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/h.md', '# H\n\nhello\n');
  const notices = () => page.evaluate(() => [...document.querySelectorAll('.marxy-notice')].map(e => e.textContent.replace(/\s+/g, ' ').slice(0, 200)));
  const r = await page.evaluate(async () => {
    const held = await import('/src/left/held.ts');
    const s = await held.storeToStage(window.marxy.handle, '/demo/h.md');
    if (typeof s === 'string') return s;
    s.apply({ range: { file: '/demo/h.md', start: 3, end: 4 }, replacement: 'HH', label: 'probe' });
    // another program writes the file
    window.marxy.shell.plant('/demo/h.md', new TextEncoder().encode('# H\n\nchanged elsewhere\n'));
    return { dirty: s.snapshot().dirty, held: held.heldStores().length };
  });
  console.log('staged', JSON.stringify(r));
  await page.evaluate(() => window.marxy.shell.emitCloseRequested());
  await page.waitForTimeout(600);
  console.log('notices after close request', JSON.stringify(await notices()));
  const btn = page.getByRole('button', { name: 'Save and close' });
  console.log('buttons', await btn.count());
  await btn.first().click();
  await page.waitForTimeout(1000);
  console.log('notices after Save and close (save should fail: file changed on disk)', JSON.stringify(await notices()));
  console.log('disk', JSON.stringify(await page.evaluate(async()=>new TextDecoder().decode(await window.marxy.shell.readFile('/demo/h.md')))), 'store dirty', await page.evaluate(async()=>(await import('/src/left/held.ts')).heldStores().length), 'methods', JSON.stringify(await page.evaluate(()=>window.marxy.shell.calls?.filter(c=>/writeFileAtomic|confirmClose/.test(c.method)).map(c=>c.method))));
  console.log('window closed?', await page.evaluate(() => window.marxy.shell.calls?.some(c => c.method === 'confirmClose')));
};
