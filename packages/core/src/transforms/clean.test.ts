import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTransform } from './registry.ts';
import { tableOf, type Case } from './testing/rows.ts';

const FENCE = '```\n# not a heading\n**bold** :) [1] ---\n```\n';

const cases: Case[] = [
  // normalize-headings keeps every character (F-41): a setext heading whose text starts with # is not ATX
  ['normalize-headings', 'keeps the character after # in a setext heading', '#x\n---\n', '#x\n---\n'],
  ['normalize-headings', 'keeps non-ASCII after #', '#é\n-\n', '#é\n-\n'],
  ['normalize-headings', 'keeps # at end of file and CRLF setext text', '#\r\n-', '#\r\n-'],
  ['normalize-headings', 'leaves a hash run with no space alone', '#Heading\n##x\n', '#Heading\n##x\n'],
  ['demote', 'keeps the character after # in a setext heading', '#x\n---\n', '#x\n---\n'],
  ['promote', 'keeps the character after # in a setext heading', '#x\n---\n', '#x\n---\n'],
  // strip-emoji
  ['strip-emoji', 'removes emoji, joined sequences and flags', 'Ship it 🚀 now 👍🏽 and 👨‍👩‍👧 🇳🇿\n', 'Ship it  now  and  \n'],
  ['strip-emoji', 'keeps copyright, trade mark and digits', '© 2026 Marxy™ 1️⃣ 2\n', '© 2026 Marxy™  2\n'],
  ['strip-emoji', 'leaves a fenced block alone', `🚀 a\n${FENCE.replace('**bold**', '🚀')}`, ` a\n${FENCE.replace('**bold**', '🚀')}`],
  ['strip-emoji', 'leaves inline code alone', 'use `🚀` 🚀\n', 'use `🚀` \n'],
  // strip-frontmatter
  ['strip-frontmatter', 'removes a leading block and the blank lines after it', '---\ntitle: x\n---\n\n\n# Hi\n', '# Hi\n'],
  ['strip-frontmatter', 'keeps a rule that is not front matter', '# Hi\n\n---\n\ntext\n', '# Hi\n\n---\n\ntext\n'],
  ['strip-frontmatter', 'keeps a block that does not start the file', '\n---\ntitle: x\n---\n', '\n---\ntitle: x\n---\n'],
  // strip-citations
  ['strip-citations', 'removes [1], 【1】 and [^note] markers', 'A claim [1] and another【2】 here[^n].\n', 'A claim and another here.\n'],
  ['strip-citations', 'removes a footnote definition and its continuation', 'Text[^n].\n\n[^n]: The note\n    goes on.\n\nAfter\n', 'Text.\n\n\nAfter\n'],
  ['strip-citations', 'keeps a link whose text is a number and a reference definition', '[1](http://a.example) and [1]\n\n[1]: http://b.example\n', '[1](http://a.example) and [1]\n\n[1]: http://b.example\n'],
  ['strip-citations', 'keeps the indent of a fence in a list after a footnote line (F-51)', '[^1]: foot\n  - ```js\n    x [1]\n    ```\n\nafter[^1]\n', '  - ```js\n    x [1]\n    ```\n\nafter\n'],
  ['strip-citations', 'leaves code alone', `see [1]\n${FENCE}`, `see\n${FENCE}`],
  // strip-bold
  ['strip-bold', 'unwraps ** and __', 'a **b c** and __d__ e\n', 'a b c and d e\n'],
  ['strip-bold', 'keeps single emphasis, a snake_case__name__x word and code', '*it* snake__name__x `**k**` **b**\n', '*it* snake__name__x `**k**` b\n'],
  ['strip-bold', 'leaves a fenced block alone', `**b**\n${FENCE.replace('[1]', '**x**')}`, `b\n${FENCE.replace('[1]', '**x**')}`],
  // strip-hr
  ['strip-hr', 'deletes ---, *** and ___ lines', 'a\n\n---\n\nb\n\n***\n\nc\n\n___\n\nd\n', 'a\n\n\nb\n\n\nc\n\n\nd\n'],
  ['strip-hr', 'deletes a spaced rule', 'a\n\n- - -\n\nb\n', 'a\n\n\nb\n'],
  ['strip-hr', 'keeps a setext underline', 'Title\n---\n\nbody\n', 'Title\n---\n\nbody\n'],
  ['strip-hr', 'keeps a rule inside a quote', '> a\n> ---\n> b\n', '> a\n> ---\n> b\n'],
  ['strip-hr', 'leaves front matter and fences alone', `---\ntitle: x\n---\n\n${FENCE}`, `---\ntitle: x\n---\n\n${FENCE}`],
  // collapse-blank
  ['collapse-blank', 'trims trailing space and collapses blank runs', 'a  \nb\t\n\n\n\n\nc \n', 'a  \nb\n\nc\n'],
  ['collapse-blank', 'trims a trailing space that is not a hard break', 'a \nb\n', 'a\nb\n'],
  ['collapse-blank', 'keeps a hard break before indented code in a list (F-51)', '* item  \n*       code\n* c\n', '* item  \n*       code\n* c\n'],
  ['collapse-blank', 'keeps a hard break before a fence in a list (F-51)', '* item  \n*   ```js\n    x  \n    ```\n* c\n', '* item  \n*   ```js\n    x  \n    ```\n* c\n'],
  ['collapse-blank', 'keeps a hard break before indented code in a quote (F-51)', '>> text  \n>>     code\n', '>> text  \n>>     code\n'],
  ['collapse-blank', 'keeps a hard break before a fence in a quote (F-51)', '> text  \n> ```js\n> x\n> ```\n', '> text  \n> ```js\n> x\n> ```\n'],
  ['collapse-blank', 'leaves a fenced block alone', 'a\n\n\n\nb\n```\nx   \n\n\n\ny\n```\n', 'a\n\nb\n```\nx   \n\n\n\ny\n```\n'],
  ['collapse-blank', 'keeps the indent of indented code after a bullet item (F-51)', '- item\n\n      code\n', '- item\n\n      code\n'],
  ['collapse-blank', 'keeps the indent of indented code after a numbered item (F-51)', '1. step\n\n       code\n', '1. step\n\n       code\n'],
  ['collapse-blank', 'keeps the indent of a fenced block in a list item (F-51)', '- item\n\n  ```js\n  x\n  ```\n', '- item\n\n  ```js\n  x\n  ```\n'],
  ['collapse-blank', 'keeps the indent of indented code in a quoted list item (F-51)', '> - item\n>\n>       code\n', '> - item\n>\n>       code\n'],
  ['collapse-blank', 'keeps the indent of the nine-space code line (F-51)', '- item\n\n         code\n', '- item\n\n         code\n'],
  // normalize-bullets
  ['normalize-bullets', '* and + become -', '* a\n* b\n  + c\n', '- a\n- b\n  - c\n'],
  ['normalize-bullets', 'leaves numbers, - and emphasis alone', '1. a\n2. b\n\n- c\n\n*it* and * not a list\n', '1. a\n2. b\n\n- c\n\n*it* and * not a list\n'],
  ['normalize-bullets', 'leaves a list that would join its neighbour', '* a\n\n- b\n', '* a\n\n- b\n'],
  ['normalize-bullets', 'leaves a fenced block alone', `* a\n\n${FENCE}\n* b\n`, `- a\n\n${FENCE}\n- b\n`],
  // normalize-headings
  ['normalize-headings', 'starts at H1 and removes skipped levels', '## A\n#### B\n### C\n', '# A\n## B\n## C\n'],
  ['normalize-headings', 'leaves a normal outline and setext headings alone', '# A\n## B\n\nS\n===\n', '# A\n## B\n\nS\n===\n'],
  ['normalize-headings', 'leaves a fenced block alone', `### A\n\n${FENCE}\n#### B\n`, `# A\n\n${FENCE}\n## B\n`],
  // demote / promote
  ['demote', 'adds one # to every heading, H6 stays', '# A\n\n###### B\n\ntext\n', '## A\n\n###### B\n\ntext\n'],
  ['demote', 'keeps a closing run and leaves a fence alone', `# A #\n\n${FENCE}`, `## A #\n\n${FENCE}`],
  ['promote', 'removes one # from every heading, H1 stays', '# A\n\n### B\n\ntext\n', '# A\n\n## B\n\ntext\n'],
  ['promote', 'leaves a fenced block alone', `## A\n\n${FENCE}`, `# A\n\n${FENCE}`],
  // unwrap
  ['unwrap', 'joins the lines of a paragraph', 'one\ntwo\nthree\n\nnext\n', 'one two three\n\nnext\n'],
  ['unwrap', 'keeps a hard break', 'one  \ntwo\nthree\n', 'one  \ntwo three\n'],
  ['unwrap', 'leaves lists, quotes, tables, headings and code alone', `- a\n  b\n\n> q\n> r\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n# H\n\n${FENCE}`, `- a\n  b\n\n> q\n> r\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n# H\n\n${FENCE}`],
  // smart / straight punctuation
  ['smart-punct', 'curls quotes, dashes a range, an em dash and an ellipsis', 'He said "it\'s 10-20" -- wait...\n', 'He said “it’s 10–20”—wait…\n'],
  ['smart-punct', 'leaves dates, code spans and fences alone', `2026-10-10 \`"x"\`\n${FENCE.replace('[1]', '"q"')}`, `2026-10-10 \`"x"\`\n${FENCE.replace('[1]', '"q"')}`],
  ['straight-punct', 'straightens quotes, dashes and the ellipsis', '“a” ‘b’ c—d e–f g…\n', '"a" \'b\' c--d e-f g...\n'],
  ['straight-punct', 'leaves a fenced block alone', `“a”\n\`\`\`\n“b”\n\`\`\`\n`, `"a"\n\`\`\`\n“b”\n\`\`\`\n`],
];
tableOf(cases);

test('strip-hr and collapse-blank are idempotent (card), asserted on rows with work to do', () => {
  for (const [id, , source] of cases.filter((c) => c[0] === 'strip-hr' || c[0] === 'collapse-blank')) {
    const once = runTransform(id, source);
    assert.equal(runTransform(id, once), once, id);
  }
});

test('normalize-headings keeps a lone surrogate after # (F-41)', () => {
  assert.equal(runTransform('normalize-headings', '#\udc80\n-\n'), '#\udc80\n-\n');
});
