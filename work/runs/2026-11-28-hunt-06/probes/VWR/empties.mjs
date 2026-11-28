import { storedZip } from '../../../../../packages/core/src/office/testing/samples.ts';
const eocd = new Uint8Array(22); new DataView(eocd.buffer).setUint32(0,0x06054b50,true);
const files = {
  '/demo/e-empty-eocd.zip': eocd,
  '/demo/e-one.zip': storedZip({ '日本語/ファイル.txt': 'hello' }),
  '/demo/e-dironly.zip': storedZip({ 'a/': '' }),
  '/demo/e-long.zip': storedZip({ ['d/'.repeat(30) + 'x'.repeat(150) + '.txt']: 'hi' }),
  '/demo/e-0.zip': new Uint8Array(0),
  '/demo/e-0.docx': new Uint8Array(0),
  '/demo/e-0.xlsx': new Uint8Array(0),
  '/demo/e-0.eml': new Uint8Array(0),
  '/demo/e-0.sqlite': new Uint8Array(0),
  '/demo/e-0.ipynb': new Uint8Array(0),
  '/demo/e-0.ttf': new Uint8Array(0),
  '/demo/e-0.csv': new Uint8Array(0),
  '/demo/e-0.pptx': new Uint8Array(0),
  '/demo/e-empty.docx': storedZip({ '[Content_Types].xml': '<Types/>' }),
  '/demo/e-eml.eml': new TextEncoder().encode('From: =?UTF-8?B?w4lsb8Ot?= <a@b.c>\r\nSubject: Hi\r\n\r\nbody'),
};
export default async ({ boot, open, plantBytes }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const [p, b] of Object.entries(files)) {
    await plantBytes(page, p, b);
    const r = await Promise.race([
      (async () => { await open(page, p, 1500); return page.evaluate(() => { const v = document.querySelector('[data-marxy-viewer]'); const t = (v ?? document.querySelector('.marxy-pane'))?.innerText ?? ''; return (v ? 'VIEWER ' + v.getAttribute('data-marxy-viewer') + ': ' : 'PANE: ') + t.replace(/\s+/g, ' ').slice(0, 450); }); })(),
      new Promise((r) => setTimeout(() => r('TIMEOUT'), 10000)),
    ]);
    console.log('### ' + p + '\n' + r + '\n  errors: ' + JSON.stringify(page.errors ?? []));
  }
};
