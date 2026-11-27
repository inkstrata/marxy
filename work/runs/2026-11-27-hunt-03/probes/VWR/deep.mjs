const race = (p, ms, label) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('TIMEOUT ' + label)), ms))]);
const N = Number(process.env.N || 30000);
const cases = {
  'html-nested-div': ['html', '<!doctype html><html><body>' + '<div>'.repeat(N) + 'x' + '</div>'.repeat(N) + '</body></html>'],
  'html-nested-ul': ['html', '<ul>'.repeat(N) + '<li>x</li>' + '</ul>'.repeat(N)],
  'xml-nested': ['xml', '<a>'.repeat(N) + 'x' + '</a>'.repeat(N)],
  'yaml-flow': ['yaml', 'a: ' + '['.repeat(N) + ']'.repeat(N) + '\n'],
  'yaml-indent': ['yaml', Array.from({ length: 3000 }, (_, i) => ' '.repeat(i) + 'k' + i + ':').join('\n') + '\n'],
  'json-arrays': ['json', '['.repeat(N) + ']'.repeat(N)],
  'json-objs': ['json', '{"a":'.repeat(N) + '1' + '}'.repeat(N)],
  'toml-inline': ['toml', 'a = ' + '['.repeat(N) + ']'.repeat(N) + '\n'],
  'svg-nested': ['svg', '<svg xmlns="http://www.w3.org/2000/svg">' + '<g>'.repeat(N) + '</g>'.repeat(N) + '</svg>'],
  'jsonl-deep': ['jsonl', ('{"a":'.repeat(2000) + '1' + '}'.repeat(2000) + '\n').repeat(30)],
};
export default async ({ boot, plantText }) => {
  for (const [name, [ext, text]] of Object.entries(cases)) {
    const page = await boot('plans/pg16-upgrade-plan.md');
    const cdp = await page.context().newCDPSession(page);
    const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 100)));
    const res = { name, bytes: text.length };
    try {
      await plantText(page, `/demo/deep-${name}.${ext}`, text);
      const t = Date.now();
      await race(page.evaluate(p => window.marxy.handle.open(p), `/demo/deep-${name}.${ext}`), 10000, 'open');
      await page.waitForTimeout(2500);
      await race(page.evaluate(() => 1), 10000, 'ping');
      res.ms = Date.now() - t;
      res.view = await race(page.evaluate(() => (document.querySelector('main')?.innerText || document.body.innerText).replace(/\s+/g, ' ').slice(0, 140)), 5000, 'text');
    } catch (e) { res.err = e.message; }
    res.pageerrors = errs.slice(0, 3);
    console.log(JSON.stringify(res));
    await page.context().close();
  }
};
