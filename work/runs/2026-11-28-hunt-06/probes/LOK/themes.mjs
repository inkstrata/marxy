export default async ({ boot, shot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const run = (id) => page.evaluate(async (id) => { const { commands } = await import('/src/commands/index.ts'); const c = commands().find(c => c.id === id); if (!c) return 'no ' + id; await c.run({ showNotice(t) { (window.__n ??= []).push(t); } }); return 'ok'; }, id);
  const snap = (label) => page.evaluate((label) => {
    const cs = getComputedStyle(document.documentElement); const b = getComputedStyle(document.body);
    const lum = (c) => { const m = c.match(/\d+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
    return label + ' ' + JSON.stringify({ v: document.documentElement.getAttribute('data-marxy-variant'), bg: b.backgroundColor, lum: +lum(b.backgroundColor).toFixed(2), text: cs.getPropertyValue('--marxy-color-text').trim(), art: getComputedStyle(document.querySelector('.marxy-article')).color, styles: document.querySelectorAll('style#marxy-theme,style[id^=marxy-theme]').length, notices: window.__n });
  }, label);
  console.log(await snap('boot'));
  for (const [id, label] of [['view.variant-light', 'light'], ['view.theme-fjord', 'fjord'], ['view.theme-high-contrast', 'hc'], ['view.theme-warm', 'warm'], ['view.variant-dark', 'dark'], ['view.theme-default', 'night-paper'], ['view.theme-ink', 'ink']]) {
    console.log(await run(id)); await page.waitForTimeout(900); console.log(await snap(label));
  }
  console.log('config', JSON.stringify(await page.evaluate(async () => new TextDecoder().decode(await window.marxy.shell.readFile('/config')))));
};
