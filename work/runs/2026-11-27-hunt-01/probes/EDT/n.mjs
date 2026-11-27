export default async ({ boot, plantBytes, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const mod = (await page.evaluate(() => navigator.platform)).includes('Mac') ? 'Meta' : 'Control';
  const k = (x) => page.keyboard.press(x);
  const hex = async (p) => Buffer.from(await page.evaluate(async (p) => Array.from(await window.marxy.shell.readFile(p)), p)).toString('hex');
  const u16 = (s, bom = true) => Buffer.concat([bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(s, 'utf16le')]);
  const cases = [
    ['/demo/u16.txt', u16('# T\r\nhello wörld\r\n')],
    ['/demo/l1.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a, 0x78, 0x0a])],
    ['/demo/u16be.txt', Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('hi\nthere\n', 'utf16le').swap16()])],
  ];
  for (const [p, b] of cases) {
    await plantBytes(page, p, b); await open(page, p);
    const mode = await page.evaluate(() => document.body.dataset.marxyMode);
    if (mode !== 'source') { await k(`${mod}+e`); await page.waitForTimeout(800); }
    await k(`${mod}+ArrowDown`); await page.keyboard.type('Z'); await k(`${mod}+s`); await page.waitForTimeout(900);
    console.log(p, '\n  before', b.toString('hex'), '\n  after ', await hex(p), '\n  notices', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.marxy-notice')].map(e => e.textContent.slice(0, 90)))));
  }
};
