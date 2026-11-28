// Verify PRS-01: main-thread stall after the palette's first query on a 2 MB changelog; control = same size, a non-changelog name.
const stall = async (page, label, fn) => {
  const t = Date.now(); await fn();
  const r = await Promise.race([page.evaluate(() => 1).then(() => 'ok'), new Promise((r) => setTimeout(() => r('STALLED>10s'), 10000))]);
  console.log(label, r, Date.now() - t, 'ms');
};
export default async ({ boot, open, plantText }) => {
  for (const [name, runs] of [['CHANGELOG.md', 2], ['NOTES.md', 1]]) {
    const page = await boot('plans/pg16-upgrade-plan.md');
    let s = '# Changelog\n\n';
    for (let i = 1; s.length < 2_000_000; i++) s += `## ${i}.0.0\n\n- fixed \`src/a${i}.ts\` thing\n- more **bold** text\n\n`;
    await plantText(page, '/demo/' + name, s);
    await open(page, '/demo/' + name);
    await new Promise((r) => setTimeout(r, 20000));
    await stall(page, name + ' ctrl+k', () => page.keyboard.press('Control+k'));
    await new Promise((r) => setTimeout(r, 6000));
    await stall(page, name + ' type r', () => page.keyboard.type('r'));
    await new Promise((r) => setTimeout(r, 6000));
    await stall(page, name + ' type e', () => page.keyboard.type('e'));
  }
};
