export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const n of ['Aaa', 'Bbb', 'Ccc']) await plantText(page, `/demo/p/${n}.md`, `# ${n}\n\ntext [to Aaa](Aaa.md) [to Bbb](Bbb.md)\n`);
  const st = async (m) => { await page.waitForTimeout(700); console.log(m, await page.evaluate(() => { const f = (n) => { const b = document.querySelector(`button[aria-label="${n}"]`); return b ? (b.disabled ? 'off' : 'on') : '?'; }; return window.marxy.handle.panes().focused.path().split('/').pop() + ' Back=' + f('Back') + ' Fwd=' + f('Forward'); })); };
  await open(page, '/demo/p/Aaa.md', 600);
  // Open the other two the way a reader does: the Line (Mod+K), type, Enter.
  for (const n of ['Bbb', 'Ccc']) { await page.keyboard.press('Control+k'); await page.waitForTimeout(300); await page.keyboard.type(n); await page.waitForTimeout(500); await page.keyboard.press('Enter'); await st('line-open ' + n); }
  await page.click('article h1'); 
  await page.keyboard.press('Alt+ArrowLeft'); await st('key Back (palette history)');
  await page.keyboard.press('Alt+ArrowRight'); await st('key Forward');
  // now step with button to Bbb, then use keys
  await page.click('button[aria-label="Back"]'); await st('button Back');
  await page.click('button[aria-label="Back"]'); await st('button Back 2');
  await page.keyboard.press('Alt+ArrowRight'); await st('key Forward after button Back');
  await open(page, '/demo/p/Aaa.md', 800); await st('handle open Aaa');
  await page.click('article a:has-text("to Bbb")'); await st('link -> Bbb');
  await page.keyboard.press('Alt+ArrowLeft'); await st('key Back over link');
  await page.keyboard.press('Alt+ArrowRight'); await st('key Forward over link');
  await page.click('button[aria-label="Forward"]', { timeout: 3000 }).catch(() => console.log('Forward button disabled')); await st('after Forward button');
};
