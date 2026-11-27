export default async ({ boot, plantText, shot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/evil.txt', 'a'.repeat(36) + '!\n');
  await page.waitForTimeout(1000);
  for (const q of ['#aaaaaaaa', '#/a+!/', '#/(a+)+$/']) {
    await page.keyboard.press('Control+k'); await page.keyboard.type(q); await page.waitForTimeout(1500);
    const t0 = Date.now();
    console.log(q, await Promise.race([page.evaluate(() => document.querySelector('#marxy-palette')?.innerText.slice(0, 300)), new Promise(r => setTimeout(() => r('STALL'), 10000))]), Date.now() - t0);
    await page.keyboard.press('Escape');
  }
};
