// Byte provenance over the fixture corpus: the invariants, the UTF-16 → byte conversion, the
// constructs the contract names, and the parse budget for the long technical document.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { mathFromMarkdown } from 'mdast-util-math';
import { gfm } from 'micromark-extension-gfm';
import type { Block, Inline, Node } from '../contracts/ast.ts';
import { byteOffsetTableBuilds, byteOffsets } from './byte-offsets.ts';
import { ParseProvenanceError, documentFromMdast } from './from-mdast.ts';
import { checkInvariants } from './invariants.ts';
import { splitLines } from './line-endings.ts';
import { parseMarkdown } from './parse.ts';

const corpusDir = new URL('../../../../fixtures/corpus/', import.meta.url);
const markdownFixtures = readdirSync(corpusDir).filter((name) => name.endsWith('.md')).sort();
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(name, corpusDir)));

const nodes = (root: Node): Node[] => {
  const out: Node[] = [root];
  for (const child of root.children ?? []) out.push(...nodes(child));
  return out;
};

test('the corpus has the markdown fixtures the gates depend on', () => {
  assert.ok(markdownFixtures.length >= 12, `only ${markdownFixtures.length} markdown fixtures`);
  for (const required of ['01-long-technical.md', '07-cjk.md', '08-rtl.md', '12-crlf-and-bom.md', '13-no-trailing-newline.md']) {
    assert.ok(markdownFixtures.includes(required), `missing ${required}`);
  }
});

for (const name of markdownFixtures) {
  test(`every AST_INVARIANTS entry holds for ${name}`, () => {
    const bytes = read(name);
    const document = parseMarkdown(bytes, { file: name });
    assert.deepEqual(checkInvariants(document, bytes), []);
  });

  test(`every node of ${name} carries byte provenance into the file`, () => {
    const bytes = read(name);
    const document = parseMarkdown(bytes, { file: name });
    for (const node of nodes(document)) {
      assert.equal(node.src.file, name, `${node.type} names ${node.src.file}`);
      assert.ok(Number.isInteger(node.src.start) && node.src.start >= 0, `${node.type} start ${node.src.start}`);
      assert.ok(node.src.end <= bytes.byteLength, `${node.type} ends at ${node.src.end}, past ${bytes.byteLength}`);
    }
  });
}

test('offsets are byte offsets, not code-unit offsets (07-cjk.md)', () => {
  const bytes = read('07-cjk.md');
  const text = new TextDecoder().decode(bytes);
  const document = parseMarkdown(bytes, { file: '07-cjk.md' });
  const heading = document.children.find((block) => block.type === 'heading');
  assert.ok(heading, 'no heading in the CJK fixture');
  // The first heading's text is multi-byte, so a code-unit offset would land mid-character.
  const slice = new TextDecoder().decode(bytes.subarray(heading.src.start, heading.src.end));
  assert.equal(slice, splitLines(text)[0]);
  assert.ok(Buffer.byteLength(slice, 'utf8') > slice.length, 'the fixture is no longer multi-byte');
});

test('a byte-order mark is counted but not parsed (12-crlf-and-bom.md)', () => {
  const bytes = read('12-crlf-and-bom.md');
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'the fixture lost its BOM');
  const document = parseMarkdown(bytes, { file: '12-crlf-and-bom.md' });
  assert.deepEqual({ start: document.src.start, end: document.src.end }, { start: 0, end: bytes.byteLength });
  const first = document.children[0];
  assert.equal(first?.type, 'heading', 'the BOM stopped the first line from being a heading');
  assert.equal(first?.src.start, 3, 'the first block starts after the BOM bytes');
});

test('a file with no trailing newline keeps its last byte (13-no-trailing-newline.md)', () => {
  const bytes = read('13-no-trailing-newline.md');
  const document = parseMarkdown(bytes, { file: '13-no-trailing-newline.md' });
  const last = document.children.at(-1);
  assert.equal(document.src.end, bytes.byteLength);
  assert.equal(last?.src.end, bytes.byteLength);
});

test('the surrogate pair and the emoji in 08-rtl.md and elsewhere convert whole', () => {
  const text = 'a😀b *c*\n';
  const bytes = new TextEncoder().encode(text);
  const document = parseMarkdown(bytes, { file: 'emoji.md' });
  for (const node of nodes(document)) {
    const slice = new TextDecoder('utf-8', { fatal: true });
    assert.doesNotThrow(() => slice.decode(bytes.subarray(node.src.start, node.src.end)), `${node.type} splits a character`);
  }
});

test('the UTF-16 → byte table is built once per document', () => {
  const bytes = read('07-cjk.md');
  const before = byteOffsetTableBuilds();
  parseMarkdown(bytes, { file: '07-cjk.md' });
  assert.equal(byteOffsetTableBuilds() - before, 1);
});

test('byteOffsets converts every code unit of a mixed-width string', () => {
  const text = 'a£€😀b';
  const table = byteOffsets(text);
  for (const index of [0, 1, 2, 3, 5, 6]) {
    assert.equal(table.at(index), Buffer.byteLength(text.slice(0, index), 'utf8'), `at ${index}`);
  }
  // Index 4 is inside the emoji's surrogate pair, where micromark's offsets never land: the pair is
  // one character of four bytes, and the second half of it reports that character's end.
  assert.equal(table.at(4), Buffer.byteLength('a£€😀', 'utf8'));
  assert.equal(table.byteLength, Buffer.byteLength(text, 'utf8'));
});

test('byteOffsets adds the base a stripped byte-order mark paid for', () => {
  const table = byteOffsets('ab', 3);
  assert.deepEqual([table.at(0), table.at(1), table.at(2), table.byteLength], [3, 4, 5, 5]);
});

test('GFM, frontmatter and math produce the contract nodes (09-gfm-everything.md, 06-math.md)', () => {
  const gfmBytes = read('09-gfm-everything.md');
  const gfm = nodes(parseMarkdown(gfmBytes, { file: '09-gfm-everything.md' }));
  const types = new Set<string>(gfm.map((node) => node.type));
  for (const required of [
    'frontmatter', 'heading', 'paragraph', 'blockquote', 'list', 'listItem', 'codeBlock', 'htmlBlock',
    'thematicBreak', 'table', 'tableRow', 'tableCell', 'footnoteDefinition', 'text', 'emphasis',
    'strong', 'strikethrough', 'code', 'link', 'image', 'html', 'softBreak', 'hardBreak',
    'footnoteReference', 'taskMarker',
  ]) {
    assert.ok(types.has(required), `no ${required} node in the GFM fixture`);
  }
  const mathBytes = read('06-math.md');
  const math = new Set(nodes(parseMarkdown(mathBytes, { file: '06-math.md' })).map((node) => node.type));
  assert.ok(math.has('mathBlock') && math.has('mathInline'), 'math did not parse');
});

test('a task marker is the exact bytes a toggle would splice', () => {
  const text = '- [x] done\n- [ ] not\n';
  const bytes = new TextEncoder().encode(text);
  const document = parseMarkdown(bytes, { file: 'tasks.md' });
  const markers = nodes(document).filter((node): node is Extract<Inline, { type: 'taskMarker' }> => node.type === 'taskMarker');
  assert.equal(markers.length, 2);
  assert.deepEqual(markers.map((marker) => text.slice(marker.src.start, marker.src.end)), ['[x]', '[ ]']);
  assert.deepEqual(markers.map((marker) => marker.checked), [true, false]);
});

test('a reference link carries the definition url and the reference bytes', () => {
  const text = 'see [it][ref] and [gone][missing]\n\n[ref]: /url "t"\n';
  const document = parseMarkdown(text, { file: 'refs.md' });
  const links = nodes(document).filter((node) => node.type === 'link');
  assert.equal(links.length, 1);
  assert.equal(links[0]?.type === 'link' ? links[0].url : undefined, '/url');
  assert.equal(text.slice(links[0]!.src.start, links[0]!.src.end), '[it][ref]');
  const texts = nodes(document).filter((node) => node.type === 'text').map((node) => node.type === 'text' ? node.value : '');
  assert.ok(texts.some((value) => value.includes('[gone][missing]')), 'an unresolved reference lost its source text');
});

/**
 * GFM's autolink-literal mdast transform used to rebuild a paragraph's inline children without
 * positions whenever a candidate held a backslash escape, and provenance collapsed to the top of the
 * file. These two inputs are the ones that did it; `parse.ts` removes the transform that caused it.
 */
for (const input of ['x <a\\.b@c.example> y\n', '- [x] a\\+b@c.example\n']) {
  test(`no node collapses to the top of the file: ${JSON.stringify(input)}`, () => {
    const bytes = new TextEncoder().encode(input);
    const document = parseMarkdown(bytes, { file: 'autolink.md' });
    const all = nodes(document);
    // The document itself starts at 0; nothing inside it may claim a range it does not occupy.
    for (const node of all.slice(1)) {
      assert.ok(node.src.end > 0, `${node.type} has the empty range [0,0)`);
      assert.ok(node.src.start > 0 || input.startsWith(sourceOf(node, input)), `${node.type} claims bytes it does not occupy`);
    }
    assert.deepEqual(checkInvariants(document, bytes), []);
    // The escaped candidate stays literal text, and its bytes are exactly where it was written.
    const texts = all.filter((node) => node.type === 'text');
    assert.ok(texts.length > 0);
    for (const node of texts) {
      assert.ok(node.src.end > node.src.start, `empty text range for ${JSON.stringify(input)}`);
    }
  });
}

const sourceOf = (node: Node, input: string): string => input.slice(node.src.start, node.src.end);

test('the removed transform is still the only one that would drop positions', () => {
  // A canary on the dependencies, not on us: it records why `parse.ts` removes a transform, and fails
  // if GFM starts positioning what it rebuilds (remove the workaround) or if another extension grows a
  // transform (widen it). The frontmatter and math extensions carry none, which is why only GFM's set
  // is filtered.
  const gfmExtensions = gfmFromMarkdown();
  assert.deepEqual(
    gfmExtensions.filter((extension) => extension.transforms !== undefined).length,
    1,
    'the set of GFM mdast extensions carrying tree transforms changed',
  );
  for (const extensions of [frontmatterFromMarkdown(['yaml', 'toml']), mathFromMarkdown()]) {
    for (const extension of [extensions].flat()) {
      assert.equal(extension.transforms, undefined, 'an extension parse.ts does not filter grew a transform');
    }
  }
  const unfiltered = fromMarkdown('x <a\\.b@c.example> y\n', { extensions: [gfm()], mdastExtensions: [gfmExtensions] });
  const positionless: string[] = [];
  const walk = (node: { type: string; position?: unknown; children?: unknown }): void => {
    if (node.position === undefined) positionless.push(node.type);
    for (const child of (node.children ?? []) as { type: string; position?: unknown }[]) walk(child);
  };
  walk(unfiltered);
  assert.ok(
    positionless.length > 0,
    'mdast-util-gfm-autolink-literal now positions the nodes it rebuilds: remove the filter in parse.ts',
  );
});

test('a candidate micromark can scan is still a link, with real provenance', () => {
  const input = 'see https://marxy.invalid/r and www.marxy.invalid and reader@marxy.invalid\n';
  const bytes = new TextEncoder().encode(input);
  const document = parseMarkdown(bytes, { file: 'autolinks.md' });
  const links = nodes(document).filter((node) => node.type === 'link');
  assert.equal(links.length, 3, 'GFM autolink literals stopped working');
  assert.deepEqual(
    links.map((link) => sourceOf(link, input)),
    ['https://marxy.invalid/r', 'www.marxy.invalid', 'reader@marxy.invalid'],
  );
  assert.deepEqual(checkInvariants(document, bytes), []);
});

test('a node without a source position is refused, not given offset zero', () => {
  // The one way to reach this is a future mdast extension that drops positions the way GFM's
  // autolink-literal transform did; the parser must fail loudly rather than invent provenance.
  const root = {
    type: 'root' as const,
    position: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 4, offset: 3 } },
    children: [{ type: 'paragraph' as const, children: [{ type: 'text' as const, value: 'abc' }] }],
  };
  assert.throws(
    () => documentFromMdast(root as never, { file: 'broken.md', text: 'abc', offsets: byteOffsets('abc') }),
    (error: unknown) => error instanceof ParseProvenanceError && error.nodeType === 'paragraph' && error.file === 'broken.md',
  );
});

test('a CR-only document gets soft breaks, not carriage returns inside text', () => {
  const input = 'old mac\rlines\r';
  const bytes = new TextEncoder().encode(input);
  const document = parseMarkdown(bytes, { file: 'cr.md' });
  const paragraph = document.children[0];
  assert.equal(paragraph?.type, 'paragraph');
  const children = (paragraph?.children ?? []) as readonly Inline[];
  assert.deepEqual(children.map((child) => child.type), ['text', 'softBreak', 'text']);
  assert.equal(sourceOf(children[1]!, input), '\r');
  for (const child of children) {
    if (child.type === 'text') assert.ok(!child.value.includes('\r'), 'a CR survived inside a text value');
  }
  assert.deepEqual(checkInvariants(document, bytes), []);
});

test('an indented code block whose content looks like a fence keeps its content range', () => {
  const input = '\t```\n\tread\n';
  const bytes = new TextEncoder().encode(input);
  const document = parseMarkdown(bytes, { file: 'tab-fence.md' });
  const code = document.children[0] as Extract<Block, { type: 'codeBlock' }>;
  assert.equal(code.type, 'codeBlock');
  assert.equal(code.lang, undefined, 'a tab-indented line is indented code, not a fence');
  assert.ok(code.content.end > code.content.start, 'the content range collapsed to empty');
  // Both lines, the tabs included, and nothing past the last byte of code.
  assert.equal(input.slice(code.content.start, code.content.end), '\t```\n\tread');
  assert.equal(code.value, '```\nread');
  assert.deepEqual(checkInvariants(document, bytes), []);
});

test('a soft break owns the line ending and the block markers that continue the quote', () => {
  const text = '> a\n> b\n';
  const document = parseMarkdown(text, { file: 'quote.md' });
  const quote = document.children[0];
  assert.equal(quote?.type, 'blockquote');
  const paragraph = quote.type === 'blockquote' ? quote.children[0] : undefined;
  const children = (paragraph?.children ?? []) as readonly Inline[];
  assert.deepEqual(children.map((child) => child.type), ['text', 'softBreak', 'text']);
  assert.equal(text.slice(children[1]!.src.start, children[1]!.src.end), '\n> ');
});

test('a code block content range is the code alone', () => {
  const text = '```ts meta\nconst x = 1;\n```\n';
  const document = parseMarkdown(text, { file: 'code.md' });
  const code = document.children[0] as Extract<Block, { type: 'codeBlock' }>;
  assert.equal(code.type, 'codeBlock');
  assert.equal(code.lang, 'ts');
  assert.equal(code.info, 'ts meta');
  assert.equal(text.slice(code.content.start, code.content.end), 'const x = 1;\n');
});

test('a CR-only fenced block with an info string keeps content, lang and info', () => {
  const input = '```js meta\rconst x = 1;\r```\r';
  const bytes = new TextEncoder().encode(input);
  const document = parseMarkdown(bytes, { file: 'cr-fence.md' });
  const code = document.children[0] as Extract<Block, { type: 'codeBlock' }>;
  assert.equal(code.type, 'codeBlock');
  assert.equal(input.slice(code.content.start, code.content.end), 'const x = 1;\r');
  assert.equal(code.lang, 'js');
  assert.equal(code.info, 'js meta');
  assert.ok(code.info !== undefined && !code.info.includes('const'), 'info swallowed the rest of the block');
  assert.deepEqual(checkInvariants(document, bytes), []);
});

test('a CR-only indented block content slices to its code lines alone', () => {
  const input = '    line one\r    line two\rpara\r';
  const bytes = new TextEncoder().encode(input);
  const document = parseMarkdown(bytes, { file: 'cr-indent.md' });
  const code = document.children[0] as Extract<Block, { type: 'codeBlock' }>;
  assert.equal(code.type, 'codeBlock');
  assert.equal(input.slice(code.content.start, code.content.end), '    line one\r    line two');
  assert.ok(!input.slice(code.content.start, code.content.end).includes('para'), 'content swallowed the paragraph');
  assert.deepEqual(checkInvariants(document, bytes), []);
});

// Revert isJustTheCode's NUL → U+FFFD substitution and both of these fail: the value
// carries the replacement character where the content bytes still hold NUL.
test('a NUL in a fenced code block stays inside the content range', () => {
  const input = '```\na\u0000b\n```\n';
  const bytes = new TextEncoder().encode(input);
  const document = parseMarkdown(bytes, { file: 'nul-fence.md' });
  const code = document.children[0] as Extract<Block, { type: 'codeBlock' }>;
  assert.equal(code.type, 'codeBlock');
  assert.equal(code.value, 'a\ufffdb');
  assert.equal(input.slice(code.content.start, code.content.end), 'a\u0000b\n');
  assert.deepEqual(checkInvariants(document, bytes), []);
});

test('a NUL in an indented code block stays inside the content range', () => {
  const input = '    a\u0000b\n';
  const bytes = new TextEncoder().encode(input);
  const document = parseMarkdown(bytes, { file: 'nul-indent.md' });
  const code = document.children[0] as Extract<Block, { type: 'codeBlock' }>;
  assert.equal(code.type, 'codeBlock');
  assert.equal(code.value, 'a\ufffdb');
  assert.equal(input.slice(code.content.start, code.content.end), '    a\u0000b');
  assert.deepEqual(checkInvariants(document, bytes), []);
});

test('no parse source splits or searches on a bare newline literal', () => {
  // Needles are assembled so this file does not contain the calls it forbids.
  const nl = String.raw`\n`;
  const pattern = new RegExp(String.raw`\b(?:indexOf|split)\(\s*(['"\`])` + nl.replaceAll('\\', '\\\\') + String.raw`\1`);
  const parseDir = new URL('./', import.meta.url);
  const offenders: string[] = [];
  const walk = (directory: URL, prefix = ''): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, directory), `${name}/`);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const text = withoutComments(readFileSync(new URL(entry.name, directory), 'utf8'));
      if (pattern.test(text)) offenders.push(name);
    }
  };
  walk(parseDir);
  assert.deepEqual(offenders, []);
});

/** Block and line comments only; a forbidden call hiding in a comment is allowed. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}

/**
 * How much slower this machine is than the one the 10 ms budget was set on, measured rather than
 * assumed: a shared CI runner is several times slower than a developer's machine, and a budget that
 * fails for that reason stops being a signal. The workload is string building, regex scanning and
 * small-object allocation, which is the work a parser does.
 *
 * This probe is a stopgap and under-compensates under load. MARXY-59 moves the parse budget into
 * `fixtures/perf-budgets.json` with a per-runner baseline, the two-tier shape ADR-0022 set, and
 * deletes the probe; it is deliberately left as it stands here.
 */
const PROBE_REFERENCE_MS = 4.3;

function machineFactor(): number {
  const words = 'the quick brown fox jumps over the lazy dog'.split(' ');
  const run = (): number => {
    const started = performance.now();
    let sink = 0;
    for (let round = 0; round < 3000; round++) {
      let line = '';
      for (const word of words) line += `${word} *${word}* \`${word}\` `;
      for (const match of line.matchAll(/[*`]\w+[*`]/g)) sink += match.index;
      sink += line.split(/\s+/).map((word) => ({ word, length: word.length })).filter((token) => token.length > 3).length;
    }
    return performance.now() - started;
  };
  run();
  const runs = [run(), run(), run(), run(), run()].sort((a, b) => a - b);
  return Math.max(1, runs[2]! / PROBE_REFERENCE_MS);
}

// On a shared CI runner the machine-factor probe under-compensates under load (it measured 1.99× on a
// run where the parse was 2.2× slower, and the job went red on a push to main). Timing is a perf-gate
// concern with a per-runner envelope (ADR-0022; MARXY-59 moves this budget there); here it runs on
// developer machines and on the reference tier only.
const timingIsMeaningfulHere = !process.env.CI || process.env.MARXY_PERF_ENV === 'reference';
test('parsing 01-long-technical.md stays inside the 10 ms budget', { skip: timingIsMeaningfulHere ? false : 'shared CI runner: timing budgets are enforced by the perf gate, not a unit test (MARXY-59)' }, () => {
  const bytes = read('01-long-technical.md');
  for (let warmup = 0; warmup < 25; warmup++) parseMarkdown(bytes, { file: '01-long-technical.md' });
  const runs: number[] = [];
  for (let run = 0; run < 25; run++) {
    const started = performance.now();
    parseMarkdown(bytes, { file: '01-long-technical.md' });
    runs.push(performance.now() - started);
  }
  runs.sort((a, b) => a - b);
  const median = runs[Math.floor(runs.length / 2)]!;
  const factor = machineFactor();
  const budget = 10 * factor;
  console.log(`parse 01-long-technical.md: ${median.toFixed(2)} ms median, machine ${factor.toFixed(2)}× the reference, budget ${budget.toFixed(1)} ms`);
  assert.ok(
    median < budget,
    `parse took ${median.toFixed(2)} ms (median of ${runs.length}); budget is 10 ms on the reference machine, ${budget.toFixed(1)} ms on this one (measured ${factor.toFixed(2)}× slower)`,
  );
});
