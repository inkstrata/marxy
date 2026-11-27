const lorem = 'The quick brown fox jumps over the lazy dog [a link](https://e.com/x) and *em* `code` more words to wrap across lines. ';
export default async ({ boot, open, plantText, shot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  let s = ''; for (let h = 0; s.length < 20e6; h++) s += `\n## H ${h}\n\n${lorem.repeat(8)}\n\n- a\n- b\n\n`;
  await plantText(page, '/demo/big20.md', s);
  await open(page, '/demo/big20.md'); await page.waitForTimeout(3000);
  console.log(await page.evaluate(() => document.body.innerText.slice(0, 600)));
  await shot(page, 'big20');
};
