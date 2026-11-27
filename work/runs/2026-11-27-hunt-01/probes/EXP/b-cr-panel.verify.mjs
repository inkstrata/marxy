export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/cr.md', '# One\r\rtwo words\r\rthree words\r\rfour words\r');
  await open(page, '/demo/cr.md');
  const r = await page.evaluate(async () => {
    const h = window.marxy.handle;
    const ok = h.selection.cursorAt(8, 9);
    await new Promise((r) => setTimeout(r, 300));
    h.shell.queueSaveDialog?.('/demo/o-cr.md');
    h.frame().left.show('export', { what: 'selection', as: 'raw' });
    await new Promise((r) => setTimeout(r, 400));
    const panel = document.querySelector('.marxy-drawer')?.innerText.replace(/\s+/g, ' ').slice(0, 400);
    document.querySelector('.marxy-drawer .marxy-l-btns .marxy-l-pri')?.click();
    await new Promise((r) => setTimeout(r, 800));
    let out;
    try { out = JSON.stringify(new TextDecoder().decode(await h.shell.readFile('/demo/o-cr.md'))); } catch (e) { out = 'ERR ' + e.message; }
    const notes = [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent);
    return { ok, sel: JSON.stringify(h.selection.state().selection), panel, out, notes };
  });
  console.log(JSON.stringify(r, null, 1));
};
