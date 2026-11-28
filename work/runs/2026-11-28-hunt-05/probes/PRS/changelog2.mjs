import { profile } from './prof.mjs';
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  let s = '# Changelog\n\n';
  for (let i = 1; s.length < 2_000_000; i++) s += `## ${i}.0.0\n\n- fixed \`src/a${i}.ts\` thing\n- more **bold** text\n\n`;
  await plantText(page, '/demo/CHANGELOG.md', s);
  await open(page, '/demo/CHANGELOG.md');
  await new Promise((r) => setTimeout(r, 20000));
  console.log(await profile(page, async () => { await page.keyboard.press('Control+k'); await new Promise((r) => setTimeout(r, 6000)); await page.keyboard.type('release notes'); await new Promise((r) => setTimeout(r, 8000)); }));
};
