import { readFileSync, readdirSync } from 'node:fs';
import { parseMarkdown } from '../../../worktrees/definitions-index/packages/core/src/parse/parse.ts';
import { holdsDefinitions } from '../../../worktrees/definitions-index/packages/core/src/parse/from-mdast.ts';

const dir = 'C:/Dev/reader/worktrees/definitions-index/fixtures/corpus/';
for (const name of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
  const bytes = new Uint8Array(readFileSync(dir + name));
  const doc = parseMarkdown(bytes, { file: name });
  console.log(name, bytes.length, holdsDefinitions(doc));
}
