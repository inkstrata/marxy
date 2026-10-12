// The Clean group (J-03): remove, normalise and tidy. Bodies run on LF text (see types.ts).
// Structure comes from the parser: a thematic break is a node (so a setext underline is not one), a heading
// is a node, a code block is a span the prose transforms step around. Where an E operation already does the
// job on a node (promote/demote, list markers), the transform calls that operation.
import type { List, ListItem, Node } from '../contracts/ast.ts';
import { demoteHeading, promoteHeading } from '../operations/heading-level.ts';
import { markerSpans, mergesWithNeighbour } from '../operations/list-markers.ts';
import { applyEdits, atxHeadings, indexOf, gapsOf, mapInline, mapOutsideCodeSpans, mapProse, mapProseWithTail, nodesOf, parseText, walk } from './prose.ts';
import type { TransformDef } from './types.ts';
import { wrap80 } from './wrap.ts';

// An emoji, with its joiners and modifiers. `\p{Extended_Pictographic}` alone would take the copyright sign and
// the trade mark, so a bare pictograph counts only when it is emoji-presentation or carries U+FE0F.
const EMOJI =
  /(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\p{Emoji_Presentation}|\p{Extended_Pictographic}️)(?:\p{Emoji_Modifier}|️|‍(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️?))*/gu;

export const stripEmoji: TransformDef = {
  id: 'strip-emoji',
  kind: 'edit',
  outsideCode: true,
  idempotent: true,
  run(lf) {
    // Nothing to strip means no parse: the parse is the cost of this transform on a large text (W-21.2), and a text
    // with no emoji needs neither the protected spans nor the code spans to come back unchanged.
    if (!new RegExp(EMOJI.source, 'u').test(lf)) return lf;
    return mapInline(lf, (p) => p.replace(EMOJI, ''));
  },
};

export const stripFrontmatter: TransformDef = {
  id: 'strip-frontmatter',
  kind: 'edit',
  idempotent: true,
  run(lf) {
    // Front matter opens on the first line and ends at the first fence that closes it; nothing after that line can change
    // it. So the parse reads the text up to the first later line that could be a closing fence, not the whole document,
    // and reads it all only when that line turns out not to close it.
    if (lf[0] !== '-' && lf[0] !== '+') return lf;
    const fence = /\n(?:---|\+\+\+)[^\n]*(?:\n|$)/g;
    fence.lastIndex = lf.indexOf('\n');
    const close = fence.lastIndex < 0 ? null : fence.exec(lf);
    if (!close) return lf;
    const head = lf.slice(0, close.index + close[0].length);
    const first = nodesOf(head, parseText(head), ['frontmatter'])[0] ?? nodesOf(lf, parseText(lf), ['frontmatter'])[0];
    if (!first || first.span.start !== 0) return lf;
    let end = first.span.end;
    while (lf[end] === '\n') end++;
    return lf.slice(end);
  },
};

export const stripCitations: TransformDef = {
  id: 'strip-citations',
  kind: 'edit',
  outsideCode: true,
  idempotent: true,
  run(lf) {
    // Nothing a citation could be: no `[1]`, `[^note]` or `【…】`, so no parse (the parse is this transform's cost on a
    // large text, W-21.2).
    if (!/\[(?:\d+|\^[^\]\n]+)\]|【/.test(lf)) return lf;
    // `[1]` is a marker unless it is a link's text, a reference's label or a definition; `[^note]` unless it opens a definition.
    // A `[1]` whose label the document defines is a reference link, not a marker.
    const labels = new Set([...lf.matchAll(/^ {0,3}\[(\d+)\]:/gm)].map((m) => m[1]));
    const DEF = /^\[\^[^\]\n]+\]:.*(?:\n[ \t]+\S.*)*\n?/gm;
    const markers = (p: string): string =>
      p
        .replace(/[ \t]?\[(\d+)\](?![(:[])/g, (m, n: string) => (labels.has(n) ? m : ''))
        .replace(/[ \t]?【[^】\n]*】/g, '')
        .replace(/\[\^[^\]\n]+\](?!:)/g, '');
    // With no footnote definition to remove, the text the markers are read from is the text that was parsed, so it is
    // one walk over the cached parse. (A document with no definition used to parse a second time all the same.)
    if (!new RegExp(DEF.source, 'm').test(lf)) return mapInline(lf, markers);
    // Footnote definitions (and their indented continuation lines) go whole, line ending included. Taking one out can
    // change what the parser makes of the lines around it (a fence it was keeping open, say), so the markers used to
    // be read from a second parse of the text without them. When every definition stands alone between blank lines and
    // holds nothing that opens or closes a block, removing it leaves the blocks around it as they were, and the one
    // parse already made serves; otherwise the second parse is still made, so the output is the same either way.
    if (standAlone(lf, DEF)) {
      return mapProse(lf, (prose) => mapOutsideCodeSpans(prose.replace(DEF, ''), markers));
    }
    return mapInline(mapProse(lf, (p) => p.replace(DEF, '')), markers);
  },
};

/** True when removing the definitions `def` matches cannot change how the parser reads the rest of `lf`. */
function standAlone(lf: string, def: RegExp): boolean {
  if (lf[0] === '-' || lf[0] === '+') return false; // front matter that may not close lasts the whole file
  for (const g of gapsOf(lf)) {
    // Definitions one right after another are one run of lines to take out.
    const runs: [number, number][] = [];
    for (const m of lf.slice(g.start, g.end).matchAll(def)) {
      const start = g.start + m.index;
      const end = start + m[0].length;
      const run = runs.at(-1);
      if (run && run[1] === start) run[1] = end;
      else runs.push([start, end]);
    }
    for (const [start, end] of runs) {
      const alone = start === 0 || (lf[start - 1] === '\n' && (start === 1 || lf[start - 2] === '\n'));
      const closed = end >= lf.length || lf[end] === '\n';
      if (!alone || !closed || /[<>`~$|]/.test(lf.slice(start, end))) return false;
      let next = end;
      while (lf[next] === '\n') next++;
      if (lf[next] === ' ' || lf[next] === '\t') return false;
    }
  }
  return true;
}

export const stripBold: TransformDef = {
  id: 'strip-bold',
  kind: 'edit',
  outsideCode: true,
  run: (lf) =>
    mapInline(lf, (p) =>
      p.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1').replace(/(?<!\w)__(?=\S)(.+?)(?<=\S)__(?!\w)/g, '$1'),
    ),
};

export const stripHr: TransformDef = {
  id: 'strip-hr',
  kind: 'edit',
  outsideCode: true,
  idempotent: true,
  run(lf) {
    const edits: { start: number; end: number; text: string }[] = [];
    for (const { span } of nodesOf(lf, parseText(lf), ['thematicBreak'])) {
      const lineStart = lf.lastIndexOf('\n', span.start - 1) + 1;
      // A rule inside a quote or a list item has a marker before it on its line: leave it.
      if (!/^[ \t]*$/.test(lf.slice(lineStart, span.start))) continue;
      const end = lf[span.end] === '\n' ? span.end + 1 : span.end;
      edits.push({ start: lineStart, end, text: '' });
    }
    return applyEdits(lf, edits);
  },
};

export const collapseBlank: TransformDef = {
  id: 'collapse-blank',
  kind: 'edit',
  outsideCode: true,
  idempotent: true,
  run: (lf) =>
    mapProseWithTail(lf, (prose, tail) => {
      const lines = prose.split('\n');
      // A gap that ends at a nested block's line start is followed by that line's container prefix (`tail`), which is
      // what the hard-break test below has always read there.
      const nextOf = (i: number): string => (i === lines.length - 2 && tail !== '' ? tail : lines[i + 1]!);
      const stripped = lines.map((line, i) => {
        const bare = line.replace(/[ \t]+$/, '');
        // Two spaces at the end of a line inside a paragraph are a hard break, not stray space: keep them.
        const hardBreak = bare !== '' && / {2,}$/.test(line) && i < lines.length - 1 && nextOf(i).trim() !== '';
        return hardBreak ? line : bare;
      });
      return stripped.join('\n').replace(/\n{3,}/g, '\n\n');
    }),
};

export const normalizeBullets: TransformDef = {
  id: 'normalize-bullets',
  kind: 'edit',
  outsideCode: true,
  idempotent: true,
  run(lf) {
    const doc = parseText(lf);
    const index = indexOf(lf);
    const parents = new Map<Node, Node>();
    walk(doc, (n) => {
      for (const child of n.children ?? []) parents.set(child as Node, n);
    });
    const edits: { start: number; end: number; text: string }[] = [];
    for (const { node, span } of nodesOf<List>(lf, doc, ['list'])) {
      if (node.ordered) continue;
      // A list that would join the unordered list beside it once its marker matches is left as written.
      if (mergesWithNeighbour(doc, node, false, parents.get(node))) continue;
      // The list's own text, so reading its markers costs its length, not the document's.
      const spans = markerSpans(node, lf.slice(span.start, span.end), node.src.start);
      if (!spans || spans.length !== node.children.length) continue;
      for (const { marker } of spans as { item: ListItem; marker: { start: number; end: number } }[]) {
        const at = index.toIndex(marker.start);
        if (lf[at] === '*' || lf[at] === '+') edits.push({ start: at, end: at + 1, text: '-' });
      }
    }
    return applyEdits(lf, edits);
  },
};

export const normalizeHeadings: TransformDef = {
  id: 'normalize-headings',
  kind: 'edit',
  outsideCode: true,
  idempotent: true,
  run(lf) {
    const heads = atxHeadings(lf);
    if (heads.length === 0) return lf;
    const min = Math.min(...heads.map((h) => h.heading.level));
    let last = 0;
    const edits: { start: number; end: number; text: string }[] = [];
    for (const { heading, span } of heads) {
      const level = Math.min(heading.level - min + 1, last + 1);
      last = level;
      if (level !== heading.level) edits.push({ start: span.start, end: span.start + heading.level, text: '#'.repeat(level) });
    }
    return applyEdits(lf, edits);
  },
};

/** Run E's promote/demote operation on each ATX heading alone (its own range), so a heading at the limit stays as it is. */
function shiftHeadings(lf: string, op: typeof promoteHeading): string {
  const doc = parseText(lf);
  const index = indexOf(lf);
  const edits: { start: number; end: number; text: string }[] = [];
  for (const { heading, span } of atxHeadings(lf, doc)) {
    const range = heading.src;
    const input = { document: doc, node: heading, range };
    if (!op.canApply(input)) continue;
    const text = lf.slice(index.toIndex(range.start), index.toIndex(range.end));
    const { replacement } = op.run({ ...input, text });
    if (replacement !== text) edits.push({ start: span.start, end: span.end, text: replacement });
  }
  return applyEdits(lf, edits);
}

export const demote: TransformDef = { id: 'demote', kind: 'edit', outsideCode: true, run: (lf) => shiftHeadings(lf, demoteHeading) };
export const promote: TransformDef = { id: 'promote', kind: 'edit', outsideCode: true, run: (lf) => shiftHeadings(lf, promoteHeading) };

export const unwrap: TransformDef = {
  id: 'unwrap',
  kind: 'edit',
  outsideCode: true,
  idempotent: true,
  run(lf) {
    // Only paragraphs that sit directly in the document: a list item, a quote or a table keeps its line breaks.
    const doc = parseText(lf);
    const top = new Set<unknown>(doc.children);
    const edits: { start: number; end: number; text: string }[] = [];
    for (const { node, span } of nodesOf(lf, doc, ['paragraph'])) {
      if (!top.has(node)) continue;
      const text = lf.slice(span.start, span.end);
      const body = text.replace(/\n+$/, '');
      const lines = body.split('\n');
      if (lines.length < 2) continue;
      let flat = lines[0]!;
      for (let i = 1; i < lines.length; i++) {
        // A hard break (two spaces or a backslash at the end of the line) stays a line break.
        const hard = / {2,}$/.test(lines[i - 1]!) || /\\$/.test(lines[i - 1]!);
        flat = hard ? `${flat}\n${lines[i]}` : `${flat.replace(/[ \t]+$/, '')} ${lines[i]!.replace(/^[ \t]+/, '')}`;
      }
      if (flat !== body) edits.push({ start: span.start, end: span.start + body.length, text: flat });
    }
    return applyEdits(lf, edits);
  },
};

export const smartPunct: TransformDef = {
  id: 'smart-punct',
  kind: 'edit',
  outsideCode: true,
  run: (lf) =>
    mapInline(lf, (t) =>
      t
        .replace(/(^|[\s([{"])'(?=\d0s)/g, '$1’')
        .replace(/(^|[\s([{])"/g, '$1“')
        .replace(/"/g, '”')
        .replace(/(^|[\s([{“])'/g, '$1‘')
        .replace(/'/g, '’')
        .replace(/(?<![\d-])(\d+) ?- ?(\d+)(?![\d-])/g, '$1–$2')
        .replace(/ -- | --(?=\w)/g, '—')
        .replace(/\.\.\./g, '…'),
    ),
};

export const straightPunct: TransformDef = {
  id: 'straight-punct',
  kind: 'edit',
  outsideCode: true,
  idempotent: true,
  run: (lf) =>
    mapInline(lf, (t) => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/—/g, '--').replace(/–/g, '-').replace(/…/g, '...')),
};

export const CLEAN: readonly TransformDef[] = [
  stripEmoji, stripFrontmatter, stripCitations, stripBold, stripHr, collapseBlank, normalizeBullets,
  normalizeHeadings, demote, promote, unwrap, smartPunct, straightPunct, wrap80,
];
