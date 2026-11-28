export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/md.md', '# H\n\nalpha\n\nbravo\n\ncharlie\n\ndelta\n\n- x\n- y\n');
  await open(page, '/demo/md.md');
  const state = () => page.evaluate(() => ({ sel: getSelection().toString(), cur: [...document.querySelectorAll('[data-marxy-selected],[aria-selected=true],.marxy-selected,.marxy-cursor')].map(e => e.textContent.trim().slice(0,30)).slice(0,6), mode: document.body.dataset.marxyMode }));
  for (const q of [':3', ':5-9', ':9-5', ':1']) {
    await page.keyboard.press('Control+k');
    await page.keyboard.type(q);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    console.log(JSON.stringify(q), JSON.stringify(await state()));
  }
};
