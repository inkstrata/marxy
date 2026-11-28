// The same large file asked for twice in the pane while its first open is in flight (a double click, a drop plus a second launch).
export default async ({ boot, plantText }) => {
  let t = '# TWICE\n\n'; for (let i = 0; t.length < 3_000_000; i++) t += `- item ${i} with *em* and [l](https://e.com/${i})  \n  second line\n\n`;
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/t.md', t);
  const marks = (n) => page.evaluate((n) => window.marxy.shell.calls.filter(c => c.method === 'mark' && c.args[0] === n).length, n);
  const reads = () => page.evaluate(() => window.marxy.shell.calls.filter(c => c.method === 'readFile' && String(c.args[0]).endsWith('t.md')).length);
  const b = { f: await marks('file_read'), r: await reads() };
  const t0 = Date.now();
  await page.evaluate(() => { window.__a = window.marxy.handle.open('/demo/t.md'); window.__b = window.marxy.handle.open('/demo/t.md'); });
  const done = await page.evaluate(() => Promise.all([window.__a, window.__b]).then(() => true));
  console.log('both opens settled after', ((Date.now() - t0) / 1000).toFixed(1) + 's; file_read marks +' + (await marks('file_read') - b.f) + ', readFile calls +' + (await reads() - b.r));
  const t1 = Date.now();
  await page.evaluate(() => window.marxy.handle.open('/demo/t.md'));
  console.log('one more open of the settled file took', ((Date.now() - t1) / 1000).toFixed(1) + 's');
};
