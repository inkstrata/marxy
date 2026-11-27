// "Is this Markdown" is one question asked of the registry (`isMarkdownPath`): Source structure, tab width, the minimap,
// Export, the Studio and links follow a new Markdown row (`.qmd`) with no list of their own to grow.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import type { AppHandle } from '../app-types.ts';
import { pointingHere } from '../left/doc-links.ts';
import { localLinkTarget } from '../selection/view.ts';
import { structureKindFor } from './structure.ts';
import { updateTabWidthResolver } from './tab-width.ts';

const src = new URL('../', import.meta.url);

test('Source structure: a Markdown page has sections from the parse, any other file paragraphs', () => {
  for (const [path, want] of [
    ['/r/a.md', 'markdown'], ['/r/a.mdx', 'markdown'], ['/r/report.qmd', 'markdown'], ['/r/a.Rmd', 'markdown'], ['/r/.cursorrules', 'markdown'],
    ['/r/a.txt', 'text'], ['/r/README', 'text'], ['/r/a.ts', 'text'], ['/r/a.r', 'text'], ['/r/a.zzz', 'text'],
  ] as const) assert.equal(structureKindFor(path), want, path);
});

test('a link opens inside Marxy to a Markdown page or plain text; anything else is refused unless it is followed beside', () => {
  for (const [href, opens] of [
    ['b.md', true], ['b.markdown', true], ['b.mdx', true], ['b.txt', true], ['b.qmd', true], ['b.Rmd', true], ['b.mkdn', true], ['llms.txt', true],
    ['b.ts', false], ['b.rst', false], ['b.png', false], ['b.zzz', false], ['NOTICE', false],
  ] as const) {
    const got = localLinkTarget('/r/a.md', href, '/r');
    assert.equal('target' in got, opens, href);
    if (!opens) assert.deepEqual(got, { refused: 'Only markdown documents open inside Marxy.' }, href);
  }
  for (const href of ['b.ts', 'NOTICE', 'LICENSE.mit', 'COPYING.LESSER']) assert.ok('target' in localLinkTarget('/r/a.md', href, '/r', { allowSource: true }), `${href} beside`);
});

test('tab width: a Markdown page keeps the default and reads no .editorconfig; any other file looks for one', async () => {
  for (const [path, reads] of [['/r/q/report.qmd', false], ['/r/m/a.md', false], ['/r/t/main.ts', true], ['/r/n/NOTICE', true]] as const) {
    const asked: string[] = [];
    const shell = { readFile: async (p: string): Promise<Uint8Array> => { asked.push(p); throw new Error('none'); } };
    // A folder each: the walk is kept per folder. The editor's own module needs a window; what matters here happened
    // before it is reached.
    await updateTabWidthResolver(path, shell).catch(() => undefined);
    assert.equal(asked.some((p) => p.endsWith('.editorconfig')), reads, path);
  }
});

test('Pointing here searches every Markdown page and prose name, and the text it searched before', async () => {
  const paths = ['/r/a.md', '/r/b.qmd', '/r/c.Rmd', '/r/NOTICE', '/r/NEWS', '/r/llms.txt', '/r/x.ts', '/r/y.conf', '/r/z.png', '/r/w.zzz', '/r/target.md'];
  let searched: readonly string[] = [];
  const handle = {
    index: { entries: () => paths.map((path) => ({ path })), roots: () => ['/r'] },
    panes: () => ({ panes: [] }),
    shell: { searchContent: async (files: readonly string[]) => { searched = files; return { hits: [] }; } },
  } as unknown as AppHandle;
  pointingHere(handle, '/r/target.md', 1, () => undefined);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual([...searched].sort(), ['/r/NEWS', '/r/NOTICE', '/r/a.md', '/r/b.qmd', '/r/c.Rmd', '/r/llms.txt', '/r/x.ts', '/r/y.conf']);
});

test('no Markdown extension list is left in the app: the minimap, Export and the Studio ask the registry too', () => {
  const files = (dir: URL, at = ''): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(new URL(`${e.name}/`, dir), `${at}${e.name}/`) : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [`${at}${e.name}`] : []);
  const lists = files(src).filter((f) => /md\|markdown|markdown\|mdown|mdown\|mkd/.test(readFileSync(new URL(f, src), 'utf8')));
  // Pointing here keeps its wider list of text worth searching, beside the question (`linksFrom`).
  assert.deepEqual(lists, ['left/doc-links.ts']);
  for (const f of ['proposals/minimap.ts', 'left/panels/export.ts', 'studio/studio.ts', 'source/structure.ts', 'source/tab-width.ts']) {
    assert.match(readFileSync(new URL(f, src), 'utf8'), /isMarkdownPath\(/, f);
  }
});
