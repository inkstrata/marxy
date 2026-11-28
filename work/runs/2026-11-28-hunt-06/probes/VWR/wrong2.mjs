// An RTF body under four names: what the reader meets for each.
const B = String.fromCharCode(92);
const rtf = new TextEncoder().encode(`{${B}rtf1${B}ansi${B}deff0 Hello ${B}b world${B}b0${B}par}`);
const files = { '/demo/w2.doc': rtf, '/demo/w2.docx': rtf, '/demo/w2.txt': rtf, '/demo/w2.rtf': rtf, '/demo/w2.odt': rtf };
export default async ({ boot, open, plantBytes }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const [p, b] of Object.entries(files)) {
    await plantBytes(page, p, b);
    await open(page, p, 1500);
    const r = await page.evaluate(() => {
      const v = document.querySelector('[data-marxy-viewer]');
      const t = (v ?? document.querySelector('.marxy-pane'))?.innerText ?? '';
      return (v ? 'VIEWER ' + v.getAttribute('data-marxy-viewer') + ': ' : 'PANE: ') + t.replace(/\s+/g, ' ').slice(0, 330);
    });
    console.log('### ' + p + '\n' + r);
  }
};
