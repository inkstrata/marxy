import { bigFile } from '../gen.mjs';
import { cdpOf, step } from './lib.mjs';
export default async ({ boot, open, plantText }) => {
  const mb = Number(process.env.MB || 2);
  const page = await boot('plans/pg16-upgrade-plan.md');
  const get = await cdpOf(page);
  const { name, text } = await bigFile('md-headings', Math.round(mb * 1e6));
  const n = (text.match(/^#+ /gm) || []).length;
  const target = n - 20;
  const at = text.indexOf(`Heading ${target}\n`);
  await plantText(page, '/demo/' + name, text);
  console.log('=== md-headings ' + mb + ' MB bytes ' + text.length + ' headings ' + n + ' target Heading ' + target + ' at char ' + at);
  await open(page, '/demo/' + name);
  await page.waitForTimeout(3000);
  const where = () => page.evaluate((t) => { const h=[...document.querySelectorAll('.marxy-article h1,.marxy-article h2,.marxy-article h3,.marxy-article h4')].find(e=>e.textContent.trim()==='Heading '+t); const r=h?.getBoundingClientRect(); const out={heading: h? 'mounted top='+(r.top|0):'absent', headings: document.querySelectorAll('.marxy-article h1,.marxy-article h2,.marxy-article h3,.marxy-article h4').length}; const mid = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return { mid: mid?.closest('[data-marxy-s]')?.getAttribute('data-marxy-s'), ...out }; }, target);
  await page.keyboard.press('Control+k'); await page.waitForTimeout(300);
  await step(page, get, 'fill @Heading target', async () => { await page.keyboard.type('@'); await page.waitForTimeout(3000); await page.keyboard.insertText('Heading ' + target); await page.waitForTimeout(1500); }, 90000);
  console.log(' rows', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('li')].filter(l=>/Heading/.test(l.textContent)).slice(0,4).map(l=>l.textContent.slice(0,60)+'|'+l.getAttribute('aria-selected')))));
  await step(page, get, 'Enter (jump)', async () => { await page.keyboard.press('Enter'); await page.waitForTimeout(1500); }, 60000);
  for (const t of [500,3000,10000,25000]) { await page.waitForTimeout(t===500?0:t); console.log(' at', t, JSON.stringify(await where())); }
  console.log(' landed', JSON.stringify(await where()));
  await page.waitForTimeout(8000);
  console.log(' +8s', JSON.stringify(await where()));
  await page.context().close();
};
