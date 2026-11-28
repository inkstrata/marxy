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
  for (const n of [2000, 4000, 6000, 9000]) {
    const paras = Array.from({ length: n }, (_, i) => `eeee eeee eeee eeee ${i}`);
    const path = `/demo/t${n}.docx`;
    await plantBytes(page, path, docx(paras));
    await open(page, path, 5000);
    const before = page.errors?.length ?? 0;
    await page.keyboard.press('Control+f');
    await page.keyboard.type('e');
    await page.waitForTimeout(3000);
    const bar = await page.evaluate(() => [...document.querySelectorAll('[class*=find]')].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 4));
    console.log(n, 'expected matches', n * 16 + 0, 'new errors', (page.errors?.length ?? 0) - before, JSON.stringify(bar));
    await shot(page, 'find-' + n);
    await page.keyboard.press('Escape');
  }
};
