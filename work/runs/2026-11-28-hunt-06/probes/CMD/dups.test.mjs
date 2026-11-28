import { test } from 'node:test';
import { commands } from '/D:/Dev/marxy-wt/hunt-06/apps/desktop/src/commands/index.ts';
test('dups', () => {
  const by = new Map();
  for (const c of commands()) { if (c.listed === false) continue; (by.get(c.title) ?? by.set(c.title, []).get(c.title)).push(`${c.id}[${c.key ?? ''}${c.keys ? ' ' + c.keys.join(',') : ''}]`); }
  for (const [t, ids] of by) if (ids.length > 1) console.log('DUP', JSON.stringify(t), ids.join(' | '));
  const ids = new Map();
  for (const c of commands()) ids.set(c.id, (ids.get(c.id) ?? 0) + 1);
  for (const [i, n] of ids) if (n > 1) console.log('DUPID', i, n);
});
