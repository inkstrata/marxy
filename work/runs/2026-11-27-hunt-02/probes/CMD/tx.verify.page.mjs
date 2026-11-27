const mk = (n) => { let s=''; for (let h=0;h<n;h++) s+=`## Heading ${h}\n\nSome plain prose for section ${h}, with a [link](https://e.com/${h}).\n\n1. one\n2. two\n\n- [ ] task\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n`; return s; };
const race = (p, l) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL>10s ' + l)), 10000))]);
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/big.md', mk(Number(process.env.N||1500)));
  await open(page, '/demo/big.md');
  await page.evaluate(() => new Promise(r => setTimeout(r, 4000)));
  console.log('open settled');
  for (const k of ['Alt+2', 'Alt+6']) {
    const t = Date.now(); let err = '';
    try { await race(page.keyboard.press(k), k); await race(page.evaluate(() => 1), k + ' answer'); } catch (e) { err = e.message; }
    console.log(k, 'until page answers', Date.now() - t, 'ms', err);
  }
  for (let i = 0; i < 6; i++) { const t = Date.now(); let err = '';
    try { await race(page.evaluate(() => new Promise(r => setTimeout(r, 0))), 'ping' + i); } catch (e) { err = e.message; }
    console.log('ping', i, 'latency', Date.now() - t, 'ms', err); if (err) break; await new Promise(r => setTimeout(r, 1000)); }
};
