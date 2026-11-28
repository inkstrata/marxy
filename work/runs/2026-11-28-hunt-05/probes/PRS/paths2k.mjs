import { profile } from './prof.mjs';
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const filler = 'Lorem ipsum dolor sit amet. '.repeat(30);
  let s = '# Doc\n\n', n = 0;
  for (let i = 1; s.length < 2_000_000; i++) { s += `## Section ${i}\n\n${filler}\nSee \`src/file${i}.ts\`.\n\n`; n = i; }
  console.log('distinct paths', n, 'chars', s.length);
  await plantText(page, '/demo/paths2k.md', s);
  console.log(await profile(page, async () => {
    await open(page, '/demo/paths2k.md');
    await new Promise((r) => setTimeout(r, 25000));
    await page.keyboard.press('Alt+4'); await new Promise((r) => setTimeout(r, 8000));
  }));
};
