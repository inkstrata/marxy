export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const run = (id) => page.evaluate(async (id) => { const { commands } = await import('/src/commands/index.ts'); await commands().find(c => c.id === id).run({ showNotice() {} }); }, id);
  const read = (p) => page.evaluate(async (p) => { try { return new TextDecoder().decode(await window.marxy.shell.readFile(p)).slice(0, 300); } catch (e) { return 'ERR ' + (e.code || e.message); } }, p);
  await run('look.use.paper'); await page.waitForTimeout(900);
  console.log('look.toml', JSON.stringify(await read('/look.toml')));
  // looks off: theme paints again
  await run('look.theme'); await page.waitForTimeout(900);
  console.log('after look.theme', JSON.stringify(await read('/look.toml')).slice(0, 80));
  console.log('page', await page.evaluate(() => { const r = document.documentElement; return JSON.stringify({ look: r.getAttribute('data-marxy-look'), size: r.style.getPropertyValue('--marxy-size-body'), v: r.getAttribute('data-marxy-variant'), keys: [...r.style].length }); }));
  console.log('commands', await page.evaluate(async () => { const { commands } = await import('/src/commands/index.ts'); return commands().filter(c => /^look\./.test(c.id) && !/use\./.test(c.id)).map(c => c.id).join(','); }));
};
