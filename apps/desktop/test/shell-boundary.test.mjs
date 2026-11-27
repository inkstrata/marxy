// Proves the shell-api boundary: Tauri invoke() and @tauri-apps imports exist
// only under apps/desktop/src/shell, so replacing the shell means rewriting that directory alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfiguredCsp, parseCspString } from '../../../scripts/check-csp.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const shellDir = join('apps', 'desktop', 'src', 'shell');
// `.claude` holds nested agent worktrees: another checkout's files, not this one's.
const skipDirs = new Set(['node_modules', 'dist', 'demo-dist', 'target', 'target-rust', '.git', '.claude', 'results', 'screenshots']);
const sourceExt = /\.(m?[jt]sx?|svelte|vue|html)$/;

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) out.push(...sourceFiles(full));
    } else if (sourceExt.test(entry.name) && statSync(full).size < 2_000_000) {
      out.push(full);
    }
  }
  return out;
}

// Comments are stripped so that prose about the rule — the shell-api contract's own header says
// "No invoke() calls anywhere else" — is not mistaken for a call.
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const files = sourceFiles(repoRoot).map(f => ({
  rel: relative(repoRoot, f),
  text: stripComments(readFileSync(f, 'utf8')),
}));

test('the repository has source files to scan', () => {
  assert.ok(files.length > 3, `expected to scan several files, scanned ${files.length}`);
});

test('invoke( appears only under apps/desktop/src/shell', () => {
  const offenders = files
    // The tests and the scripts that drive the built app over CDP call into it from outside, as a test does.
    .filter(f => !f.rel.startsWith(shellDir + sep) && !f.rel.startsWith(join('apps', 'desktop', 'test') + sep) && !f.rel.startsWith(join('apps', 'desktop', 'scripts') + sep))
    .filter(f => /\binvoke\s*\(/.test(f.text))
    .map(f => f.rel);
  assert.deepEqual(offenders, [], `invoke( outside ${shellDir}: ${offenders.join(', ')}`);
});

test('@tauri-apps is imported only under apps/desktop/src/shell', () => {
  const offenders = files
    .filter(f => !f.rel.startsWith(shellDir + sep))
    .filter(f => /['"]@tauri-apps\//.test(f.text))
    .map(f => f.rel);
  assert.deepEqual(offenders, [], `@tauri-apps import outside ${shellDir}: ${offenders.join(', ')}`);
});

test('the shell directory is the one that does talk to Tauri', () => {
  const shellFiles = files.filter(f => f.rel.startsWith(shellDir + sep));
  assert.ok(shellFiles.some(f => /\binvoke\s*\(/.test(f.text)), 'no invoke() found in the shell directory');
});

/** Runtime (non-type) export names, plus the wildcard and default forms, which can re-export anything. */
function valueExports(text) {
  const names = [];
  for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/g)) names.push(m[1]);
  for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const spec of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
      if (spec.startsWith('type ')) continue;
      const as = /\bas\s+([A-Za-z_$][\w$]*)/.exec(spec);
      names.push(as ? as[1] : spec);
    }
  }
  if (/export\s+default\b/.test(text)) names.push('default');
  if (/export\s*\*/.test(text)) names.push('*');
  return names;
}

// The grep above checks how a call site is spelled, which a convenience wrapper defeats:
// `export const call = invoke` inside this directory, used from anywhere, is still a hole in the
// boundary. So the directory's runtime export surface is an allowlist — one shell object, nothing
// that hands a caller the raw IPC channel.
test('apps/desktop/src/shell exports only the shell object and the memory factory', () => {
  // `eventsForWatch` and `refusalForWatch` are pure filters over an `fs-watch`
  // payload; they take no IPC handle. So do `createEarlyBuffer`, its `EARLY_LIMIT` and `isNotWatching`
  // the bounded buffer for what arrives before a watch knows its key, and a test of an error.
  // `clipboard`: the clipboard type names, the write check and the Tauri adapter, which takes
  // `invoke` as an argument; it holds no IPC handle. `pathsOnce` keeps the answer of a `configPaths` it is
  // handed; it holds none either. `runFrame` and `headsFrame` parse run_command's and read_archive_heads' answers from bytes
  // they are handed.
  const allowed = ['shell', 'createMemoryShell', 'eventsForWatch', 'refusalForWatch', 'createEarlyBuffer', 'EARLY_LIMIT', 'isNotWatching', 'clipboard', 'pathsOnce', 'runFrame', 'headsFrame'];
  const exported = files
    .filter(f => f.rel.startsWith(shellDir + sep))
    .flatMap(f => valueExports(f.text).map(name => ({ name, rel: f.rel })));
  assert.ok(exported.length > 0, `no exports found under ${shellDir}`);
  const offenders = exported.filter(e => !allowed.includes(e.name)).map(e => `${e.rel}:${e.name}`);
  assert.deepEqual(offenders, [], `${shellDir} may export only ${allowed.join(', ')}; found ${offenders.join(', ')}`);
});

test('app.ts never imports shell/tauri.ts', () => {
  const app = files.find(f => f.rel === join('apps', 'desktop', 'src', 'app.ts'));
  assert.ok(app, 'apps/desktop/src/app.ts is missing');
  assert.doesNotMatch(app.text, /shell\/tauri/);
});

test('memory.ts is never imported from main.ts', () => {
  const main = files.find(f => f.rel === join('apps', 'desktop', 'src', 'main.ts'));
  assert.ok(main, 'apps/desktop/src/main.ts is missing');
  assert.doesNotMatch(main.text, /memory\.ts|createMemoryShell|shell\/memory/);
});

test('main.ts is at most 30 lines and contains no parse or render call', () => {
  const raw = readFileSync(join(repoRoot, 'apps', 'desktop', 'src', 'main.ts'), 'utf8');
  const lines = raw.replace(/\n$/, '').split('\n');
  assert.ok(lines.length <= 30, `main.ts is ${lines.length} lines; startApp must own startup`);
  assert.doesNotMatch(stripComments(raw), /parseMarkdown|renderDocumentSafeHtml|\.innerHTML\s*=/);
});

/** Every `invoke('name')` in tauri.ts must appear in `generate_handler!`. */
function invokeCommandNames(tauriText) {
  return [...new Set([...tauriText.matchAll(/\binvoke(?:<[^>]*>)?\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]))];
}

function handlerCommandNames(mainText) {
  const block = /generate_handler!\[([\s\S]*?)\]/.exec(mainText)?.[1] ?? '';
  const names = [];
  for (const part of block.split(',')) {
    const token = part.trim().replace(/\s+/g, ' ');
    const scoped = /(?:commands::(?:fs|image|os|search|chars|run|archive|tables|font|media|recent)|pasteboard|detect|remote|scope|encoding::commands|outlook::commands|legacy_office)::(\w+)/.exec(token);
    if (scoped) names.push(scoped[1]);
    else if (/^[a-z][a-z0-9_]*$/.test(token)) names.push(token);
  }
  return names;
}

test('every invoke() name in tauri.ts is registered in generate_handler!', () => {
  const tauri = readFileSync(join(repoRoot, 'apps', 'desktop', 'src', 'shell', 'tauri.ts'), 'utf8');
  const main = readFileSync(join(repoRoot, 'apps', 'desktop', 'src-tauri', 'src', 'main.rs'), 'utf8');
  const invoked = invokeCommandNames(stripComments(tauri));
  const registered = new Set(handlerCommandNames(main));
  const missing = invoked.filter((name) => !registered.has(name));
  assert.deepEqual(missing, [], `unregistered invoke(): ${missing.join(', ')}`);
});

test('the invoke ↔ handler check fails when a handler name is removed', () => {
  const tauri = readFileSync(join(repoRoot, 'apps', 'desktop', 'src', 'shell', 'tauri.ts'), 'utf8');
  const main = readFileSync(join(repoRoot, 'apps', 'desktop', 'src-tauri', 'src', 'main.rs'), 'utf8');
  const invoked = invokeCommandNames(stripComments(tauri));
  const registered = handlerCommandNames(main).filter((name) => name !== 'image_size');
  const missing = invoked.filter((name) => !registered.includes(name));
  assert.deepEqual(missing, ['image_size']);
});

const srcTauri = join(repoRoot, 'apps', 'desktop', 'src-tauri');

/** The app manifest's commands in build.rs. */
function manifestCommandNames(buildText) {
  const block = /const COMMANDS: &\[&str\] = &\[([\s\S]*?)\];/.exec(buildText)?.[1] ?? '';
  return [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

test('build.rs declares an app manifest of exactly the commands in generate_handler!', () => {
  const build = readFileSync(join(srcTauri, 'build.rs'), 'utf8');
  const main = readFileSync(join(srcTauri, 'src', 'main.rs'), 'utf8');
  assert.match(build, /AppManifest::new\(\)\.commands\(COMMANDS\)/);
  const declared = manifestCommandNames(build);
  assert.equal(declared.length, 57);
  assert.deepEqual([...declared].sort(), [...handlerCommandNames(main)].sort());
});

test('the one capability is the main window\'s: listen, unlisten and each app command, no plugin and no core:default', () => {
  assert.deepEqual(readdirSync(join(srcTauri, 'capabilities')), ['main.json']);
  const cap = JSON.parse(readFileSync(join(srcTauri, 'capabilities', 'main.json'), 'utf8'));
  const commands = manifestCommandNames(readFileSync(join(srcTauri, 'build.rs'), 'utf8'));
  assert.equal(cap.identifier, 'main');
  assert.deepEqual(cap.windows, ['main']);
  assert.equal(cap.remote, undefined, 'no remote origin may call the app');
  assert.deepEqual(cap.permissions, [
    'core:event:allow-listen',
    'core:event:allow-unlisten',
    ...commands.map((c) => `allow-${c.replaceAll('_', '-')}`),
  ]);
  assert.ok(!cap.permissions.some((p) => /^(dialog|clipboard-manager|fs|shell|opener):|^core:default$/.test(p)));
});

test('no page code reaches a plugin: the dialogs and the clipboard go through the app\'s own commands', () => {
  // tauri-check.mjs calls plugin:dialog|open in the real window on purpose, to see it refused.
  const page = files.filter((f) => f.rel.startsWith(join('apps', 'desktop', 'src') + sep) || f.rel.startsWith(`packages${sep}`));
  const offenders = page.filter((f) => /['"]plugin:[a-z-]+\|/.test(f.text)).map((f) => f.rel);
  assert.deepEqual(offenders, []);
});

test('the CSP has no eval and loads nothing from off the machine', () => {
  const csp = parseCspString(JSON.parse(readFileSync(join(srcTauri, 'tauri.conf.json'), 'utf8')).app.security.csp);
  const local = new Set(["'none'", "'self'", 'data:', 'blob:', 'ipc:', 'marxy-file:', 'marxy-remote:']);
  for (const [directive, sources] of csp) {
    for (const source of sources) {
      assert.notEqual(source, "'unsafe-eval'", directive);
      assert.notEqual(source, "'wasm-unsafe-eval'", directive);
      if (source === "'unsafe-inline'") {
        assert.equal(directive, 'style-src-attr', 'inline only for style attributes');
        continue;
      }
      assert.ok(local.has(source) || /^http:\/\/(ipc|marxy-file|marxy-remote)\.localhost$/.test(source), `${directive} ${source}`);
    }
  }
  assert.deepEqual(csp.get('default-src'), ["'none'"]);
  assert.deepEqual(csp.get('script-src'), ["'self'"]);
});

test('the release navigation guard refuses a local server on any port; only a debug build loads from one', () => {
  const main = readFileSync(join(srcTauri, 'src', 'main.rs'), 'utf8');
  assert.match(main, /on_navigation\(\|_, url\| navigation_allowed\(url, cfg!\(debug_assertions\)\)\)/);
  // The cases themselves are cargo test's (main.rs, a_release_build_refuses_a_local_server_that_a_debug_build_loads_from).
  assert.match(main, /!navigation_allowed\(&local\.parse\(\)\.unwrap\(\), false\)/);
  assert.match(main, /"http:\/\/localhost:1234\/"/);
});

test('on Windows the main window has dragDropEnabled off and is otherwise the same window', () => {
  const base = JSON.parse(readFileSync(join(srcTauri, 'tauri.conf.json'), 'utf8')).app.windows;
  const windows = JSON.parse(readFileSync(join(srcTauri, 'tauri.windows.conf.json'), 'utf8')).app.windows;
  assert.equal(base.length, 1);
  assert.equal(base[0].label, 'main');
  assert.equal(base[0].dragDropEnabled, undefined, 'the drop stays on where tab drag does not need it off');
  // A platform file's array replaces the base one whole (JSON merge patch), so the window is restated in full.
  assert.deepEqual(windows, [{ ...base[0], dragDropEnabled: false }]);
});

test('run_command is sent a command id, never a program or its arguments', () => {
  const tauri = stripComments(readFileSync(join(repoRoot, 'apps', 'desktop', 'src', 'shell', 'tauri.ts'), 'utf8'));
  assert.match(tauri, /JSON\.stringify\(\{ id, cwd \}\)/);
  assert.doesNotMatch(tauri, /\bprogram\b/);
});

test('local files load through marxy-file: only; the asset protocol is off and the CSP matches check-csp', () => {
  const conf = JSON.parse(readFileSync(join(srcTauri, 'tauri.conf.json'), 'utf8'));
  assert.equal(conf.app.security.assetProtocol, undefined);
  assert.doesNotMatch(readFileSync(join(srcTauri, 'Cargo.toml'), 'utf8'), /protocol-asset/);
  assert.match(readFileSync(join(srcTauri, 'src', 'main.rs'), 'utf8'), /register_asynchronous_uri_scheme_protocol\(file_scheme::SCHEME/);
  const csp = conf.app.security.csp;
  assert.equal(csp, loadConfiguredCsp());
  assert.doesNotMatch(csp, /\basset:|asset\.localhost/);
  for (const directive of ['img-src', 'font-src', 'media-src']) {
    assert.match(csp, new RegExp(`${directive} [^;]*marxy-file: http://marxy-file\\.localhost`), directive);
  }
  const tauri = stripComments(readFileSync(join(repoRoot, 'apps', 'desktop', 'src', 'shell', 'tauri.ts'), 'utf8'));
  assert.match(tauri, /convertFileSrc\(path, 'marxy-file'\)/);
});
