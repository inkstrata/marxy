import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Block } from '../contracts/ast.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { inlinePlainText } from './inline-text.ts';

function parse(source: string) {
  return parseMarkdown(source, { file: 'test.md' });
}

test('inline-text: one case per inline type', () => {
  const doc = parse(
    'plain `code` *em* **st** ~~del~~ [lnk **bold**](http://x) ![the alt](i.png) $m$ note[^1]<b>x</b>  \nsoft\nbreak\n\n- [ ] task\n\n[^1]: n\n',
  );
  const para = doc.children[0]!;
  assert.equal(para.type, 'paragraph');
  const inlines = (para as Extract<Block, { type: 'paragraph' }>).children;
  const byType = (type: string) => inlines.filter((n) => n.type === type);
  assert.equal(inlinePlainText(byType('text').slice(0, 1)), 'plain ');
  assert.equal(inlinePlainText(byType('code')), 'code');
  assert.equal(inlinePlainText(byType('emphasis')), 'em');
  assert.equal(inlinePlainText(byType('strong')), 'st');
  assert.equal(inlinePlainText(byType('strikethrough')), 'del');
  assert.equal(inlinePlainText(byType('link')), 'lnk bold');
  assert.equal(inlinePlainText(byType('image')), 'the alt');
  assert.equal(inlinePlainText(byType('mathInline')), 'm');
  assert.equal(inlinePlainText(byType('footnoteReference')), '[1]');
  assert.equal(inlinePlainText(byType('html')), '');
  assert.equal(inlinePlainText(byType('hardBreak')), '\n');
  assert.equal(inlinePlainText(byType('hardBreak'), { hardBreak: ' / ' }), ' / ');
  assert.equal(inlinePlainText(byType('softBreak')), ' ');
  const list = doc.children.find((b): b is Extract<Block, { type: 'list' }> => b.type === 'list')!;
  const item = list.children[0]!;
  const taskPara = item.children[0] as Extract<Block, { type: 'paragraph' }>;
  assert.equal(inlinePlainText(taskPara.children.filter((n) => n.type === 'taskMarker')), '');
  assert.equal(inlinePlainText(taskPara.children).trim(), 'task');
});
