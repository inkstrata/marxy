// Writes each bundled theme's sheet (packages/theme/<theme>/theme.css and theme.toml) from its look under src/looks/, so
// the theme config.toml names and the look the Studio shows are one definition. A colour is written as the theme drew it
// (rgba and all) where nothing moved it, as the colour it resolves to otherwise, and as var() where it names another
// role. Night and Paper is the exception: its sheet is default/theme.css, the base every theme is laid over, hand-written;
// theme-twins.test.ts holds its look equal to it.
// usage: node packages/theme/scripts/write-theme-sheets.mjs [--check]   (--check writes nothing and exits 1 on a difference)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { palette } from '../src/look.ts';
import { LOOKS } from '../src/looks.ts';
import { LANG_PALETTES, PALETTE_ROLES, FOLLOWERS } from '../src/lang-palettes.ts';

const ROOT = new URL('../', import.meta.url);
const HAND_WRITTEN = new Set(['night-paper']);

const COLOUR_ORDER = [
  'bg', 'text', 'text-strong', 'text-secondary', 'text-faint', 'accent', 'accent-strong', 'accent-fg', 'accent-wash', 'link',
  'rule', 'rule-strong', 'edge', 'divider', 'divider-focus', 'quote-rule', 'surface', 'surface-glass', 'notice', 'code-bg',
  'code-text', 'selection', 'find', 'find-current', 'find-edge', 'status-ok', 'status-warn', 'status-err', 'status-info',
  'status-ok-wash', 'status-warn-wash', 'status-err-wash', 'diff-add', 'diff-del', 'diff-add-word', 'diff-del-word',
];
const TOK_ORDER = [
  'keyword', 'string', 'comment', 'number', 'function', 'type', 'variable', 'operator', 'punctuation', 'constant', 'tag',
  'attribute', 'marker', 'heading', 'builtin', 'property', 'decorator', 'self', 'escape', 'mark', 'link',
];
/** The roles a sheet always writes as another role, as every hand-written sheet did. */
const ALWAYS = { divider: 'var(--marxy-color-rule)', 'divider-focus': 'var(--marxy-color-accent)', notice: 'var(--marxy-color-surface)' };
const REF = { codeText: '--marxy-color-code-text', link: '--marxy-color-link', text: '--marxy-color-text', accent: '--marxy-color-accent', second: '--marxy-color-text-secondary', faint: '--marxy-color-text-faint' };

function block(look, scheme) {
  const p = palette(look, scheme);
  const t = p.tokens;
  const P = look.pins[scheme];
  const lines = [];
  const w = p.weights;
  lines.push(`  --marxy-weight-body: ${w.body ?? look.weight};`, `  --marxy-weight-heading: ${w.heading ?? look.headWeight};`, `  --marxy-weight-strong: ${w.strong ?? Math.min(900, look.weight + 230)};`, '');
  for (const role of COLOUR_ORDER) {
    const token = `--marxy-color-${role}`;
    let v = p.drawn[token] ?? t[token];
    if (role in ALWAYS) v = ALWAYS[role];
    else if (role === 'link' && t[token] === t['--marxy-color-accent'] && !P.link) v = 'var(--marxy-color-accent)';
    else if (role === 'status-info' && t[token] === t['--marxy-color-accent'] && !P.info) v = 'var(--marxy-color-accent)';
    else if (role === 'surface-glass') v = p.drawn[token] ?? 'var(--marxy-color-surface)';
    lines.push(`  ${token}: ${v};`);
    if (role === 'notice') lines.push(`  --marxy-shadow-surface: ${t['--marxy-shadow-surface']};`);
  }
  for (const role of TOK_ORDER) {
    const token = `--marxy-tok-${role}`;
    const pin = P.tok?.[role];
    let v = p.drawn[token] ?? t[token];
    if (pin?.startsWith('@')) {
      const name = pin.slice(1);
      const target = REF[name] ?? `--marxy-tok-${name}`;
      // A reference is written as one only while it lands on the same colour (a guard may have moved it on code's grounds).
      if (t[target] === t[token]) v = `var(${target})`;
    }
    lines.push(`  ${token}: ${v};`);
  }
  for (const [k, v] of Object.entries(P.extra ?? {})) lines.push(`  ${k}: ${v};`);
  return { lines, tokens: t };
}

/** A theme whose languages wear its own one set: a `[data-marxy-lang]` scope wins over the shipped palettes' `:where()`. */
function langScope(look, tokens) {
  if (look.perLanguage !== false || Object.keys(LANG_PALETTES).length === 0) return [];
  const roles = [...PALETTE_ROLES.map((r) => (r === 'decorator' ? 'attribute' : r)), ...Object.keys(FOLLOWERS)];
  const decl = (r) => (r === 'attribute' ? [['decorator', tokens['--marxy-tok-decorator']]] : [[r, tokens[`--marxy-tok-${r}`]]]);
  return [...new Set(roles)].flatMap(decl).map(([r, v]) => `  --marxy-tok-${r}: ${v};`);
}

export function sheetFor(look) {
  const head = [
    `/* ${look.name}: ${look.blurb}`,
    `   Written from packages/theme/src/looks/${look.id}.ts by packages/theme/scripts/write-theme-sheets.mjs: change that file`,
    '   and run the script, never this one (theme-sheets.test.ts holds them equal).',
    ...(look.credit ? [`   ${look.credit}`] : []),
    '*/',
  ];
  const out = [...head];
  if (look.only) {
    const { lines, tokens } = block(look, look.only);
    out.push(':root,', ':root[data-marxy-variant="light"] {', `  color-scheme: ${look.only === 'night' ? 'dark' : 'light'};`, ...lines, '}');
    const scope = langScope(look, tokens);
    if (scope.length) out.push('[data-marxy-lang] {', ...scope, '}');
  } else {
    const night = block(look, 'night');
    const day = block(look, 'day');
    out.push(':root {', ...night.lines, '}', ':root[data-marxy-variant="light"] {', ...day.lines, '}');
    const ns = langScope(look, night.tokens);
    if (ns.length) out.push('[data-marxy-lang] {', ...ns, '}', ':root[data-marxy-variant="light"] [data-marxy-lang] {', ...langScope(look, day.tokens), '}');
  }
  return `${out.join('\n')}\n`;
}

export function manifestFor(look) {
  return [`name = "marxy ${look.id.replace(/-/g, " ")}"`, 'author = "marxy"', 'contract = 2', `variants = [${look.only ? (look.only === 'night' ? '"dark"' : '"light"') : '"dark", "light"'}]`, ''].join('\n');
}

export const SHEET_LOOKS = LOOKS.filter((l) => l.theme && l.pins && !HAND_WRITTEN.has(l.theme));

if (import.meta.main) {
  const check = process.argv.includes('--check');
  let differ = 0;
  for (const look of SHEET_LOOKS) {
    const dir = new URL(`${look.theme}/`, ROOT);
    const files = [[new URL('theme.css', dir), sheetFor(look)], [new URL('theme.toml', dir), manifestFor(look)]];
    for (const [file, text] of files) {
      const now = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
      if (now === text) continue;
      differ += 1;
      if (check) console.error(`differs: ${file.pathname}`);
      else {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, text);
        console.log(`wrote ${file.pathname}`);
      }
    }
  }
  if (check && differ) process.exit(1);
  console.log(`${SHEET_LOOKS.length} bundled theme sheets ${check ? 'checked' : 'up to date'}${differ && !check ? ` (${differ} files written)` : ''}`);
}
