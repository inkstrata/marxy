import { bigFile } from '../gen.mjs';
import { parseMarkdown } from '../../../../../packages/core/src/parse/parse.ts';
import { reparseMarkdown, lastReparse } from '../../../../../packages/core/src/parse/reparse.ts';
import { renderDocumentSafeHtml } from '../../../../../packages/core/src/render/pipeline.ts';
import { renderSafeHtml } from '../../../../../packages/core/src/render/pipeline.ts';
const ms = (f) => { const t = performance.now(); const r = f(); return [+(performance.now() - t).toFixed(0), r]; };
const kinds = (process.env.KINDS || 'md-prose,md-technical,md-references,md-dense,md-headings,md-tables,md-code-fences').split(',');
for (const kind of kinds) for (const size of (process.env.SIZES || '1000000,2000000,4900000').split(',').map(Number)) {
  const { text } = await bigFile(kind, size);
  const bytes = Buffer.from(text);
  const out = { kind, size: bytes.length };
  try {
    let [t, doc] = ms(() => parseMarkdown(bytes)); out.parse = t; out.blocks = doc.children.length;
    [t] = ms(() => renderDocumentSafeHtml(doc)); out.render = t;
    // edit: change one byte ~ 97% in
    const at = text.lastIndexOf('\n\n', Math.floor(text.length * 0.97)) + 3;
    const after = Buffer.from(bytes); after[at] = after[at] === 0x78 ? 0x79 : 0x78;
    [t, ] = ms(() => reparseMarkdown(doc, bytes, after)); out.reparse = t; out.rp = JSON.stringify(lastReparse());
  } catch (e) { out.err = String(e).slice(0, 200); }
  console.log(JSON.stringify(out));
}
