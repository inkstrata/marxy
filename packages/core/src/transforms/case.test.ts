import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentenceCase, titleCase } from './case.ts';
import { tableOf, type Case } from './testing/rows.ts';

const FENCE = '```\n# the quick brown fox\n```\n';

tableOf([
  ['lower', 'whole text', 'Hello WORLD\n', 'hello world\n'],
  ['upper', 'whole text', 'Hello world\n', 'HELLO WORLD\n'],
  ['lower', 'leaves URLs, link destinations, code spans and fences alone', 'Read [The Docs](https://Ex.com/Path?Q=1) or <https://A.io/X> or https://B.io/Y#Z, `CamelCase`\n\n```\nKeepMe\n```\n\n[Ref]: https://C.io/W\n', 'read [the docs](https://Ex.com/Path?Q=1) or <https://A.io/X> or https://B.io/Y#Z, `CamelCase`\n\n```\nKeepMe\n```\n\n[Ref]: https://C.io/W\n'],
  ['upper', 'leaves URLs, link destinations, code spans and fences alone', 'see [the docs](https://ex.com/p) and www.ex.org/q `code` ok\n\n```\nkeep\n```\n', 'SEE [THE DOCS](https://ex.com/p) AND www.ex.org/q `code` OK\n\n```\nkeep\n```\n'],
  ['lower', 'leaves front matter alone', '---\nTitle: X\n---\n\nHELLO\n', '---\nTitle: X\n---\n\nhello\n'],
  ['title-headings', 'leaves a heading\'s link destination and code alone', '# see [the docs](https://Ex.com/Path) and `a b`\n', '# See [the docs](https://Ex.com/Path) and `a b`\n'],
  ['slug', 'lower-case-with-hyphens', 'Hello, World -- Ünïcode & more!\n', 'hello-world-unicode-more'],
  ['title-headings', 'minor words stay lower, first and last and after a colon rise', '# the lord of the rings: a tale\n\ntext of the day\n', '# The Lord of the Rings: A Tale\n\ntext of the day\n'],
  ['title-headings', 'keeps acronyms, code, paths and mixed case; keeps the closing run', '## using `git` with iOS and NASA/api ##\n', '## Using `git` With iOS and NASA/api ##\n'],
  ['title-headings', 'leaves a fenced block and setext headings alone', `${FENCE}\nsetext heading\n===\n`, `${FENCE}\nsetext heading\n===\n`],
  ['sentence-headings', 'first word up, the rest down, acronyms kept', '# the Quick Brown API Fox\n\nBody Text\n', '# The quick brown API fox\n\nBody Text\n'],
  ['sentence-headings', 'leaves a fenced block alone', `# Title Case Here\n\n${FENCE}`, `# Title case here\n\n${FENCE}`],
] satisfies Case[]);

test('title and sentence case are idempotent', () => {
  for (const s of ['the lord of the rings: a tale', 'using git with iOS', 'A Mixed heading of NASA']) {
    assert.equal(titleCase(titleCase(s)), titleCase(s));
    assert.equal(sentenceCase(sentenceCase(s)), sentenceCase(s));
  }
});
