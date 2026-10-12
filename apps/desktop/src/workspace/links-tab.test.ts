// The Links tab's pure parts (W-09): `linksOf` over parsed fixtures, `resolveMentioned` over a fake `stat`, and the rule that a
// store that has not been parsed is never parsed to fill the tab. What the reader sees is inspector.test.mjs, in WebKit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMarkdown } from '@marxy/core/src/parse/parse.ts';
import type { DocumentStore } from '../document/store.ts';
import { linksModelOf, linksOf, resolveMentioned, type StatFn } from './links-tab.ts';

const linksIn = (md: string) => linksOf(parseMarkdown(md));

test('linksOf: an inline link, a reference link, an autolink and a link in a table cell, in document order, as written', () => {
  const md = [
    'See [the docs](https://example.com/docs "t") and [ref][r] and <https://auto.example/x>.',
    '',
    '| a | b |', '|---|---|', '| [cell](https://cell.example) | 2 |',
    '',
    '[r]: https://ref.example/page',
    '',
  ].join('\n');
  const links = linksIn(md);
  assert.deepEqual(links.map((l) => [l.text, l.url]), [
    ['the docs', 'https://example.com/docs'],
    ['ref', 'https://ref.example/page'],
    ['https://auto.example/x', 'https://auto.example/x'],
    ['cell', 'https://cell.example'],
  ]);
  assert.deepEqual(links.map((l) => l.start), links.map((l) => l.start).sort((a, b) => a - b), 'document order');
  assert.equal(new TextDecoder().decode(new TextEncoder().encode(md).subarray(links[0]!.start, links[0]!.end)), '[the docs](https://example.com/docs "t")');
});

test('linksOf: the real destination is kept and a text that names another host is labelled', () => {
  const [lookalike, honest, plain] = linksIn('[apple.com](https://xn--pple-43d.com/) [example.com](https://example.com/) [here](https://example.com/)');
  assert.equal(lookalike!.url, 'https://xn--pple-43d.com/');
  assert.ok(lookalike!.mismatch && lookalike!.mismatch.includes('xn--pple-43d.com'), String(lookalike!.mismatch));
  assert.equal(honest!.mismatch, null);
  assert.equal(plain!.mismatch, null);
});

const tree = (files: readonly string[], dirs: readonly string[], hidden: readonly string[] = []): StatFn => {
  const f = new Set(files);
  const d = new Set(dirs);
  return async (p) => (hidden.some((h) => p === h || p.startsWith(`${h}/`)) ? null : f.has(p) ? { isDir: false } : d.has(p) ? { isDir: true } : null);
};

test('resolveMentioned: found beside the document or in the repository root, not found when listed folders hold no such file', async () => {
  const stat = tree(['/repo/docs/a.md', '/repo/src/x.ts'], ['/repo', '/repo/docs', '/repo/src']);
  assert.equal(await resolveMentioned('./a.md', '/repo/docs/n.md', '/repo', null, stat), 'found', 'beside the note');
  assert.equal(await resolveMentioned('./gone.md', '/repo/docs/n.md', '/repo', null, stat), 'not-found');
  assert.equal(await resolveMentioned('src/x.ts', '/repo/docs/n.md', '/repo', null, stat), 'found', 'found from the root');
  assert.equal(await resolveMentioned('../src/x.ts', '/repo/docs/n.md', '/repo', null, stat), 'found', 'found beside the document');
  assert.equal(await resolveMentioned('src/gone.ts', '/repo/n.md', '/repo', null, stat), 'not-found');
  assert.equal(await resolveMentioned('docs/a.md', '/repo/docs/n.md', '/repo', null, stat), 'found');
});

test('resolveMentioned: a path under a symlinked or deny-listed folder is not checked, never called missing', async () => {
  // `stat` answers null for the link itself and for the folder behind it.
  const stat = tree([], ['/repo', '/repo/docs'], ['/repo/linked', '/repo/node_modules']);
  assert.equal(await resolveMentioned('linked/deep/x.md', '/repo/docs/n.md', '/repo', null, stat), 'not-checked');
  assert.equal(await resolveMentioned('node_modules/p/x.js', '/repo/docs/n.md', '/repo', null, stat), 'not-checked');
  assert.equal(await resolveMentioned('docs/missing.md', '/repo/n.md', '/repo', null, stat), 'not-found', 'a real folder with no such file');
  // From /repo/docs the same name is also tried under /repo/docs/docs, whose folder is not listed: nothing is claimed.
  assert.equal(await resolveMentioned('docs/missing.md', '/repo/docs/n.md', '/repo', null, stat), 'not-checked');
  const throwing: StatFn = async () => { throw new Error('refused'); };
  assert.equal(await resolveMentioned('docs/x.md', '/repo/docs/n.md', '/repo', null, throwing), 'not-checked');
});

test('resolveMentioned: ~/ is looked for in the home folder, and with no known home it is not checked', async () => {
  const stat = tree(['/Users/me/.config/x.toml'], ['/Users/me', '/Users/me/.config']);
  assert.equal(await resolveMentioned('~/.config/x.toml', '/repo/n.md', '/repo', '/Users/me', stat), 'found');
  assert.equal(await resolveMentioned('~/.config/y.toml', '/repo/n.md', '/repo', '/Users/me', stat), 'not-found');
  assert.equal(await resolveMentioned('~/.config/x.toml', '/repo/n.md', '/repo', null, stat), 'not-checked');
});

test('resolveMentioned: a path that climbs out of the repository root is not looked at', async () => {
  let asked = 0;
  const stat: StatFn = async () => { asked++; return null; };
  assert.equal(await resolveMentioned('../../etc/passwd.txt', '/repo/n.md', '/repo', null, stat), 'not-checked');
  assert.equal(asked, 0, 'nothing outside the document\'s folder and root is stat-ed');
});

test('linksModelOf never reads the AST of a store that has not been parsed', () => {
  const text = 'print("x")  # see `src/a.ts` and [not a link](https://x.example)\n';
  const store = {
    parsed: () => false,
    snapshot: () => ({
      buffer: { text },
      get ast(): never { throw new Error('the parse was forced'); },
    }),
  } as unknown as DocumentStore;
  const model = linksModelOf(store);
  assert.equal(model.links, null, 'Links are listed for Markdown');
  assert.deepEqual(model.paths, ['src/a.ts'], 'the paths still come from the bytes');
});

test('linksModelOf reads a parsed store\'s AST', () => {
  const text = 'A [link](https://x.example) and `src/a.ts`.\r\n';
  const ast = parseMarkdown(text);
  const store = { parsed: () => true, snapshot: () => ({ buffer: { text }, ast }) } as unknown as DocumentStore;
  const model = linksModelOf(store);
  assert.equal(model.links!.length, 1);
  assert.deepEqual(model.paths, ['src/a.ts']);
});
