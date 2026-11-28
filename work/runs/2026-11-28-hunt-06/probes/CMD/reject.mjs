export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/a.md', 'alpha\n');
  await open(page, '/demo/a.md');
  await page.evaluate(() => { window.__rej = []; window.addEventListener('unhandledrejection', (e) => window.__rej.push(String(e.reason))); });
  const notices = () => page.evaluate(() => [...document.querySelectorAll('[class*=notice]')].map(n => n.textContent.trim().slice(0, 120)).filter(Boolean));
  for (const name of ['Save as', 'Fork this file', 'New file here']) {
    await page.keyboard.press('Control+Shift+p');
    await page.keyboard.type(name);
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    console.log(name, JSON.stringify({ rej: await page.evaluate(() => window.__rej), notices: await notices() }));
  }
};
