// Parses `--marxy-*` custom properties from tokens.css (dark defaults) and the light block of
// default/theme.css so specimen colours track the shipping theme without hard-coded hex in scripts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const repo = p => fileURLToPath(new URL(p, root));

function parseCustomProperties(block) {
  const props = Object.create(null);
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gi)) {
    props[`--${m[1]}`] = m[2].split('/*')[0].trim();
  }
  return props;
}

function blockBody(css, selector) {
  const open = css.indexOf(`${selector} {`);
  if (open === -1) throw new Error(`no ${selector} block in theme CSS`);
  let depth = 0;
  for (let i = css.indexOf('{', open); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(css.indexOf('{', open) + 1, i);
    }
  }
  throw new Error(`unclosed ${selector} block in theme CSS`);
}

function readPalettes() {
  const tokensCss = readFileSync(repo('packages/theme/src/tokens.css'), 'utf8');
  const dark = parseCustomProperties(blockBody(tokensCss, ':root'));

  const themeCss = readFileSync(repo('packages/theme/default/theme.css'), 'utf8');
  const light = { ...dark, ...parseCustomProperties(blockBody(themeCss, ':root[data-marxy-variant="light"]')) };
  return { dark, light };
}

let cache;
export function themePalettes() {
  if (!cache) cache = readPalettes();
  return cache;
}

function resolve(palette, name, seen = new Set()) {
  const val = palette[name];
  if (!val) return val;
  const ref = /^var\(\s*(--[^,)]+)\s*(?:,\s*[^)]+)?\s*\)$/.exec(val);
  if (!ref) return val;
  if (seen.has(ref[1])) throw new Error(`circular var() at ${name}`);
  seen.add(ref[1]);
  return resolve(palette, ref[1], seen);
}

/** @param {'dark' | 'light'} variant @param {string} key without `--marxy-` prefix */
export function themeToken(variant, key) {
  const name = `--marxy-${key}`;
  const palette = themePalettes()[variant];
  const val = resolve(palette, name);
  if (val == null) throw new Error(`token ${name} is missing for variant ${variant}`);
  return val;
}
