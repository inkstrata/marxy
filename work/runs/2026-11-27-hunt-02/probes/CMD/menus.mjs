const SIZES = (process.env.SIZES || '1,5').split(',').map(Number);
const HEADS = Number(process.env.HEADS || 3000);
const mk = (mb, heads) => {
  const target = mb * 1e6; const parts = []; let n = 0, h = 0;
  const per = Math.floor(target / heads);
  while (n < target) {
    parts.push(`## Heading ${h} about things\n\n`);
    let body = '';
    while (body.length < per - 40) body += `Paragraph with a [link](https://example.com/${h}) and *emphasis* and some words to fill the line ${h}.\n\n- item one\n- item two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n`;
    parts.push(body); n += parts[parts.length-2].length + body.length; h++;
  }
  return parts.join('');
};
const race = (p, label) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL>10s ' + label)), 10000))]);
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await page.evaluate(() => { window.__lt = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ entryTypes: ['longtask'] }); });
  const step = async (label, fn) => {
    await page.evaluate(() => { window.__lt = []; });
    const t = Date.now(); let err = '';
    try { await race(fn(), label); await race(page.evaluate(() => new Promise(r => setTimeout(r, 700))), label + ' settle'); } catch (e) { err = String(e.message); }
    const lt = await race(page.evaluate(() => Math.max(0, ...window.__lt)), 'read').catch(() => -1);
    console.log(`  ${label.padEnd(34)} wall ${String(Date.now() - t - 700).padStart(6)} ms  longest task ${Math.round(lt)} ms ${err}`);
  };
  const key = k => page.keyboard.press(k);
  for (const mb of SIZES) {
    const path = `/demo/big${mb}.md`;
    console.log(`== ${mb} MB, ${HEADS} headings`);
    await plantText(page, path, mk(mb, HEADS));
    await step('open', () => open(page, path));
    { const t=Date.now(); let quiet=0; while(Date.now()-t<90000){ await page.evaluate(()=>{window.__lt=[]}); await new Promise(r=>setTimeout(r,1500)); const m=await page.evaluate(()=>Math.max(0,...window.__lt)); if(m<50){ if(++quiet>=2) break; } else quiet=0; } console.log('  background work settled after', Date.now()-t, 'ms'); }
    await step('Line Mod+P open', () => key('Control+p'));
    await step('Line type "head"', () => page.keyboard.type('head', { delay: 30 }));
    await step('Line type "ing 1"', () => page.keyboard.type('ing 1', { delay: 30 }));
    await step('Line Escape', () => key('Escape'));
    await step('Line Mod+P again', () => key('Control+p'));
    await step('Line ArrowDown x10', async () => { for (let i = 0; i < 10; i++) await key('ArrowDown'); });
    await step('Line Escape', () => key('Escape'));
    await step('Studio Mod+Alt+T', () => key('Control+Alt+t'));
    for (const k of ['Tab', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowRight']) await step('Studio ' + k, () => key(k));
    await step('Studio Escape', () => key('Escape'));
    await step('Settings Mod+,', () => key('Control+,'));
    for (const k of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowLeft']) await step('Settings ' + k, () => key(k));
    await step('Settings Escape', () => key('Escape'));
    await step('Enter verb menu', () => key('Enter'));
    await step('verb menu Escape', () => key('Escape'));
    await step('right-click page', () => page.mouse.click(700, 400, { button: 'right' }));
    await step('ctx Escape', () => key('Escape'));
    await step('tab Shift+F10', () => key('Shift+F10'));
    await step('tab menu Escape', () => key('Escape'));
    await step('spine press mid', () => page.mouse.click(1436, 450));
    await step('spine drag', async () => { await page.mouse.move(1436, 200); await page.mouse.down(); const ms=[]; for (let y = 200; y < 800; y += 40) { const t=Date.now(); await page.mouse.move(1436, y); ms.push(Date.now()-t);} await page.mouse.up(); console.log('   per-move ms', ms.join(' ')); });
    // repeated open/close for pile-up
    const times = [];
    for (let i = 0; i < 10; i++) { const t = Date.now(); await key('Control+p'); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await key('Escape'); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); times.push(Date.now() - t); }
    console.log('  Line open/close x10 ms:', times.join(' '));
    const t2 = [];
    for (let i = 0; i < 10; i++) { const t = Date.now(); await key('Control+Alt+t'); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await key('Escape'); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); t2.push(Date.now() - t); }
    console.log('  Studio open/close x10 ms:', t2.join(' '));
  }
};
