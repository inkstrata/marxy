export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  let md = '# Code first\n\n';
  for (let i = 0; i < 40; i++) md += `Block ${i}:\n\n\`\`\`js\nconst a${i} = ${i}; function f${i}(x) { return x * ${i}; }\n\`\`\`\n\n`;
  for (let i = 0; md.length < 3_000_000; i++) md += `## S ${i}\n\nLorem ipsum dolor sit amet ${i} consectetur adipiscing elit, sed do eiusmod tempor.\n\n`;
  await plantText(page, '/demo/code-big.md', md);
  await page.evaluate(() => { window.marxy.handle.open('/demo/code-big.md'); });
  const t0 = Date.now(); let last = -1; const seen = [];
  for (let i = 0; i < 300; i++) {
    const c = await Promise.race([page.evaluate(() => [document.querySelectorAll('#doc code[data-marxy-done]').length, document.querySelectorAll('#doc pre code').length, document.querySelectorAll('#doc > *').length].join('/')), new Promise((r) => setTimeout(() => r('STALL'), 10000))]);
    if (c !== last) { seen.push(`${Date.now() - t0}ms done/code/blocks ${c}`); last = c; }
    if (c.startsWith('40/')) break;
    await page.waitForTimeout(100);
  }
  console.log(seen.join('\n'));
};
