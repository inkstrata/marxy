import { storedZip, wordParts } from '../../../../../packages/core/src/office/testing/samples.ts';
const rtf = new TextEncoder().encode('{\rtf1\ansi\deff0 Hello \b world\b0\par}');
const docx = storedZip(wordParts());
const files = {
  '/demo/w-rtf.doc': rtf,
  '/demo/w-docx.doc': docx,
  '/demo/w-docx.rtf': docx,
  '/demo/w-rtf.docx': rtf,
  '/demo/w-rtf.txt': rtf,
  '/demo/w-docx.zip': docx,
  '/demo/w-docx.xyz': docx,
  '/demo/w-docx.bin': docx,
  '/demo/w-noext': docx,
  '/demo/w-eml.txt': new TextEncoder().encode('From: a@b.c\r\nSubject: hello\r\nDate: Sat, 28 Nov 2026 08:14:09 +0000\r\n\r\nbody\r\n'),
  '/demo/w-eml.msg': new TextEncoder().encode('From: a@b.c\r\nSubject: hello\r\n\r\nbody\r\n'),
  '/demo/w-eml.mbox': new TextEncoder().encode('From a@b.c Sat Nov 28 08:14:09 2026\r\nFrom: a@b.c\r\nSubject: hello\r\n\r\nbody\r\n\r\nFrom a@b.c Sat Nov 28 08:15:09 2026\r\nFrom: a@b.c\r\nSubject: two\r\n\r\nbody2\r\n'),
};
export default async ({ boot, open, plantBytes }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const [p, b] of Object.entries(files)) {
    await plantBytes(page, p, b);
    const r = await Promise.race([
      (async () => { await open(page, p, 1500); return page.evaluate(() => { const v = document.querySelector('[data-marxy-viewer]'); const t = (v ?? document.querySelector('.marxy-pane'))?.innerText ?? ''; return (v ? 'VIEWER ' + v.getAttribute('data-marxy-viewer') + ': ' : 'PANE: ') + t.replace(/\s+/g, ' ').slice(0, 260); }); })(),
      new Promise((r) => setTimeout(() => r('TIMEOUT'), 10000)),
    ]);
    console.log('### ' + p + '\n' + r);
  }
};
