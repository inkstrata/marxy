import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { caretOffset } from './block-edit-caret.ts';

const after = (text: string, nestedAt: number | null = null): string => {
  const at = caretOffset(text, nestedAt);
  return `${text.slice(0, at)}|${text.slice(at)}`;
};

test('a paragraph, list item, task and quote end at their text, a trailing break excluded', () => {
  assert.equal(after('plain words\n'), 'plain words|\n');
  assert.equal(after('- item'), '- item|');
  assert.equal(after('- [ ] task\r\n'), '- [ ] task|\r\n');
  assert.equal(after('> quoted\n> more\n'), '> quoted\n> more|\n');
});

test('the space after an empty marker stays before the caret', () => {
  assert.equal(after('- \n'), '- |\n');
  assert.equal(after('- [ ] '), '- [ ] |');
});

test('a fenced code block ends on its last content line, before the closing fence', () => {
  assert.equal(after('```js\nlet a;\nlet b;\n```\n'), '```js\nlet a;\nlet b;|\n```\n');
  assert.equal(after('~~~\nx\n~~~'), '~~~\nx|\n~~~');
});

test('a setext heading ends on its first line', () => {
  assert.equal(after('Title\n=====\n'), 'Title|\n=====\n');
  assert.equal(after('Title\n-----'), 'Title|\n-----');
});

test('a table ends inside its last cell', () => {
  assert.equal(after('| a | b |\n| - | - |\n| 1 | 2 |\n'), '| a | b |\n| - | - |\n| 1 | 2| |\n');
  assert.equal(after('a | b\n- | -\n1 | 2'), 'a | b\n- | -\n1 | 2|');
});

test('a list item with a nested list ends in its own text', () => {
  const text = '- parent\n  - child\n';
  assert.equal(after(text, text.indexOf('- child')), '- parent|\n  - child\n');
});
