import { bigFile } from '../gen.mjs';
import { parseMarkdown } from '../../../../../packages/core/src/index.ts';
for (const mb of [0.5, 1, 2]) {
  const { text } = await bigFile('md-prose', mb * 1e6);
  const b = new TextEncoder().encode(text);
  const s = performance.now(); parseMarkdown(b, { file: 'a.md' }); console.log('parse', mb, 'MB ms', Math.round(performance.now() - s));
}
