// `checkDerivedInvariants` (ADR-0061 item 4): what every transcript tree satisfies, checked against the bytes it was
// derived from with the standard decoders, not the deriver's own: item 5's decoding is `JSON.parse` over `TextDecoder`'s
// UTF-8 (U+FFFD for each invalid sequence), and item 6's inner documents are parsed by the ordinary parser and held to
// `checkInvariants`. Run by the deriver's tests, their differential over generated sessions, and `pnpm gate:golden`.
import type { Source } from '../contracts/ast.ts';
import { DERIVED_INVARIANTS, type DerivedText, type DerivedTranscript, type TranscriptNode } from '../contracts/derived.ts';
import { checkInvariants } from '../parse/invariants.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { hasLoneSurrogate } from './jsonl-transcript.ts';

export interface DerivedViolation {
  /** One of `DERIVED_INVARIANTS`. */
  readonly invariant: (typeof DERIVED_INVARIANTS)[number];
  readonly detail: string;
}

const decoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: false });
const encoder = new TextEncoder();

/** The file name an inner document of `leaf` is parsed under: never the file's own path (ADR-0061 item 4.6). */
export const innerFileOf = (path: string, leaf: Pick<DerivedText, 'src'>): string => `${path}#derived@${leaf.src.start}`;

/** The inner document of a `markdown` leaf: the ordinary parser over the UTF-8 bytes of its value. */
export function innerDocument(path: string, leaf: DerivedText): ReturnType<typeof parseMarkdown> {
  return parseMarkdown(encoder.encode(leaf.value), { file: innerFileOf(path, leaf) });
}

const childrenOf = (node: TranscriptNode): readonly TranscriptNode[] =>
  'children' in node && Array.isArray(node.children) ? (node.children as readonly TranscriptNode[]) : [];

const inside = (inner: Source, outer: readonly Source[]): boolean => outer.some((o) => o.start <= inner.start && inner.end <= o.end);

/**
 * Every violation of `DERIVED_INVARIANTS` in `tree` over `bytes`; empty when it holds. `opts.markdown` false skips item 6's
 * parse (the differential runs it on a sample; the gate and the fixture tests run it on every leaf).
 */
export function checkDerivedInvariants(tree: DerivedTranscript, bytes: Uint8Array, opts: { readonly markdown?: boolean } = {}): DerivedViolation[] {
  const out: DerivedViolation[] = [];
  const [i1, i2, i3, i4, i5, i6, i7] = DERIVED_INVARIANTS;
  const where = (node: TranscriptNode): string => `${node.type} [${node.src.start},${node.src.end})`;
  const path = tree.src.file;

  if (tree.src.start !== 0 || tree.src.end !== bytes.length) out.push({ invariant: i1, detail: `transcript.src is [${tree.src.start},${tree.src.end}), the file is ${bytes.length} bytes` });

  const leaves: { node: TranscriptNode; from: readonly Source[] }[] = [];
  const walk = (node: TranscriptNode, parent: TranscriptNode | null): void => {
    if (node.src.start > node.src.end) out.push({ invariant: i1, detail: `${where(node)} starts after it ends` });
    if (node.src.file !== path) out.push({ invariant: i1, detail: `${where(node)} names ${node.src.file}, not the file` });
    // 4.2: non-empty, ordered, non-overlapping, and src their hull. The root of an empty file has no line.
    const empty = node.type === 'transcript' && bytes.length === 0;
    if (node.from.length === 0 && !empty) out.push({ invariant: i2, detail: `${where(node)} has no from range` });
    for (let k = 0; k < node.from.length; k++) {
      const r = node.from[k]!;
      if (r.end <= r.start) out.push({ invariant: i2, detail: `${where(node)} from[${k}] is empty` });
      if (r.end > bytes.length || r.start < 0) out.push({ invariant: i2, detail: `${where(node)} from[${k}] is outside the file` });
      const prev = node.from[k - 1];
      if (prev && prev.end > r.start) out.push({ invariant: i2, detail: `${where(node)} from[${k}] overlaps or precedes from[${k - 1}]` });
    }
    if (node.from.length > 0) {
      const lo = node.from[0]!.start;
      const hi = node.from[node.from.length - 1]!.end;
      if (node.src.start !== lo || node.src.end !== hi) out.push({ invariant: i2, detail: `${where(node)} is not the hull [${lo},${hi}) of its from ranges` });
    }
    // 4.3
    if (parent) for (const r of node.from) if (!inside(r, parent.from)) out.push({ invariant: i3, detail: `${where(node)} from [${r.start},${r.end}) is not inside its parent ${where(parent)}` });
    const kids = childrenOf(node);
    if (kids.length === 0 && node.type !== 'transcript') leaves.push({ node, from: node.from });
    if (node.type === 'derivedText') checkLeaf(node);
    for (const kid of kids) walk(kid, node);
  };

  const checkLeaf = (leaf: DerivedText): void => {
    // 4.5: JSON.parse over the standard decoding of exactly its bytes.
    const raw = decoder.decode(bytes.subarray(leaf.src.start, leaf.src.end));
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      out.push({ invariant: i5, detail: `${where(leaf)} is not a JSON string: ${String(e)}` });
      return;
    }
    if (parsed !== leaf.value) out.push({ invariant: i5, detail: `${where(leaf)} decodes to ${JSON.stringify(parsed).slice(0, 80)}, not its value ${JSON.stringify(leaf.value).slice(0, 80)}` });
    if (leaf.decoding !== 'json-string') out.push({ invariant: i5, detail: `${where(leaf)} declares ${leaf.decoding}` });
    for (const at of leaf.replaced) if (leaf.value.charCodeAt(at) !== 0xfffd) out.push({ invariant: i5, detail: `${where(leaf)} marks ${at} as a replacement, which is not U+FFFD` });
    // 4.6
    if (leaf.syntax === 'markdown') {
      if (leaf.replaced.length > 0 || hasLoneSurrogate(leaf.value)) {
        out.push({ invariant: i6, detail: `${where(leaf)} is markdown but is not well-formed text` });
        return;
      }
      if (opts.markdown === false) return;
      const valueBytes = encoder.encode(leaf.value);
      const inner = parseMarkdown(valueBytes, { file: innerFileOf(path, leaf) });
      if (inner.src.file === path) out.push({ invariant: i6, detail: `${where(leaf)}'s inner document names the file itself` });
      for (const v of checkInvariants(inner, valueBytes).slice(0, 3)) out.push({ invariant: i6, detail: `${where(leaf)}: ${v.invariant}: ${v.detail}` });
    }
  };

  walk(tree, null);

  // 4.4: the leaves' from ranges are pairwise disjoint.
  const ranges = leaves.flatMap((l) => l.from.map((r) => ({ r, node: l.node }))).sort((a, b) => a.r.start - b.r.start || a.r.end - b.r.end);
  for (let k = 1; k < ranges.length; k++) {
    if (ranges[k - 1]!.r.end > ranges[k]!.r.start) out.push({ invariant: i4, detail: `${where(ranges[k - 1]!.node)} and ${where(ranges[k]!.node)} share bytes` });
  }

  // The root's from is every line, in order, tiling the file.
  let expect = 0;
  for (const r of tree.from) {
    if (r.start !== expect) out.push({ invariant: i7, detail: `line [${r.start},${r.end}) does not start where the line before ended (${expect})` });
    const nl = bytes.indexOf(0x0a, r.start);
    const end = nl < 0 ? bytes.length : nl + 1;
    if (r.end !== end) out.push({ invariant: i7, detail: `line [${r.start},${r.end}) is not one line (it ends at ${end})` });
    expect = r.end;
  }
  if (expect !== bytes.length) out.push({ invariant: i7, detail: `the lines end at ${expect}, the file at ${bytes.length}` });

  // 4.7: each line exactly one of: a leaf's source, once in dropped, the one pending last line.
  const lineIndex = (at: number): number => {
    let lo = 0;
    let hi = tree.from.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tree.from[mid]!.start <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const sourced = new Uint8Array(tree.from.length);
  const dropped = new Uint8Array(tree.from.length);
  let pendingLine = -1;
  for (const { node, from } of leaves) {
    if (node.type === 'pending') {
      if (pendingLine >= 0) out.push({ invariant: i7, detail: 'two pending lines' });
      pendingLine = lineIndex(node.src.start);
      if (pendingLine !== tree.from.length - 1) out.push({ invariant: i7, detail: `the pending line ${pendingLine + 1} is not the last` });
      continue;
    }
    for (const r of from) sourced[lineIndex(r.start)] = 1;
  }
  for (const d of tree.dropped) {
    const k = lineIndex(d.src.start);
    const lineSrc = tree.from[k];
    if (!lineSrc || lineSrc.start !== d.src.start || lineSrc.end !== d.src.end) out.push({ invariant: i7, detail: `dropped [${d.src.start},${d.src.end}) is not a line` });
    if (d.line !== k + 1) out.push({ invariant: i7, detail: `dropped [${d.src.start},${d.src.end}) says line ${d.line}, it is line ${k + 1}` });
    if (d.record === '') out.push({ invariant: i7, detail: `dropped line ${k + 1} has no record type` });
    dropped[k] = (dropped[k] ?? 0) + 1;
  }
  for (let k = 0; k < tree.from.length; k++) {
    const kinds = (sourced[k] ? 1 : 0) + (dropped[k] ? 1 : 0) + (k === pendingLine ? 1 : 0);
    if (kinds !== 1 || (dropped[k] ?? 0) > 1) {
      const what = [sourced[k] ? 'a leaf source' : '', dropped[k] ? `dropped ${dropped[k]} times` : '', k === pendingLine ? 'pending' : ''].filter(Boolean);
      out.push({ invariant: i7, detail: what.length === 0 ? `line ${k + 1} is neither shown, dropped nor pending` : `line ${k + 1} is ${what.join(' and ')}` });
    }
  }
  return out;
}
