import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
const WT = process.env.WT ?? 'C:/Dev/reader/worktrees/definitions-index';
const { parseMarkdown } = await import(pathToFileURL(`${WT}/packages/core/src/parse/parse.ts`).href);
const dir = `C:/Dev/reader/worktrees/definitions-index/fixtures/corpus`;
for (const prefix of ['32-long-reference', '15-prose-volume']) {
  const name = readdirSync(dir).find((n) => n.startsWith(prefix))!;
  const bytes = new Uint8Array(readFileSync(`${dir}/${name}`));
  parseMarkdown(bytes, { file: '/x.md' }); // warm
  const ms: number[] = [];
  for (let i = 0; i < 9; i++) { const t = performance.now(); parseMarkdown(bytes, { file: '/x.md' }); ms.push(performance.now() - t); }
  ms.sort((a, b) => a - b);
  console.log(WT.includes('worktrees') ? 'branch' : 'master', name, bytes.length, 'median', ms[4]!.toFixed(1), 'min', ms[0]!.toFixed(1), 'max', ms[8]!.toFixed(1));
}
