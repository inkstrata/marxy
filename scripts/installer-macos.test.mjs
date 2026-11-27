import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildFolderName, otherRegistrations, parseInstallerArgs, pickCliDir, pickDest, SHIM_MARK, shimIsOurs, shimText, swapIn } from './installer-macos.mjs';

test('arguments: defaults, flags, values inline or apart, and the Windows spellings', () => {
  const d = parseInstallerArgs([]);
  assert.equal(d.ref, null);
  assert.equal(d.install && d.cli && d.launch, true);
  assert.equal(d.dmg, false);
  const o = parseInstallerArgs(['--ref', 'agent/x', '--dmg', '--no-launch', '--dest=/tmp/apps', '--no-cli']);
  assert.deepEqual([o.ref, o.dmg, o.launch, o.dest, o.cli, o.install], ['agent/x', true, false, '/tmp/apps', false, true]);
  const w = parseInstallerArgs(['-Ref', 'main', '-NoInstall', '-NoLaunch']);
  assert.deepEqual([w.ref, w.install, w.launch], ['main', false, false]);
  assert.throws(() => parseInstallerArgs(['--ref']), /needs a value/);
  assert.throws(() => parseInstallerArgs(['--ref', '--dmg']), /needs a value/);
  assert.throws(() => parseInstallerArgs(['--bogus']), /unknown argument/);
});

test('the kept build folder has the shape pnpm work status looks for', () => {
  const name = buildFolderName(new Date(2026, 10, 6, 9, 5), 'abc1234');
  assert.equal(name, '20261106-0905-abc1234');
  assert.match(name, /^\d{8}-\d{4}-/);
});

test('install goes to /Applications when it is writable, else to ~/Applications, and never beside a copy it cannot replace', () => {
  assert.equal(pickDest('/x/y'), '/x/y');
  assert.equal(pickDest(null, { exists: () => true, writable: () => true }), '/Applications');
  assert.equal(pickDest(null, { exists: () => false, writable: () => true }), '/Applications');
  assert.equal(pickDest(null, { home: '/Users/r', exists: () => false, writable: () => false }), '/Users/r/Applications');
  assert.throws(() => pickDest(null, { home: '/Users/r', exists: () => true, writable: () => false }), /cannot change \/Applications.*--dest/);
});

test('the swap keeps the old bundle until the new one is in, and puts it back when the swap fails', () => {
  const fake = (failOn) => {
    const log = [];
    const present = new Set(['/A/Marxy.app', '/A/Marxy.app.installing']);
    return {
      log,
      present,
      ops: {
        exists: (p) => present.has(p),
        rename: (from, to) => {
          if (`${from} -> ${to}` === failOn) throw new Error('rename failed');
          present.delete(from);
          present.add(to);
          log.push(`${from} -> ${to}`);
        },
        remove: (p) => { present.delete(p); log.push(`rm ${p}`); },
      },
    };
  };
  const ok = fake(null);
  swapIn('/A/Marxy.app.installing', '/A/Marxy.app', '/A/Marxy.app.previous', ok.ops);
  assert.deepEqual(ok.log, ['/A/Marxy.app -> /A/Marxy.app.previous', '/A/Marxy.app.installing -> /A/Marxy.app', 'rm /A/Marxy.app.previous']);
  const bad = fake('/A/Marxy.app.installing -> /A/Marxy.app');
  assert.throws(() => swapIn('/A/Marxy.app.installing', '/A/Marxy.app', '/A/Marxy.app.previous', bad.ops), /rename failed/);
  assert.deepEqual(bad.log, ['/A/Marxy.app -> /A/Marxy.app.previous', '/A/Marxy.app.previous -> /A/Marxy.app']);
  assert.ok(bad.present.has('/A/Marxy.app'), 'the old copy is back in place');
});

test('the command goes to ~/.local/bin only when it is on the PATH', () => {
  assert.equal(pickCliDir(null, { home: '/Users/r', path: '/usr/bin:/Users/r/.local/bin' }), '/Users/r/.local/bin');
  assert.equal(pickCliDir(null, { home: '/Users/r', path: '/usr/bin:/bin' }), null);
  assert.equal(pickCliDir('/opt/bin', { path: '' }), '/opt/bin');
});

test('the command opens through Launch Services, quotes the app path, and is the only file it will overwrite', () => {
  const text = shimText("/Users/o'b/Applications/Marxy.app");
  assert.ok(text.startsWith('#!/bin/sh\n'));
  assert.ok(text.includes(SHIM_MARK));
  assert.ok(text.includes(`app='/Users/o'\\''b/Applications/Marxy.app'`));
  assert.ok(text.includes('exec open -a "$app" "$@"'));
  const dir = mkdtempSync(join(tmpdir(), 'marxy-shim-'));
  try {
    const path = join(dir, 'marxy');
    assert.equal(shimIsOurs(path), true, 'absent');
    writeFileSync(path, text, { mode: 0o755 });
    assert.equal(shimIsOurs(path), true, 'ours');
    assert.equal(spawnSync('sh', ['-n', path]).status, 0, 'valid sh');
    writeFileSync(path, '#!/bin/sh\necho someone else\n');
    assert.equal(shimIsOurs(path), false, "someone else's");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('other registrations: every copy of the bundle id but the installed one, gone paths included', () => {
  const rec = (path, id) => `--------------------------------------------------------------------------------\nbundle id:                  1\npath:                       ${path} (0x2ec4)\nname:                       Marxy\nidentifier:                 ${id}\n`;
  const dump = [
    rec('/Applications/Marxy.app', 'dev.marxy.app'),
    rec('/Users/r/marxy-wt/app/target/release/bundle/macos/Marxy.app', 'dev.marxy.app'),
    rec('/Volumes/dmg.abc/Marxy.app', 'dev.marxy.app'),
    rec('/Volumes/dmg.abc/Marxy.app', 'dev.marxy.app'),
    rec('/Applications/Other.app', 'com.example.other'),
    'identifier:                 dev.marxy.app\n',
  ].join('');
  assert.deepEqual(otherRegistrations(dump, '/Applications/Marxy.app'), ['/Users/r/marxy-wt/app/target/release/bundle/macos/Marxy.app', '/Volumes/dmg.abc/Marxy.app']);
});
