// Builds the readable chapters (../NN-slug.md) from the handbook's sources in this folder. The
// sources use the handbook's own template markup, which GitHub shows as noise: {{A}} grade marks,
// (@slug) cross-links, <!--DATA:…--> tables generated from the lab's saved measurements, <!--INCLUDE:…-->
// demos, and `!!! kind "Title"` callouts. This turns each into plain GitHub-flavoured Markdown and fills
// every table from ../lab/data and ../data, the same numbers build.py (the original HTML build) uses.
// usage: node docs/research/reader-typography/source/to-gfm.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const out = join(here, '..');
const read = (p) => readFileSync(join(here, p), 'utf8').replace(/\r\n/g, '\n');
const json = (p) => JSON.parse(read(p));

const files = readdirSync(here).filter((f) => /^\d\d-.+\.md$/.test(f)).sort();
const pages = files.map((file) => {
  const text = read(file);
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const meta = Object.fromEntries(m[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]));
  return { file, meta, body: text.slice(m[0].length) };
});
const bySlug = Object.fromEntries(pages.map((p) => [p.meta.slug, p.file]));

const n = (v, d = 2) => (v == null ? '' : v.toFixed(d));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const table = (head, rows, align) =>
  [`| ${head.join(' | ')} |`, `| ${head.map((_, i) => (align?.[i] === 'r' ? '---:' : '---')).join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

const metrics = json('../lab/data/metrics.json');
const present = metrics.rows.filter((r) => r.present);
const byName = Object.fromEntries(present.map((r) => [r.name, r]));
function fontMetrics(kind) {
  const ref = byName.Literata.xHeight;
  const sel = present
    .filter((r) => (r.source === 'system') === (kind === 'system') && (kind === 'system' || r.category === kind))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const head = ['Family', ...(kind === 'system' ? ['Kind'] : []), 'x-height', 'Cap height', 'Average character', 'Width of 0 (1ch)', 'Characters in 66ch', 'Size matching Literata 18px x-height', 'line-height: normal', 'Default figures'];
  const rows = sel.map((r) => [r.name, ...(kind === 'system' ? [r.category] : []), n(r.xHeight, 3), n(r.capHeight, 3), n(r.avgCharEm, 3), n(r.chEm, 3), r.charsPer66ch.toFixed(0), ((18 * ref) / r.xHeight).toFixed(1), n(r.lineHeightNormal), r.defaultFigures ?? '']);
  return table(head, rows, ['l', ...(kind === 'system' ? ['l'] : []), 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'l']);
}
function opsz() {
  const names = ['Source Serif 4', 'Inter', 'Roboto Serif', 'Literata', 'Piazzolla', 'Newsreader', 'Georgia'];
  const rows = names.map((name) => {
    const r = byName[name];
    const a = r.advancePerEm;
    const change = ((a.at(-1) - a[0]) / a[0]) * 100;
    return [`${name}${name === 'Georgia' ? ' (static control)' : ''}`, ...a.map((v) => v.toFixed(2)), `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`, n(r.xHeight, 3), n(r.xHeightAt72, 3)];
  });
  return table(['Family', '12px', '16px', '24px', '48px', '72px', '12 to 72px', 'x-height at 16px', 'x-height at 72px'], rows, ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r']);
}
const lb = json('../lab/data/linebreak.json');
function lbTable(mode, cols) {
  return lb.measures.map((m) => {
    const rs = lb.results.filter((r) => r.mode === mode && r.measure === m);
    return [String(m), ...cols.map(([method, key, d]) => mean(rs.map((r) => r[method][key])).toFixed(d))];
  });
}
const justified = () =>
  table(
    ['Target characters per line', 'Mean adjustment ratio, first-fit', 'total-fit', 'Very loose lines per paragraph, first-fit', 'total-fit', 'Widest space (em), first-fit', 'total-fit', 'Hyphens per paragraph, first-fit', 'total-fit', 'Lines per paragraph, first-fit', 'total-fit'],
    lbTable('justified', [['firstFit', 'meanR', 2], ['knuthPlass', 'meanR', 2], ['firstFit', 'veryLoose', 1], ['knuthPlass', 'veryLoose', 1], ['firstFit', 'maxSpaceEm', 2], ['knuthPlass', 'maxSpaceEm', 2], ['firstFit', 'hyphens', 1], ['knuthPlass', 'hyphens', 1], ['firstFit', 'lines', 1], ['knuthPlass', 'lines', 1]]),
    Array(11).fill('r'),
  );
const ragged = () =>
  table(
    ['Target characters per line', 'Spread of line ends (SD, em), first-fit', 'total-fit', 'Chromium pretty', 'Largest gap at line end (em), first-fit', 'total-fit', 'Chromium pretty', 'Last-line fill, first-fit', 'total-fit', 'Chromium pretty'],
    lbTable('ragged', [['firstFit', 'sdSlackEm', 2], ['knuthPlass', 'sdSlackEm', 2], ['chromePretty', 'sdSlackEm', 2], ['firstFit', 'maxSlackEm', 2], ['knuthPlass', 'maxSlackEm', 2], ['chromePretty', 'maxSlackEm', 2], ['firstFit', 'lastLineFill', 2], ['knuthPlass', 'lastLineFill', 2], ['chromePretty', 'lastLineFill', 2]]),
    Array(10).fill('r'),
  );
const pretty = () =>
  table(
    ['Font', 'Characters', 'Paragraph', 'Last-line fill, wrap', 'Last-line fill, pretty', 'Mean ratio, wrap', 'Mean ratio, pretty', 'Mean ratio, total-fit'],
    lb.results.filter((r) => r.mode === 'justified' && !r.prettyEqualsWrap).map((r) => [r.font, String(r.measure), r.text, n(r.chromeWrap.lastLineFill), n(r.chromePretty.lastLineFill), n(r.chromeWrap.meanR), n(r.chromePretty.meanR), n(r.knuthPlass.meanR)]),
    ['l', 'r', 'l', 'r', 'r', 'r', 'r', 'r'],
  );
function themeContrast() {
  const keys = [['fg', 'Text'], ['comment', 'Comment'], ['string', 'String'], ['keyword', 'Keyword'], ['function', 'Function'], ['number', 'Number'], ['type', 'Type']];
  const rows = json('../data/themes.json').map((r) => [r.name, r.mode, ...keys.map(([k]) => (r.ratios[k] < 4.5 ? `**${r.ratios[k].toFixed(2)}** ✗` : r.ratios[k].toFixed(2)))]);
  return `${table(['Theme', 'Mode', ...keys.map(([, t]) => t)], rows, ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r'])}\n\nA bold ratio marked ✗ is below WCAG AA (4.5:1).`;
}
const DATA = {
  'theme-contrast': themeContrast,
  'font-metrics-serif': () => fontMetrics('serif'),
  'font-metrics-sans': () => fontMetrics('sans'),
  'font-metrics-mono': () => fontMetrics('mono'),
  'font-metrics-system': () => fontMetrics('system'),
  'opsz-table': opsz,
  'linebreak-justified': justified,
  'linebreak-ragged': ragged,
  'pretty-changes': pretty,
};

const GRADE = { A: 'replicated findings or a meta-analysis', B: 'one well-designed study', C: 'small, limited or mixed studies', D: 'expert convention without a direct test', X: 'contested or contradicted' };
const chapterMap = () =>
  pages.filter((p) => p.meta.slug !== 'orientation').map((p) => `- **[${p.meta.number}. ${p.meta.title}](${p.file})** — ${p.meta.description}${p.meta.when ? ` *Read it when ${p.meta.when}.*` : ''}`).join('\n');

/** Converts outside fenced code only. */
function outsideCode(text, fn) {
  return text.split(/(^```[\s\S]*?^```$)/m).map((part, i) => (i % 2 ? part : fn(part))).join('');
}

for (const { file, meta, body } of pages) {
  let md = body;
  md = md.replace(/<!--DATA:([a-z0-9-]+)-->/g, (_, name) => {
    if (!DATA[name]) throw new Error(`${file}: no generator for ${name}`);
    return DATA[name]();
  });
  md = md.replace(/<!--INCLUDE:[^>]+-->/g, '> **Interactive demo.** The published handbook runs a Knuth–Plass breaker, a first-fit breaker and the browser\'s `text-wrap: pretty` side by side here. The same code is `lab/kp.js`; open `lab/linebreak-lab.html` in a Chromium browser to run it.');
  md = md.replace('<!--CHAPTER-MAP-->', chapterMap());
  md = outsideCode(md, (t) =>
    t
      // !!! kind "Title"\n    indented body → a titled blockquote
      .replace(/^!!! (\w+) "([^"]+)"\n((?: {4}.*\n?|\n(?= {4}))+)/gm, (_, _kind, title, inner) =>
        `${inner.replace(/^ {4}/gm, '').trim().split('\n').map((l, i) => `> ${i === 0 ? `**${title}.** ` : ''}${l}`.trimEnd()).join('\n')}\n`)
      .replace(/\{\{([ABCDX])\}\}/g, (_, g) => `**[${g}]**`)
      .replace(/\(@([a-z0-9-]+)(#[^)]*)?\)/g, (_, slug, hash) => {
        if (!bySlug[slug]) throw new Error(`${file}: unknown cross-link @${slug}`);
        return `(${bySlug[slug]}${hash ?? ''})`;
      }),
  );
  const head = [
    `<!-- Generated from source/${file} by source/to-gfm.mjs; edit the source, then run the script. -->`,
    '',
    `# ${meta.h1 ?? meta.title}`,
    '',
    `*${meta.lede}*`,
    '',
    `Evidence grades: ${Object.entries(GRADE).map(([g, t]) => `**[${g}]** ${t}`).join(' · ')}. Part of the [Reader Typography Handbook](README.md).`,
    '',
  ].join('\n');
  writeFileSync(join(out, file), `${head}\n${md.trim()}\n`);
  console.log(`wrote ${file}`);
}
