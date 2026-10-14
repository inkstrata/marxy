// Parses the shipped CSP and refuses runtime <style> creation in the release-style paths (MARXY-250).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, fail, fix } from './lib/repo.mjs';

const TAURI_CONF = join(ROOT, 'apps/desktop/src-tauri/tauri.conf.json');

/**
 * Every runtime source must inject CSS only through adoptedStyleSheets (docs/plan/tasks/MARXY-250.md).
 * Walked, not listed: a hand-kept list missed the frontispiece's <style>, added after the list was written.
 */
export const RUNTIME_STYLE_ROOTS = ['apps/desktop/src', 'packages/core/src', 'packages/theme/src', 'packages/typeset/src'];

function isRuntimeSource(rel) {
  return /\.(?:ts|tsx|mjs|js)$/.test(rel) && !/\.test\.|\/test\/|\/testing\/|\.d\.ts$/.test(rel);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else if (isRuntimeSource(rel)) out.push(rel);
  }
  return out;
}

const STYLE_TAG_RE = /createElement\s*\(\s*['"]style['"]\s*\)/;
// CodeMirror creates its own <style> elements (style-mod), which the release policy refuses unless they carry the page's
// style nonce (F-98): `baseExtensions` installs `EditorView.cspNonce`, so a mount must go through it or install its own.
const EDITOR_MOUNT_RE = /new\s+EditorView\s*\(/;
const BASE_EXTENSIONS_DEF_RE = /function\s+baseExtensions\s*\(/;

export function parseCspString(csp) {
  const directives = new Map();
  for (const part of csp.split(';').map((s) => s.trim()).filter(Boolean)) {
    const tokens = part.split(/\s+/);
    const name = tokens.shift();
    if (name) directives.set(name, tokens);
  }
  return directives;
}

export function cspProblems(csp) {
  const problems = [];
  const dirs = parseCspString(csp);
  const styleSrc = dirs.get('style-src') ?? [];
  if (styleSrc.includes("'unsafe-inline'")) {
    problems.push(`style-src must not include 'unsafe-inline' when Tauri adds a style nonce${fix('drop unsafe-inline from style-src; use adoptedStyleSheets for runtime CSS')}`);
  }
  const styleAttr = dirs.get('style-src-attr') ?? [];
  if (!styleAttr.includes("'unsafe-inline'")) {
    problems.push(`style-src-attr must include 'unsafe-inline' for KaTeX layout attributes${fix("add style-src-attr 'unsafe-inline' to tauri.conf.json")}`);
  }
  return problems;
}

export function runtimeStyleProblems(sources) {
  const problems = [];
  for (const [rel, text] of Object.entries(sources)) {
    if (STYLE_TAG_RE.test(text)) {
      problems.push(`${rel}: runtime code creates a <style> element${fix('use adoptRuntimeSheet / adoptedStyleSheets instead')}`);
    }
    if (EDITOR_MOUNT_RE.test(text) && !/cspNonce|baseExtensions\s*\(/.test(text)) {
      problems.push(`${rel}: builds an EditorView without a style nonce, so CodeMirror's <style> is refused in a release build${fix('take the extensions from baseExtensions (source/editor.ts), or add EditorView.cspNonce.of(pageStyleNonce())')}`);
    }
    if (BASE_EXTENSIONS_DEF_RE.test(text) && !/EditorView\.cspNonce/.test(text)) {
      problems.push(`${rel}: baseExtensions does not install EditorView.cspNonce${fix('add EditorView.cspNonce.of(pageStyleNonce()) to its extensions')}`);
    }
  }
  return problems;
}

export function loadConfiguredCsp() {
  const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf8'));
  const csp = conf?.app?.security?.csp;
  if (typeof csp !== 'string' || csp.length === 0) {
    throw new Error('tauri.conf.json is missing app.security.csp');
  }
  return csp;
}

export function loadRuntimeStyleSources() {
  const sources = {};
  for (const rel of RUNTIME_STYLE_ROOTS.flatMap((root) => walk(root))) {
    sources[rel] = readFileSync(join(ROOT, rel), 'utf8');
  }
  return sources;
}

/** CSP Tauri serves in release: configured policy plus a per-load nonce on style-src. */
export function releaseStyleCsp(baseCsp, nonce) {
  const dirs = parseCspString(baseCsp);
  const styleSrc = (dirs.get('style-src') ?? []).filter((t) => t !== "'unsafe-inline'");
  styleSrc.push(`'nonce-${nonce}'`);
  dirs.set('style-src', styleSrc);
  if (!dirs.has('style-src-attr')) dirs.set('style-src-attr', ["'unsafe-inline'"]);
  return [...dirs.entries()].map(([name, vals]) => `${name} ${vals.join(' ')}`).join('; ');
}

export function injectStyleNonces(html, nonce) {
  return html.replace(/<style\b/g, `<style nonce="${nonce}"`);
}

function runSelftest() {
  const planted = { 'planted.ts': "document.createElement('style');" };
  const caught = runtimeStyleProblems(planted);
  if (caught.length !== 1) {
    console.error('check-csp --selftest: planted createElement(style) was not caught');
    process.exit(1);
  }
  const unnonced = runtimeStyleProblems({
    'planted-mount.ts': 'const view = new EditorView({ state, parent });',
    'planted-base.ts': 'export async function baseExtensions(a) { return []; }',
  });
  if (unnonced.length !== 2) {
    console.error('check-csp --selftest: a planted EditorView without a style nonce was not caught');
    process.exit(1);
  }
  const bad = cspProblems("style-src 'self' 'unsafe-inline'");
  if (!bad.some((p) => p.includes('unsafe-inline'))) {
    console.error('check-csp --selftest: bad style-src was not caught');
    process.exit(1);
  }
  console.log('check-csp selftest ok');
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--selftest')) {
    runSelftest();
    return;
  }
  const problems = [...cspProblems(loadConfiguredCsp()), ...runtimeStyleProblems(loadRuntimeStyleSources())];
  if (fail(problems)) process.exit(1);
  console.log('check-csp ok');
}

import { fileURLToPath } from 'node:url';

const invoked =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fileURLToPath(new URL(process.argv[1], `file://${process.cwd()}/`));
if (invoked) main();
