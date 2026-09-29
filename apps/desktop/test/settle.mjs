// Shared wait for a page to stop reflowing (MARXY-332).
// Idle-time typesetting and grid passes keep moving blocks after `ready`, so a scroll position or
// a measurement taken mid-reflow can name a block the settled page no longer has there. The page is
// settled once document scrollHeight has held still across ten consecutive 100 ms samples.
// Same rule as the inline settle() in source-mode-shell.test.mjs.
export async function settle(page) {
  await page.evaluate(async () => {
    let last = -1;
    let still = 0;
    while (still < 10) {
      await new Promise((r) => setTimeout(r, 100));
      const h = document.documentElement.scrollHeight;
      if (h === last) still++;
      else { still = 0; last = h; }
    }
  });
}
