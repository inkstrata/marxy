import { storedZip } from '../../../../../packages/core/src/office/testing/samples.ts';
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const docx = (paras) => storedZip({
  '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${paras.map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`,
});
const race = (p, ms, label) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL ' + label)), ms))]);
export default async ({ boot, shot, open, plantBytes }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const n of [19_999, 20_000, 20_001]) {
    const paras = Array.from({ length: n }, (_, i) => (i === n - 1 ? `LASTPARA ${i}` : `eeee eeee eeee eeee ${i}`));
    const path = `/demo/w${n}.docx`;
    await plantBytes(page, path, docx(paras));
    await open(page, path, 6000);
    const info = await race(page.evaluate(() => {
      const a = document.querySelector('.marxy-office, [data-marxy-reading], article');
      const t = document.body.innerText;
      return { cut: [...document.querySelectorAll('.marxy-office-cut')].map((e) => e.textContent), hasLast: t.includes('LASTPARA'), head: (document.querySelector('.marxy-reading-head')?.textContent ?? '').slice(0, 120) };
    }), 10000, 'read ' + n).catch((e) => String(e));
    console.log(n, JSON.stringify(info));
    // find
    try {
      await race(page.keyboard.press('Control+f'), 10000, 'ctrlf');
      await race(page.keyboard.type('e'), 10000, 'type');
      await page.waitForTimeout(3000);
      const f = await race(page.evaluate(() => ({ bar: document.body.innerText.match(/\d[\d,]* (of|matches)[^\n]*/g), errs: window.__errs ?? null })), 10000, 'read find');
      console.log(n, 'find', JSON.stringify(f), JSON.stringify(page.errors?.slice(0, 3)));
      await page.keyboard.press('Escape');
    } catch (e) { console.log(n, 'find failed', String(e)); }
  }
};
