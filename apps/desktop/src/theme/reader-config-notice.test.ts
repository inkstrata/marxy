// A config.toml that cannot be read says so; one that is not there says nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readReaderConfig, takeConfigNotices } from './reader-config.ts';

const enc = new TextEncoder();
const shellFor = (read: () => Promise<Uint8Array>) => ({
  configPaths: async () => ({ config: '/c/config.toml', data: '/d' }),
  readFile: read,
});

test('a config.toml that cannot be read is reported with the reason, and the defaults stand', async () => {
  const config = await readReaderConfig(
    shellFor(async () => {
      throw { code: 'io', message: '/c/config.toml: Access is denied. (os error 5)', path: '/c/config.toml' };
    }),
  );
  assert.equal(config.size, 20);
  const notices = takeConfigNotices();
  assert.equal(notices.length, 1);
  assert.match(notices[0]!, /config\.toml could not be read \(Access is denied\)/);
  assert.match(notices[0]!, /default/);
  assert.doesNotMatch(notices[0]!, /os error|\/c\/config/);
});

test('a config.toml that is not valid TOML is reported with the parser\'s reason', async () => {
  const config = await readReaderConfig(shellFor(async () => enc.encode('size = \n[[')));
  assert.equal(config.size, 20);
  const notices = takeConfigNotices();
  assert.equal(notices.length, 1);
  assert.match(notices[0]!, /config\.toml is not valid TOML \(.+\)/);
});

test('a missing config.toml says nothing', async () => {
  await readReaderConfig(
    shellFor(async () => {
      throw Object.assign(new Error('not found: /c/config.toml'), { code: 'not-found' });
    }),
  );
  assert.deepEqual(takeConfigNotices(), []);
});

test('a readable config.toml says nothing', async () => {
  await readReaderConfig(shellFor(async () => enc.encode('size = 22\n')));
  assert.deepEqual(takeConfigNotices(), []);
});
