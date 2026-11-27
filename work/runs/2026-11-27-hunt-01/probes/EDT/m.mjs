export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const mod = (await page.evaluate(() => navigator.platform)).includes('Mac') ? 'Meta' : 'Control';
  const k = (x) => page.keyboard.press(x);
  const disk = (p) => page.evaluate(async (p) => new TextDecoder().decode(await window.marxy.shell.readFile(p)), p);
  const buf = () => page.evaluate(() => new TextDecoder().decode(window.marxy.handle.openDocument().buffer.bytes));
  const ed = () => page.evaluate(() => document.querySelector('.cm-content')?.innerText.replace(/\n+/g, '|'));
  await plantText(page, '/demo/m.md', '# M\n\npara one\n\npara two\n');
  await open(page, '/demo/m.md');
  await k(`${mod}+e`); await page.waitForTimeout(700);
  await k(`${mod}+ArrowDown`); await page.keyboard.type('AAA'); await k('Enter'); await page.keyboard.type('BBB');
  await k(`${mod}+e`); await page.waitForTimeout(800);   // fold -> Read
  console.log('read, buf=', JSON.stringify(await buf()));
  await k(`${mod}+z`); await page.waitForTimeout(500);   // Rendered undo
  console.log('after read undo buf=', JSON.stringify(await buf()));
  await k(`${mod}+e`); await page.waitForTimeout(800);
  console.log('back in source editor=', await ed());
  await page.keyboard.type('CCC'); await k(`${mod}+z`); await page.waitForTimeout(300);
  console.log('source undo editor=', await ed());
  await k(`${mod}+z`); await page.waitForTimeout(300);
  console.log('source undo#2 editor=', await ed());
  await k(`${mod}+s`); await page.waitForTimeout(800);
  console.log('disk', JSON.stringify(await disk('/demo/m.md')), 'buf', JSON.stringify(await buf()));
};
