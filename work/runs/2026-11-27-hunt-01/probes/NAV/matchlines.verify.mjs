// Times matchLines on growing 'a'*n+'!' lines with (a+)+$ : exponential growth proves no guard.
import { matchLines } from '/Users/<user>/Dev/marxy-wt/hunt-01/apps/desktop/src/left/search-model.ts';
for (const n of [20, 24, 26, 28, 30]) {
  const t = Date.now();
  matchLines('a'.repeat(n) + '!\n', /(a+)+$/g);
  console.log('n', n, Date.now() - t, 'ms');
}
