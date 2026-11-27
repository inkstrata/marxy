const T = (p, ms = 8000, l = '') => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL ' + l)), ms))]);
export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const mod = (await page.evaluate(() => navigator.platform)).includes('Mac') ? 'Meta' : 'Control';
  const k = (x) => page.keyboard.press(x);
  const disk = (p) => page.evaluate(async (p) => { try { return new TextDecoder().decode(await window.marxy.shell.readFile(p)); } catch (e) { return 'ERR ' + e.code; } }, p);
  const info = () => page.evaluate(() => ({ path: window.marxy.handle.openDocument().path, title: document.title, mode: !!document.querySelector('.cm-content') }));
  const log = async (l, f) => { try { console.log(l, JSON.stringify(await T(f(), 8000, l))); } catch (e) { console.log(l, 'FAIL', e.message); } };
  await plantText(page, '/demo/s.md', '# S\n\nsrc\n');
  await open(page, '/demo/s.md');
  await k(`${mod}+e`); await page.waitForTimeout(700);
  await k(`${mod}+ArrowDown`); await page.keyboard.type('ONE');
  await page.evaluate(() => { window.marxy.shell.saveDialog = async () => '/demo/copy.md'; });
  await k(`${mod}+Shift+s`); await page.waitForTimeout(1200);
  await log('after save-as', async () => ({ info: await info(), orig: await disk('/demo/s.md'), copy: await disk('/demo/copy.md') }));
  await page.keyboard.type('TWO'); await k(`${mod}+s`); await page.waitForTimeout(800);
  await log('type+save', async () => ({ orig: await disk('/demo/s.md'), copy: await disk('/demo/copy.md') }));
  await k(`${mod}+z`); await k(`${mod}+z`); await k(`${mod}+s`); await page.waitForTimeout(800);
  await log('undo x2 + save', async () => ({ orig: await disk('/demo/s.md'), copy: await disk('/demo/copy.md'), editor: await page.evaluate(() => document.querySelector('.cm-content').innerText.replace(/\n+/g,'|')) }));
  // Save As again onto the original (overwrite) with different text
  await page.keyboard.type('THREE');
  await page.evaluate(() => { window.marxy.shell.saveDialog = async () => '/demo/s.md'; });
  await k(`${mod}+Shift+s`); await page.waitForTimeout(1200);
  await log('save-as back onto orig', async () => ({ info: await info(), orig: await disk('/demo/s.md'), copy: await disk('/demo/copy.md') }));
};
