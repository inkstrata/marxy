export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const mod = (await page.evaluate(() => navigator.platform)).includes('Mac') ? 'Meta' : 'Control';
  const k = (x) => page.keyboard.press(x);
  const disk = (p) => page.evaluate(async (p) => new TextDecoder().decode(await window.marxy.shell.readFile(p)), p);
  const editor = () => page.evaluate(() => document.querySelector('.cm-content')?.innerText.replace(/\n+/g, '|'));
  const notices = () => page.evaluate(() => [...document.querySelectorAll('.marxy-notice')].map(e => e.textContent.replace(/\s+/g, ' ').slice(0, 140)));
  await plantText(page, '/demo/j.md', '# J\n\none\ntwo\n');
  await open(page, '/demo/j.md');
  await k(`${mod}+e`); await page.waitForTimeout(700);
  await k(`${mod}+ArrowDown`); await page.keyboard.type('MINE');
  // external program rewrites the file
  await page.evaluate(() => window.marxy.shell.plant('/demo/j.md', new TextEncoder().encode('# J\n\nTHEIRS one\ntwo\n')));
  await page.waitForTimeout(1500);
  console.log('editor', await editor(), '| notices', JSON.stringify(await notices()));
  await k(`${mod}+s`); await page.waitForTimeout(1000);
  console.log('after save: disk', JSON.stringify(await disk('/demo/j.md')), '| notices', JSON.stringify(await notices()));
  console.log('editor', await editor());
};
