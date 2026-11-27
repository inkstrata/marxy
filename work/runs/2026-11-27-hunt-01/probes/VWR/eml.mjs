const cases = {
  '/h/a.eml': ['From: a\r\n\r\n' + 'x'.repeat(5e6), 'eml 5MB single line'],
  '/h/b.txt': ['x'.repeat(5e6), 'txt 5MB single line (control)'],
  '/h/c.eml': ['From: a\r\n\r\n' + 'x'.repeat(200e3), 'eml 200KB single line'],
  '/h/d.eml': ['From: a\r\n\r\n' + 'word '.repeat(1e6), 'eml 5MB words'],
  '/h/e.eml': ['From: a\r\n\r\n' + 'line\r\n'.repeat(800e3), 'eml 800k lines'],
};
export default async ({ boot, plantText }) => {
  const only = process.env.CASE;
  const page = await boot('plans/pg16-upgrade-plan.md');
  const race = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r('TIMEOUT'), ms))]);
  for (const [path, [text, label]] of Object.entries(cases)) {
    if (only && !path.includes(only)) continue;
    const t = Date.now();
    await plantText(page, path, text);
    const r = await race(page.evaluate((p) => window.marxy.handle.open(p), path).then(() => 'opened'), 15000);
    const a = r === 'TIMEOUT' ? 'TIMEOUT' : await race(page.evaluate(() => 1).then(() => 'alive'), 10000);
    console.log(label.padEnd(34), r, a, Date.now() - t, 'ms');
    if (a === 'TIMEOUT') break;
  }
};
