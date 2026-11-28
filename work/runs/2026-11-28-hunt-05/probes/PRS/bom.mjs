import { profile } from './prof.mjs';
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const bom = process.env.BOM !== '0' ? '\uFEFF' : '';
  let s = bom + '# Doc\n\n';
  for (let i = 1; s.length < 2_000_000; i++) s += `## Section ${i}\n\nSee \`src/file${i}.ts\` and [link](http://x/${i}).\n\n`;
  await plantText(page, '/demo/big-bom.md', s);
  console.log(await profile(page, async () => {
    await open(page, '/demo/big-bom.md');
    await new Promise((r) => setTimeout(r, 25000));
    await page.keyboard.press('Alt+4'); await new Promise((r) => setTimeout(r, 8000));
  }));
};
