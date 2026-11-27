// one table. Every extension the old tables listed resolves the same, and the Tauri associations follow it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Kind } from '../contracts/kinds.ts';
import { entryFromCandidate } from '../index-model/entry.ts';
import { classify } from '../index-model/kinds.ts';
import { codeLanguageOf, isCodeFile } from '../parse/code.ts';
import { ROW_ALIASES } from './aliases.ts';
import { detectKind } from './detect.ts';
import { BINARY_FILE_TYPE, FILE_TYPES, PAGE_VIEWERS, UNKNOWN_FILE_TYPE, contentTypeFor, fenceWord, fileTypeFor, fileTypeOf, guessedFromBytes, isMarkdownPath, isSecretName, langOf, openWithExtensions, langOfFence, noteContent, parserOf, searchSkipReason, tableExtensions, viewerOf, wantsContent, type FileTypeRow } from './registry.ts';
import { clearShowAs, detectFileKind, emptyKindsEnvelope, setShowAs } from './show-as.ts';
import { LANGUAGE_TO_GRAMMAR } from '../highlight/languages.generated.ts';

// The allow-list as kinds.ts held it before the registry.
const OLD_MARKDOWN = ['md', 'mdx', 'markdown', 'mdown', 'mkd'];
const OLD_TEXT = ['txt', 'text'];
const OLD_SOURCE = 'ts tsx js jsx mjs cjs mts cts rs py go java kt kts c h cc cpp cxx hpp hh rb php swift sh bash zsh json toml yaml yml html htm xml sql graphql lua r ex exs hs vue svelte css scss log csv tsv jsonl'.split(' ');
// a log is read, not edited; its kind stays `source`, so the index and the Tauri associations are as they were.
const READ_FIRST = ['log', 'out', 'diff', 'patch', 'term', 'session'];
// Data opens in Read as its reading (a tree, records, a table), Source one action away.
const READ_AS_DATA = ['json', 'toml', 'yaml', 'yml', 'xml', 'csv', 'tsv', 'jsonl'];
// BY_EXT in apps/desktop/src/source/language.ts before the registry: extension -> CodeMirror id.
const OLD_CM: Record<string, string> = {
  md: 'markdown', markdown: 'markdown', mdx: 'markdown', txt: 'markdown', ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  mjs: 'javascript', cjs: 'javascript', rs: 'rust', py: 'python', css: 'css', json: 'json', yaml: 'yaml', yml: 'yaml', html: 'html', htm: 'html',
  // grammars added.
  go: 'go', java: 'java', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', sh: 'shell', bash: 'shell', zsh: 'shell', toml: 'toml',
};

test('every old allow-list extension keeps its kind and mode', () => {
  for (const [list, kind, mode] of [[OLD_MARKDOWN, 'markdown', 'rendered'], [OLD_TEXT, 'text', 'rendered'], [OLD_SOURCE, 'source', 'source']] as const) {
    for (const ext of list) {
      const t = fileTypeOf(`/r/file.${ext}`);
      assert.equal(t?.kind, kind, ext);
      assert.equal(t?.mode, READ_FIRST.includes(ext) || READ_AS_DATA.includes(ext) ? 'rendered' : mode, ext);
      assert.equal(classify(`/r/file.${ext}`), kind, ext);
    }
  }
  assert.equal(tableExtensions().length, OLD_MARKDOWN.length + OLD_TEXT.length + OLD_SOURCE.length + 8, '`.out`, `.diff` and `.patch`, `.term` and `.session`, and `.ndjson`, `.atom` and `.rss` are the extensions added since');
});

test('a .log and an .out open in Read, as logs; no other source file but data does', () => {
  for (const name of ['a.log', 'a.out', 'A.LOG', '/r/dir.d/build.out']) {
    const t = fileTypeOf(`/r/${name}`);
    assert.equal(t?.mode, 'rendered', name);
    assert.equal(t?.kind, 'source', name);
    assert.equal(t?.lang, 'log', name);
    assert.equal(t?.searchable, true, name);
  }
  for (const ext of OLD_SOURCE.filter((e) => !READ_FIRST.includes(e) && !READ_AS_DATA.includes(e))) assert.equal(fileTypeOf(`/r/f.${ext}`)?.mode, 'source', ext);
});

test('a .diff and a .patch open in Read, as diffs; on main neither was in the table', () => {
  for (const name of ['a.diff', 'x.patch', 'A.PATCH', '/r/dir.d/change.diff']) {
    const t = fileTypeOf(`/r/${name}`);
    assert.equal(t?.mode, 'rendered', name);
    assert.equal(t?.kind, 'source', name);
    assert.equal(t?.lang, 'diff', name);
    assert.equal(t?.searchable, true, name);
    assert.equal(classify(`/r/${name}`), 'source', name);
  }
});

test('a .term and a .session open in Read, as terminal sessions; on main neither was in the table', () => {
  for (const name of ['a.term', 'x.session', 'A.SESSION', '/r/dir.d/release-session.term']) {
    const t = fileTypeOf(`/r/${name}`);
    assert.equal(t?.mode, 'rendered', name);
    assert.equal(t?.kind, 'source', name);
    assert.equal(t?.lang, 'terminal', name);
    assert.equal(t?.searchable, true, name);
  }
});

test('every old BY_EXT extension keeps its CodeMirror id, and Go, C, C++, Java, shell and TOML are added; only .mdown, .mkd and .text gain one (as .txt has)', () => {
  for (const ext of tableExtensions()) assert.equal(fileTypeOf(`/r/f.${ext}`)?.cm, OLD_CM[ext] ?? (['mdown', 'mkd', 'text'].includes(ext) ? 'markdown' : undefined), ext);
});

test('exact names and the extension-less text family', () => {
  assert.equal(classify('/r/theme.css'), 'theme');
  assert.equal(classify('/r/theme.toml'), 'theme');
  assert.equal(classify('/r/Makefile'), 'source');
  assert.equal(classify('/r/Dockerfile'), 'source');
  assert.equal(fileTypeOf('/r/Makefile')?.mode, 'source');
  for (const n of ['README', 'readme', 'CONTRIBUTING', 'CHANGELOG', 'CHANGES', 'HISTORY']) {
    assert.equal(fileTypeOf(`/r/${n}`)?.mode, 'rendered', n);
    assert.equal(classify(`/r/${n}`), 'text', `${n} is listed in the index`);
  }
  // LICENSE, NOTES, TODO and AUTHORS are text now, as README is.
  for (const n of ['LICENSE', 'NOTES', 'TODO', 'AUTHORS']) assert.equal(fileTypeOf(`/r/${n}`)?.kind, 'text', n);
  for (const n of ['READMEFIRST', '.md', 'toString', 'constructor', '__proto__']) assert.equal(fileTypeOf(`/r/${n}`), undefined, n);
});

test('the Tauri file associations list what the table calls markdown, text and source', () => {
  const conf = JSON.parse(readFileSync(new URL('../../../../apps/desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const assoc = conf.bundle.fileAssociations as { ext: string[] }[];
  const listed = assoc.flatMap((a) => a.ext).sort();
  const wanted = tableExtensions().sort();
  assert.deepEqual(listed, wanted);
});

// Windows hands Markdown to Tauri's own association (it takes the default) and offers every other type Marxy has a page
// for in "Open with" from the installer hooks, which never write an extension's default.
test('on Windows the Markdown association and the installer hooks together offer every type Marxy has a page for', () => {
  const dir = new URL('../../../../apps/desktop/src-tauri/', import.meta.url);
  const base = JSON.parse(readFileSync(new URL('tauri.conf.json', dir), 'utf8')).bundle;
  const win = JSON.parse(readFileSync(new URL('tauri.windows.conf.json', dir), 'utf8')).bundle;
  const hooks = readFileSync(new URL(base.windows.nsis.installerHooks, dir), 'utf8');
  const offered = [...hooks.matchAll(/^\s*!insertmacro \$\{ACTION\} "([^"]+)"/gm)].map((m) => m[1]);
  const markdown = (win.fileAssociations as { ext: string[] }[]).flatMap((a) => a.ext);
  assert.deepEqual([...markdown, ...offered].sort(), openWithExtensions().sort());
  assert.deepEqual(markdown, (base.fileAssociations as { ext: string[] }[])[0].ext);
  for (const e of tableExtensions()) assert.ok(markdown.includes(e) || offered.includes(e), `${e} is claimed elsewhere but not offered on Windows`);
  for (const e of ['pdf', 'png', 'heic', 'docx', 'xlsx', 'epub', 'zip', 'mp4', 'msg', 'ipynb', 'cs', 'ps1', 'ini']) assert.ok(offered.includes(e), e);
  for (const e of ['exe', 'dll', 'lnk', 'pem']) assert.equal(offered.includes(e), false, `${e} gets only the card`);
  assert.equal(/WriteReg\w+\s+HKCU\s+"Software\\Classes\\\.\$\{EXT\}"\s+""/.test(hooks), false, 'no extension default is written');
});

// One registry, every surface. Each row's sample paths resolve to the row, and open (detectFileKind), the index
// (classify, entryFromCandidate), Show as (a choice set and forgotten), the icon's language and the parse all agree with it.
const samples = (row: FileTypeRow): string[] => [
  ...(row.match.ext ?? []).flatMap((e) => [`/r/sample.${e}`, `/r/Sample.${e.toUpperCase()}`]),
  ...(row.match.name ?? []).flatMap((n) => [`/r/${n}`, `/r/${n.toUpperCase()}`]),
  ...(row.match.glob ?? []).map((g) => `/r/${g.replace(/[*?]/g, 'x')}`),
];
const none = new Uint8Array();

test('every registry row resolves the same in open, the index, Show as, the icon and the parse', () => {
  for (const row of FILE_TYPES) {
    const paths = samples(row);
    // MATLAB and Prolog have no name of their own: only content reaches them (content.test.ts).
    if (['matlab', 'prolog'].includes(row.id)) continue;
    assert.ok(paths.length > 0, row.id);
    for (const path of paths) {
      const at = `${row.id}: ${path}`;
      // A credential name marks the row it gets (searchable false) without changing which row it is.
      if (isSecretName(path)) {
        assert.equal(fileTypeOf(path)?.id, row.id, at);
        continue;
      }
      assert.equal(fileTypeOf(path), row, at);
      assert.equal(detectFileKind({ path, head: none, choices: emptyKindsEnvelope() }).kind, row.readerKind, `open, ${at}`);
      assert.equal(detectKind({ path, head: none }).kind, row.readerKind, `detect, ${at}`);
      const entry = entryFromCandidate('/r', { path, relativePath: path.slice(3), mtimeMs: 0, size: 0 });
      assert.equal(entry.readerKind, row.readerKind, `index, ${at}`);
      assert.equal(classify(path), row.kind, `index, ${at}`);
      const other: Kind = row.readerKind === 'code' ? 'article' : 'code';
      const set = setShowAs(emptyKindsEnvelope(), path, other);
      assert.ok(set.ok, at);
      assert.equal(detectFileKind({ path, head: none, choices: set.envelope }).kind, other, `Show as, ${at}`);
      const cleared = clearShowAs(set.envelope, path);
      assert.equal(detectFileKind({ path, head: none, choices: cleared }).kind, row.readerKind, `Show as forgotten, ${at}`);
      assert.equal(langOf(path), row.lang, `icon language, ${at}`);
      assert.equal(parserOf(path), row.parser, `parser, ${at}`);
      assert.equal(isCodeFile(path), row.parser === 'code', `isCodeFile, ${at}`);
      assert.equal(codeLanguageOf(path), row.lang, `codeLanguageOf, ${at}`);
    }
  }
});

test('.cs, .rst and .ini read as code or text, never as Markdown; unknown text is plain text as written', () => {
  for (const path of ['/r/Program.cs', '/r/index.rst', '/r/setup.ini', '/r/a.zzz', '/r/INSTALL', '/r/.zzzrc']) {
    assert.notEqual(parserOf(path), 'markdown', path);
    assert.notEqual(fileTypeFor(path).reading, 'page', path);
  }
  assert.equal(langOf('/r/Program.cs'), 'csharp');
  assert.equal(langOf('/r/setup.ini'), 'ini');
  assert.equal(parserOf('/r/index.rst'), 'text');
  assert.equal(fileTypeFor('/r/a.zzz'), UNKNOWN_FILE_TYPE);
  assert.equal(UNKNOWN_FILE_TYPE.parser, 'text');
  assert.equal(UNKNOWN_FILE_TYPE.mode, 'source');
});

test('plain text the reader chose to read as a prose kind is parsed as Markdown; code never is', () => {
  assert.equal(parserOf('/r/index.rst', 'article'), 'markdown');
  assert.equal(parserOf('/r/a.zzz', 'readme'), 'markdown');
  assert.equal(parserOf('/r/a.zzz', 'code'), 'text');
  assert.equal(parserOf('/r/Program.cs', 'article'), 'code');
  assert.equal(parserOf('/r/data.csv', 'article'), 'text');
});

test('language ids are Shiki grammar ids, and a fence names the same id its file would', () => {
  for (const [fence, id] of [['rs', 'rust'], ['rust', 'rust'], ['bash', 'shellscript'], ['sh', 'shellscript'], ['ts', 'typescript'], ['py', 'python'], ['cs', 'csharp'], ['C#', 'csharp'], ['golang', 'go'], ['Dockerfile', 'docker'], ['mermaid', 'mermaid']] as const) {
    assert.equal(langOfFence(fence), id, fence);
  }
  for (const row of FILE_TYPES) if (row.lang) assert.equal(langOfFence(row.lang), row.lang, row.id);
});

test('every language id the registry gives a file is a grammar on the allow-list, so Read and Source colour it', () => {
  // `terminal` is the app's own reading, with no grammar.
  const own = new Set(['terminal']);
  for (const row of FILE_TYPES) {
    if (row.lang === undefined || own.has(row.lang)) continue;
    assert.ok(LANGUAGE_TO_GRAMMAR[row.lang], `${row.id}: ${row.lang} is not on the grammar allow-list`);
  }
  // The extensions of the grammars added after the first set, and those of the languages no mode coloured before it.
  for (const [ext, grammar] of [
    ['rb', 'ruby'], ['php', 'php'], ['lua', 'lua'], ['r', 'r'], ['ex', 'elixir'], ['hs', 'haskell'], ['vue', 'vue'],
    ['svelte', 'svelte'], ['scss', 'scss'], ['graphql', 'graphql'], ['cs', 'csharp'], ['zig', 'zig'], ['ps1', 'powershell'],
    ['tf', 'terraform'], ['tfvars', 'terraform'], ['hcl', 'hcl'], ['scala', 'scala'], ['clj', 'clojure'], ['jl', 'julia'],
  ] as const) {
    assert.equal(LANGUAGE_TO_GRAMMAR[langOf(`a.${ext}`)!], grammar, ext);
  }
  assert.equal(LANGUAGE_TO_GRAMMAR[langOf('Makefile')!], 'make');
  assert.equal(LANGUAGE_TO_GRAMMAR[langOf('src/CMakeLists.txt')!], 'cmake');
  // A grammar off the allow-list (copyleft, or no licence found) is no row's language.
  for (const row of FILE_TYPES) assert.ok(!['glsl', 'tcl', 'dax', 'nginx', 'org', 'ada', 'racket', 'gnuplot', 'ahk2'].includes(row.lang ?? ''), row.id);
});

test('Markdown under other names is a Markdown page, in Read first, never claimed in the associations', () => {
  for (const [path, id, lang] of [
    ['/r/report.qmd', 'quarto', 'markdown'], ['/r/Analysis.Rmd', 'r-markdown', 'markdown'], ['/r/a.rmarkdown', 'r-markdown', 'markdown'],
    ['/r/a.mkdn', 'markdown-alias', 'markdown'], ['/r/a.mkdown', 'markdown-alias', 'markdown'], ['/r/a.mdwn', 'markdown-alias', 'markdown'],
    ['/r/a.markdn', 'markdown-alias', 'markdown'], ['/r/a.mdtxt', 'markdown-alias', 'markdown'], ['/r/a.mdtext', 'markdown-alias', 'markdown'],
    ['/r/a.livemd', 'markdown-alias', 'markdown'], ['/r/git.1.ronn', 'markdown-alias', 'markdown'],
    ['/r/.cursor/rules/style.mdc', 'mdc', 'mdc'],
    ['/r/llms.txt', 'markdown-name', 'markdown'], ['/r/LLMS-FULL.TXT', 'markdown-name', 'markdown'], ['/r/.cursorrules', 'markdown-name', 'markdown'],
    ['/r/.windsurfrules', 'markdown-name', 'markdown'], ['/r/.clinerules', 'markdown-name', 'markdown'],
  ] as const) {
    const t = fileTypeOf(path);
    assert.equal(t?.id, id, path);
    assert.equal(t?.kind, 'markdown', path);
    assert.equal(t?.mode, 'rendered', path);
    assert.equal(parserOf(path), 'markdown', path);
    assert.equal(langOf(path), lang, path);
    assert.equal(t?.associated, false, path);
    assert.equal(isMarkdownPath(path), true, path);
  }
  assert.equal(fileTypeOf('/r/notes.txt')?.id, 'text', 'only llms.txt is Markdown by its name; other .txt stays plain text');
});

test('isMarkdownPath is the row\'s kind, as the head corrects it', () => {
  for (const [path, want] of [
    ['/r/a.md', true], ['/r/a.MDX', true], ['/r/a.mdown', true], ['/r/a.qmd', true], ['/r/a.Rmd', true], ['/r/.clinerules', true],
    ['/r/a.txt', false], ['/r/README', false], ['/r/NOTICE', false], ['/r/a.ts', false], ['/r/a.r', false], ['/r/index.rst', false],
    ['/r/a.adoc', false], ['/r/a.zzz', false], ['/r/llms.txt.bak', false],
  ] as const) assert.equal(isMarkdownPath(path), want, path);
  const marked = '/r/draft.zzz';
  noteContent(marked, { class: 'text', modeline: 'markdown' });
  assert.equal(isMarkdownPath(marked), true, 'a modeline that says Markdown');
  noteContent(marked, null);
});

test('a braced fence (Quarto, R Markdown, Pandoc) names the language inside its brace; an unbraced one is as before', () => {
  for (const [info, word, id] of [
    ['{r}', 'r', 'r'], ['{r setup, include=FALSE}', 'r', 'r'], ['{r,echo=FALSE}', 'r', 'r'], ['{r', 'r', 'r'], ['{python}', 'python', 'python'],
    ['{.python .numberLines}', 'python', 'python'], ['{.python', 'python', 'python'], ['{=html}', 'html', 'html'], ['{#fig-a .py}', 'py', 'python'],
    ['{ojs}', 'ojs', 'ojs'], ['{mermaid}', 'mermaid', 'mermaid'], ['{}', '', ''], ['{#only-an-id}', '', ''],
    ['rs', 'rs', 'rust'], ['js{1,3}', 'js{1,3}', 'js{1,3}'], [' Rust ', ' Rust ', 'rust'], ['python title="a.py"', 'python title="a.py"', 'python title="a.py"'],
  ] as const) {
    assert.equal(fenceWord(info), word, info);
    assert.equal(langOfFence(info), id, info);
  }
});

test('the prose names are whole names, each read as its neighbours are; a script-like name is left to its head', () => {
  for (const [kind, names] of [
    ['readme', ['SECURITY', 'CODE_OF_CONDUCT', 'GOVERNANCE', 'SUPPORT', 'FAQ', 'HACKING', 'BUGS']],
    ['changelog', ['NEWS', 'RELEASES']],
    ['notes', ['ROADMAP']],
    ['article', ['NOTICE', 'COPYRIGHT', 'UNLICENSE', 'PATENTS', 'THANKS', 'CREDITS', 'CONTRIBUTORS', 'MAINTAINERS', 'ACKNOWLEDGMENTS', 'ACKNOWLEDGEMENTS',
      'LICENSE-MIT', 'LICENSE-APACHE', 'LICENSE-APACHE-2.0', 'LICENSE-BSD', 'LICENSE-GPL', 'LICENSE-LGPL', 'LICENSE-MPL', 'LICENSE-ISC', 'LICENSE-ZLIB',
      'LICENSE-CC0', 'LICENSE.mit', 'LICENSE.APACHE', 'license.bsd', 'LICENCE-MIT', 'LICENCE-APACHE', 'COPYING.LESSER', 'COPYING.LIB', 'COPYING.GPL', 'COPYING.LGPL']],
  ] as const) {
    for (const n of names) {
      const t = fileTypeOf(`/r/${n}`);
      assert.equal(t?.kind, 'text', n);
      assert.equal(t?.readerKind, kind, n);
      assert.equal(t?.reading, 'prose', n);
      assert.equal(t?.mode, 'rendered', n);
      assert.equal(detectKind({ path: `/r/${n}`, head: none }).kind, kind, n);
    }
  }
  for (const n of ['INSTALL', 'VERSION', 'configure', 'bootstrap', 'LICENSE-THIRD-PARTY']) assert.equal(fileTypeOf(`/r/${n}`), undefined, n);
  assert.equal(fileTypeOf('/r/license-checker.js')?.id, 'javascript', 'no glob: a script named for a licence stays code');
  assert.equal(fileTypeOf('/r/notice.ts')?.id, 'typescript');
});

// A file that is not a text buffer has a viewer of the app's own. Source is always the bytes.
const DECODED = ['tga', 'exr', 'hdr', 'qoi', 'jxl', 'dng', 'cr2', 'nef', 'arw', 'orf', 'rw2', 'raf', 'pef', 'srw', 'pbm', 'pgm', 'ppm', 'pnm', 'pam', 'ff', 'dds', 'psd', 'svgz'];

test('images open as the image page: what the webview draws, what the decoders read, and camera RAW', () => {
  for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'tif', 'tiff', 'heic', ...DECODED]) {
    const t = fileTypeOf(`/r/photo.${ext}`);
    assert.equal(t?.id, 'image', ext);
    assert.equal(t?.viewer, 'image', ext);
    assert.equal(viewerOf(`/r/PHOTO.${ext.toUpperCase()}`), 'image', ext);
    assert.equal(t?.kind, 'binary', `${ext}: listed, never searched`);
    assert.equal(t?.searchable, false, ext);
  }
});

test('every other binary row opens as the file card with the bytes beside it; text keeps the text views', () => {
  for (const row of FILE_TYPES) {
    if (row.kind !== 'binary') continue;
    const own: Record<string, string> = { image: 'image', archive: 'archive', pdf: 'pdf', database: 'sqlite', spreadsheet: 'sheet', 'office-document': 'office', 'outlook-message': 'mail', font: 'font', audio: 'media', video: 'media', book: 'book' };
    assert.equal(row.viewer, own[row.id] ?? 'card', row.id);
    assert.equal(row.mode, 'rendered', `${row.id}: Read is the card or the page; Source the hex view`);
    assert.ok(PAGE_VIEWERS.has(row.viewer), row.id);
  }
  assert.equal(BINARY_FILE_TYPE.viewer, 'card');
  assert.equal(UNKNOWN_FILE_TYPE.viewer, 'text', 'unknown text is text');
  for (const path of ['/r/a.md', '/r/a.ts', '/r/a.json', '/r/a.log', '/r/README']) assert.equal(viewerOf(path), 'text', path);
  assert.equal(viewerOf('/r/page.html'), 'html');
});

test('an archive the shell lists opens as its tree; one it does not read is the card', () => {
  for (const ext of ['zip', 'jar', 'whl', 'vsix', 'apk', 'tar', 'tgz', 'gz', 'bz2', 'xz', '7z', 'zst', 'tzst', 'deb', 'cab', 'iso', 'rar']) {
    const t = fileTypeOf(`/r/a.${ext}`);
    assert.equal(t?.id, 'archive', ext);
    assert.equal(t?.viewer, 'archive', ext);
    assert.equal(t?.searchable, false, ext);
  }
  assert.equal(viewerOf('/r/notes-backup.tar.gz'), 'archive');
  assert.equal(viewerOf('/r/backup.tar.zst'), 'archive');
  for (const ext of ['rpm', 'dmg']) assert.equal(viewerOf(`/r/a.${ext}`), 'card', ext);
  assert.equal(viewerOf('/r/report.docx'), 'office', 'an office file is a zip, but read as a document, not listed as one');
  assert.equal(viewerOf('/r/old.doc'), 'office', 'a Word 97-2003 document is a compound file the shell reads as one');
});

test('an EPUB is a zip read as a book, of the book kind; its zip head keeps it one', () => {
  const t = fileTypeOf('/r/The Measure.EPUB');
  assert.equal(t?.id, 'book');
  assert.equal(t?.viewer, 'book');
  assert.equal(t?.readerKind, 'book');
  assert.equal(t?.searchable, false);
  assert.ok(PAGE_VIEWERS.has('book'));
  assert.equal(contentTypeFor('/r/the-measure.epub', { class: 'binary', format: 'zip' })?.id, 'book');
});

test('a database opens as the table page, a workbook as its sheets; a database’s log and index are file cards; the head decides', () => {
  for (const ext of ['sqlite', 'sqlite3', 'db']) assert.equal(viewerOf(`/r/a.${ext}`), 'sqlite', ext);
  for (const ext of ['xlsx', 'xlsm', 'xls', 'ods']) assert.equal(viewerOf(`/r/a.${ext}`), 'sheet', ext);
  // A database's log and index name no row: their bytes make them the file card, which names the database (viewers/index.ts).
  for (const name of ['journal.sqlite-wal', 'journal.sqlite-shm']) assert.equal(contentTypeFor(`/r/${name}`, { class: 'binary' })?.viewer, 'card', name);
  assert.equal(viewerOf('/r/report.docx'), 'office');
  // A database with no extension is found by its header, as detection names it.
  assert.equal(contentTypeFor('/r/cache', { class: 'binary', format: 'sqlite' })?.viewer, 'sqlite');
  assert.equal(contentTypeFor('/r/book', { class: 'binary', format: 'xlsx' })?.viewer, 'sheet');
});

test('a font opens as its specimen and audio and video as the player, by name or by their magic', () => {
  for (const ext of ['ttf', 'otf', 'woff', 'woff2', 'ttc', 'otc']) assert.equal(viewerOf(`/r/Face.${ext.toUpperCase()}`), 'font', ext);
  for (const ext of ['wav', 'mp3', 'flac', 'm4a', 'mp4', 'mov', 'webm', 'mkv']) assert.equal(viewerOf(`/r/clip.${ext}`), 'media', ext);
  for (const ext of ['eot', 'mid']) assert.equal(viewerOf(`/r/a.${ext}`), 'card', ext);
  for (const [format, viewer] of [['ttc', 'font'], ['woff2', 'font'], ['wav', 'media'], ['mov', 'media']] as const) {
    assert.equal(contentTypeFor('/r/no-extension', { class: 'binary', format })?.viewer, viewer, format);
  }
});

test('a PDF opens as its pages, by its name or, with none, by its %PDF- head', () => {
  for (const path of ['/r/manual.pdf', '/r/SCAN.PDF']) {
    const t = fileTypeOf(path);
    assert.equal(t?.id, 'pdf', path);
    assert.equal(t?.viewer, 'pdf', path);
    assert.equal(t?.kind, 'binary', `${path}: never read whole, never parsed as text`);
    assert.equal(t?.searchable, false, path);
    assert.equal(t?.mode, 'rendered', `${path}: Read is its pages; Source the hex view`);
  }
  const report = '/r/downloads/report';
  assert.equal(fileTypeOf(report), undefined);
  noteContent(report, { class: 'binary', format: 'pdf' });
  assert.equal(viewerOf(report), 'pdf');
  assert.equal(guessedFromBytes(report), true, 'found from its bytes when the name said nothing');
  const misnamed = '/r/notes.txt';
  noteContent(misnamed, { class: 'binary', format: 'pdf' });
  assert.equal(viewerOf(misnamed), 'pdf', 'a PDF named .txt is read by its bytes');
  noteContent(report, null);
  noteContent(misnamed, null);
});

test('an SVG is text: Source is its text, Read the image page', () => {
  const t = fileTypeOf('/r/sketch.svg');
  assert.equal(t?.id, 'svg');
  assert.equal(t?.viewer, 'image');
  assert.notEqual(t?.kind, 'binary', 'its text is read, searched and edited like any text');
  assert.equal(t?.searchable, true);
  assert.equal(t?.parser, 'code');
  assert.equal(t?.lang, 'xml');
  assert.equal(parserOf('/r/sketch.svg'), 'code', 'never Markdown');
});

test('a reading found from the bytes when the name said nothing is a guess; no reading is not', () => {
  const webp = '/r/downloads/IMG_2231';
  assert.equal(fileTypeOf(webp), undefined);
  noteContent(webp, { class: 'binary', format: 'webp' });
  assert.equal(fileTypeOf(webp)?.id, 'image');
  assert.equal(viewerOf(webp), 'image');
  assert.equal(guessedFromBytes(webp), true);
  const tmk = '/r/cache/index.tmk';
  noteContent(tmk, { class: 'binary' });
  assert.equal(fileTypeOf(tmk), BINARY_FILE_TYPE);
  assert.equal(viewerOf(tmk), 'card');
  assert.equal(guessedFromBytes(tmk), false, 'finding no reading is not a guess');
  const png = '/r/a.png';
  noteContent(png, { class: 'binary', format: 'png' });
  assert.equal(guessedFromBytes(png), false, 'the name said it');
  // Bytes that are text under an image's name are text no row names.
  const fake = '/r/notes.png';
  noteContent(fake, { class: 'text' });
  assert.equal(viewerOf(fake), 'text');
  for (const p of [webp, tmk, png, fake]) noteContent(p, null);
});

// Aliases (aliases.ts): a type under another extension or a fixed name is its row's, never associated.
test('an alias resolves to the row it belongs to, and no alias claims what a row or another alias holds', () => {
  const rowOf = (id: string): FileTypeRow => FILE_TYPES.find((r) => r.id === id)!;
  for (const [path, id] of [
    ['/r/map.geojson', 'json'], ['/r/Cargo.lock', 'toml'], ['/r/.zshrc', 'shellscript'], ['/r/App.csproj', 'xml'], ['/r/Jenkinsfile', 'groovy'],
    ['/r/Podfile', 'ruby'], ['/r/x.pyi', 'python'], ['/r/x.hxx', 'cpp'], ['/r/page.xhtml', 'html'], ['/r/.flaskenv', 'dotenv'],
    ['/r/.vimrc', 'viml'], ['/r/CITATION.CFF', 'yaml'], ['/r/BSDmakefile', 'make'], ['/r/tool.nomad', 'hcl'], ['/r/Containerfile', 'docker'],
  ] as const) {
    const base = rowOf(id);
    const row = fileTypeOf(path)!;
    assert.equal(row.id, id, path);
    assert.equal(row.lang, base.lang, path);
    assert.equal(row.reading, base.reading, path);
    assert.equal(row.mode, base.mode, path);
    assert.equal(row.searchable, base.searchable && !isSecretName(path), path);
    assert.equal(row.associated, false, path);
  }
  assert.equal(fileTypeOf('/r/.flaskenv')?.searchable, false);
  assert.equal(fileTypeOf('/r/views/home.blade.php')?.lang, 'blade');
  assert.equal(fileTypeOf('/r/index.php')?.lang, 'php');
  assert.equal(fileTypeOf('/r/.babelrc')?.lang, 'jsonc');

  // A clone shares its base row's id, so the base rows are the first of each id.
  const first = FILE_TYPES.filter((r, i) => FILE_TYPES.findIndex((o) => o.id === r.id) === i);
  const seen = new Map<string, string>();
  const claim = (key: string, id: string): void => {
    assert.equal(seen.get(key), undefined, `${key} is claimed by ${seen.get(key)} and ${id}`);
    seen.set(key, id);
  };
  for (const r of first) {
    for (const e of r.match.ext ?? []) claim(`ext:${e}`, r.id);
    for (const n of r.match.name ?? []) claim(`name:${n.toLowerCase()}`, r.id);
    for (const g of r.match.glob ?? []) claim(`glob:${g}`, r.id);
  }
  for (const [id, a] of Object.entries(ROW_ALIASES)) {
    assert.ok(first.some((r) => r.id === id), `${id} has no row`);
    for (const e of a.ext ?? []) { claim(`ext:${e}`, id); assert.match(e, /^[^.]+$/, `${e} is not a bare extension`); }
    for (const n of a.name ?? []) { claim(`name:${n}`, id); assert.equal(n, n.toLowerCase(), n); }
  }
  assert.equal(tableExtensions().length, first.filter((r) => r.associated).flatMap((r) => r.match.ext ?? []).length);
  assert.ok(FILE_TYPES.filter((r) => !first.includes(r)).every((r) => !r.associated));
});

test('a shortcut is a binary row the installer does not claim, found by its bytes too', () => {
  const row = fileTypeFor('/r/Notepad.lnk');
  assert.equal(row.id, 'shortcut');
  assert.equal(row.kind, 'binary');
  assert.equal(row.viewer, 'card');
  assert.equal(row.associated, false);
  assert.equal(contentTypeFor('/r/link', { class: 'binary', format: 'lnk' })?.id, 'shortcut');
});

test('a Windows program is its own binary row, found by its MZ head too; an installer package is not one', () => {
  for (const name of ['setup.exe', 'kernel32.dll', 'ntfs.sys', 'grid.ocx', 'ribbons.scr']) {
    const row = fileTypeFor(`/r/${name}`);
    assert.equal(row.id, 'program', name);
    assert.equal(row.viewer, 'card', name);
    assert.equal(row.associated, false, name);
  }
  assert.equal(contentTypeFor('/r/tool', { class: 'binary', format: 'exe' })?.id, 'program');
  assert.notEqual(fileTypeFor('/r/setup.msi').id, 'program');
  assert.equal(fileTypeFor('/r/libfoo.so').id, 'executable');
});

test('a certificate is one row for its four names, never searched, and its DER bytes keep the row', () => {
  for (const name of ['a.pem', 'SERVER.PEM', 'a.crt', 'a.cer', 'a.der']) {
    const row = fileTypeFor(`/r/${name}`);
    assert.equal(row.id, 'certificate', name);
    assert.equal(row.viewer, 'card', name);
    assert.equal(row.searchable, false, name);
    assert.equal(searchSkipReason(row), 'may hold secrets', name);
  }
  const der = contentTypeFor('/r/a.cer', { class: 'binary' });
  assert.equal(der?.id, 'certificate');
  assert.equal(der?.kind, 'binary');
  assert.equal(contentTypeFor('/r/a.crt', { class: 'text' })?.id, 'certificate');
  // A modeline or a shebang swaps the row, but the name still says the file may hold a key.
  for (const name of ['/r/m.crt', '/r/m.cer', '/r/m.der', '/r/m.pem']) {
    noteContent(name, { class: 'text', modeline: 'python' });
    assert.equal(fileTypeFor(name).searchable, false, name);
    assert.equal(searchSkipReason(fileTypeFor(name)), 'may hold secrets', name);
    noteContent(name, null);
  }
});

test('.url and .inf read as INI; .desktop keeps its own grammar', () => {
  for (const name of ['Site.url', 'setup.inf']) {
    const row = fileTypeFor(`/r/${name}`);
    assert.equal(row.id, 'ini', name);
    assert.equal(row.lang, 'ini', name);
  }
});

test('files that hold credentials are kept out of Find like .env, and still open', () => {
  for (const path of [
    '/r/.npmrc', '/r/.netrc', '/r/_netrc', '/r/tls.key', '/r/putty.ppk', '/r/id_rsa', '/r/id_ed25519', '/r/id_ecdsa',
    '/r/id_dsa', '/r/id_ed25519_sk', '/r/id_rsa-work', '/r/id_rsa.bak', '/r/.pgpass', '/r/.git-credentials', '/r/.pypirc', '/r/.envrc', '/r/prod.env',
    '/home/me/.aws/credentials', '/home/me/.AWS/credentials', '/r/.env',
  ]) {
    const t = fileTypeFor(path);
    assert.equal(t.searchable, false, path);
    assert.equal(searchSkipReason(t), 'may hold secrets', path);
    assert.equal(t.viewer, 'text', `${path}: opening it directly still shows its text`);
  }
  for (const path of ['/r/id_rsa.pub', '/r/id_ed25519.pub', '/r/id_rsa_sk.pub', '/r/id_rsa2', '/r/credentials', '/r/docs/credentials', '/r/credentials.md', '/r/pem', '/r/key.txt']) {
    assert.equal(searchSkipReason(fileTypeFor(path)), null, path);
  }
});

test('a credential name is a mark over the row, so a head still decides what the file is', () => {
  const deck = '/r/deck.key';
  assert.equal(wantsContent(deck), true, 'no row of its own: the head is read');
  noteContent(deck, { class: 'binary', format: 'zip' });
  assert.equal(fileTypeFor(deck).id, 'archive');
  assert.equal(viewerOf(deck), 'archive');
  assert.equal(searchSkipReason(fileTypeFor(deck)), 'binary');
  const pem = '/r/server.key';
  noteContent(pem, { class: 'text', encoding: 'utf-8' });
  assert.equal(searchSkipReason(fileTypeFor(pem)), 'may hold secrets');
  assert.equal(viewerOf(pem), 'text');
  // A modeline in the file does not make it searchable.
  const rc = '/r/.npmrc';
  noteContent(rc, { class: 'text', modeline: 'ini' });
  assert.equal(fileTypeFor(rc).id, 'ini');
  assert.equal(fileTypeFor(rc).searchable, false);
  assert.equal(searchSkipReason(fileTypeFor(rc)), 'may hold secrets');
  // `.env` has a row of its own; a modeline still cannot make it searchable.
  const env = '/r/.env';
  noteContent(env, { class: 'text', modeline: 'sh' });
  assert.equal(fileTypeFor(env).searchable, false);
  assert.equal(searchSkipReason(fileTypeFor(env)), 'may hold secrets');
  for (const p of ['/r/.env.local', '/r/.flaskenv']) assert.equal(searchSkipReason(fileTypeFor(p)), 'may hold secrets', p);
  for (const p of [deck, pem, rc, env]) noteContent(p, null);
});

test('a credential name with no row of its own keeps the unknown text defaults for wrapping and the column guide', () => {
  for (const path of ['/r/.npmrc', '/r/id_rsa']) {
    assert.equal(fileTypeOf(path), undefined, path);
    assert.equal(fileTypeFor(path).kind, UNKNOWN_FILE_TYPE.kind, path);
    assert.equal(fileTypeFor(path).readerKind, UNKNOWN_FILE_TYPE.readerKind, path);
    assert.equal(fileTypeFor(path).mode, UNKNOWN_FILE_TYPE.mode, path);
    assert.equal(searchSkipReason(fileTypeFor(path)), 'may hold secrets', path);
  }
});
