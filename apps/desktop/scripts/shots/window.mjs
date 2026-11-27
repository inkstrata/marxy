// The window on a page, the Line over it, and a table from a file that is in no fixture: copy this for a scenario of
// your own. `node scripts/shots.mjs scripts/shots/window.mjs`, from apps/desktop.
export default async ({ boot, shot, open, plantText, real }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await shot(page, 'page');
  await page.keyboard.press('Control+k');
  await shot(page, 'line', { wait: 900 });
  await page.keyboard.press('Escape');
  if (real) return;
  // Planted into the memory shell, then opened like any other file. A clip crops to a part at true size.
  await plantText(page, '/demo/planted.csv', 'city,high,low\nLisbon,24,16\nOslo,11,4\nCairo,35,22\n');
  await open(page, '/demo/planted.csv');
  await shot(page, 'table');
  await shot(page, 'table-crop', { clip: { x: 540, y: 150, width: 420, height: 300 } });
};
