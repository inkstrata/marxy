// The engine-neutral half of the rag study (MARXY-19): corpus paragraph extraction, the shared
// ragged-right item stream, the greedy baseline, and the rag metric definitions. No engine imported
// here, so both candidate breakers are scored by identical arithmetic over identical input.

/** TeX's integer badness, 100·(t/s)³ (TeX: The Program §108), capped at INF_BAD. */
export const INF_BAD = 10000;
export function badness(t, s) {
  if (t <= 0) return 0;
  if (s <= 0) return INF_BAD;
  const r = Math.floor((297 * t) / s);
  if (r > 1290) return INF_BAD;
  return Math.min(INF_BAD, Math.floor((r * r * r + 0x20000) / 0x40000));
}

/**
 * Markdown → the paragraphs a typesetter would set: block text with markup removed, in document
 * order. Deliberately crude but deterministic; code blocks, tables, headings and HTML blocks are
 * dropped because none of them go through the paragraph breaker (design-language.md).
 */
export function extractParagraphs(source) {
  const lines = source.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').split('\n');
  const paragraphs = [];
  let current = [];
  let fence = null;
  const flush = () => {
    if (current.length) paragraphs.push(stripInline(current.join(' ')));
    current = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/^\s*>\s?/, '');
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && line.trimStart().startsWith(fence)) fence = null;
      continue;
    }
    if (fenceMatch) {
      flush();
      fence = fenceMatch[1][0].repeat(3);
      continue;
    }
    if (
      line.trim() === '' ||
      /^\s{0,3}#{1,6}\s/.test(line) ||
      /^\s{0,3}(\|)/.test(line) ||
      /^\s{0,3}([-*_]\s*){3,}$/.test(line) ||
      /^\s{0,3}<[a-zA-Z/!]/.test(line) ||
      /^\s{0,3}\$\$/.test(line) ||
      /^\s{0,3}\[[^\]]+\]:\s/.test(line) ||
      /^\s{0,3}:{3,}/.test(line) ||
      /^ {4,}\S/.test(raw)
    ) {
      flush();
      continue;
    }
    const listItem = /^\s{0,8}([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line);
    if (listItem) {
      flush();
      current.push(listItem[2]);
      continue;
    }
    current.push(line.trim());
  }
  flush();
  return paragraphs.filter((p) => p.length > 0);
}

/** Inline markup removal. The text a reader sees is what gets measured. */
function stripInline(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\((?:[^)]*)\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>\s][^>]*>/g, '')
    .replace(/`+/g, '')
    .replace(/\*\*|__|\*|_|~~/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The shared ragged-right item stream. Ragged-right in the Knuth–Plass formalism means word glue
 * that never shrinks, carrying the stretch that prices the line's shortfall when it ends a line —
 * TeX's `\rightskip` approximated per glue, which is exactly what tex-linebreak2 spells
 * `lineFinalSpacesInNonJustified`. Neither engine exposes a true per-line rightskip, so the shared
 * approximation is the only way to give both the identical stream and isolate the breaker.
 * Widths are in em, so the study is independent of the reader's font size.
 */
export function buildRaggedItems(text, font, opts) {
  const space = font.advanceOf(0x20);
  const stretch = opts.glueStretchEm;
  const items = [];
  const words = text.split(' ').filter((w) => w !== '');
  words.forEach((word, i) => {
    if (i > 0) items.push({ kind: 'glue', width: space, stretch, shrink: 0 });
    // An explicit hyphen or dash inside a word is a real break opportunity in every renderer.
    const pieces = word.split(/(?<=[-–—])/);
    pieces.forEach((piece, j) => {
      if (j > 0) items.push({ kind: 'penalty', width: 0, penalty: opts.exHyphenPenalty, flagged: true });
      items.push({ kind: 'box', width: font.widthOf(piece), text: piece });
    });
  });
  items.push({ kind: 'glue', width: 0, stretch: 0, shrink: 0, fil: true });
  items.push({ kind: 'penalty', width: 0, penalty: -INF_BAD, flagged: false, forced: true });
  return items;
}

/** First-fit greedy breaking: what an engine's own line breaker does, and the bar K–P must clear. */
export function greedyBreakpoints(items, measure) {
  const breakpoints = [0];
  for (;;) {
    const start = breakpoints.length === 1 ? 0 : breakpoints.at(-1) + 1;
    let width = 0;
    let seenBox = false;
    let lastLegal = -1;
    let overflowed = false;
    for (let i = start; i < items.length; i++) {
      const item = items[i];
      // The paragraph's forced end is a breakpoint like any other: a tail that overflows the measure
      // must fall back to the last legal break, or the last line silently runs past the margin.
      const breakable =
        (item.kind === 'glue' && !item.fil && seenBox) ||
        (item.kind === 'penalty' && (item.forced || item.penalty < INF_BAD));
      if (breakable) {
        const atBreak = width + (item.kind === 'penalty' ? item.width : 0);
        if (atBreak > measure && lastLegal !== -1) {
          overflowed = true;
          break;
        }
        if (item.forced) {
          breakpoints.push(i);
          return breakpoints;
        }
        lastLegal = i;
      }
      if (item.kind === 'box') {
        width += item.width;
        seenBox = true;
      } else if (item.kind === 'glue' && seenBox && !item.fil) width += item.width;
    }
    breakpoints.push(overflowed ? lastLegal : items.length - 1);
    if (!overflowed) return breakpoints;
  }
}

/**
 * Natural set widths of the lines a breakpoint list produces. Ragged rendering sets every line at
 * natural width, so the line's width IS its content width: glue at a break and glue at the start of
 * a line are discarded exactly as TeX discards them.
 */
export function lineWidths(items, breakpoints) {
  const widths = [];
  for (let l = 1; l < breakpoints.length; l++) {
    const from = breakpoints[l - 1];
    const to = breakpoints[l];
    let width = 0;
    let seenBox = false;
    for (let i = l === 1 ? 0 : from + 1; i < to; i++) {
      const item = items[i];
      if (item.kind === 'box') {
        width += item.width;
        seenBox = true;
      } else if (item.kind === 'glue' && seenBox && !item.fil) width += item.width;
    }
    if (items[to]?.kind === 'penalty') width += items[to].width; // a materialised hyphen
    widths.push(width);
  }
  return widths;
}

/**
 * Ids of the paragraphs EVERY arrangement set inside the measure. Dropping a paragraph because the
 * engine being scored overflowed it removes that engine's own failures from its own score, which
 * reverses the sign of a close comparison; the only pool two engines can be ranked over is the
 * intersection. `pools` maps a label to `{ id, widths }` entries covering the same paragraphs.
 */
export function commonParagraphs(pools, measure) {
  const labels = Object.keys(pools);
  const fits = (widths) => widths.every((w) => w <= measure + 1e-9);
  return pools[labels[0]].map((p) => p.id).filter((id) => labels.every((label) => fits(pools[label].find((p) => p.id === id).widths)));
}

/**
 * The width arrays for `ids`, in `ids` order, refusing to return a pool that is not exactly the set
 * asked for. Every pooled comparison row goes through this, so a per-engine set can never again be
 * passed off as a comparable one: the mismatch throws on the run that produces the table.
 */
export function selectPool(pool, ids) {
  const byId = new Map(pool.map((p) => [p.id, p.widths]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`pool is missing ${missing.length} of the ${ids.length} paragraphs asked for: ${missing.slice(0, 3).join(', ')}`);
  return ids.map((id) => byId.get(id));
}

/**
 * The guard on the defect that returned this PR: two rows presented as a comparison but pooled over
 * each row's own successes. Every pooled comparison calls this with the paragraph ids it actually
 * scored per label, and it throws unless they are one set. Membership alone cannot catch the defect —
 * each engine's successes are all present in the other's pool — so the ids themselves are compared.
 */
export function assertOneParagraphSet(idsByLabel) {
  const labels = Object.keys(idsByLabel);
  const reference = String(idsByLabel[labels[0]]);
  for (const label of labels.slice(1)) {
    if (String(idsByLabel[label]) !== reference) {
      const extra = idsByLabel[label].filter((id) => !idsByLabel[labels[0]].includes(id));
      throw new Error(`refusing to rank over different paragraph sets: ${label} scored ${idsByLabel[label].length} paragraphs and ${labels[0]} scored ${idsByLabel[labels[0]].length}${extra.length ? ` (${label} alone has ${extra.slice(0, 3).join(', ')})` : ''}`);
    }
  }
  return idsByLabel[labels[0]];
}

/**
 * The rag metrics. All three are computed over the paragraph's non-final lines: a paragraph's last
 * line is short by construction and says nothing about the rag.
 *
 * - cv: coefficient of variation of line lengths — the headline "how even is the rag" number.
 * - shortLines: lines whose shortfall exceeds `shortLineFraction` of the measure (a visible hole).
 * - worstBadness: the worst line's TeX badness against `badnessStretchEm`, which is the metric's own
 *   reference rag tolerance and is deliberately independent of what the breakers were fed, so rows
 *   stay comparable across the sweep.
 *
 * Shortfalls are reported alongside them because badness saturates at INF_BAD and a saturated
 * column cannot rank anything.
 */
export function ragMetrics(perParagraphWidths, measure, opts) {
  const widths = [];
  let overfull = 0;
  let lastLines = 0;
  for (const paragraph of perParagraphWidths) {
    if (paragraph.length < 2) {
      lastLines += paragraph.length;
      continue;
    }
    lastLines++;
    for (const w of paragraph.slice(0, -1)) {
      widths.push(w);
      if (w > measure + 1e-9) overfull++;
    }
  }
  const empty = { lines: 0, lastLines, overfull, cv: null, shortLines: null, shortLineRate: null, worstBadness: null, meanShortfall: null, p95Shortfall: null };
  if (widths.length === 0) return empty;
  const mean = widths.reduce((a, b) => a + b, 0) / widths.length;
  const variance = widths.reduce((a, b) => a + (b - mean) ** 2, 0) / widths.length;
  const shortfalls = widths.map((w) => Math.max(0, measure - w)).sort((a, b) => a - b);
  let shortLines = 0;
  let worstBadness = 0;
  for (const shortfall of shortfalls) {
    if (shortfall > opts.shortLineFraction * measure) shortLines++;
    worstBadness = Math.max(worstBadness, badness(shortfall, opts.badnessStretchEm));
  }
  return {
    lines: widths.length,
    lastLines,
    overfull,
    cv: Math.sqrt(variance) / mean,
    shortLines,
    shortLineRate: (shortLines / widths.length) * 100,
    worstBadness,
    meanShortfall: shortfalls.reduce((a, b) => a + b, 0) / shortfalls.length,
    p95Shortfall: shortfalls[Math.min(shortfalls.length - 1, Math.ceil(0.95 * shortfalls.length) - 1)],
  };
}
