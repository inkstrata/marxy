// Source's colour from Read's tokenizer: Shiki's runs, read in the highlight worker, applied as CodeMirror
// marks with Read's own classes (`marxy-tok-<role>`), so a token is one role, and one colour, in both modes. Lezer stays
// for structure (folding, Markdown's marks); it colours nothing in a code file.
//
// A code file is one channel: its text is sent when it opens and again a moment after each edit, and the worker reads it
// top down a piece at a time (core's RunSession), each piece replacing the marks over its span. Between an edit and its
// pieces the marks are mapped through the change, so colour never flickers off. A Markdown file's fences are each
// coloured as Read colours that fence, for the fences in view.
import { syntaxTree } from '@codemirror/language';
import { type Extension, type Range, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { hasGrammarRuns } from '@marxy/core/src/highlight/index.ts';
import { RUN_ROLES, runsFromTokens } from '@marxy/core/src/highlight/runs.ts';
import { langOfFence } from '@marxy/core/src/kind/registry.ts';
import type { LineRange, RunSessionOptions } from '@marxy/core/src/highlight/session.ts';
import { peekTokens, rememberTokens } from '../render/block-cache.ts';
import { fenceTokens, openRuns, type RunsChannel, type RunsPiece, type RunsSink } from '../render/highlight.ts';

/** One mark per role, with the class Read's spans carry (base.css colours both). */
const MARKS = RUN_ROLES.map((role) => Decoration.mark({ class: `marxy-tok-${role}` }));

/** Marks for `runs`, each moved by `offset` and kept below `limit`. */
export function marksFromRuns(runs: Uint32Array, offset = 0, limit = Number.POSITIVE_INFINITY): Range<Decoration>[] {
  const out: Range<Decoration>[] = [];
  for (let i = 0; i + 2 < runs.length; i += 3) {
    const from = runs[i]! + offset;
    const to = Math.min(runs[i + 1]! + offset, limit);
    if (to > from) out.push(MARKS[runs[i + 2]!]!.range(from, to));
  }
  return out;
}

/** The runs over `from`..`to` replace whatever marks were there. */
const setRuns = StateEffect.define<{ readonly from: number; readonly to: number; readonly marks: readonly Range<Decoration>[] }>();

/** The marks of a code file's runs, mapped through every change until its pieces replace them. */
export const runMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    let next = marks.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setRuns)) continue;
      const { from, to } = e.value;
      next = next.update({ filterFrom: from, filterTo: to, filter: (a, b) => b <= from || a >= to, add: e.value.marks, sort: true });
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The effect that lays a piece over a doc of `length`; the last piece also clears what an earlier, longer text left past the end. */
export function pieceEffect(piece: RunsPiece, length: number): StateEffect<unknown> {
  return setRuns.of({ from: piece.from, to: piece.done ? length : Math.min(piece.to, length), marks: marksFromRuns(piece.runs, 0, length) });
}

/** A moment after the last keystroke, so a burst of typing is read once. */
const EDIT_DELAY_MS = 80;

type Open = (lang: string, sink: RunsSink, options?: RunSessionOptions) => RunsChannel;

/** The lines on screen, then the editor's viewport around them (read first, in that order), 0-based. */
export function viewLines(view: Pick<EditorView, 'state' | 'visibleRanges' | 'viewport'>): LineRange[] {
  const { doc } = view.state;
  const line = (pos: number): number => doc.lineAt(pos).number - 1;
  const shown = view.visibleRanges;
  const out: LineRange[] = [];
  if (shown.length > 0) out.push([line(shown[0]!.from), line(shown[shown.length - 1]!.to) + 1]);
  out.push([line(view.viewport.from), line(view.viewport.to) + 1]);
  return out;
}

/** A channel opened before its editor exists, and the pieces that came before the editor took it. */
interface Early {
  readonly channel: RunsChannel;
  readonly text: string;
  readonly held: { piece: RunsPiece; version: number }[];
  take?: (piece: RunsPiece, version: number) => void;
}

/** The early channel of each colour extension no editor has taken yet, so one never taken can be closed. */
const UNTAKEN = new WeakMap<object, Early>();

/**
 * Colour for a whole file in `lang` (its registry id). Nothing for a language with no grammar runs. `open` is the
 * worker's channel; a test passes one of its own. Given the editor's text (lines joined by `\n`), the channel opens
 * now, so the grammar loads and the first piece is read while the editor mounts and Lezer's package loads.
 */
export function codeColour(lang: string, open: Open = openRuns, text?: string, options: RunSessionOptions = {}): Extension {
  if (!hasGrammarRuns(lang)) return [];
  let early: Early | null = null;
  if (text !== undefined) {
    const held: Early['held'] = [];
    const opened: Early = {
      text,
      held,
      channel: open(lang, { piece: (piece, version) => (opened.take ? opened.take(piece, version) : held.push({ piece, version })), none: () => {} }, options),
    };
    opened.channel.send(text, 1);
    early = opened;
  }
  const plugin = ViewPlugin.fromClass(
    class {
      private readonly view: EditorView;
      private readonly channel: RunsChannel;
      private version = 0;
      /** The doc the last text sent was; a piece for any other is for text that is gone. */
      private sent = null as EditorView['state']['doc'] | null;
      private timer: ReturnType<typeof setTimeout> | undefined;
      private destroyed = false;
      private viewFrame = 0;

      constructor(view: EditorView) {
        this.view = view;
        const mine = early;
        early = null;
        if (mine && view.state.doc.toString() === mine.text) {
          this.channel = mine.channel;
          this.version = 1;
          this.sent = view.state.doc;
          mine.take = (piece, version) => this.take(piece, version);
          this.sendView();
          // Not during the update that builds this plugin: a dispatch then is refused.
          if (mine.held.length > 0) queueMicrotask(() => { for (const h of mine.held.splice(0)) this.take(h.piece, h.version); });
          return;
        }
        mine?.channel.close();
        this.channel = open(lang, { piece: (piece, version) => this.take(piece, version), none: () => {} }, options);
        this.send();
        this.sendView();
      }

      /** Once a frame at most: scrolling moves what is read next. */
      private sendView(): void {
        if (this.viewFrame !== 0) return;
        const send = (): void => {
          this.viewFrame = 0;
          if (!this.destroyed) this.channel.view(viewLines(this.view));
        };
        this.viewFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(send) : (queueMicrotask(send), -1);
      }

      private take(piece: RunsPiece, version: number): void {
        if (this.destroyed || version !== this.version || this.view.state.doc !== this.sent) return;
        this.view.dispatch({ effects: pieceEffect(piece, this.view.state.doc.length) });
      }

      update(update: ViewUpdate): void {
        if (update.viewportChanged || update.geometryChanged) this.sendView();
        if (!update.docChanged) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.send(), EDIT_DELAY_MS);
      }

      private send(): void {
        this.timer = undefined;
        if (this.destroyed) return;
        this.sent = this.view.state.doc;
        // `toString` joins lines with `\n` whatever the file's separator: offsets are CodeMirror positions.
        this.channel.send(this.sent.toString(), ++this.version);
      }

      destroy(): void {
        this.destroyed = true;
        clearTimeout(this.timer);
        if (this.viewFrame > 0) cancelAnimationFrame(this.viewFrame);
        this.channel.close();
      }
    },
  );
  const ext = [runMarks, plugin];
  if (early) UNTAKEN.set(ext, early);
  return ext;
}

/** Closes the early channel of a colour extension that will never be given to an editor (it moved to another file). */
export function releaseColour(ext: Extension): void {
  const early = typeof ext === 'object' && ext !== null ? UNTAKEN.get(ext) : undefined;
  if (early && !early.take) early.channel.close();
}

/** A fence the page can colour: its language and the span of its body lines. */
interface FenceBody {
  readonly lang: string;
  readonly from: number;
  readonly to: number;
}

/** The fences with a body in the visible ranges whose language has grammar runs. Quoted fences are left plain. */
export function fenceBodies(state: EditorView['state'], ranges: readonly { from: number; to: number }[]): FenceBody[] {
  const out: FenceBody[] = [];
  const seen = new Set<number>();
  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name === 'Blockquote') return false;
        if (node.name !== 'FencedCode') return;
        if (seen.has(node.from)) return false;
        seen.add(node.from);
        const info = node.node.getChild('CodeInfo');
        const word = info ? state.sliceDoc(info.from, info.to).trim().split(/[\s{,]/)[0] ?? '' : '';
        const lang = word === '' ? '' : langOfFence(word);
        if (lang === '' || !hasGrammarRuns(lang)) return false;
        const first = state.doc.lineAt(node.from).number + 1;
        const closed = node.node.getChildren('CodeMark').length > 1;
        const last = closed ? state.doc.lineAt(node.to).number - 1 : state.doc.lineAt(node.to).number;
        if (first > last) return false;
        out.push({ lang, from: state.doc.line(first).from, to: state.doc.line(last).to });
        return false;
      },
    });
  }
  return out;
}

type FenceTokens = (code: string, lang: string, live: () => boolean) => ReturnType<typeof fenceTokens>;

const fenceRunsArrived = StateEffect.define<null>();

/** Few: only fences in view are asked for, and one this long fills the view. */
const UNKEPT_MAX = 4;

/** Each fence in view coloured from Read's runs for its text (`fenceTokens` is the worker's; a test passes its own). */
export function fenceColour(tokens: FenceTokens = fenceTokens): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private readonly view: EditorView;
      private readonly asked = new Set<string>();
      // Runs the shared store would not keep (a fence too long for it): held here, or each arrival would ask again.
      private readonly unkept = new Map<string, Uint32Array>();
      private destroyed = false;

      constructor(view: EditorView) {
        this.view = view;
        this.decorations = this.build();
      }

      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.viewportChanged ||
          syntaxTree(update.state) !== syntaxTree(update.startState) ||
          update.transactions.some((tr) => tr.effects.some((e) => e.is(fenceRunsArrived)))
        ) {
          this.decorations = this.build();
        }
      }

      private build(): DecorationSet {
        const { state } = this.view;
        const marks: Range<Decoration>[] = [];
        for (const fence of fenceBodies(state, this.view.visibleRanges)) {
          const text = state.doc.sliceString(fence.from, fence.to, '\n');
          const key = `${fence.lang}\u0000${text}`;
          const known = peekTokens(fence.lang, text);
          const runs = known ? (known.runs ??= runsFromTokens(known.lines)) : this.unkept.get(key);
          if (runs) {
            marks.push(...marksFromRuns(runs, fence.from, fence.to));
          } else if (!this.asked.has(key)) {
            this.ask(key, text, fence.lang);
          }
        }
        return Decoration.set(marks, true);
      }

      private ask(key: string, text: string, lang: string): void {
        this.asked.add(key);
        void tokens(text, lang, () => !this.destroyed).then((lines) => {
          this.asked.delete(key);
          if (this.destroyed || !lines) return;
          if (!peekTokens(lang, text)) rememberTokens(lang, text, lines);
          if (!peekTokens(lang, text)) {
            this.unkept.set(key, runsFromTokens(lines));
            if (this.unkept.size > UNKEPT_MAX) this.unkept.delete(this.unkept.keys().next().value!);
          }
          this.view.dispatch({ effects: fenceRunsArrived.of(null) });
        });
      }

      destroy(): void {
        this.destroyed = true;
      }
    },
    { decorations: (v) => v.decorations },
  );
}
