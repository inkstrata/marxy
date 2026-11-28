export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const logs = []; page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 200)));
  const unit = '# Head N\n\nPara with `code` and [ref] and [unclosed bracket and é😀 text here.\n\n```js\nconst a = 1;\n```\n\n- item\n  > quote\n\n';
  let text = '';
  for (let i = 0; text.length < 600000; i++) text += unit.replace('N', i);
  text += '[ref]: http://example.com\n\n```\nunclosed fence at end\n';
  await plantText(page, '/demo/big.md', text);
  await open(page, '/demo/big.md');
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => {
    const h = window.__h || window.__marxyHandle;
    const c = h?.shell?.calls?.filter((x) => x.method === 'mark' && x.args[0] === 'parsed').map((x) => x.args[2]);
    return { keys: Object.keys(window).filter((k) => k.startsWith('__')), parsed: c, worker: typeof Worker };
  });
  console.log(JSON.stringify(r)); console.log(logs.join('\n'));
};
