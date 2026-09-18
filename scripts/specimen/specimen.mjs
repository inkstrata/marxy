// The specimen's shared definitions: the two candidate typeface pairs (ADR-0015), the pages of the
// long document that get captured, and the stylesheet, built from the type scale in
// docs/design-language.md and the tokens in packages/theme/src/tokens.css rather than from copies of
// those numbers, so a drift in either shows up as a specimen failure.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderSafeHtml } from '../../packages/core/src/render/index.ts';

const root = new URL('../../', import.meta.url);
export const repo = p => new URL(p, root);
export const repoPath = p => fileURLToPath(repo(p));

export const SOURCE = 'fixtures/corpus/01-long-technical.md';
export const OUT = 'docs/taste-review/review-0';
export const VIEWPORT = { width: 1000, height: 900 };
export const DPRS = [1, 2];

export function tokens() {
  const css = readFileSync(repo('packages/theme/src/tokens.css'), 'utf8');
  return key => {
    const m = css.match(new RegExp(`--marxy-${key}:\\s*([^;]+);`));
    if (!m) throw new Error(`token --marxy-${key} is not in packages/theme/src/tokens.css`);
    return m[1].split('/*')[0].trim();
  };
}

const ROLE_KEYS = { 'Title (h1)': 'title', 'Section (h2)': 'section', 'Sub (h3)': 'sub', Body: 'body', 'Code block': 'code', 'Caption, meta': 'caption' };
const num = s => parseFloat(s.replace('\u2212', '-'));

// The scale lives as a markdown table in docs/design-language.md; parsing it is what lets the
// verifier claim the specimen is set "at the type scale" instead of at numbers someone retyped.
export function typeScale() {
  const md = readFileSync(repo('docs/design-language.md'), 'utf8');
  const scale = {};
  for (const line of md.split('\n')) {
    const cells = line.split('|').map(s => s.trim());
    if (cells.length !== 7) continue;
    const key = ROLE_KEYS[cells[1]];
    if (!key) continue;
    const [size, lineHeight] = cells[2].split('/').map(num);
    scale[key] = {
      role: cells[1], size, lineHeight,
      weight: parseInt(cells[3], 10),
      tracking: cells[4] === '0' ? '0' : `${num(cells[4])}em`,
      spaceAbove: cells[5] === '\u2014' ? 0 : num(cells[5]),
    };
  }
  const missing = Object.values(ROLE_KEYS).filter(k => !scale[k]);
  if (missing.length) throw new Error(`type scale rows missing from docs/design-language.md: ${missing.join(', ')}`);
  return scale;
}

export const pairs = [
  {
    id: 'a', slug: 'pair-a-literata-jetbrains-mono', text: 'Literata', mono: 'JetBrains Mono',
    adr: 'the ADR-0015 default',
    faces: [
      { family: 'Literata', file: 'fonts/literata/Literata[opsz,wght].ttf', weight: '200 900', style: 'normal' },
      { family: 'Literata', file: 'fonts/literata/Literata-Italic[opsz,wght].ttf', weight: '200 900', style: 'italic' },
      { family: 'JetBrains Mono', file: 'fonts/jetbrains-mono/JetBrainsMono[wght].ttf', weight: '100 800', style: 'normal' },
    ],
  },
  {
    id: 'b', slug: 'pair-b-source-serif-4-ibm-plex-mono', text: 'Source Serif 4', mono: 'IBM Plex Mono',
    adr: 'the ADR-0015 fallback',
    faces: [
      { family: 'Source Serif 4', file: 'fonts/source-serif-4/SourceSerif4Variable-Roman.ttf', weight: '200 900', style: 'normal' },
      { family: 'IBM Plex Mono', file: 'fonts/ibm-plex-mono/IBMPlexMono-Regular.ttf', weight: '400', style: 'normal' },
    ],
  },
];

// The kinds of remote reference the render-time control page makes, to show the interception that
// the no-network claim rests on is live. `video` is in the list because a remote video src is
// exactly what a static scan for `<img>` and `<script>` tags misses.
export const CONTROL_RESOURCES = ['img', 'video', 'iframe', 'stylesheet', 'import', 'fetch'];

// Anchors, not scroll offsets: the two pairs set the document to different heights, and the reviewer
// has to be looking at the same passage in both to compare anything.
export const pages = [
  { id: 'p1-opening', shows: 'title, opening prose, first section heading' },
  { id: 'p2-inline-code', shows: 'inline code inside body text (design constraint 5)' },
  { id: 'p3-table', shows: 'a wide data table and its figures' },
  { id: 'p4-heading-stack', shows: 'h2 above h3 above body, space-above ratios' },
  { id: 'p5-late-list', shows: 'a bulleted list late in the document (grid drift)' },
];

export function documentHtml() {
  const src = readFileSync(repo(SOURCE), 'utf8');
  return renderSafeHtml(src, { file: SOURCE }).html;
}

const dataUrl = file => `url(data:font/ttf;base64,${readFileSync(repo(file)).toString('base64')}) format("truetype")`;

export function stylesheet(pair) {
  const t = tokens(), s = typeScale();
  const faces = pair.faces.map(f => `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};font-display:block;src:${dataUrl(f.file)}}`).join('\n');
  const text = `"${pair.text}", serif`, mono = `"${pair.mono}", monospace`;
  const type = r => `font-size:${r.size}px;line-height:${r.lineHeight}px;font-weight:${r.weight};letter-spacing:${r.tracking}`;
  const role = (sel, r) => `${sel}{${type(r)};margin:${r.spaceAbove}px 0 0}`;
  return `${faces}
:root{color-scheme:light}
*{box-sizing:border-box}
html,body{margin:0;background:${t('color-bg')};color:${t('color-text')}}
body{font-family:${text};${type(s.body)};font-optical-sizing:auto;text-rendering:optimizeLegibility}
::-webkit-scrollbar{width:0;height:0}
article{width:${t('measure')};margin:0 auto;padding:${s.body.lineHeight * 2}px 0}
article>:first-child{margin-top:0}
${role('h1', s.title)}
${role('h2', s.section)}
${role('h3', s.sub)}
h1,h2,h3{font-family:${t('font-heading') === 'var(--marxy-font-text)' ? text : t('font-heading')};color:inherit}
${role('p, ul, ol, blockquote, table', s.body)}
li{margin:0}
ul,ol{padding-left:${s.body.lineHeight}px}
a{color:${t('color-link')};text-decoration-thickness:1px;text-underline-offset:2px}
strong{font-weight:${t('weight-strong')}}
hr{border:0;border-top:1px solid ${t('color-rule')};margin:${s.body.lineHeight}px 0 0;height:0}
code,pre{font-family:${mono};font-size:${s.code.size}px;font-weight:${s.code.weight};letter-spacing:${s.code.tracking}}
code{background:${t('color-code-bg')};color:${t('color-code-text')};padding:0 .2em}
pre{line-height:${s.code.lineHeight}px;margin:${s.code.spaceAbove}px 0 0;background:${t('color-code-bg')};padding:${t('code-padding')};border-radius:${t('code-radius')};overflow-x:hidden;white-space:pre-wrap}
pre code{background:none;padding:0}
blockquote{margin-left:0;padding-left:${s.body.lineHeight}px;border-left:${t('quote-rule-width')} solid ${t('color-quote-rule')}}
table{border-collapse:collapse;width:100%;font-size:${s.caption.size}px;line-height:${s.caption.lineHeight}px;letter-spacing:${s.caption.tracking}}
th,td{text-align:left;padding:0 .6em 0 0;vertical-align:top;border-bottom:1px solid ${t('color-rule')}}
th{font-weight:${t('weight-heading')}}
#ch-probe{position:absolute;top:-9999px;left:0;white-space:pre;font:inherit}`;
}

export function pngSize(url) {
  const head = readFileSync(url).subarray(0, 24);
  if (head.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${url} is not a PNG`);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

export function specimenPage(pair) {
  return `<!doctype html><html lang=en><meta charset=utf-8><title>marxy specimen — ${pair.text} + ${pair.mono}</title><style>${stylesheet(pair)}</style><body><article>${documentHtml()}</article><span id=ch-probe>${'0'.repeat(68)}</span>`;
}
