// A fence's lines carry the registry's id for its word, and a braced fence (Quarto's ```{r}) the id
// inside its brace, as Read's do.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { fenceScopes } from './fence-lang.ts';

/** Each fence's name as marked, and the id its first body line carries. */
function scopes(doc: string): [string, string][] {
  const state = EditorState.create({ doc, extensions: [markdown()] });
  ensureSyntaxTree(state, doc.length, 5000);
  const out: [string, string][] = [];
  fenceScopes(state, [{ from: 0, to: doc.length }]).between(0, doc.length, (from, to, deco) => {
    const attrs = deco.spec.attributes as Record<string, string>;
    if (deco.spec.class === 'marxy-fence-lang') out.push([state.sliceDoc(from, to), attrs['data-marxy-lang']!]);
  });
  return out;
}

test('a fence is named by its word, a braced one by its brace, each with the registry id', () => {
  const doc = ['```rs', 'x', '```', '', '```js{1,3}', 'x', '```', '', '```{r setup, include=FALSE}', 'x', '```', '', '```{.python .numberLines}', 'x', '```', '', '```{=html}', 'x', '```', '', '```{}', 'x', '```', ''].join('\n');
  assert.deepEqual(scopes(doc), [['rs', 'rust'], ['js', 'javascript'], ['{r setup, include=FALSE}', 'r'], ['{.python .numberLines}', 'python'], ['{=html}', 'html']]);
});
