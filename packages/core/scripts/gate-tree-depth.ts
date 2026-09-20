// Compares the sanitiser's written tree to the live DOM in a browser (MARXY-84). The gate asks
// whether any node gained an ancestor other than an implied table section; the mutation hook proves
// the check fails when a formatting element closes late.

import { TREE_DEPTH_CASES, type TreeDepthCase } from './tree-depth-cases.ts';

/** The only ancestors a live tree may gain over the written one (review measurement, MARXY-12). */
export const IMPLIED_TABLE_SECTION = new Set(['table', 'tbody', 'thead', 'tfoot', 'tr']);

export interface ElementSnapshot {
  readonly tag: string;
  readonly ancestors: readonly string[];
}

export const WRITER_CLOSE_LATE_MUTATION = 'writer-close-late';

/** Simulates closing a formatting element one block too late — the shape that swallows a document. */
export function applyWriterMutation(html: string, mutation: string | undefined): string {
  if (mutation !== WRITER_CLOSE_LATE_MUTATION) return html;
  // Drop the first </a> that precedes a block, so the anchor stays open through the paragraph.
  return html.replace(/<\/a>(?=<p\b)/, '');
}

/** Reads element snapshots in document order, for comparing written markup to a live DOM walk. */
export function snapshotsFromHtml(html: string): ElementSnapshot[] {
  const voidElements = new Set(['br', 'hr', 'img', 'input', 'wbr', 'col']);
  const open: string[] = [];
  const out: ElementSnapshot[] = [];
  for (const match of html.matchAll(/<(\/?)([A-Za-z][^\s/>]*)[^>]*>/g)) {
    const name = match[2]!.toLowerCase();
    const raw = match[0]!;
    if (match[1] === '/') {
      if (open.at(-1) === name) open.pop();
      continue;
    }
    out.push({ tag: name, ancestors: [...open] });
    const selfClosing = /\/\s*>$/.test(raw);
    if (!voidElements.has(name) && !selfClosing) open.push(name);
  }
  return out;
}

/**
 * Walks two document-order lists together, skipping implied table-section nodes the live parser
 * inserts, then returns violations when a paired element is deeper in the live tree than written.
 */
export function depthViolations(written: readonly ElementSnapshot[], live: readonly ElementSnapshot[]): string[] {
  const violations: string[] = [];
  let w = 0;
  let l = 0;
  while (w < written.length && l < live.length) {
    const we = written[w]!;
    const le = live[l]!;
    if (we.tag === le.tag) {
      const extra = le.ancestors.filter((ancestor) => !we.ancestors.includes(ancestor));
      const forbidden = extra.filter((ancestor) => !IMPLIED_TABLE_SECTION.has(ancestor));
      if (forbidden.length > 0) {
        violations.push(
          `<${le.tag}> #${l} gained ${forbidden.map((name) => `<${name}>`).join(', ')} in the live tree`,
        );
      }
      w += 1;
      l += 1;
      continue;
    }
    if (IMPLIED_TABLE_SECTION.has(le.tag)) {
      l += 1;
      continue;
    }
    if (IMPLIED_TABLE_SECTION.has(we.tag)) {
      w += 1;
      continue;
    }
    violations.push(`element ${l}: written <${we.tag}> but live <${le.tag}>`);
    w += 1;
    l += 1;
  }
  while (l < live.length && IMPLIED_TABLE_SECTION.has(live[l]!.tag)) l += 1;
  while (w < written.length && IMPLIED_TABLE_SECTION.has(written[w]!.tag)) w += 1;
  return violations;
}

export function casesToRun(): readonly TreeDepthCase[] {
  return TREE_DEPTH_CASES;
}
