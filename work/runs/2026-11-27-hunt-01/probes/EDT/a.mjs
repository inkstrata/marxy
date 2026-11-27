const T = (p, ms = 10000, label = '') => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL ' + label)), ms))]);
export default async ({ boot, plantBytes, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const mod = (await page.evaluate(() => navigator.platform)).includes('Mac') ? 'Meta' : 'Control';
  const read = async (p) => Buffer.from(await page.evaluate(async (p) => { const b = await window.marxy.shell.readFile(p); return Array.from(b.bytes ?? b); }, p)).toString('hex');
  const step = async (name, fn) => { try { const r = await T(fn(), 10000, name); console.log('OK', name, JSON.stringify(r)); } catch (e) { console.log('FAIL', name, e.message); } };
  const bytes = Buffer.concat([Buffer.from([0xef,0xbb,0xbf]), Buffer.from('# T\r\n\r\nhello\r\nworld\r\n')]);
  await plantBytes(page, '/demo/bom.md', bytes);
  await open(page, '/demo/bom.md');
  const k = (x) => page.keyboard.press(x);
  await step('mode', async () => { await k(`${mod}+e`); await page.waitForTimeout(800); return await page.evaluate(() => document.querySelector('.cm-content') !== null); });
  await step('type', async () => { await k(`${mod}+ArrowUp`); await page.keyboard.type('X'); await k('Enter'); await page.keyboard.type('Y'); });
  await step('save', async () => { await k(`${mod}+s`); await page.waitForTimeout(800); return await read('/demo/bom.md'); });
  await step('undo', async () => { await k(`${mod}+z`); await page.waitForTimeout(300); await k(`${mod}+s`); await page.waitForTimeout(800); return await read('/demo/bom.md'); });
  await step('undo2', async () => { await k(`${mod}+z`); await k(`${mod}+z`); await page.waitForTimeout(300); await k(`${mod}+s`); await page.waitForTimeout(800); return await read('/demo/bom.md'); });
  await step('redo', async () => { await k(`${mod}+Shift+z`); await page.waitForTimeout(300); await k(`${mod}+s`); await page.waitForTimeout(800); return await read('/demo/bom.md'); });
  console.log('orig', bytes.toString('hex'));
};
