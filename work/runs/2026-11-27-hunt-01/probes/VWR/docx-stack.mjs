import { readWord } from '../../../../../packages/core/src/office/word.ts';
const W = (b) => '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + b + '</w:body></w:document>';
for (const n of [20000, 50000, 100000, 150000, 400000]) {
  const xml = new TextEncoder().encode(W('<w:p><w:r><w:t>hi</w:t></w:r></w:p>'.repeat(n)));
  const read = async (name) => (name === 'word/document.xml' ? xml : null);
  try { const d = await readWord(read); console.log(n, 'ok', d.blocks.length); }
  catch (e) { console.log(n, 'THROW', String(e).slice(0, 80), (e.stack || '').split('\n').slice(1, 4).join(' | ')); }
}
