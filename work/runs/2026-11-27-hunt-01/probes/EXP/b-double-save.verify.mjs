export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const r = await page.evaluate(async () => {
    const h = window.marxy.handle;
    let calls = 0;
    const orig = h.shell.saveDialog.bind(h.shell);
    h.shell.saveDialog = async (o) => { calls++; await new Promise((r) => setTimeout(r, 300)); return null; };
    h.frame().left.show('export', { what: 'file', as: 'html' });
    await new Promise((r) => setTimeout(r, 400));
    const b = document.querySelector('.marxy-drawer .marxy-l-btns .marxy-l-pri');
    b.click(); b.click();
    await new Promise((r) => setTimeout(r, 1500));
    // second part: a build that cannot run: jsonl on a markdown file (no table) / text with no article
    return { saveDialogCalls: calls, label: b.textContent };
  });
  console.log(JSON.stringify(r));
};
