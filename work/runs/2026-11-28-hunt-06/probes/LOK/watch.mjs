export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  console.log(await page.evaluate(async () => { try { const h = await window.marxy.shell.watch('/', () => {}); return 'ok ' + typeof h.close; } catch (e) { return 'ERR ' + e.message; } }));
  console.log(await page.evaluate(async () => { try { const h = await window.marxy.handle.shell.watch('/', () => {}); return 'ok ' + typeof h.close + ' same=' + (window.marxy.handle.shell === window.marxy.shell); } catch (e) { return 'ERR ' + e.message; } }));
};
