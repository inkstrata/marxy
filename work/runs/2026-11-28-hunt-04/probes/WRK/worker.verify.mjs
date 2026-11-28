// Own probe: 400 KB Markdown with a link definition; collect console, marks, and race the open against 10 s.
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const logs = [];
  page.on('console', (m) => { if (/parse|worker/i.test(m.text())) logs.push(m.type() + ': ' + m.text()); });
  const body = '[ref]: https://example.com\n\n' + Array.from({ length: 9000 }, (_, i) => `Paragraph ${i} with [a link][ref] and some words to fill the line out.\n`).join('\n');
  await plantText(page, '/demo/big-def.md', body);
  const t = new Promise((r) => setTimeout(() => r('TIMEOUT'), 10000));
  const r = await Promise.race([open(page, '/demo/big-def.md').then(() => 'opened'), t]);
  await new Promise((r) => setTimeout(r, 1500));
  console.log('bytes', body.length, 'open:', r);
  console.log(logs.join('\n') || 'no worker/parse console lines');
  const marks = await page.evaluate(() => (window.__marxyMarks || performance.getEntriesByType('mark').map((m) => m.name)).toString().slice(0, 400)).catch((e) => 'n/a ' + e.message);
  console.log('marks', marks);
};
