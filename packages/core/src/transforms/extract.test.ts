import { tableOf, type Case } from './testing/rows.ts';

const DOC = [
  '# Title', '', 'Intro with `src/a.ts` and `./b/c.md` and `src/a.ts` again. Is it done?', '',
  '- [ ] open one', '- [x] done', '  - [ ] nested open', '',
  '```console', '$ npm test', 'ok 1', '```', '', '```bash', 'echo hi', '```', '', '```ts', 'const x = 1;', '```', '',
  '## Links', '', 'See [a](https://a.example) and [b](https://b.example) and [a](https://a.example).', '',
  '| h1 | h2 |', '|---|---|', '| 1 | 2 |', '',
].join('\n');

tableOf([
  ['x-code', 'every fence, nothing else', DOC, '```console\n$ npm test\nok 1\n```\n\n```bash\necho hi\n```\n\n```ts\nconst x = 1;\n```'],
  ['x-commands', 'shell fences as a script, prompts removed, output left out', DOC, 'set -euo pipefail\n\nnpm test\n\necho hi'],
  ['x-commands', 'no shell fence: nothing', '```ts\nx\n```\n', ''],
  ['x-tasks', 'unchecked tasks only, nesting kept', DOC, '- [ ] open one\n  - [ ] nested open'],
  ['x-links', 'unique links', DOC, '- [a](https://a.example)\n- [b](https://b.example)'],
  ['x-paths', 'unique backticked paths, in order', DOC, 'src/a.ts\n./b/c.md'],
  ['x-headings', 'headings as an indented list', '# A\n\n## B\n\n```\n# not\n```\n\n### C\n', '- A\n  - B\n    - C'],
  ['x-tables', 'every table as CSV', DOC, 'h1,h2\n1,2'],
  ['x-questions', 'lines ending in ?, outside code', '- Is it done?\nA statement.\n```\nwhy?\n```\nReally?\n', '- Is it done?\nReally?'],
] satisfies Case[]);
