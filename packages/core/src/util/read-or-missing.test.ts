import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOrMissing } from './read-or-missing.ts';

const reject = (e: unknown) => () => Promise.reject(e);

test('bytes, absent only for not-found, failed for anything else', async () => {
  assert.deepEqual(await readOrMissing(async () => Uint8Array.of(1)), { kind: 'bytes', bytes: Uint8Array.of(1) });
  assert.deepEqual(await readOrMissing(reject({ code: 'not-found', message: 'x' })), { kind: 'absent' });
  for (const e of [{ code: 'io', message: 'locked' }, { code: 'permission' }, new Error('C:/not found/a: denied'), 'bare', null]) {
    const r = await readOrMissing(reject(e));
    assert.equal(r.kind, 'failed');
    assert.equal(r.kind === 'failed' && r.error, e);
  }
});
