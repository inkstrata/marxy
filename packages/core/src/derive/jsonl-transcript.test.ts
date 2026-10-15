// The `jsonl-transcript` deriver (ADR-0061, K-12) over the corpus's session, over hostile lines, and over 1,000 generated
// sessions checked against an independent reading of each line with `TextDecoder` and `JSON.parse`: the invariants of
// ADR-0061 item 4 (the accounting rule and item 4.5 above all), slices that agree with a whole read, and the type
// boundary that keeps a derived node away from every operation.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import type { Node, Source } from '../contracts/ast.ts';
import { DERIVED_INVARIANTS, type DerivedNode, type DerivedText, type DerivedTool, type DerivedTranscript, type DerivedTurn, type TranscriptNode } from '../contracts/derived.ts';
import type { OperationInput } from '../contracts/operation.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { checkDerivedInvariants, innerDocument, innerFileOf } from './invariants.ts';
import { createTranscriptDeriver, decodeJsonString, deriveTranscript, lineOfByte, parseJsonBytes } from './jsonl-transcript.ts';
import { countsOf, rowHtml, sourceLinesOf, turnText, userPrompts } from './transcript-html.ts';
import { entryFromCandidate } from '../index-model/entry.ts';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });
const FIXTURE = '40-session.jsonl';
const fixtureBytes = new Uint8Array(readFileSync(new URL(`../../../../fixtures/corpus/${FIXTURE}`, import.meta.url)));

const bytesOf = (s: string | Uint8Array): Uint8Array => (typeof s === 'string' ? enc.encode(s) : s);
const derive = (s: string | Uint8Array, file = '/r/s.jsonl'): DerivedTranscript => {
  const bytes = bytesOf(s);
  const tree = deriveTranscript(bytes, file);
  assert.deepEqual(checkDerivedInvariants(tree, bytes), [], 'the tree holds DERIVED_INVARIANTS');
  return tree;
};
const walk = (node: TranscriptNode, fn: (n: TranscriptNode) => void): void => {
  fn(node);
  if ('children' in node) for (const c of node.children as readonly TranscriptNode[]) walk(c, fn);
};
const leavesOf = (tree: DerivedTranscript): DerivedText[] => {
  const out: DerivedText[] = [];
  walk(tree, (n) => {
    if (n.type === 'derivedText') out.push(n);
  });
  return out;
};
const turns = (t: DerivedTranscript): DerivedTurn[] => t.children.filter((c): c is DerivedTurn => c.type === 'turn');
const raw = (bytes: Uint8Array, s: Source): string => dec.decode(bytes.subarray(s.start, s.end));
const line = (o: unknown): string => JSON.stringify(o);
const user = (content: unknown): string => line({ type: 'user', message: { role: 'user', content } });
const agent = (content: unknown): string => line({ type: 'assistant', message: { role: 'assistant', content } });

// ---- the corpus fixture ----------------------------------------------------------------------------------------------------

test('the corpus session holds DERIVED_INVARIANTS, every one of its markdown leaves parsed', () => {
  const tree = deriveTranscript(fixtureBytes, FIXTURE);
  assert.deepEqual(checkDerivedInvariants(tree, fixtureBytes), []);
  assert.equal(DERIVED_INVARIANTS.length, 7);
  assert.equal(tree.src.end, fixtureBytes.length);
  assert.equal(tree.from.length, 18, 'eighteen lines');
});

test('the accounting rule over the corpus session: each line is a leaf\'s source, in dropped once, or the one pending line', () => {
  const tree = deriveTranscript(fixtureBytes, FIXTURE);
  const shown = new Set<number>();
  walk(tree, (n) => {
    if (n.type === 'derivedText' || n.type === 'unreadable') for (const r of n.from) shown.add(lineOfByte(tree, r.start));
  });
  const dropped = tree.dropped.map((d) => d.line);
  const pending = tree.children.filter((c) => c.type === 'pending').map((c) => lineOfByte(tree, c.src.start));
  for (let k = 1; k <= tree.from.length; k++) {
    const kinds = Number(shown.has(k)) + dropped.filter((d) => d === k).length + Number(pending.includes(k));
    assert.equal(kinds, 1, `line ${k}`);
  }
  assert.deepEqual(pending, [18], 'the unfinished last line is pending');
  assert.deepEqual(tree.dropped.map((d) => [d.line, d.record, d.known]), [
    [1, 'summary', true], [5, 'file-history-snapshot', true], [6, 'system', true], [13, 'queue-operation', true], [14, 'mystery-record', false], [17, 'blank', true],
  ]);
  const unreadable = tree.children.filter((c) => c.type === 'unreadable');
  assert.deepEqual(unreadable.map((u) => u.line), [12], 'the bad line is unreadable, not dropped');
  const counts = countsOf(tree);
  assert.deepEqual([counts.notShown, counts.unknown, counts.unreadable, counts.pending], [5, 1, 1, true], 'the header line counts the unknown type apart');
});

test('the escaped U+202E is one character in its leaf, and is marked as Read marks a bidi control', () => {
  const tree = deriveTranscript(fixtureBytes, FIXTURE);
  const leaf = leavesOf(tree).find((l) => l.value.includes('\u202e'))!;
  assert.ok(leaf, 'a leaf holds the override');
  assert.equal([...leaf.value].filter((c) => c === '\u202e').length, 1);
  assert.ok(raw(fixtureBytes, leaf.src).includes('\\u202e'), 'the file spells it as a six-byte escape');
  assert.equal(raw(fixtureBytes, leaf.src).includes('\u202e'), false, 'and holds no override itself');
  assert.equal(leaf.syntax, 'markdown', "the agent's text is Markdown");
  const turn = turns(tree).find((t) => t.children.includes(leaf))!;
  const html = rowHtml(turn, fixtureBytes, { path: FIXTURE });
  assert.match(html, /<code class="marxy-invisible-glyph" aria-hidden="true">202E<\/code><code class="marxy-invisible-byte marxy-invisible-bidi" aria-hidden="true">\u202e<\/code>/);
  // Every U+202E in the render is inside its marker: none stands bare where it would act.
  assert.equal(html.split('\u202e').length - 1, 1);
});

test('the tool call and its result three lines later are one tool node', () => {
  const tree = deriveTranscript(fixtureBytes, FIXTURE);
  const bash = turns(tree).flatMap((t) => t.children).find((c): c is DerivedTool => c.type === 'tool' && c.children[0]?.value === 'Bash')!;
  assert.equal(bash.from.length, 2, 'the call\'s object and the result\'s');
  assert.deepEqual(bash.from.map((r) => lineOfByte(tree, r.start)), [4, 7], 'three lines apart');
  assert.ok(bash.answered && !bash.failed && !bash.orphan);
  assert.deepEqual(bash.children.map((c) => c.role), ['tool-name', 'tool-input', 'tool-input', 'tool-output']);
  assert.match(bash.children[3]!.value, /^indexed 932 files/);
  // The agent's turn holds the call, the lines between and the result: one turn, not three.
  const agentTurn = turns(tree)[1]!;
  assert.equal(agentTurn.speaker, 'agent');
  assert.ok(agentTurn.children.includes(bash));
  assert.deepEqual(agentTurn.from.map((r) => lineOfByte(tree, r.start)), [3, 4, 7, 8]);
});

test('no node knows a model, a session id, a cost, a token count or a per-event time', () => {
  const tree = deriveTranscript(fixtureBytes, FIXTURE);
  const seen = JSON.stringify(tree);
  for (const value of ['model-name-x', '00000000-0000-4000-8000-000000000001', '0.0123', '1200', '2026-10-07T15', 'msg_01', 'c2lnbmF0dXJl']) {
    assert.equal(seen.includes(value), false, `the tree holds ${value}`);
  }
  const keys = new Set<string>();
  walk(tree, (n) => {
    for (const k of Object.keys(n)) keys.add(k);
  });
  for (const banned of ['model', 'sessionId', 'session', 'cost', 'costUSD', 'usage', 'tokens', 'timestamp', 'time', 'uuid', 'id']) {
    assert.equal(keys.has(banned), false, `a node has a ${banned} field`);
  }
});

test('nothing derived goes into the index: no index or kind module imports the deriver, and a session\'s entry holds none of its text', () => {
  for (const dir of ['index-model', 'kind']) {
    const folder = new URL(`../${dir}/`, import.meta.url);
    for (const name of readdirSync(folder).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      const text = readFileSync(new URL(name, folder), 'utf8');
      assert.equal(/from ['"][^'"]*\/derive\//.test(text), false, `${dir}/${name} imports a deriver`);
    }
  }
  const entry = entryFromCandidate('/repo', { path: '/repo/40-session.jsonl', relativePath: '40-session.jsonl', mtimeMs: 1, size: fixtureBytes.length, bytes: fixtureBytes });
  const seen = JSON.stringify(entry);
  for (const leaf of leavesOf(deriveTranscript(fixtureBytes, FIXTURE))) {
    if (leaf.value.length >= 8) assert.equal(seen.includes(leaf.value.slice(0, 24)), false, `the index entry holds ${JSON.stringify(leaf.value.slice(0, 24))}`);
  }
  assert.equal(entry.title, '40-session.jsonl', 'titled by its name, not by a derived prompt');
});

test('the type checker refuses a DerivedNode where an operation takes a Node', () => {
  const tree = deriveTranscript(fixtureBytes, FIXTURE);
  const leaf: DerivedText = leavesOf(tree)[0]!;
  const asDerived: DerivedNode = leaf;
  // @ts-expect-error a derived leaf is not an AST node
  const asNode: Node = leaf;
  const document = parseMarkdown('x\n', { file: FIXTURE });
  // @ts-expect-error an operation's input takes a Node, never a derived one
  const input: OperationInput = { document, node: leaf, range: leaf.src, text: leaf.value };
  // @ts-expect-error a turn is not a Node either
  const asTurnNode: Node = turns(tree)[0]!;
  assert.ok(asDerived && asNode && input && asTurnNode);
});

test('an inner document is parsed under a synthetic name, never the file\'s, and its offsets index the derived text', () => {
  const tree = deriveTranscript(fixtureBytes, FIXTURE);
  const leaf = leavesOf(tree).find((l) => l.syntax === 'markdown')!;
  const inner = innerDocument(FIXTURE, leaf);
  assert.equal(inner.src.file, `${FIXTURE}#derived@${leaf.src.start}`);
  assert.equal(inner.src.file, innerFileOf(FIXTURE, leaf));
  assert.equal(inner.src.end, enc.encode(leaf.value).length);
});

test('copy-turn is the turn\'s text without its label; Source lines are the whole lines it came from; your prompts in order', () => {
  const tree = deriveTranscript(fixtureBytes, FIXTURE);
  const [you, agentTurn] = turns(tree);
  assert.equal(turnText(you!), 'The indexer takes 40 seconds on my notes folder.\nCan you find out why?');
  assert.equal(
    turnText(agentTurn!),
    "Thinking · 12 words\n\nI'll profile a cold run first, then look at where the time goes.\n\nTool · Bash · 4 lines\n\nHighlighting is **91%** of the run. Every file is highlighted on every index, even when it has not changed.\n\nOne file name in the log reads `notes\u202etxt.md`, and another holds a zero\u200bwidth space.",
  );
  const lines = dec.decode(sourceLinesOf(tree, fixtureBytes, agentTurn!));
  assert.deepEqual(lines.split('\n').filter(Boolean).map((l) => JSON.parse(l).type), ['assistant', 'assistant', 'user', 'assistant'], 'lines 3, 4, 7 and 8, not the bookkeeping between');
  assert.deepEqual(userPrompts(tree).split('\n\n'), ['The indexer takes 40 seconds on my notes folder.\nCan you find out why?', 'So cache it?', 'Run it again, and say what \ud800 means in the log.']);
});

// ---- hostile lines ----------------------------------------------------------------------------------------------------------

test('CRLF line endings: the CR is JSON whitespace, the line keeps both bytes, and nothing is unreadable', () => {
  const text = `${user('hi')}\r\n${agent([{ type: 'text', text: 'yo' }])}\r\n`;
  const tree = derive(text);
  assert.deepEqual(turns(tree).map((t) => t.speaker), ['you', 'agent']);
  assert.equal(tree.from[0]!.end - tree.from[0]!.start, user('hi').length + 2);
});

test('a raw NUL makes its line unreadable; an escaped one is a character of the text', () => {
  const tree = derive(`${user('a').replace('"a"', '"a\u0000b"')}\n${user('c').replace('"c"', '"c\\u0000d"')}\n`);
  assert.equal(tree.children[0]!.type, 'unreadable');
  const leaf = leavesOf(tree)[0]!;
  assert.equal(leaf.value, 'c\u0000d');
});

test('bytes that are not UTF-8 inside a string: the leaf is plain and each replacement the decoding made is marked', () => {
  const head = enc.encode('{"type":"assistant","message":{"role":"assistant","content":"ok ');
  const tail = enc.encode(' � end"}}\n');
  const bytes = new Uint8Array([...head, 0xff, 0xe2, 0x82, 0x41, 0xf0, 0x9f, ...tail]);
  const tree = derive(bytes);
  const leaf = leavesOf(tree)[0]!;
  assert.equal(leaf.syntax, 'plain', 'never Markdown');
  assert.equal(leaf.value, 'ok ��A� � end', 'TextDecoder\'s replacements, and the file\'s own U+FFFD');
  assert.deepEqual(leaf.replaced, [3, 4, 6], 'the three Marxy made, not the one the file holds');
  const html = rowHtml(turns(tree)[0]!, bytes, { path: '/r/s.jsonl' });
  assert.equal(html.match(/marxy-derived-replaced/g)?.length, 3);
});

test('bytes that are not UTF-8 outside a string make the line unreadable', () => {
  const bytes = new Uint8Array([...enc.encode('{"type":"user","message":{"role":"user","content":"x"}}'), 0xff, 0x0a]);
  assert.equal(derive(bytes).children[0]!.type, 'unreadable');
});

test('lone surrogates in escapes: the leaf keeps the unit, is plain and is marked', () => {
  const text = `${agent([{ type: 'text', text: 'PLACEHOLDER' }]).replace('PLACEHOLDER', 'a \\ud800 b \\udc00 c \\ud83d\\ude00 d')}\n`;
  const tree = derive(text);
  const leaf = leavesOf(tree)[0]!;
  assert.equal(leaf.value, 'a \ud800 b \udc00 c 😀 d');
  assert.equal(leaf.syntax, 'plain');
  const html = rowHtml(turns(tree)[0]!, bytesOf(text), { path: '/r/s.jsonl' });
  assert.equal(html.match(/a lone surrogate/g)?.length, 2, 'the two lone units, not the pair');
  assert.ok(html.includes('😀'), 'the pair is the emoji');
});

test('bidi controls, raw or escaped, are each one character and drawn as a marker', () => {
  const text = `${user('x\u202ey\u2066z')}\n${user('PLACE').replace('PLACE', 'p\\u202eq')}\n`;
  const tree = derive(text);
  const html = turns(tree).map((t) => rowHtml(t, bytesOf(text), { path: '/r/s.jsonl' })).join('');
  assert.equal(html.match(/marxy-invisible-bidi/g)?.length, 3);
});

test('a 5 MB single line: read as one leaf when it is JSON, as one unreadable row when it is not', () => {
  const big = 'x'.repeat(5 * 1024 * 1024);
  const t0 = performance.now();
  const tree = derive(`${user('before')}\n${agent([{ type: 'text', text: big }])}\n${user('after')}\n`);
  const ms = performance.now() - t0;
  assert.equal(leavesOf(tree)[1]!.value.length, big.length);
  assert.deepEqual(turns(tree).map((t) => t.speaker), ['you', 'agent', 'you']);
  const broken = derive(`${user('before')}\n{"type":"assistant","text":"${big}\n${user('after')}\n`);
  assert.equal(broken.children[1]!.type, 'unreadable');
  console.log(`  a 5 MB line derived and checked in ${ms.toFixed(0)} ms`);
});

test('a line nested a million deep is read without a stack overflow', () => {
  const deep = `${'['.repeat(1_000_000)}${']'.repeat(1_000_000)}`;
  const tree = derive(`${deep}\n${'['.repeat(10)}\n`);
  assert.deepEqual(tree.dropped.map((d) => d.record), ['(not an object)']);
  assert.equal(tree.children[0]!.type, 'unreadable');
});

test('a byte-order mark before the first line, blank and whitespace lines, values that are not objects', () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode(`${user('hi')}\n\n   \r\n42\n"str"\n[1]\nnull\n`)]);
  const tree = derive(bytes);
  assert.equal(turns(tree).length, 1);
  assert.deepEqual(tree.dropped.map((d) => [d.record, d.known]), [['blank', true], ['blank', true], ['(not an object)', false], ['(not an object)', false], ['(not an object)', false], ['(not an object)', false]]);
});

test('the last line: pending while unfinished, unreadable once a newline ends it, a record once it is JSON', () => {
  assert.equal(derive(`${user('a')}\n{"type":"us`).children.at(-1)!.type, 'pending');
  assert.equal(derive(`${user('a')}\n{"type":"us\n`).children.at(-1)!.type, 'unreadable');
  assert.equal(derive(`${user('a')}\n${user('b')}`).children.length, 1, 'a finished last line with no newline is read, and joins the turn');
  assert.equal(derive('').from.length, 0, 'an empty file has no line');
  assert.deepEqual(derive('\n').dropped.map((d) => d.record), ['blank']);
});

test('records of other shapes: a role and content at the top, a role: tool result, a message with no text', () => {
  const tree = derive(
    [
      line({ role: 'user', content: 'plain prompt' }),
      line({ role: 'assistant', content: [{ type: 'text', text: 'answer' }, { type: 'tool_use', id: 't9', name: 'grep', input: { pattern: 'x' } }] }),
      line({ role: 'tool', tool_call_id: 't9', content: 'found' }),
      line({ type: 'user', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', data: 'AAAA' } }] } }),
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'redacted_thinking', data: 'zz' }] } }),
      '',
    ].join('\n'),
  );
  assert.deepEqual(turns(tree).map((t) => t.speaker), ['you', 'agent']);
  const grep = turns(tree)[1]!.children[1] as DerivedTool;
  assert.ok(grep.answered && !grep.orphan, 'a role: tool line joins the call its tool_call_id names');
  assert.deepEqual(grep.children.map((c) => c.value), ['grep', 'x', 'found']);
  assert.deepEqual(tree.dropped.map((d) => [d.record, d.known]), [['user', true], ['assistant', true]]);
});

test('an unreadable line ends the turn; a dropped one does not', () => {
  const tree = derive([agent('a'), line({ type: 'summary', summary: 's' }), agent('b'), 'nope', agent('c'), ''].join('\n'));
  assert.deepEqual(tree.children.map((c) => c.type), ['turn', 'unreadable', 'turn']);
  assert.equal(turns(tree)[0]!.children.length, 2);
});

test('a result joins its call in the turn; a second result for one call, or one after a prompt, stands alone', () => {
  const call = agent([{ type: 'tool_use', id: 'a1', name: 'Read', input: {} }]);
  const res = user([{ type: 'tool_result', tool_use_id: 'a1', content: 'body', is_error: true }]);
  const tree = derive([call, res, res, user('next'), res, ''].join('\n'));
  const units = turns(tree).flatMap((t) => t.children).filter((c): c is DerivedTool => c.type === 'tool');
  assert.deepEqual(units.map((u) => [u.orphan, u.answered, u.failed, u.from.length]), [[false, true, true, 2], [true, true, true, 1], [true, true, true, 1]]);
});

// ---- the JSON reader against JSON.parse ------------------------------------------------------------------------------------

/** A small seeded generator, so a failing case is reproducible from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ATOMS = ['', 'a', ' ', '"', '\\', '\\"', '\\\\', '\\n', '\\u0041', '\\ud800', '\\udc00', '\\ud83d\\ude00', '\\u202e', '\\u200b', '\\u001b[31m', '\\x', '\\u12', '\t', '\u0000', '\r', 'é', '\u202e', '中', '😀', '{', '}', '[', ']', ':', ',', '0', '-1.5e+3', '01', '1.', 'true', 'nul', 'null', '\ufeff'];
const BAD_BYTES = [0xff, 0xc0, 0x80, 0xe2, 0x82, 0xf0, 0x9f, 0xed, 0xa0, 0xf4, 0x90, 0xc3];

/** A random line of bytes: mostly JSON, often broken in one of the ways a file breaks. */
function randomLine(r: () => number): Uint8Array {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const str = (): string => `"${Array.from({ length: Math.floor(r() * 6) }, () => pick(ATOMS)).join('')}"`;
  const value = (depth: number): string => {
    const k = r();
    if (depth > 3 || k < 0.35) return pick([str(), str(), '0', '-12.5', 'true', 'false', 'null', '1e9']);
    if (k < 0.7) return `{${Array.from({ length: Math.floor(r() * 4) }, () => `${str()}:${value(depth + 1)}`).join(',')}}`;
    return `[${Array.from({ length: Math.floor(r() * 4) }, () => value(depth + 1)).join(r() < 0.1 ? ',,' : ',')}]`;
  };
  let text = r() < 0.15 ? ` ${value(0)}\r` : value(0);
  if (r() < 0.2) text = text.slice(0, Math.floor(r() * text.length)) + pick(ATOMS) + text.slice(Math.floor(r() * text.length));
  const bytes = [...enc.encode(text)];
  if (r() < 0.15) bytes.splice(Math.floor(r() * bytes.length), 0, pick(BAD_BYTES));
  return new Uint8Array(bytes.filter((b) => b !== 0x0a));
}

const parsesAsJson = (bytes: Uint8Array): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(dec.decode(bytes)) };
  } catch {
    return { ok: false };
  }
};

test('the byte reader agrees with JSON.parse over the UTF-8 decoding on 20,000 random lines, and every string token decodes as JSON.parse reads it', () => {
  const r = rng(0x5eed);
  let valid = 0;
  for (let n = 0; n < 20_000; n++) {
    const bytes = randomLine(r);
    const got = parseJsonBytes(bytes, 0, bytes.length);
    const want = parsesAsJson(bytes);
    assert.equal(got !== null, want.ok, `line ${n}: ${JSON.stringify(dec.decode(bytes))}`);
    if (!got) continue;
    valid++;
    // Every string token in the value, keys included, decodes to what JSON.parse makes of exactly its bytes.
    const tokens: { s: number; e: number }[] = [];
    const visit = (v: ReturnType<typeof parseJsonBytes>): void => {
      if (!v) return;
      if (v.k === 's') tokens.push(v);
      if (v.k === 'o') {
        tokens.push(...v.keys);
        v.vals.forEach(visit);
      }
      if (v.k === 'a') v.items.forEach(visit);
    };
    visit(got);
    for (const t of tokens) {
      const mine = decodeJsonString(bytes, t);
      assert.equal(mine.value, JSON.parse(dec.decode(bytes.subarray(t.s, t.e))), `token in line ${n}`);
      for (const at of mine.replaced) assert.equal(mine.value.charCodeAt(at), 0xfffd);
    }
  }
  assert.ok(valid > 5000 && valid < 19_000, `a fair mix of valid (${valid}) and broken lines`);
});

// ---- sessions: slices, and the differential over 1,000 generated sessions -----------------------------------------------

/** One generated session: records of every kind the deriver reads, bookkeeping, and hostile lines among them. */
function randomSession(r: () => number, n: number): Uint8Array {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const hostile = (): string =>
    Array.from({ length: 1 + Math.floor(r() * 4) }, () => pick(['plain words', '**bold** and `code`', '# a heading\n\n- a list', 'x\u202ey', '\u2066iso\u2069', 'zero\u200bwidth', '\u001b[2J', 'nul\u0000l', 'tab\tbed', 'line\r\nbreak', '😀 pair', '中文', '\ufeffbom', 'ok'])).join(' ');
  const ids: string[] = [];
  const parts: Uint8Array[] = [];
  const lines = 1 + Math.floor(r() * 40);
  for (let k = 0; k < lines; k++) {
    const roll = r();
    let text: string;
    if (roll < 0.18) text = user(r() < 0.5 ? hostile() : [{ type: 'text', text: hostile() }]);
    else if (roll < 0.36) {
      const blocks: unknown[] = [];
      for (let b = 0; b < 1 + Math.floor(r() * 3); b++) {
        const kind = r();
        if (kind < 0.4) blocks.push({ type: 'text', text: hostile() });
        else if (kind < 0.55) blocks.push({ type: 'thinking', thinking: hostile(), signature: 'sig' });
        else if (kind < 0.9) {
          const id = `t${k}-${b}`;
          ids.push(id);
          blocks.push({ type: 'tool_use', id, name: pick(['Bash', 'Read', 'Edit', 'x\u202ey']), input: { command: hostile(), n: 3, nested: { s: 'skip' } } });
        } else blocks.push({ type: 'image', source: {} });
      }
      text = line({ type: 'assistant', message: { role: 'assistant', model: 'm', content: blocks, usage: { input_tokens: 1 } }, costUSD: 0.1 });
    } else if (roll < 0.5) {
      const id = r() < 0.8 && ids.length > 0 ? pick(ids) : 'nobody';
      text = user([{ type: 'tool_result', tool_use_id: id, content: r() < 0.5 ? hostile() : [{ type: 'text', text: hostile() }, { type: 'image' }], is_error: r() < 0.2 }]);
    } else if (roll < 0.6) text = line({ type: pick(['summary', 'system', 'file-history-snapshot', 'mystery', 'queue-operation']), content: hostile() });
    else if (roll < 0.66) text = line({ role: pick(['user', 'assistant', 'tool', 'system']), content: hostile(), tool_call_id: pick(ids.length ? ids : ['z']) });
    else if (roll < 0.72) text = pick(['', '   ', '\t\r', '42', '[]', 'null']);
    else if (roll < 0.8) {
      // Escapes the encoder never writes: lone surrogates, a surrogate pair spelled out, an escaped NUL, \/.
      text = user('PLACE').replace('PLACE', pick(['\\ud800', 'a\\udc00b', '\\ud83d\\ude00', '\\u0000', '\\/', '\\u202E\\u200B', '\\b\\f']));
    } else if (roll < 0.88) {
      // A broken line: cut short, a raw control character, a bad escape.
      const whole = agent(hostile());
      text = pick([whole.slice(0, Math.floor(r() * whole.length)), whole.replace('"content"', '"content\u0001"'), whole.replace('content', 'con\\qtent'), 'not json at all']);
    } else {
      // Bytes that are not UTF-8, inside a string or outside one.
      const whole = enc.encode(user(`bad ${hostile()} bytes`));
      const at = r() < 0.7 ? whole.indexOf(0x62 /* b of bad */) : 0;
      parts.push(new Uint8Array([...whole.subarray(0, at), pick(BAD_BYTES), pick(BAD_BYTES), ...whole.subarray(at)]));
      parts.push(enc.encode(r() < 0.3 ? '\r\n' : '\n'));
      continue;
    }
    parts.push(enc.encode(text));
    parts.push(enc.encode(k === lines - 1 && r() < 0.3 ? '' : r() < 0.3 ? '\r\n' : '\n'));
  }
  // One session in the run carries a 5 MB line.
  if (n === 500) {
    parts.push(enc.encode(agent([{ type: 'text', text: `${'5 MB of one line. '.repeat(5 * 1024 * 1024 / 18)}\u202e` }])));
    parts.push(enc.encode('\n'));
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * What an independent reading of one line says it shows: `JSON.parse` over `TextDecoder`'s decoding, and the deriver's
 * rules for which strings of a record are text. A multiset of values, since pairing a result to its call moves where a
 * leaf sits, never whether it is shown.
 */
function referenceValues(lineBytes: Uint8Array, first: boolean): { kind: 'blank' | 'unreadable' | 'values'; values: string[] } {
  let body = lineBytes;
  if (first && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) body = body.subarray(3);
  const text = dec.decode(body);
  if (/^[ \t\r\n]*$/.test(text)) return { kind: 'blank', values: [] };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { kind: 'unreadable', values: [] };
  }
  const values: string[] = [];
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { kind: 'values', values };
  const o = v as Record<string, unknown>;
  const msg = o.message as Record<string, unknown> | undefined;
  const role = (msg && typeof msg === 'object' && !Array.isArray(msg) && typeof msg.role === 'string' ? msg.role : undefined) ?? (typeof o.role === 'string' ? o.role : undefined);
  const type = typeof o.type === 'string' ? o.type : undefined;
  const content = msg && typeof msg === 'object' && !Array.isArray(msg) && 'content' in msg ? msg.content : o.content;
  const contentStrings = (c: unknown): string[] => {
    if (typeof c === 'string') return [c];
    if (!Array.isArray(c)) return [];
    return c.flatMap((item) => (typeof item === 'string' ? [item] : item && typeof item === 'object' && (item as { type?: unknown }).type === 'text' && typeof (item as { text?: unknown }).text === 'string' ? [(item as { text: string }).text] : []));
  };
  const message = (speaker: 'you' | 'agent'): void => {
    if (typeof content === 'string') {
      values.push(content);
      return;
    }
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (typeof block === 'string') values.push(block);
      if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
      const b = block as Record<string, unknown>;
      if (b.type === 'text' && typeof b.text === 'string') values.push(b.text);
      else if (b.type === 'thinking' && speaker === 'agent' && typeof b.thinking === 'string') values.push(b.thinking);
      else if (b.type === 'tool_use' && speaker === 'agent' && typeof b.name === 'string') {
        values.push(b.name);
        if (b.input && typeof b.input === 'object' && !Array.isArray(b.input)) for (const x of Object.values(b.input)) if (typeof x === 'string') values.push(x);
      } else if (b.type === 'tool_result') values.push(...contentStrings(b.content));
    }
  };
  if (role === 'user' && (type === undefined || type === 'user' || msg !== undefined)) message('you');
  else if (role === 'assistant' && (type === undefined || type === 'assistant' || msg !== undefined)) message('agent');
  else if (role === 'tool' && type === undefined) values.push(...contentStrings(o.content));
  return { kind: 'values', values };
}

test('slices: a session derived a few bytes at a time is the session derived whole, and a settled row never changes after', () => {
  const r = rng(77);
  for (let n = 0; n < 60; n++) {
    const bytes = randomSession(r, n);
    const whole = deriveTranscript(bytes, '/r/s.jsonl');
    const d = createTranscriptDeriver(bytes, '/r/s.jsonl');
    let frozen: string[] = [];
    while (!d.step(1 + Math.floor(r() * 400))) {
      const now = d.tree.children.slice(0, d.settled).map((c) => JSON.stringify(c));
      assert.deepEqual(now.slice(0, frozen.length), frozen, `session ${n}: a settled row changed`);
      frozen = now;
    }
    assert.deepEqual(JSON.parse(JSON.stringify(d.tree)), JSON.parse(JSON.stringify(whole)), `session ${n}`);
    assert.ok(d.slices >= 1);
  }
});

test('extend: a session cut at any byte and then read on from the cut is the session derived whole, and the rows it kept are unchanged', () => {
  const r = rng(4242);
  let cuts = 0;
  for (let n = 0; n < 300; n++) {
    const bytes = randomSession(r, n === 0 ? 1 : n);
    const whole = JSON.stringify(deriveTranscript(bytes, '/r/s.jsonl'));
    // Two appends: the file as the agent was writing it, then more, then all of it.
    const first = Math.floor(r() * bytes.length);
    const second = first + Math.floor(r() * (bytes.length - first));
    const d = createTranscriptDeriver(bytes.subarray(0, first), '/r/s.jsonl');
    while (!d.step(1 + Math.floor(r() * 2000))) {}
    for (const cut of [second, bytes.length]) {
      const rowsBefore = d.tree.children.map((c) => JSON.stringify(c));
      const kept = d.extend(bytes.subarray(0, cut));
      assert.ok(kept >= 0 && kept <= rowsBefore.length, `session ${n}: kept ${kept} of ${rowsBefore.length}`);
      while (!d.step(1 + Math.floor(r() * 2000))) {}
      assert.deepEqual(d.tree.children.slice(0, kept).map((c) => JSON.stringify(c)), rowsBefore.slice(0, kept), `session ${n}: a kept row changed`);
      cuts++;
    }
    assert.equal(JSON.stringify(d.tree), whole, `session ${n} cut at ${first} and ${second}`);
    assert.deepEqual(checkDerivedInvariants(d.tree, bytes, { markdown: false }), []);
  }
  assert.equal(cuts, 600);
});

test('extend refuses bytes that do not begin with what was read, and an append reads only the new lines', () => {
  const head = `${user('a')}\n${agent('b')}\n`;
  const d = createTranscriptDeriver(bytesOf(head), '/r/s.jsonl');
  while (!d.step(1 << 20)) {}
  assert.equal(d.extend(bytesOf(`${user('A')}\n${agent('b')}\n`)), -1, 'an edit before the end is not an append');
  const slicesBefore = d.slices;
  const linesBefore = d.lines;
  assert.equal(d.extend(bytesOf(`${head}${agent('c')}\n`)), 1, 'the open agent turn may grow; the prompt stays');
  while (!d.step(1 << 20)) {}
  assert.equal(d.lines - linesBefore, 1, 'one line read');
  assert.equal(d.slices - slicesBefore, 1);
  assert.equal((d.tree.children[1] as DerivedTurn).children.length, 2, 'the appended reply joined the turn');
});

test('what a shown line holds that is not text is counted and kept: non-string inputs, image blocks, result items', () => {
  const tree = derive(
    [
      agent([{ type: 'text', text: 'planning' }, { type: 'tool_use', id: 'w1', name: 'TodoWrite', input: { todos: [{ content: 'x', status: 'pending' }], count: 2, note: 'n' } }]),
      user([{ type: 'tool_result', tool_use_id: 'w1', content: [{ type: 'text', text: 'ok' }, { type: 'image', source: {} }] }]),
      user([{ type: 'text', text: 'look at this' }, { type: 'image', source: { type: 'base64', data: 'AAAA' } }, 7]),
      '',
    ].join('\n'),
  );
  const tool = turns(tree)[0]!.children[1] as DerivedTool;
  assert.deepEqual(tool.unshown.map((u) => [u.what, u.key ?? null]), [['array', 'todos'], ['number', 'count'], ['image', null]]);
  const you = turns(tree)[1]!;
  assert.deepEqual(you.unshown.map((u) => u.what), ['image', 'number']);
  const html = rowHtml(turns(tree)[0]!, bytesOf(''), { path: '/r/s.jsonl' });
  assert.match(html, /3 values not shown/);
  assert.match(rowHtml(you, bytesOf(''), { path: '/r/s.jsonl' }), /2 values not shown/);
});

test('a prompt that answers a call and then says something: the result joins the call, the text starts the prompt', () => {
  const tree = derive([agent([{ type: 'tool_use', id: 'q1', name: 'Ask', input: {} }]), user([{ type: 'text', text: 'here' }, { type: 'tool_result', tool_use_id: 'q1', content: 'answer' }]), ''].join('\n'));
  const units = turns(tree).flatMap((t) => t.children).filter((c): c is DerivedTool => c.type === 'tool');
  assert.deepEqual(units.map((u) => [u.orphan, u.answered]), [[false, true]]);
  assert.deepEqual(turns(tree).map((t) => t.speaker), ['agent', 'you']);
});

test('the differential over 1,000 generated sessions: the accounting rule and item 4.5 hold for every one, and each line shows what JSON.parse finds in it', () => {
  const r = rng(0xc0ffee);
  let leaves = 0;
  let lines = 0;
  let unreadable = 0;
  let replaced = 0;
  let surrogates = 0;
  let pending = 0;
  const t0 = performance.now();
  for (let n = 0; n < 1000; n++) {
    const bytes = randomSession(r, n);
    const tree = deriveTranscript(bytes, `/r/s${n}.jsonl`);
    // Items 4.1 to 4.7, item 4.5 by TextDecoder and JSON.parse; item 4.6's parse on every tenth session (and the fixture's every leaf above).
    const problems = checkDerivedInvariants(tree, bytes, { markdown: n % 10 === 0 });
    assert.deepEqual(problems, [], `session ${n}`);
    // Each line, read independently: what it shows is exactly the leaves the tree took from it.
    const byLine = new Map<number, string[]>();
    walk(tree, (node) => {
      if (node.type !== 'derivedText') return;
      leaves++;
      if (node.replaced.length > 0) replaced++;
      if (/[\ud800-\udfff]/.test(node.value) && node.syntax === 'plain') surrogates++;
      const k = lineOfByte(tree, node.src.start);
      byLine.set(k, [...(byLine.get(k) ?? []), node.value]);
    });
    const unreadableLines = new Set(tree.children.filter((c) => c.type === 'unreadable').map((c) => (c as { line: number }).line));
    const pendingLines = new Set(tree.children.filter((c) => c.type === 'pending').map((c) => (c as { line: number }).line));
    const droppedLines = new Set(tree.dropped.map((d) => d.line));
    for (let k = 1; k <= tree.from.length; k++) {
      lines++;
      const r0 = tree.from[k - 1]!;
      const body = bytes.subarray(r0.start, bytes[r0.end - 1] === 0x0a ? r0.end - 1 : r0.end);
      const want = referenceValues(body, k === 1);
      const got = (byLine.get(k) ?? []).slice().sort();
      if (want.kind === 'unreadable') {
        const last = k === tree.from.length && bytes[r0.end - 1] !== 0x0a;
        assert.ok(last ? pendingLines.has(k) : unreadableLines.has(k), `session ${n} line ${k} is not JSON and is not marked so`);
        if (last) pending++;
        else unreadable++;
        continue;
      }
      if (want.kind === 'blank') {
        assert.ok(droppedLines.has(k), `session ${n} line ${k} is blank and not dropped`);
        continue;
      }
      assert.deepEqual(got, want.values.slice().sort(), `session ${n} line ${k}`);
      assert.equal(droppedLines.has(k), want.values.length === 0, `session ${n} line ${k}: dropped exactly when it shows nothing`);
    }
  }
  const ms = performance.now() - t0;
  console.log(`  1,000 sessions: ${lines} lines, ${leaves} leaves, ${replaced} with replaced bytes, ${surrogates} with surrogates, ${unreadable} unreadable, ${pending} pending, ${ms.toFixed(0)} ms`);
  assert.ok(replaced > 50 && surrogates > 50 && unreadable > 200 && pending > 10, 'the generator reached every hostile case');
});
