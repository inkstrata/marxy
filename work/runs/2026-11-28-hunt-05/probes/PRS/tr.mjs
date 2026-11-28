import { profile } from './prof.mjs';
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const bom = process.env.BOM !== '0' ? '\uFEFF' : '';
  let s = bom + '# Doc\n\n';
  for (let i = 1; s.length < 2_000_000; i++) s += `## Section ${i}\n\n- [ ] task ${i}\n- [x] done\n\nSome *prose* here.\n\n`;
  await plantText(page, '/demo/big-tr.md', s);
  await open(page, '/demo/big-tr.md');
  await new Promise((r) => setTimeout(r, 25000));
  console.log(await profile(page, async () => {
    await page.keyboard.press('Alt+6'); await new Promise((r) => setTimeout(r, 25000));
  }));
};
