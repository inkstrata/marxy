// First colour vs mount completion: 40 fences on top, then ~2.5 MB of paragraphs.
export default async ({ boot, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  let md = '# Code first\n\n';
  for (let i = 0; i < 40; i++) md += `B${i}:\n\n\`\`\`js\nconst a${i} = ${i}; function f${i}(x) { return x * ${i}; }\n\`\`\`\n\n`;
  for (let i = 0; md.length < 2_500_000; i++) md += `## S ${i}\n\nLorem ipsum dolor sit amet ${i} consectetur adipiscing elit.\n\n`;
  await plantText(page, '/demo/fc.md', md);
  await page.evaluate(() => { window.marxy.handle.open('/demo/fc.md'); });
  const t0 = Date.now(); let last = '', firstColour = null, lastBlocks = 0, stableAt = 0;
  for (let i = 0; i < 400; i++) {
    const c = await Promise.race([page.evaluate(() => [[...document.querySelectorAll('#doc code[data-marxy-done]')].filter((e) => e.textContent.includes('const a')).length, document.querySelectorAll('#doc > *').length].join('/')), new Promise((r) => setTimeout(() => r('STALL'), 10000))]);
    const [d, b] = c.split('/').map(Number); const t = Date.now() - t0;
    if (d > 0 && firstColour === null) firstColour = t;
    if (b !== lastBlocks) { lastBlocks = b; stableAt = t; }
    if (d >= 17) break;
    await page.waitForTimeout(100);
  }
  console.log(JSON.stringify({ firstColourMs: firstColour, blocksStoppedGrowingMs: stableAt, blocks: lastBlocks }));
};
