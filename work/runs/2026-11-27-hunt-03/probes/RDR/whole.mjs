import { bigFile } from '../gen.mjs';
import { parseMarkdown } from '../../../../../packages/core/src/parse/parse.ts';
import { holdsDefinitionMark } from '../../../../../packages/core/src/parse/reparse.ts';
const ms = (f) => { const t = performance.now(); const r = f(); return [+(performance.now() - t).toFixed(0), r]; };
for (const kind of (process.env.KINDS || 'md-technical,md-references').split(',')) for (const size of [250000, 500000, 1000000, 2000000]) {
  const { text } = await bigFile(kind, size); const bytes = Buffer.from(text);
  const [h, mark] = ms(() => holdsDefinitionMark(bytes));
  const [t, doc] = ms(() => parseMarkdown(bytes));
  console.log(JSON.stringify({ kind, size: bytes.length, mark, markMs: h, parseMs: t, blocks: doc.children.length, perMB: +(t / (bytes.length / 1e6)).toFixed(0) }));
}
