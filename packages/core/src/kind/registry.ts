// The file-type registry: one table says what a file is from its name, and what the shell's content detection
// means when the head corrects the name. Open, the index (Library, palette,
// Find), Show as, the kind icon, the parse and Read's reading all ask it; `detectKind` consults it for the format tier
// and keeps the head's shape as its own layer above. Pure: no DOM, no I/O.

import type { Kind } from '../contracts/kinds.ts';
import { basename, dirname, normalizePath } from '../index-model/paths.ts';
import { NEW_GRAMMAR_ROWS, ROW_ALIASES } from './aliases.ts';
import { SNIFF_HEAD_BYTES, SNIFF_LIMIT_BYTES, sniffFormat } from './sniff.ts';

/** The index family a file is listed under (`IndexEntry.kind`). */
export type FileKind = 'markdown' | 'text' | 'source' | 'theme' | 'binary';
export type FileMode = 'rendered' | 'source';
/** How the bytes become the page's AST: Markdown, code blocks in `lang`, or code blocks with no language (as written). */
export type FileParser = 'markdown' | 'code' | 'text';
/**
 * What Read sets by default: the Markdown page, plain text read by its shape (prose, verse, or Markdown when it is),
 * code, plain text as written, a data reading (a tree, records, a table), or nothing to read (binary).
 */
export type FileReading = 'page' | 'prose' | 'code' | 'plain' | 'tree' | 'records' | 'table' | 'notebook' | 'binary';
/**
 * The view that shows the file: the text views (Read and Source), HTML's trust-gated page, or a page of the app's own for
 * what is not a text buffer (`apps/desktop/src/viewers`): the file card with the bytes beside it (the floor for any
 * file with no reading), or the image page, or an archive's tree, or a PDF's pages, or the table page of a
 * SQLite database or a spreadsheet, or a font's specimen, or the media page's player, or a Word document or a deck read
 * as text, or an EPUB read as one page in its spine's order. Source is always the bytes: the hex view for a file that is not text, the text for one that is (an SVG).
 */
export type FileViewer = 'text' | 'html' | 'card' | 'image' | 'archive' | 'pdf' | 'sqlite' | 'sheet' | 'mail' | 'font' | 'media' | 'office' | 'book';

/** The viewers that are a page of the app's own rather than the text views. */
export const PAGE_VIEWERS: ReadonlySet<FileViewer> = new Set<FileViewer>(['card', 'image', 'archive', 'pdf', 'sqlite', 'sheet', 'font', 'media', 'office', 'mail', 'book']);

export interface FileType {
  /** The row's name, `unknown` for the fallback. */
  readonly id: string;
  readonly kind: FileKind;
  /** The kind the name alone says; the head's shape may refine it (`detectKind`). */
  readonly readerKind: Kind;
  readonly reading: FileReading;
  /** Mode a file opens in before the reader toggles. */
  readonly mode: FileMode;
  readonly parser: FileParser;
  /** Shiki grammar id where Shiki has one (also what `data-marxy-lang` carries); absent when there is none. */
  readonly lang?: string;
  /** CodeMirror language id (the loader lives in the app); absent when Source has no grammar. */
  readonly cm?: string;
  readonly viewer: FileViewer;
  /** Read by Find. The index lists every file whatever this says. */
  readonly searchable: boolean;
  /** Set when the file's name says it holds credentials (`isSecretName`): never searchable, whatever else the row or the head says. */
  readonly secret?: true;
  /** Claimed in the Tauri file associations. */
  readonly associated: boolean;
}

export interface FileMatch {
  /** Lowercase extensions, no dot. */
  readonly ext?: readonly string[];
  /** Whole names, any case. */
  readonly name?: readonly string[];
  /** Name globs (`*`, `?`), any case. */
  readonly glob?: readonly string[];
}

export interface FileTypeRow extends FileType {
  readonly match: FileMatch;
}

type Spec = Omit<FileTypeRow, 'viewer' | 'searchable' | 'associated'> & Partial<Pick<FileType, 'viewer' | 'searchable' | 'associated'>>;

const row = (spec: Spec): FileTypeRow => ({ viewer: 'text', searchable: true, associated: true, ...spec });

const markdown = (id: string, ext: string[], lang: string, extra: Partial<Spec> = {}): FileTypeRow =>
  row({ id, match: { ext }, kind: 'markdown', readerKind: 'article', reading: 'page', mode: 'rendered', parser: 'markdown', lang, cm: 'markdown', ...extra });
const code = (id: string, match: FileMatch, lang?: string, cm?: string, extra: Partial<Spec> = {}): FileTypeRow =>
  row({ id, match, kind: 'source', readerKind: 'code', reading: 'code', mode: 'source', parser: lang ? 'code' : 'text', lang, cm, ...extra });
/** Read first: a log, a diff or a session is read, and Source is one action away. */
const readCode = (id: string, ext: string[], readerKind: Kind, lang: string): FileTypeRow =>
  code(id, { ext }, lang, undefined, { readerKind, mode: 'rendered' });
/** Data Read sets as a reading (a tree, records, a table); Source keeps its own grammar. */
const data = (id: string, ext: string[], reading: FileReading, lang?: string, cm?: string): FileTypeRow =>
  code(id, { ext }, lang, cm, { readerKind: 'data', reading, mode: 'rendered' });
/** Text no reading knows: it opens in Source and Read sets it as written, never as Markdown. */
const plain = (id: string, match: FileMatch, readerKind: Kind, lang?: string): FileTypeRow =>
  row({ id, match, kind: 'text', readerKind, reading: 'plain', mode: 'source', parser: 'text', lang, associated: false });
/**
 * Bytes Marxy does not read as text: listed in the index, never read by Find. Read is the file card with the bytes
 * beside it, or the viewer the row names; Source is the hex view. Never read whole, never parsed.
 */
const binary = (id: string, ext: string[], viewer: FileViewer = 'card'): FileTypeRow =>
  row({ id, match: { ext }, kind: 'binary', readerKind: 'data', reading: 'binary', mode: 'rendered', parser: 'text', viewer, searchable: false, associated: false });

/** Grammar id and the extensions it colours, for the languages added after the first set (each grammar on the Shiki allow-list). */
const GRAMMAR_ROWS: readonly (readonly [string, string[]])[] = [
  ['terraform', ['tf', 'tfvars']], ['hcl', ['hcl']], ['scala', ['scala', 'sc']], ['clojure', ['clj', 'cljs', 'cljc', 'edn']],
  ['fsharp', ['fs', 'fsi', 'fsx']], ['ocaml', ['ml', 'mli']], ['erlang', ['erl', 'hrl']], ['julia', ['jl']], ['nim', ['nim', 'nims']],
  ['groovy', ['groovy', 'gradle']], ['bat', ['bat', 'cmd']], ['fish', ['fish']], ['nix', ['nix']], ['proto', ['proto']],
  ['latex', ['tex', 'sty']], ['bibtex', ['bib']], ['less', ['less']], ['sass', ['sass']], ['stylus', ['styl']], ['astro', ['astro']],
  ['solidity', ['sol']], ['cmake', ['cmake']], ['elm', ['elm']], ['crystal', ['cr']], ['d', ['d']],
  ['fortran-free-form', ['f90', 'f95', 'f03', 'f08']], ['pascal', ['pas']], ['vb', ['vb', 'vbs']], ['system-verilog', ['sv', 'svh']],
  ['vhdl', ['vhd', 'vhdl']], ['hlsl', ['hlsl']], ['wgsl', ['wgsl']], ['awk', ['awk']], ['coffee', ['coffee']], ['pug', ['pug', 'jade']],
  ['handlebars', ['hbs', 'handlebars']], ['twig', ['twig']], ['liquid', ['liquid']], ['jinja', ['j2', 'jinja']], ['gleam', ['gleam']],
  ['mojo', ['mojo']], ['odin', ['odin']], ['prisma', ['prisma']], ['typst', ['typ']], ['hjson', ['hjson']],
  ['kdl', ['kdl']], ['ron', ['ron']], ['bicep', ['bicep']], ['cue', ['cue']], ['jsonnet', ['jsonnet', 'libsonnet']], ['nushell', ['nu']],
  ['common-lisp', ['lisp', 'lsp']], ['scheme', ['scm', 'ss']], ['emacs-lisp', ['el']], ['viml', ['vim']], ['asm', ['asm']],
  ['llvm', ['ll']], ['wasm', ['wat', 'wast']], ['properties', ['properties']], ['reg', ['reg']], ['po', ['po', 'pot']],
  ['fennel', ['fnl']], ['raku', ['raku', 'rakumod']], ['purescript', ['purs']], ['haxe', ['hx']], ['gdscript', ['gd']],
  ['openscad', ['scad']], ['vyper', ['vy']], ['razor', ['cshtml', 'razor']], ['erb', ['erb']], ['haml', ['haml']],
  ['kusto', ['kql', 'csl']], ['sparql', ['rq', 'sparql']], ['turtle', ['ttl']], ['cypher', ['cypher', 'cyp']],
  ['mermaid', ['mmd', 'mermaid']], ['cobol', ['cbl', 'cob']], ['ballerina', ['bal']], ['typespec', ['tsp']], ['puppet', ['pp']],
  ['qml', ['qml']], ['luau', ['luau']], ['asciidoc', ['adoc', 'asciidoc']], ['wikitext', ['wiki', 'mediawiki']], ['lean', ['lean']],
  ['apl', ['apl']], ['applescript', ['applescript']], ['nsis', ['nsi', 'nsh']], ['sas', ['sas']], ['hack', ['hack']], ['vala', ['vala']],
  ['http', ['http']], ['hurl', ['hurl']], ['desktop', ['desktop']], ['beancount', ['beancount']],
  ['powerquery', ['pq']], ['plsql', ['pls', 'pck']], ['abap', ['abap']], ['apex', ['apex']], ['gherkin', ['feature']],
  ['glimmer-js', ['gjs']], ['glimmer-ts', ['gts']], ['marko', ['marko']], ['imba', ['imba']], ['templ', ['templ']], ['move', ['move']],
  ['cairo', ['cairo']], ['wit', ['wit']], ['smithy', ['smithy']], ['pkl', ['pkl']], ['nextflow', ['nf']], ['moonbit', ['mbt']],
  ['dream-maker', ['dm', 'dme']], ['shaderlab', ['shader']], ['gdshader', ['gdshader']], ['polar', ['polar']],
  ['clarity', ['clar']], ['cadence', ['cdc']], ['chapel', ['chpl']], ['talonscript', ['talon']], ['jison', ['jison']], ['xsl', ['xsl', 'xslt']],
];

/** A grammar of JSON's family that Read sets as a data tree; Source keeps the grammar. */
const treeCode = (lang: string, match: FileMatch): FileTypeRow =>
  code(lang, match, lang, undefined, { readerKind: 'data', reading: 'tree', mode: 'rendered', associated: false });

const BASE_ROWS: readonly FileTypeRow[] = [
  markdown('markdown', ['md', 'markdown', 'mdown', 'mkd'], 'markdown'),
  markdown('mdx', ['mdx'], 'mdx'),
  // Markdown under other names, none claimed in the associations: Quarto and R Markdown (their cells are braced fences,
  // `fenceWord`), the extensions other tools write Markdown under, Cursor's rules (front matter, then Markdown), and
  // names that say text but hold Markdown.
  markdown('quarto', ['qmd'], 'markdown', { associated: false }),
  markdown('r-markdown', ['rmd', 'rmarkdown'], 'markdown', { associated: false }),
  markdown('markdown-alias', ['mkdn', 'mkdown', 'mdwn', 'markdn', 'mdtxt', 'mdtext', 'livemd', 'ronn'], 'markdown', { associated: false }),
  markdown('mdc', ['mdc'], 'mdc', { associated: false }),
  markdown('markdown-name', [], 'markdown', { match: { name: ['llms.txt', 'llms-full.txt', '.cursorrules', '.windsurfrules', '.clinerules'] }, associated: false }),
  // Plain text keeps the Markdown parse: Read sets it as prose or verse by its shape and as a page only when it holds
  // Markdown (`readingOf`).
  row({ id: 'text', match: { ext: ['txt', 'text'] }, kind: 'text', readerKind: 'article', reading: 'prose', mode: 'rendered', parser: 'markdown', cm: 'markdown' }),
  // The extension-less text family. Whole names only: a glob (`license-*`) would beat a code
  // extension and make `license-checker.js` prose. INSTALL, VERSION and the like are left to their heads: as often a script.
  ...([
    ['readme', ['readme', 'contributing', 'security', 'code_of_conduct', 'governance', 'support', 'faq', 'hacking', 'bugs']],
    ['changelog', ['changelog', 'changes', 'history', 'news', 'releases']],
    ['notes', ['notes', 'todo', 'roadmap']],
    ['article', [
      'authors', 'license', 'licence', 'copying', 'notice', 'copyright', 'unlicense', 'patents', 'thanks', 'credits', 'contributors', 'maintainers',
      'acknowledgments', 'acknowledgements', 'license-mit', 'license-apache', 'license-apache-2.0', 'license-bsd', 'license-gpl', 'license-lgpl',
      'license-mpl', 'license-isc', 'license-zlib', 'license-cc0', 'license.mit', 'license.apache', 'license.bsd', 'licence-mit', 'licence-apache',
      'copying.lesser', 'copying.lib', 'copying.gpl', 'copying.lgpl',
    ]],
  ] as const).map(
    ([readerKind, name]) => row({ id: `text-${name[0]}`, match: { name }, kind: 'text', readerKind, reading: 'prose', mode: 'rendered', parser: 'markdown', associated: false }),
  ),

  code('typescript', { ext: ['ts'] }, 'typescript', 'typescript'),
  code('typescript-module', { ext: ['mts', 'cts'] }, 'typescript'),
  code('tsx', { ext: ['tsx'] }, 'tsx', 'tsx'),
  code('javascript', { ext: ['js', 'mjs', 'cjs'] }, 'javascript', 'javascript'),
  code('jsx', { ext: ['jsx'] }, 'jsx', 'jsx'),
  code('rust', { ext: ['rs'] }, 'rust', 'rust'),
  code('python', { ext: ['py'] }, 'python', 'python'),
  code('go', { ext: ['go'] }, 'go', 'go'),
  code('java', { ext: ['java'] }, 'java', 'java'),
  code('kotlin', { ext: ['kt', 'kts'] }, 'kotlin'),
  code('c', { ext: ['c', 'h'] }, 'c', 'c'),
  code('cpp', { ext: ['cc', 'cpp', 'cxx', 'hpp', 'hh'] }, 'cpp', 'cpp'),
  code('ruby', { ext: ['rb'] }, 'ruby'),
  code('php', { ext: ['php'] }, 'php'),
  code('swift', { ext: ['swift'] }, 'swift'),
  code('shellscript', { ext: ['sh', 'bash', 'zsh'] }, 'shellscript', 'shell'),
  code('html', { ext: ['html', 'htm'] }, 'html', 'html', { readerKind: 'html', reading: 'page', parser: 'markdown', viewer: 'html' }),
  code('sql', { ext: ['sql'] }, 'sql'),
  code('graphql', { ext: ['graphql'] }, 'graphql'),
  code('lua', { ext: ['lua'] }, 'lua'),
  code('r', { ext: ['r'] }, 'r'),
  code('elixir', { ext: ['ex', 'exs'] }, 'elixir'),
  code('haskell', { ext: ['hs'] }, 'haskell'),
  code('vue', { ext: ['vue'] }, 'vue'),
  code('svelte', { ext: ['svelte'] }, 'svelte'),
  code('css', { ext: ['css'] }, 'css', 'css'),
  code('scss', { ext: ['scss'] }, 'scss'),
  // Added with the registry; not claimed in the Tauri associations (those are src-tauri's to change).
  code('csharp', { ext: ['cs'] }, 'csharp', undefined, { associated: false }),
  code('powershell', { ext: ['ps1', 'psm1', 'psd1'] }, 'powershell', undefined, { associated: false }),
  code('zig', { ext: ['zig'] }, 'zig', undefined, { associated: false }),
  code('dart', { ext: ['dart'] }, 'dart', undefined, { associated: false }),
  code('ini', { ext: ['ini', 'cfg'] }, 'ini', undefined, { readerKind: 'data', associated: false }),
  code('dotenv', { name: ['.env'], glob: ['.env.*'] }, 'dotenv', undefined, { searchable: false, associated: false }),
  plain('rst', { ext: ['rst'] }, 'code', 'rst'),
  // Added with content detection: `.m` and `.pl` are Objective-C and Perl until the head says MATLAB or Prolog,
  // which only content reaches (no name of theirs).
  code('perl', { ext: ['pl', 'pm'] }, 'perl', undefined, { associated: false }),
  code('objective-c', { ext: ['m'] }, 'objective-c', undefined, { associated: false }),
  code('objective-cpp', { ext: ['mm'] }, 'objective-cpp', undefined, { associated: false }),
  code('matlab', {}, 'matlab', undefined, { associated: false }),
  code('prolog', {}, 'prolog', undefined, { associated: false }),
  // Added with every permissive grammar: code Read and Source colour, opened in Source, not claimed in the
  // associations. The id is the grammar's; extensions another row already holds are left to it.
  ...GRAMMAR_ROWS.map(([lang, ext]) => code(lang, { ext }, lang, undefined, { associated: false })),
  // JSON with comments and JSON5 are read as a data tree, like JSON (`reading/tree.ts`, `parseJsonc`).
  treeCode('json5', { ext: ['json5'] }),
  code('cmake-lists', { name: ['cmakelists.txt'] }, 'cmake', undefined, { associated: false }),
  code('codeowners', { name: ['codeowners'] }, 'codeowners', undefined, { associated: false }),
  code('git-commit', { name: ['commit_editmsg', 'merge_msg', 'tag_editmsg'] }, 'git-commit', undefined, { associated: false }),
  code('git-rebase', { name: ['git-rebase-todo'] }, 'git-rebase', undefined, { associated: false }),

  // Logs: `.out` is often not a log, and `detectKind` falls back from its shape.
  readCode('log', ['log', 'out'], 'log', 'log'),
  readCode('diff', ['diff', 'patch'], 'diff', 'diff'),
  // A shell session. `terminal` is the app's own id (its reading groups by command), not a Shiki grammar.
  readCode('terminal', ['term', 'session'], 'terminal', 'terminal'),

  data('json', ['json'], 'tree', 'json', 'json'),
  data('toml', ['toml'], 'tree', 'toml', 'toml'),
  data('yaml', ['yaml', 'yml'], 'tree', 'yaml', 'yaml'),
  data('xml', ['xml', 'atom', 'rss'], 'tree', 'xml'),
  data('jsonl', ['jsonl', 'ndjson'], 'records', 'jsonl'),
  data('csv', ['csv', 'tsv'], 'table'),
  // A notebook is text: Read sets its cells (reading/notebook.ts), Source is its JSON in the JSON grammar.
  { ...data('ipynb', ['ipynb'], 'notebook', 'json', 'json'), associated: false },

  // A mail message is text: Source is the message as it travels, Read its page: the head, the HTML part in a sandbox.
  row({ id: 'eml', match: { ext: ['eml'] }, kind: 'text', readerKind: 'data', reading: 'plain', mode: 'rendered', parser: 'text', viewer: 'mail', associated: false }),

  // An SVG is text: Source is its text, Read the image page (drawn through <img>, so a script in it never runs).
  row({ id: 'svg', match: { ext: ['svg'] }, kind: 'source', readerKind: 'code', reading: 'code', mode: 'rendered', parser: 'code', lang: 'xml', viewer: 'image', associated: false }),

  row({ id: 'theme-css', match: { name: ['theme.css'] }, kind: 'theme', readerKind: 'code', reading: 'code', mode: 'source', parser: 'code', lang: 'css', cm: 'css', associated: false }),
  row({ id: 'theme-toml', match: { name: ['theme.toml'] }, kind: 'theme', readerKind: 'data', reading: 'tree', mode: 'source', parser: 'code', lang: 'toml', associated: false }),
  code('docker', { name: ['dockerfile'], glob: ['dockerfile.*', '*.dockerfile'] }, 'docker', 'dockerfile', { associated: false }),
  code('make', { name: ['makefile', 'gnumakefile'], glob: ['*.mk'] }, 'make', undefined, { associated: false }),
  code('just', { name: ['justfile'] }, 'just', undefined, { associated: false }),
  code('ruby-build', { name: ['rakefile', 'gemfile'] }, 'ruby', undefined, { associated: false }),
  code('procfile', { name: ['procfile'] }, undefined, undefined, { associated: false }),

  // Images: what the webview draws, and what the shell's decoders read: TGA, EXR, HDR, QOI, JPEG XL, the PNM family,
  // farbfeld, DDS, the embedded preview of a TIFF-based camera RAW and a Photoshop file's own preview, and an SVGZ unpacked
  // to its SVG. HEIC is drawn where the system decodes it; elsewhere it falls to the card.
  binary('image', ['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'bmp', 'ico', 'cur', 'tif', 'tiff', 'avif', 'heic', 'heif', 'tga', 'exr', 'hdr', 'qoi', 'jxl', 'dng', 'cr2', 'nef', 'arw', 'orf', 'rw2', 'raf', 'pef', 'srw', 'pbm', 'pgm', 'ppm', 'pnm', 'pam', 'ff', 'dds', 'psd', 'svgz'], 'image'),
  // Audio and video play in the webview's player, their facts read from the container; MIDI is notes, not sound.
  binary('audio', ['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'wma', 'aiff', 'aif', 'ac3', 'mka', 'amr'], 'media'),
  binary('midi', ['mid', 'midi']),
  binary('video', ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'ogv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'm2ts'], 'media'),
  // Archives the shell lists as a tree: the zip family, tar and its compressed forms, 7z, a lone gzip, bzip2, xz or
  // Zstandard file, Debian packages, cabinets, ISO images and RAR (listed, never unpacked). The rest have no reading.
  binary('archive', ['zip', 'jar', 'war', 'ear', 'aar', 'whl', 'vsix', 'apk', 'xpi', 'nupkg', 'tar', 'tgz', 'gz', 'tbz', 'tbz2', 'bz2', 'txz', 'xz', 'crate', '7z', 'zst', 'tzst', 'deb', 'cab', 'iso', 'rar'], 'archive'),
  // An EPUB is a zip read as a book: its chapters as one page in the spine's order, its contents the Outline. Read as
  // still offers the archive it is packed in.
  { ...binary('book', ['epub'], 'book'), readerKind: 'book' },
  binary('archive-other', ['rpm', 'dmg']),
  // A specimen drawn by the webview from the file, never installed; EOT is not a font the webview draws.
  binary('font', ['ttf', 'otf', 'woff', 'woff2', 'ttc', 'otc'], 'font'),
  binary('font-other', ['eot']),
  // A PDF's pages, drawn by pdf.js from ranges of the file; a PDF with no extension is found by its %PDF- head.
  binary('pdf', ['pdf'], 'pdf'),
  // A Windows shortcut: its card says what it points at, from the bytes; it is never followed or started.
  binary('shortcut', ['lnk']),
  // A Windows program or library: its card says what the file claims (product, version, target, signature), from its
  // own bytes; it is never started, loaded or verified. An .msi is a compound file, not one of these.
  binary('program', ['exe', 'dll', 'sys', 'ocx', 'scr']),
  // A certificate: PEM is text (Source is its own lines) and DER is bytes. Never searched, whatever the name: a .crt or
  // .cer may hold a key beside the certificate, and a key's material must not reach an index.
  row({ id: 'certificate', match: { ext: ['pem', 'crt', 'cer', 'der'] }, kind: 'text', readerKind: 'data', reading: 'plain', mode: 'rendered', parser: 'text', viewer: 'card', searchable: false, secret: true, associated: false }),
  binary('executable', ['so', 'dylib', 'o', 'a', 'lib', 'obj', 'class', 'wasm', 'pyc', 'bin', 'elf']),
  // An Outlook message: a compound file the shell reads into the message it would be as it travels, so Read is the mail
  // page and Source the bytes. Text under the name (a ROS message definition) falls to plain text, as any binary row's does.
  binary('outlook-message', ['msg'], 'mail'),
  // Word documents and decks read as text on the office page, in the reading typography, so they are articles. A .doc or
  // .ppt is a compound file the shell reads; the others are zips of parts.
  { ...binary('office-document', ['docx', 'pptx', 'odt', 'odp', 'doc', 'ppt'], 'office'), readerKind: 'article' },
  // RTF is text: Source is the file's own lines, Read the office page's reading of it, as a message's is the mail page.
  row({ id: 'rtf', match: { ext: ['rtf'] }, kind: 'text', readerKind: 'article', reading: 'plain', mode: 'rendered', parser: 'text', viewer: 'office', associated: false }),
  // A workbook's sheets as saved; a database's tables in stored order. The page checks the bytes: a .db that is
  // not SQLite (an encrypted one) falls to the file card.
  binary('spreadsheet', ['xlsx', 'xlsm', 'xls', 'ods'], 'sheet'),
  binary('database', ['sqlite', 'sqlite3', 'db'], 'sqlite'),
];

/**
 * A type known by another extension or a fixed name (`aliases.ts`): its row cloned under the new match, the same id and
 * the same reading, never associated. Last in the table, so `ROW_BY_LANG` still names the original row.
 */
const aliasRows = (): FileTypeRow[] => [
  ...Object.entries(ROW_ALIASES).map(([id, { ext, name }]) => {
    const base = BASE_ROWS.find((r) => r.id === id);
    if (!base) throw new Error(`aliases.ts: no row ${id}`);
    return { ...base, match: { ext, name }, associated: false };
  }),
  ...NEW_GRAMMAR_ROWS.map(({ lang, ext, name, glob }) =>
    lang === 'jsonc' ? treeCode(lang, { ext, name, glob }) : code(lang, { ext, name, glob }, lang, undefined, { associated: false })),
];

export const FILE_TYPES: readonly FileTypeRow[] = [...BASE_ROWS, ...aliasRows()];

/**
 * What a file no row names is: text, opened in Source and set as written in Read, never parsed as Markdown. Find reads it:
 * the shell's search still skips a file whose head holds a NUL.
 */
export const UNKNOWN_FILE_TYPE: FileType = {
  id: 'unknown', kind: 'text', readerKind: 'code', reading: 'plain', mode: 'source', parser: 'text', viewer: 'text', searchable: true, associated: false,
};

const UNKNOWN_ROW: FileTypeRow = { ...UNKNOWN_FILE_TYPE, match: {} };

/**
 * An RTF file whose head content detection calls binary (raw bytes after `\bin`, NULs among them): still read on the
 * office page, from the file's bytes, with Source as the hex view. Matched by no name, only by detection.
 */
export const RTF_BYTES_ROW: FileTypeRow = { ...binary('rtf', [], 'office'), readerKind: 'article' };

/** A DER certificate (or a key) whose head content detection calls binary: the same card, with Source as the hex view. */
export const CERT_BYTES_ROW: FileTypeRow = { ...binary('certificate', []), secret: true };

/** Bytes content detection found binary under a name no binary row names. */
export const BINARY_FILE_TYPE: FileTypeRow = binary('binary', []);

const BY_EXT = new Map<string, FileTypeRow>();
const BY_NAME = new Map<string, FileTypeRow>();
const BY_GLOB: { re: RegExp; row: FileTypeRow }[] = [];
const nameGlob = (glob: string): RegExp =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
for (const r of FILE_TYPES) {
  for (const e of r.match.ext ?? []) BY_EXT.set(e, r);
  for (const n of r.match.name ?? []) BY_NAME.set(n, r);
  for (const g of r.match.glob ?? []) BY_GLOB.push({ re: nameGlob(g), row: r });
}

/** The row for a lowercase, dotless extension, or `undefined`. */
export function fileTypeForExtension(ext: string): FileTypeRow | undefined {
  return BY_EXT.get(ext);
}

/**
 * The row `path` resolves to: what content detection recorded for it (`noteContent`) when its head corrected the name;
 * else a whole name, then the extension when it is Markdown or text (`Dockerfile.md` and `.env.md` are pages), then a
 * name glob, then any other extension. `undefined` when none names it.
 */
export function fileTypeOf(path: string): FileTypeRow | undefined {
  const row = readingTypeOf(path);
  return row && isSecretName(path) ? secretly(row) : row;
}

function readingTypeOf(path: string): FileTypeRow | undefined {
  if (CONTENT.size > 0 || SNIFFED.size > 0) {
    const key = normalizePath(path);
    if (CONTENT.has(key)) return CONTENT.get(key) ?? undefined;
    const sniffed = SNIFFED.get(key)?.row;
    if (sniffed) return sniffed;
  }
  return nameTypeOf(path);
}

// Whole names of files that hold credentials, and the extensions that mean a key or a secret. A key pair's `.pub` half is
// not one, and `credentials` counts only inside a `.aws` folder.
const SECRET_NAMES: ReadonlySet<string> = new Set(['.env', '.flaskenv', '.npmrc', '.netrc', '_netrc', '.pgpass', '.git-credentials', '.pypirc', '.envrc']);
const SECRET_EXTENSIONS: ReadonlySet<string> = new Set(['pem', 'crt', 'cer', 'der', 'key', 'ppk', 'env']);
const SSH_KEY = /^id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?(?:[._-].*)?$/;

/**
 * Whether `path`'s name says it holds credentials. Applied over whatever row the file gets, not a row of its own: a
 * `.key` that is a Keynote deck is still the archive its head says, only never searched.
 */
export function isSecretName(path: string): boolean {
  const name = basename(path).toLowerCase();
  if (SECRET_NAMES.has(name) || name.startsWith('.env.')) return true;
  if (name.endsWith('.pub')) return false;
  if (SSH_KEY.test(name)) return true;
  const dot = name.lastIndexOf('.');
  if (dot > 0 && SECRET_EXTENSIONS.has(name.slice(dot + 1))) return true;
  return name === 'credentials' && basename(dirname(path)).toLowerCase() === '.aws';
}

const SECRET_ROWS = new Map<FileTypeRow, FileTypeRow>();
function secretly(row: FileTypeRow): FileTypeRow {
  let out = SECRET_ROWS.get(row);
  if (!out) SECRET_ROWS.set(row, (out = { ...row, searchable: false, secret: true }));
  return out;
}

/** `fileTypeOf` from the name alone, whatever content detection said. */
export function nameTypeOf(path: string): FileTypeRow | undefined {
  const name = basename(path);
  const lower = name.toLowerCase();
  const byName = BY_NAME.get(lower);
  if (byName) return byName;
  const i = name.lastIndexOf('.');
  const byExt = i <= 0 ? undefined : BY_EXT.get(lower.slice(i + 1));
  if (byExt && (byExt.kind === 'markdown' || byExt.kind === 'text')) return byExt;
  for (const g of BY_GLOB) if (g.re.test(name)) return g.row;
  return byExt;
}

/** The viewer that shows `path`: its row's, `text` for a file no row names. */
export function viewerOf(path: string): FileViewer {
  return fileTypeFor(path).viewer;
}

/**
 * Whether `path`'s row was found from its bytes when its name said nothing of it: a WebP with no extension. Such a
 * reading is a guess, and says so; a name that agreed, or bytes that found no reading, are not.
 */
export function guessedFromBytes(path: string): boolean {
  const key = normalizePath(path);
  if (!CONTENT.has(key)) return SNIFFED.get(key)?.row !== undefined && nameTypeOf(path) === undefined;
  const found = CONTENT.get(key);
  return found !== null && found !== undefined && found !== BINARY_FILE_TYPE && nameTypeOf(path) === undefined;
}

/** `fileTypeOf`, with the unknown row for a file no row names. */
export function fileTypeFor(path: string): FileType {
  return fileTypeOf(path) ?? (isSecretName(path) ? secretly(UNKNOWN_ROW) : UNKNOWN_FILE_TYPE);
}

/** Kinds that read text as prose: the reader choosing one for a plain-text file chooses to read it as Markdown. */
const MARKDOWN_KINDS: ReadonlySet<Kind> = new Set<Kind>(['article', 'report', 'book', 'readme', 'docs', 'notes', 'changelog', 'transcript']);

/** Kinds with a page of their own drawn from a grammar, and that grammar: a log, a session, a patch. */
const PAGE_LANGS: ReadonlyMap<Kind, string> = new Map<Kind, string>([['log', 'log'], ['terminal', 'terminal'], ['diff', 'diff']]);

/**
 * The language `path` is drawn in when it is read as `kind`: plain text (a `.txt`, a name-only file, a file no row names)
 * found or chosen to be a log, a session or a patch is that kind's page, as a `.log` is; anything else, its row's own.
 */
export function pageLangOf(path: string, kind?: Kind | string | null): string | undefined {
  const type = fileTypeFor(path);
  const lang = kind === undefined || kind === null ? undefined : PAGE_LANGS.get(kind as Kind);
  if (lang !== undefined && type.kind === 'text' && type.viewer === 'text' && (type.reading === 'prose' || type.reading === 'plain')) return lang;
  return type.lang;
}

/** Whether plain text `path` read as `kind` is that kind's page, not its row's: a `.txt` that is a log, say. */
export function readsAsPage(path: string, kind?: Kind | string | null): boolean {
  return pageLangOf(path, kind) !== fileTypeFor(path).lang;
}

/**
 * How `path` is parsed when it is read as `kind`. Plain text read as a log, a session or a patch is parsed as that code
 * (`pageLangOf`); plain text the reader chose to read as a prose kind is parsed as Markdown; nothing else is, unless its
 * row says Markdown. `kind` is a kind the reader chose (Show as, or a rule), or one detection found from the file's shape.
 */
export function parserOf(path: string, kind?: Kind): FileParser {
  const type = fileTypeFor(path);
  if (readsAsPage(path, kind)) return 'code';
  if (type.parser === 'text' && type.kind === 'text' && kind !== undefined && MARKDOWN_KINDS.has(kind)) return 'markdown';
  return type.parser;
}

/**
 * Whether `path` is a Markdown page: its row's kind, as corrected by its head. The app asks this, not an extension list,
 * before treating a file as Markdown (Source structure, tab width, the minimap, Export, the Studio, links).
 */
export function isMarkdownPath(path: string): boolean {
  return fileTypeOf(path)?.kind === 'markdown';
}

/** The language id `path` is coloured in (a Shiki grammar id where one exists), or `undefined`. */
export function langOf(path: string): string | undefined {
  return fileTypeFor(path).lang;
}

/** Every extension Marxy claims in the Tauri file associations. */
export function tableExtensions(): string[] {
  return FILE_TYPES.filter((r) => r.associated).flatMap((r) => r.match.ext ?? []);
}

/**
 * What the Windows installer offers in "Open with" without taking the default: every extension Marxy has a page for.
 * The file card's rows (programs, shortcuts, certificates, bytes no viewer reads) are left out, since the card only
 * says what the file is.
 */
export function openWithExtensions(): string[] {
  return [...new Set(FILE_TYPES.filter((r) => r.viewer !== 'card').flatMap((r) => r.match.ext ?? []))];
}

// A Map, not an object: a fence word is the document's, and `constructor` or `__proto__` must find nothing.
const ALIASES: ReadonlyMap<string, string> = new Map(Object.entries({
  bash: 'shellscript', sh: 'shellscript', zsh: 'shellscript', shell: 'shellscript', golang: 'go', 'c++': 'cpp', 'c#': 'csharp',
  dockerfile: 'docker', console: 'shellsession', 'sh-session': 'shellsession', 'bash session': 'shellsession', svg: 'xml', ps: 'powershell',
  // Emacs and Vim mode names, as modelines write them.
  'shell-script': 'shellscript', makefile: 'make', cperl: 'perl', gfm: 'markdown', objc: 'objective-c', 'objective-c++': 'objective-cpp',
}));
const LANG_IDS: ReadonlySet<string> = new Set(FILE_TYPES.flatMap((r) => (r.lang ? [r.lang] : [])));

/**
 * The language word of a fence's info string when Pandoc braces it: Quarto and R Markdown cells (```{r setup,
 * include=FALSE}) name their engine first, an attribute fence (```{.python .numberLines}) its first class, a raw block
 * (```{=html}) its format. A cut-off brace (`{r`, the parse's first word) reads the same. An info string that does not
 * open with a brace is returned as it is; a braced one that names none gives ''.
 */
export function fenceWord(info: string): string {
  const text = info.trim();
  if (!text.startsWith('{')) return info;
  const end = text.indexOf('}');
  const parts = text.slice(1, end === -1 ? undefined : end).split(/[\s,]+/).filter((p) => p !== '');
  const first = parts[0] ?? '';
  if (first.startsWith('=')) return first.slice(1);
  if (/^[^.#=][^=]*$/.test(first)) return first;
  return parts.find((p) => p.startsWith('.'))?.slice(1) ?? '';
}

/**
 * The language id for a fence's info word (```rs, ```bash, ```{r}): an extension the table knows gives its row's id, a
 * known alias its grammar's, anything else itself, lowercased. Read's fences and code files carry the same id this way.
 */
export function langOfFence(info: string): string {
  const word = fenceWord(info).trim().toLowerCase();
  if (LANG_IDS.has(word)) return word;
  return ALIASES.get(word) ?? BY_EXT.get(word)?.lang ?? word;
}

// ---- content ------------------------------------------------------------------------------------------------------

/**
 * What the shell's content detection saw in a file's head (`detect_files`, src-tauri/src/detect.rs): signals only. What
 * they mean, the row and so the reading, the language and the mode, is decided here.
 */
export interface ContentSignals {
  readonly class: 'text' | 'binary' | 'empty';
  readonly encoding?: string;
  /** A binary format's usual extension, as its magic names it (`png`), or `mpeg-ts`. */
  readonly format?: string;
  /** The interpreter a `#!` line names (`python3`). */
  readonly shebang?: string;
  /** The mode a modeline names (`c++`, `sh`). */
  readonly modeline?: string;
  /** A heuristic's word for an ambiguous or missing extension (`objective-c`, `prolog`, `xml`). */
  readonly lang?: string;
}

/** Interpreters by name, version stripped (`python3.12` is `python`), to the language word they run. */
const INTERPRETERS: ReadonlyMap<string, string> = new Map(Object.entries({
  python: 'python', node: 'javascript', nodejs: 'javascript', bun: 'javascript', deno: 'typescript', 'ts-node': 'typescript', tsx: 'typescript',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', dash: 'shellscript', ksh: 'shellscript', ash: 'shellscript',
  ruby: 'ruby', perl: 'perl', php: 'php', lua: 'lua', luajit: 'lua', rscript: 'r', pwsh: 'powershell', powershell: 'powershell',
  elixir: 'elixir', runghc: 'haskell', runhaskell: 'haskell', make: 'make', swift: 'swift', just: 'just',
}));

/** The first row for each language id: `typescript`, not `typescript-module`; `css`, not `theme-css`. */
const ROW_BY_LANG = new Map<string, FileTypeRow>();
for (const r of FILE_TYPES) if (r.lang !== undefined && !ROW_BY_LANG.has(r.lang)) ROW_BY_LANG.set(r.lang, r);

/** The row a language word (a mode, a fence word, an extension) names, or undefined. */
export function rowForWord(word: string): FileTypeRow | undefined {
  const lower = word.trim().toLowerCase();
  return ROW_BY_LANG.get(langOfFence(lower)) ?? BY_EXT.get(lower);
}

const interpreterRow = (program: string): FileTypeRow | undefined => {
  const word = INTERPRETERS.get(program.toLowerCase().replace(/[\d.]+$/, ''));
  return word === undefined ? undefined : rowForWord(word);
};

/** Rows whose extension several languages share: the head's heuristic decides among them. */
const AMBIGUOUS: ReadonlySet<string> = new Set(['c', 'objective-c', 'perl', 'typescript']);

/**
 * What `path` is, its name corrected by its content. The name is the first guess. A binary head is binary, under
 * the binary row its name or its magic names. Text: a modeline wins (the author said so); then a heuristic's word for
 * an ambiguous or missing extension; then a shebang, where the name says nothing, says binary or says only text; and
 * text under a binary name is text no row names. `null` is that unknown text.
 */
export function contentTypeFor(path: string, signals: ContentSignals): FileTypeRow | null {
  const named = nameTypeOf(path) ?? null;
  if (signals.class === 'binary') {
    if (named?.kind === 'binary') return named;
    if (named?.id === 'rtf') return RTF_BYTES_ROW;
    if (named?.id === 'certificate') return CERT_BYTES_ROW;
    const format = signals.format === 'mpeg-ts' ? 'm2ts' : signals.format;
    const byFormat = format === undefined ? undefined : BY_EXT.get(format);
    return byFormat?.kind === 'binary' ? byFormat : BINARY_FILE_TYPE;
  }
  if (signals.class === 'empty') return named?.kind === 'binary' ? null : named;
  const byMode = signals.modeline === undefined ? undefined : rowForWord(signals.modeline);
  if (byMode) return byMode;
  const heuristicMayDecide = named === null || named.kind === 'binary' || AMBIGUOUS.has(named.id);
  const byHeuristic = heuristicMayDecide && signals.lang !== undefined ? rowForWord(signals.lang) : undefined;
  if (byHeuristic) return byHeuristic;
  const open = named === null || named.kind === 'binary' || named.id === 'text';
  const byShebang = open && signals.shebang !== undefined ? interpreterRow(signals.shebang) : undefined;
  if (byShebang) return byShebang;
  return named?.kind === 'binary' ? null : named;
}

/** Rows content detection set apart from what the name says, by normalised path (`null`: text no row names). */
const CONTENT = new Map<string, FileTypeRow | null>();
/**
 * What `noteSniffed` found for a name no row knows, apart from `CONTENT` so `noteContent` (every index walk and save)
 * cannot erase it. Only other bytes on the next open replace it. `row` undefined: looked, and it is text.
 */
const SNIFFED = new Map<string, { stamp: string; row: FileTypeRow | undefined }>();
/** Corrections kept at once; the oldest goes first. A correction let go is the name's guess again. */
const CONTENT_MAX = 20_000;

/**
 * Records what `path`'s head says, so every reader of the registry (open, the parse, Source, the index, Find, the
 * icon) sees the corrected row; `null` forgets it. Only a correction is kept: a head that agrees with the name keeps
 * nothing. The reader's Show as still wins: it is a kind, read above the row (`parserOf`, `detectKind`).
 */
export function noteContent(path: string, signals: ContentSignals | null): FileTypeRow | undefined {
  const key = normalizePath(path);
  CONTENT.delete(key);
  if (signals === null) return nameTypeOf(path);
  const row = contentTypeFor(path, signals);
  if (row !== (nameTypeOf(path) ?? null)) {
    if (CONTENT.size >= CONTENT_MAX) CONTENT.delete(CONTENT.keys().next().value!);
    CONTENT.set(key, row);
  }
  return row ?? undefined;
}

/**
 * A name no row knows, and no earlier detection corrected, read from its bytes: XML or JSON the text leaves no doubt about
 * (`sniffFormat`). The row is then the XML or JSON one for every reader of the registry, and `guessedFromBytes` says it
 * was found from the text. A known name is never looked at, and a name that holds secrets is not read this way.
 */
export function noteSniffed(path: string, bytes: Uint8Array): FileTypeRow | undefined {
  const key = normalizePath(path);
  const held = CONTENT.get(key);
  if (nameTypeOf(path) !== undefined || held || isSecretName(path)) return held ?? undefined;
  // The same bytes as the last open keep the last answer, found or not, without parsing again.
  const stamp = stampOf(bytes);
  const before = SNIFFED.get(key);
  if (before && before.stamp === stamp) return before.row;
  SNIFFED.delete(key);
  const found = sniffFormat(bytes);
  const row = found === null ? undefined : BY_EXT.get(found);
  if (SNIFFED.size >= CONTENT_MAX) SNIFFED.delete(SNIFFED.keys().next().value!);
  SNIFFED.set(key, { stamp, row });
  return row;
}

/** Length and an FNV-1a hash: cheap beside a parse, and other bytes of the same length still show. */
function stampOf(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  // Past the limit the sniff reads only the head, so only the head is hashed.
  const n = bytes.length <= SNIFF_LIMIT_BYTES ? bytes.length : SNIFF_HEAD_BYTES;
  for (let i = 0; i < n; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193);
  return `${bytes.length}:${h >>> 0}`;
}

/**
 * Whether the index walk reads this file's head: no row names it, or its extension is shared (`.h`, `.m`, `.pl`). A `.ts`
 * is read for video only when it is opened: a TypeScript tree would otherwise read the head of every file.
 */
export function wantsContent(path: string): boolean {
  const named = nameTypeOf(path);
  return named === undefined || (named.id !== 'typescript' && AMBIGUOUS.has(named.id));
}

/** Why Find does not read a file of this type, or null when it does: `binary`, or the row's own reason. */
export function searchSkipReason(type: FileType): string | null {
  if (type.searchable) return null;
  if (type.kind === 'binary') return 'binary';
  if (type.id === 'dotenv' || type.secret) return 'may hold secrets';
  return 'not a kind Find reads';
}
