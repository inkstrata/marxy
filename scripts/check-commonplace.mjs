// The Commonplace (MARXY-256): every piece is sourced, carries a visible colophon, and is ours to ship.
// The rights rule lives in apps/desktop/src/commonplace/README.md; this is its machine half. It derives
// public-domain status from the years in each piece's front matter rather than trusting a label.
// The translation licence and the note that front matter is not shown live in INFO.md.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT, fail, fix } from './lib/repo.mjs';

export const DIR = join(ROOT, 'apps/desktop/src/commonplace');
export const PIECES = join(DIR, 'pieces');

export const FORMS = new Set(['verse', 'prose', 'code']);
export const RIGHTS = new Set(['public-domain', 'public-domain+marxy-translation', 'public-domain-declared']);
const REQUIRED = ['title', 'author', 'date', 'form', 'languages', 'source', 'transcription', 'rights'];

/**
 * The front matter this corpus writes: `key: value` lines, values plain, quoted, a number, or a flow
 * list `[a, b]`. Anything else is an error, so a piece cannot smuggle in a shape the check misreads.
 */
export function parseFrontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return { error: 'no YAML front matter at the top of the file' };
  const data = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!kv) return { error: `front matter line is not \`key: value\`: ${line}` };
    data[kv[1]] = scalar(kv[2].replace(/\s+#.*$/, ''));
  }
  return { data, body: text.slice(m[0].length) };
}

function scalar(raw) {
  const v = raw.trim();
  if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map(s => scalar(s)).filter(s => s !== '');
  if (/^".*"$/.test(v)) return v.slice(1, -1).replace(/\\"/g, '"');
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

/** Lines of the body outside fenced code, with their text; fences may hold anything. */
function proseLines(body) {
  const out = [];
  let fence = null;
  for (const line of body.split('\n')) {
    const f = /^(`{3,}|~{3,})/.exec(line);
    if (fence) { if (f && line.startsWith(fence)) fence = null; continue; }
    if (f) { fence = f[1]; continue; }
    out.push(line);
  }
  return out;
}

/**
 * The public-domain test as of `year`: life + 70 (the author, and a translator or editor whose text
 * we reproduce, died on or before `year - 71`) and the United States' published-95-years-ago rule
 * (first published on or before `year - 96`), or a stated reason the US rule is met otherwise.
 */
export function rightsProblems(d, year) {
  const out = [];
  const lifeLimit = year - 71;
  const usLimit = year - 96;
  if (!RIGHTS.has(d.rights)) return [`rights "${d.rights}" is not one of ${[...RIGHTS].join(', ')}`];
  if (d.rights === 'public-domain-declared') {
    if (!d.rights_note) out.push('public-domain-declared needs a rights_note naming who declared it and where');
    return out;
  }
  const dead = (who, died) => {
    if (typeof died !== 'number') out.push(`${who}_died must be a year (negative for BCE)`);
    else if (died > lifeLimit) out.push(`${who} died in ${died}; life + 70 is not met until ${died + 71}`);
  };
  dead('author', d.author_died);
  if (typeof d.first_published !== 'number') out.push('first_published must be a year');
  else if (d.first_published > usLimit && !d.us_basis) {
    out.push(`first published ${d.first_published}, after ${usLimit}: add us_basis explaining why it is public domain in the US`);
  }
  if (d.editor) dead('editor', d.editor_died);
  if (d.rights === 'public-domain+marxy-translation') {
    if (d.translator !== 'Marxy') out.push('public-domain+marxy-translation needs `translator: Marxy`');
  } else if (d.translator) {
    if (d.translator === 'Marxy') out.push('a Marxy translation is rights public-domain+marxy-translation');
    else {
      dead('translator', d.translator_died);
      if (typeof d.translation_published !== 'number') out.push('translation_published must be a year');
      else if (d.translation_published > usLimit) out.push(`translation first published ${d.translation_published}, after ${usLimit}`);
    }
  }
  return out;
}

/** Every problem with one piece, as `file: message` lines. */
export function checkPiece(name, text, year) {
  const problems = [];
  const say = (msg, how) => problems.push(`${name}: ${msg}${how ? fix(how) : ''}`);
  if (text.includes('\r')) say('has CR line endings', 'save it with LF line endings');
  if (!text.endsWith('\n') || text.endsWith('\n\n')) say('must end in exactly one newline');
  const fm = parseFrontMatter(text);
  if (fm.error) { say(fm.error, 'see apps/desktop/src/commonplace/FORMAT.md'); return problems; }
  const { data: d, body } = fm;
  for (const key of REQUIRED) if (d[key] === undefined || d[key] === '') say(`front matter has no ${key}`, 'see FORMAT.md');
  if (d.form !== undefined && !FORMS.has(d.form)) say(`form "${d.form}" is not verse, prose or code`);
  if (d.languages !== undefined && (!Array.isArray(d.languages) || d.languages.length === 0)) say('languages must be a list like [en] or [de, en]');
  if (d.transcription && !/^https?:\/\/\S+$/.test(d.transcription)) say('transcription must be the URL of the text this piece was checked against');
  if (d.rights) for (const p of rightsProblems(d, year)) say(p, 'README.md "The rights rule"');

  const lines = proseLines(body);
  const h1 = lines.filter(l => /^# /.test(l));
  if (h1.length !== 1) say(`has ${h1.length} h1 headings; a piece has exactly one`);
  const h2 = lines.filter(l => /^## /.test(l)).length;
  const langs = Array.isArray(d.languages) ? d.languages.length : 0;
  if (langs > 1 && h2 !== langs) say(`declares ${langs} languages but has ${h2} \`## \` sections`);
  if (langs === 1 && h2 !== 0) say('a single-language piece has no `## ` sections');
  const breaks = lines.map((l, i) => (/^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(l) ? i : -1)).filter(i => i >= 0);
  if (breaks.length !== 1) say(`has ${breaks.length} thematic breaks; exactly one, before the colophon`);
  else if (!lines.slice(breaks[0] + 1).some(l => l.trim())) say('has nothing after its thematic break', 'the colophon names author, work, date and edition');
  if (lines.some(l => / $/.test(l))) say('has trailing spaces; verse hard breaks are a trailing backslash');
  if (lines.some(l => l.includes('![') || /<[a-z!/]/i.test(l))) say('contains an image or raw HTML', 'pieces are plain CommonMark and never load anything');
  if (body.includes('Translated for Marxy')) say('puts the translation notice in the text', 'say it once in INFO.md; the page shows the text');
  return problems;
}

/**
 * The info note is where the page's metadata lives: front matter is not shown, and a Marxy
 * translation is released under the MIT licence. `text` is `INFO.md`.
 */
export function checkInfo(text) {
  const problems = [];
  if (!text.includes('MIT licence')) problems.push(`INFO.md must say Marxy translations are released under the MIT licence${fix('see the Translations section')}`);
  if (!/does not show it/.test(text)) problems.push(`INFO.md must say the front matter is not shown${fix('the page shows the text only')}`);
  return problems;
}

/** Piece files named in the README's list, as `pieces/<name>.md` links. */
export function listedPieces(readme) {
  return new Set([...readme.matchAll(/\]\(pieces\/([^)]+\.md)\)/g)].map(m => m[1]));
}

export function checkCorpus({ files, readme, year }) {
  const problems = [];
  for (const { name, text } of files) problems.push(...checkPiece(name, text, year));
  const listed = listedPieces(readme);
  const present = new Set(files.map(f => f.name));
  for (const n of present) if (!listed.has(n)) problems.push(`${n}: not listed in apps/desktop/src/commonplace/README.md${fix('add a row for it')}`);
  for (const n of listed) if (!present.has(n)) problems.push(`README.md lists pieces/${n}, which does not exist${fix('remove the row or add the piece')}`);
  if (files.length === 0) problems.push('the Commonplace has no pieces');
  return problems;
}

export function loadCorpus() {
  const files = readdirSync(PIECES).filter(n => n.endsWith('.md')).sort()
    .map(name => ({ name, text: readFileSync(join(PIECES, name), 'utf8') }));
  return {
    files,
    readme: readFileSync(join(DIR, 'README.md'), 'utf8'),
    info: readFileSync(join(DIR, 'INFO.md'), 'utf8'),
  };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(resolve(process.argv[1])));
if (invokedDirectly) {
  const corpus = loadCorpus();
  const problems = [...checkCorpus({ ...corpus, year: new Date().getUTCFullYear() }), ...checkInfo(corpus.info)];
  if (fail(problems)) process.exit(1);
  console.log(`commonplace: ${corpus.files.length} pieces, every one sourced and cleared`);
}
