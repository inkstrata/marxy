// Files named like a database, a font, a sheet or an archive that are something else (or cut short).
const cfb = new Uint8Array(600); cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const sqliteHead = new Uint8Array(100); sqliteHead.set(new TextEncoder().encode('SQLite format 3'), 0); sqliteHead[16] = 0x10; sqliteHead[17] = 0; sqliteHead[18] = 1; sqliteHead[19] = 1;
const text = new TextEncoder().encode('just words, not a database\n');
const files = {
  '/demo/Thumbs.db': cfb,
  '/demo/n-words.db': text,
  '/demo/n-words.sqlite': text,
  '/demo/n-cut.sqlite': sqliteHead,
  '/demo/n-words.ttf': text,
  '/demo/n-words.xlsx': text,
  '/demo/n-words.zip': text,
  '/demo/n-words.mp3': text,
  '/demo/n-words.png': text,
  '/demo/n-words.docx': text,
  '/demo/n-words.pptx': text,
  '/demo/n-words.msg': text,
  '/demo/n-words.eml': text,
  '/demo/n-words.ipynb': text,
  '/demo/n-json.ipynb': new TextEncoder().encode('{"hello": 1}'),
  '/demo/n-ods.ods': text,
};
export default async ({ boot, open, plantBytes }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const [p, b] of Object.entries(files)) {
    await plantBytes(page, p, b);
    await open(page, p, 1300);
    const r = await page.evaluate(() => {
      const v = document.querySelector('[data-marxy-viewer]');
      const t = (v ?? document.querySelector('.marxy-pane'))?.innerText ?? '';
      return (v ? 'VIEWER ' + v.getAttribute('data-marxy-viewer') + ': ' : 'PANE: ') + t.replace(/\s+/g, ' ').slice(0, 230);
    });
    console.log('### ' + p + '\n' + r);
  }
};
