const T = (p, ms = 10000, label = '') => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL ' + label)), ms))]);
export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const mod = (await page.evaluate(() => navigator.platform)).includes('Mac') ? 'Meta' : 'Control';
  const k = (x) => page.keyboard.press(x);
  const disk = (p) => page.evaluate(async (p) => { const b = await window.marxy.shell.readFile(p); return new TextDecoder().decode(b.bytes ?? b); }, p);
  const buf = () => page.evaluate(() => new TextDecoder().decode(window.marxy.handle.openDocument().buffer.bytes));
  const step = async (name, fn) => { try { const r = await T(fn(), 10000, name); console.log('OK', name, JSON.stringify(r)); } catch (e) { console.log('FAIL', name, e.message); } };
  await plantText(page, '/demo/a.md', '# A\n\nalpha\n');
  await plantText(page, '/demo/b.md', '# B\n\nbeta\n');
  await open(page, '/demo/a.md');
  await k(`${mod}+e`); await page.waitForTimeout(600);
  await k(`${mod}+ArrowDown`); await page.keyboard.type('X');
  await step('open B while dirty', async () => { page.evaluate(() => window.marxy.handle.open('/demo/b.md')); await page.waitForTimeout(800); return { path: await page.evaluate(() => window.marxy.handle.openDocument().path), notices: await page.evaluate(() => [...document.querySelectorAll('.marxy-notice, [class*=notice]')].map(e => e.textContent.slice(0,120))) }; });
  // type + save in same tick, then keep typing during save
  await open(page, '/demo/a.md', 500).catch(()=>{});
  await step('state', async () => ({ path: await page.evaluate(() => window.marxy.handle.openDocument().path), buf: await buf(), disk: await disk('/demo/a.md') }));
  await step('rapid save+type', async () => {
    await k(`${mod}+s`); await page.keyboard.type('YY'); await k(`${mod}+s`); await page.keyboard.type('Z'); await page.waitForTimeout(1000);
    await k(`${mod}+s`); await page.waitForTimeout(800);
    return { buf: await buf(), disk: await disk('/demo/a.md'), calls: await page.evaluate(() => window.marxy.shell.calls?.filter(c => c.method === 'writeFileAtomic').length) };
  });
};
