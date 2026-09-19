// The theme contract is names, unit kinds and an explaining comment — not default values (ADR-0031).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, fail, fix } from './lib/repo.mjs';

export const TOKENS = join(ROOT, 'packages/theme/src/tokens.css');
export const CONTRACT = join(ROOT, 'packages/theme/tokens.contract.json');

const KINDS = new Set(['length', 'number', 'colour', 'family', 'ratio', 'keyword']);
const DECL = /^\s*(--marxy-[a-z0-9-]+)\s*:\s*([^;]+);(.*)$/;
const LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:px|em|rem|ch|ex|%|vw|vh|vmin|vmax|cm|mm|in|pt|pc|lh|rlh|cap|ic)$/i;
const INTEGER = /^-?\d+$/;
const RATIO = /^-?(?:\d+\.\d+|\.\d+)$/;
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOUR_FN = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/i;
const VAR_REF = /^var\(\s*(--marxy-[a-z0-9-]+)(?:\s*,[\s\S]*)?\)$/i;

/**
 * Infer a unit kind from a CSS value. `var()`/`calc()` take the kind they resolve to,
 * otherwise `keyword`. A theme author relies on this, not on 28px.
 */
export function kindOf(value, resolve = () => undefined) {
  const v = String(value ?? '').trim();
  const ref = VAR_REF.exec(v);
  if (ref) return resolve(ref[1]) ?? 'keyword';
  if (/^calc\(/i.test(v)) {
    const inner = v.replace(/^calc\(\s*/i, '').replace(/\s*\)$/, '');
    const kinds = inner.split(/[+\-*/]/).map(part => kindOf(part.trim(), resolve));
    if (kinds.includes('length')) return 'length';
    if (kinds.includes('colour')) return 'colour';
    if (kinds.includes('family')) return 'family';
    if (kinds.includes('ratio')) return 'ratio';
    if (kinds.length && kinds.every(k => k === 'number')) return 'number';
    return 'keyword';
  }
  if (HEX.test(v) || COLOUR_FN.test(v)) return 'colour';
  if (/['"]/.test(v) || v.includes(',')) return 'family';
  if (LENGTH.test(v)) return 'length';
  if (INTEGER.test(v)) return 'number';
  if (RATIO.test(v)) return 'ratio';
  return 'keyword';
}

/**
 * Every `--marxy-*` declaration in `css`, with kind inferred and whether an explaining
 * comment sits on the same line. Values are not returned: they are not contract.
 */
export function declarations(css) {
  const raw = [];
  for (const line of String(css).split(/\r?\n/)) {
    const m = DECL.exec(line);
    if (!m) continue;
    raw.push({ name: m[1], value: m[2].trim(), comment: /\/\*/.test(m[3]) });
  }
  const byName = new Map(raw.map(d => [d.name, d]));
  const kinds = new Map();
  function resolve(name, seen = new Set()) {
    if (kinds.has(name)) return kinds.get(name);
    if (seen.has(name)) return 'keyword';
    const d = byName.get(name);
    if (!d) return undefined;
    seen.add(name);
    const kind = kindOf(d.value, ref => resolve(ref, seen));
    kinds.set(name, kind);
    return kind;
  }
  return raw.map(d => ({ name: d.name, kind: resolve(d.name), comment: d.comment }));
}

/** Name added, removed, re-kinded, or stripped of its explaining comment. */
export function differences(actual, expected) {
  const have = new Map(actual.map(d => [d.name, d]));
  const want = new Map(expected.map(d => [d.name, d]));
  const out = [];
  for (const [name, exp] of want) {
    const got = have.get(name);
    if (!got) {
      out.push({ token: name, kind: 'removed', message: `${name} removed` });
      continue;
    }
    if (got.kind !== exp.kind) {
      out.push({
        token: name,
        kind: 're-kinded',
        message: `${name} re-kinded (${exp.kind} → ${got.kind})`,
      });
    }
    if (exp.comment && !got.comment) {
      out.push({ token: name, kind: 'comment-lost', message: `${name} comment lost` });
    }
  }
  for (const name of have.keys()) {
    if (!want.has(name)) out.push({ token: name, kind: 'added', message: `${name} added` });
  }
  return out;
}

const FIX = {
  added: 'revert the new token, or accept it with an ADR and node scripts/check-tokens.mjs --write',
  removed: 'restore the token, or accept the removal with an ADR and node scripts/check-tokens.mjs --write',
  're-kinded': 'restore the unit kind, or accept the change with an ADR and node scripts/check-tokens.mjs --write',
  'comment-lost': 'restore the explaining comment on that declaration',
};

export function check(css, contract) {
  return differences(declarations(css), contract);
}

function assertContractShape(contract) {
  if (!Array.isArray(contract)) throw new Error('tokens.contract.json must be an array of {name, kind, comment}');
  for (const row of contract) {
    if (row.value !== undefined) throw new Error(`${row.name ?? '?'}: contract snapshot must not carry a value`);
    if (!row.name || !KINDS.has(row.kind) || typeof row.comment !== 'boolean') {
      throw new Error(`bad contract row ${JSON.stringify(row)}`);
    }
  }
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(process.argv[1], `file://${process.cwd()}/`));
if (invoked) {
  const css = readFileSync(TOKENS, 'utf8');
  const decls = declarations(css);
  if (process.argv.includes('--write')) {
    writeFileSync(CONTRACT, `${JSON.stringify(decls, null, 2)}\n`);
    console.log(`tokens-contract: wrote ${decls.length} tokens`);
    process.exit(0);
  }
  const contract = JSON.parse(readFileSync(CONTRACT, 'utf8'));
  assertContractShape(contract);
  const found = check(css, contract);
  const lines = found.map(p => `${p.message}${fix(FIX[p.kind])}`);
  if (fail(lines)) process.exit(1);
  console.log(`tokens-contract ok (${decls.length} tokens)`);
}
