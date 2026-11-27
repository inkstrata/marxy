// Each fenced block in Markdown's Source carries its own language scope, as in Read: the lines between its fence
// lines take `data-marxy-lang`, the registry's id for the fence's word, so a theme's `[data-marxy-lang="rust"]` scope
// colours a Rust fence in Source as it does in Read, under the editor root's `markdown`. Read writes the attribute under
// a secret name because a raw HTML block could forge it there; here it is a CodeMirror line decoration, which the
// document's text cannot make, so it is written as itself.
import { langOfFence } from '@marxy/core/src/kind/registry.ts';
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/** As the renderer and the sanitiser hold it (`LANG_ID` in sanitize/policy.ts): one lowercase token. */
const LANGUAGE_TOKEN = /^[a-z0-9#+._-]{1,32}$/;

const lineDeco = new Map<string, Decoration>();
const decoFor = (id: string): Decoration => {
  let d = lineDeco.get(id);
  if (!d) lineDeco.set(id, (d = Decoration.line({ attributes: { 'data-marxy-lang': id } })));
  return d;
};

const nameDeco = new Map<string, Decoration>();
/** The fence's word for its language, which carries the language's accent when the accent is on. */
const nameFor = (id: string): Decoration => {
  let d = nameDeco.get(id);
  if (!d) nameDeco.set(id, (d = Decoration.mark({ class: 'marxy-fence-lang', attributes: { 'data-marxy-lang': id } })));
  return d;
};

/** The language id of each fence's body lines in the visible ranges, from the Markdown syntax tree. */
export function fenceScopes(state: EditorState, ranges: readonly { from: number; to: number }[]): DecorationSet {
  const out: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'FencedCode') return;
        if (seen.has(node.from)) return false;
        seen.add(node.from);
        const info = node.node.getChild('CodeInfo');
        const written = info ? state.sliceDoc(info.from, info.to).trim() : '';
        // A braced fence (Quarto's ```{r setup}) names its language inside the brace, and the brace is its name.
        const word = written.startsWith('{') ? (/^\{[^}]*\}?/.exec(written)?.[0] ?? '') : (written.split(/[\s{,]/)[0] ?? '');
        const id = word === '' ? '' : langOfFence(word);
        if (!LANGUAGE_TOKEN.test(id)) return false;
        const lead = info ? state.sliceDoc(info.from, info.to).search(/\S/) : -1;
        if (info && lead >= 0) out.push(nameFor(id).range(info.from + lead, info.from + lead + word.length));
        const first = state.doc.lineAt(node.from).number + 1;
        const lastLine = state.doc.lineAt(node.to);
        // An unclosed fence runs to the end of the document: its last line is body, not a closing mark.
        const closed = node.node.getChildren('CodeMark').length > 1;
        const last = closed ? lastLine.number - 1 : lastLine.number;
        for (let n = first; n <= last; n++) {
          const line = state.doc.line(n);
          if (line.to < from || line.from > to) continue;
          out.push(decoFor(id).range(line.from));
        }
        return false;
      },
    });
  }
  return Decoration.set(out, true);
}

/** The extension: fence scopes for what is on screen, kept as the text, the parse or the viewport moves. */
export function fenceLanguageScopes(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = fenceScopes(view.state, view.visibleRanges);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) {
          this.decorations = fenceScopes(update.state, update.view.visibleRanges);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}
