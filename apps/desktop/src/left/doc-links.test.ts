// Pointing here: a content search that fails is said, not remembered as "no file names this one". The links and written
// paths of a file: read from the store's parse, once per version of its text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppHandle } from '../app-types.ts';
import type { Document } from '@marxy/core';
import { openDocumentStore, type DocumentStore } from '../document/store.ts';
import { linksOfPane, pointingHere } from './doc-links.ts';
import type { PaneView } from './types.ts';

test('a failed search says so once, and the next look at the same revision searches again', async () => {
  let calls = 0;
  let redraws = 0;
  const handle = {
    index: { entries: () => [{ path: '/r/a.md' }, { path: '/r/t.md' }], roots: () => ['/r'] },
    panes: () => ({ panes: [] }),
    shell: {
      searchContent: async () => {
        calls++;
        if (calls === 1) throw Object.assign(new Error('search refused'), { code: 'io' });
        return { hits: [{ path: '/r/a.md', line: 3, preview: 'see t.md here', matchStart: 4, matchEnd: 8 }] };
      },
    },
  } as unknown as AppHandle;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  assert.equal(pointingHere(handle, '/r/t.md', 7, () => redraws++), null);
  await tick();
  assert.equal(redraws, 1);
  assert.equal(pointingHere(handle, '/r/t.md', 7, () => redraws++), 'failed');
  assert.equal(pointingHere(handle, '/r/t.md', 7, () => redraws++), null, 'looked for again');
  await tick();
  assert.equal(calls, 2);
  assert.deepEqual(pointingHere(handle, '/r/t.md', 7, () => redraws++), [{ from: '/r/a.md', line: 3, w: 't.md' }]);
});

// ---- Links read the store's parse, once per version --------------------------------------------------------------


const io = { writeFileAtomic: async () => {} };
const enc = new TextEncoder();

function harness(files: string[], store: DocumentStore) {
  const index = [...files];
  const handle = { index: { entries: () => index.map((path) => ({ path })), roots: () => ['/r'] }, panes: () => ({ panes: [] }) } as unknown as AppHandle;
  const pane = { content: { viewer: () => null, store: () => store }, view: { mode: 'rendered' } } as unknown as PaneView;
  return { handle, pane, index };
}

/** The store, with how many times something asked it for its text's parse. */
function counted(store: DocumentStore): { store: DocumentStore; asks: () => number } {
  let n = 0;
  return {
    store: new Proxy(store, {
      get(t, k) {
        if (k === 'textParse') return () => (n++, t.textParse());
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    }),
    asks: () => n,
  };
}

test('the written paths come from the store’s parse of the file, not from a parse of its own', () => {
  const text = 'See `docs/plan.md` for the plan.\n';
  const bytes = enc.encode(text);
  // A parse that holds the whole file as one code block: read from it, the file names no path; parsed again, it would name one.
  const src = { file: '/r/a.md', start: 0, end: bytes.length };
  const ast = { type: 'document', src, children: [{ type: 'codeBlock', src, lang: null, meta: null, value: text }] } as unknown as Document;
  const store = openDocumentStore(io, '/r/a.md', bytes, { ast, nodeMap: new Map() });
  const { handle, pane } = harness(['/r/a.md', '/r/docs/plan.md'], store);
  assert.deepEqual(linksOfPane(handle, pane, '/r/a.md')?.all, []);
});

test('a file opening elsewhere places the links again but does not read the text again; an edit does', async () => {
  const text = '# A\n\nSee `docs/plan.md` and `docs/later.md`.\n\n```\n`docs/code.md`\n```\n';
  const { store, asks } = counted(openDocumentStore(io, '/r/a.md', enc.encode(text)));
  const { handle, pane, index } = harness(['/r/a.md', '/r/docs/plan.md'], store);
  assert.deepEqual(linksOfPane(handle, pane, '/r/a.md')?.all.map((l) => l.w), ['docs/plan.md'], 'a path in code is not a mention');
  assert.equal(asks(), 1);
  index.push('/r/docs/later.md');
  assert.deepEqual(linksOfPane(handle, pane, '/r/a.md')?.all.map((l) => l.w), ['docs/plan.md', 'docs/later.md'], 'the new file is found');
  assert.equal(asks(), 1, 'the text was not read again for a file that came');
  await store.apply({ range: { file: '/r/a.md', start: 0, end: 3 }, replacement: '# B', label: 'edit' });
  linksOfPane(handle, pane, '/r/a.md');
  assert.equal(asks(), 2, 'a new version is read again');
});

test('a Markdown file with CRLF line ends has its written paths read from its parse, code left out', () => {
  const text = 'See `docs/plan.md`.\r\n\r\n```\r\n`docs/code.md`\r\n```\r\n\r\nAnd `docs/later.md`.\r\n';
  const store = openDocumentStore(io, '/r/c.md', enc.encode(text));
  assert.equal(store.textParse(), null, 'the store lends no LF pair for CRLF text');
  const { handle, pane } = harness(['/r/c.md', '/r/docs/plan.md', '/r/docs/code.md', '/r/docs/later.md'], store);
  assert.deepEqual(linksOfPane(handle, pane, '/r/c.md')?.all.map((l) => [l.w, l.line]), [['docs/plan.md', 1], ['docs/later.md', 7]]);
});
