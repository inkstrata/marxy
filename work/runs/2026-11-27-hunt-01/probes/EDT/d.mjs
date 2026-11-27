export default async ({ boot, plantBytes, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const mod = (await page.evaluate(() => navigator.platform)).includes('Mac') ? 'Meta' : 'Control';
  const rt = async (label) => { const t = Date.now(); await page.evaluate(() => new Promise(r => setTimeout(r, 0))); console.log('  ', label, 'main thread free after', Date.now() - t, 'ms'); };
  for (const [label, unit, n] of [['5MB-minified-json-one-line', '{"a":1,"b":[1,2,3],"c":"text"},', 160000]]) {
    const text = '[' + unit.repeat(n) + '{}]\n';
    await plantBytes(page, '/demo/min.json', Buffer.from(text));
    await open(page, '/demo/min.json', 800);
    console.log(label, text.length);
    await page.keyboard.press(`${mod}+e`);
    await page.waitForTimeout(2500); await rt('after switch to source');
    for (let i = 0; i < 3; i++) { await page.keyboard.type('Q'); await rt('after key ' + i); }
    await page.keyboard.press(`${mod}+s`); await rt('after save');
    await page.waitForTimeout(500); await rt('after save+500');
    await page.keyboard.press(`${mod}+z`); await rt('after undo');
    await page.keyboard.press(`${mod}+e`); await rt('after back to read');
  }
};
