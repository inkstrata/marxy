// The kind, decided once at open (K-05a, ADR-0060 items 6 to 9): every pane root carries
// `data-marxy-kind`, decided from the file's own first bytes with the reader's `[[kind]]` rules and
// *show as*; kept through live reloads; decided again only when the file is opened again. The app boots
// on the shipped skeleton over the memory shell (config.toml is `/config`, kinds.json `/data/kinds.json`).
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);
after(() => closeHarness());

async function withPage(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
    await fn(page);
  } finally {
    await browser.close();
  }
}

const prose = '# Title\n\nA paragraph of plain prose, long enough to be a document and no more than that.\n';
const speakers = '# Chat\n\n## You\n\nHello there.\n\n## Assistant\n\nHello, how can I help?\n';

/** One fixture per kind: [path, text, kind]. A kind detection needs a long prefix for is reached by a rule or *show as* below. */
const perKind = [
  ['/r/a.md', prose, 'article'],
  ['/r/plan.md', '# Plan\n\n## Summary\n\nx\n\n## Risks\n\ny\n\n## Next steps\n\nz\n', 'report'],
  ['/r/README.md', prose, 'readme'],
  ['/r/CHANGELOG.md', '# Changelog\n\n## 1.0.0\n\n- first\n', 'changelog'],
  ['/r/api.md', '# API\n\n## Parameters\n\nx\n\n## Returns\n\ny\n', 'docs'],
  ['/r/chat.md', speakers, 'transcript'],
  ['/r/2026-10-11.md', '# Tuesday\n\nWent for a walk.\n', 'notes'],
  ['/r/main.rs', 'fn main() {}\n', 'code'],
  ['/r/d.json', '{"a": 1}\n', 'data'],
  ['/r/build.log', '2026-10-11 10:00:00 INFO start\n2026-10-11 10:00:01 WARN slow\n2026-10-11 10:00:02 ERROR boom\n', 'log'],
  ['/r/s.term', '$ ls\na b\n$ pwd\n/r\n', 'terminal'],
  ['/r/x.diff', '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n', 'diff'],
  ['/r/p.html', '<p>hi</p>\n', 'html'],
  // book: reached by a reader's rule (its shape needs a long prefix).
  ['/ruled/novel.md', prose, 'book'],
];

const config = '[[kind]]\nglob = "/ruled/**"\nis = "book"\n\n[[kind]]\nglob = "/r/rule-*.md"\nis = "report"\n';

const kindsJson = (map) => JSON.stringify({ version: 1, kinds: map });

/** The left pane's root: its `data-marxy-kind`, its mode and the full DetectResult the open path holds. */
const left = (page) =>
  page.evaluate(() => {
    const pane = window.__marxyHandle.panes().panes[0];
    const d = pane.content.detected();
    return {
      attribute: pane.host.getAttribute('data-marxy-kind'),
      method: pane.kind(),
      mode: pane.host.getAttribute('data-marxy-mode'),
      kind: d?.kind ?? null,
      reasons: d?.reasons.length ?? 0,
      path: pane.path(),
    };
  });

test('a fixture per kind sets the attribute to that kind, and the open path keeps the full DetectResult', () =>
  withPage(async (page) => {
    const files = Object.fromEntries([...perKind.map(([p, t]) => [p, t]), ['/config', config]]);
    await bootTwoPanes(page, { files, open: ['/r/a.md'] });
    for (const [path, , kind] of perKind) {
      await page.evaluate((p) => window.__marxyHandle.open(p), path);
      const seen = await left(page);
      assert.equal(seen.path, path);
      assert.equal(seen.attribute, kind, path);
      assert.equal(seen.kind, kind, `${path}: the DetectResult's kind is the attribute's`);
      assert.equal(seen.method, kind, `${path}: Pane.kind() reads the attribute`);
      assert.ok(seen.reasons >= 1, `${path}: the reasons are kept`);
    }
  }));

test('a [[kind]] rule and a show-as entry each win over detection, in that order (the path-only detector would fail this)', () =>
  withPage(async (page) => {
    const files = {
      '/config': config,
      // README.md is a readme by name; the rule says report; show as says transcript for the one file.
      '/r/rule-1.md': prose,
      '/r/rule-2.md': prose,
      '/r/README.md': prose,
      '/data/kinds.json': kindsJson({ '/r/rule-2.md': 'transcript', '/r/README.md': 'docs' }),
    };
    await bootTwoPanes(page, { files, open: ['/r/README.md'] });
    assert.equal((await left(page)).attribute, 'docs', 'show as beats detection (README is a readme by name)');
    await page.evaluate(() => window.__marxyHandle.open('/r/rule-1.md'));
    assert.equal((await left(page)).attribute, 'report', 'a rule beats detection (a prose file is an article)');
    await page.evaluate(() => window.__marxyHandle.open('/r/rule-2.md'));
    assert.equal((await left(page)).attribute, 'transcript', 'show as beats the rule that also matches');
  }));

test('a missing, corrupt or unreadable kinds.json and config.toml leave detection alone', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files: { '/r/a.md': prose, '/config': '[[[ not toml', '/data/kinds.json': 'not json' }, open: ['/r/a.md'] });
    assert.equal((await left(page)).attribute, 'article');
  }));

test('a reload of a growing file keeps its kind; opening it again decides again', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files: { '/r/g.md': prose }, open: ['/r/g.md'] });
    assert.equal((await left(page)).attribute, 'article');
    const reloaded = await page.evaluate(async ({ next }) => {
      const h = window.__marxyHandle;
      const count = () => h.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'live_reload').length;
      const before = count();
      await h.shell.writeFileAtomic('/r/g.md', new TextEncoder().encode(next));
      h.shell.emit([{ kind: 'modified', path: '/r/g.md' }]);
      for (let i = 0; i < 500 && count() === before; i++) await new Promise((r) => setTimeout(r, 10));
      return count() > before;
    }, { next: prose + '\n' + speakers });
    assert.ok(reloaded, 'the live reload ran');
    assert.ok(await page.evaluate(() => document.getElementById('doc').textContent.includes('Hello, how can I help?')), 'the new text is on the page');
    const kept = await left(page);
    assert.equal(kept.attribute, 'article', 'speaker headings arrived by reload; the kind did not move');
    assert.equal(kept.kind, 'article');
    await page.evaluate(() => window.__marxyHandle.open('/r/a.md'));
    await page.evaluate(() => window.__marxyHandle.open('/r/g.md'));
    assert.equal((await left(page)).attribute, 'transcript', 'opened again, the file is decided again');
  }));

test('an extension-less README family opens Rendered; other extension-less files and formats open as before', () =>
  withPage(async (page) => {
    const files = {
      '/r/a.md': prose,
      '/r/README': prose,
      '/r/CONTRIBUTING': prose,
      '/r/CHANGELOG': '# Changes\n\n- one\n',
      '/r/CHANGES': '# Changes\n\n- one\n',
      '/r/HISTORY': '# Changes\n\n- one\n',
      '/r/LICENSE': 'MIT License\n',
      '/r/README.rst': 'Title\n=====\n',
    };
    await bootTwoPanes(page, { files, open: ['/r/a.md'] });
    const expected = [
      ['/r/README', 'rendered', 'readme'],
      ['/r/CONTRIBUTING', 'rendered', 'readme'],
      ['/r/CHANGELOG', 'rendered', 'changelog'],
      ['/r/CHANGES', 'rendered', 'changelog'],
      ['/r/HISTORY', 'rendered', 'changelog'],
      ['/r/LICENSE', 'source', 'code'],
      ['/r/README.rst', 'source', 'code'],
    ];
    for (const [path, mode, kind] of expected) {
      await page.evaluate((p) => window.__marxyHandle.open(p), path);
      const seen = await left(page);
      assert.equal(seen.mode, mode, `${path} opens ${mode}`);
      assert.equal(seen.attribute, kind, path);
    }
  }));

test('each pane has its own kind, and a failed open leaves none', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files: { '/r/a.md': prose, '/r/main.rs': 'fn main() {}\n' }, open: ['/r/a.md', '/r/main.rs'] });
    const kinds = await page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => [p.kind(), p.host.getAttribute('data-marxy-kind')]));
    assert.deepEqual(kinds, [['article', 'article'], ['code', 'code']]);
    await page.evaluate(() => window.__marxyHandle.open('/r/missing.md'));
    assert.equal((await left(page)).attribute, null);
  }));
