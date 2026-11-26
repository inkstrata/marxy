// The file card: while Settings is open, the file it writes (config.toml), as it is on disk, with the lines
// the last change made marked. Read when drawn, so a hand edit in another editor shows too. Drawn under Settings in the
// drawer (left/host-branch.ts). The look's own file is the Studio's File tab.
import { lastWritten } from '../../theme/written.ts';
import { el } from '../dom.ts';
import type { CardContext, CardDef } from './types.ts';

const decoder = new TextDecoder();

const branchOf = (ctx: CardContext): 'settings' | null => (!ctx.frame.folded && ctx.frame.left.extra() === 'settings' ? 'settings' : null);

/** The file the open branch writes, and how the card names it. */
async function fileOf(ctx: CardContext): Promise<{ readonly path: string; readonly name: string } | null> {
  if (!branchOf(ctx) || !ctx.handle.shell.configPaths) return null;
  const { config } = await ctx.handle.shell.configPaths();
  return { path: config, name: 'config.toml' };
}

export const fileShown: CardDef = {
  id: 'file',
  title: () => 'Settings file',
  detail: () => 'as it is',
  relevant: (ctx) => branchOf(ctx) !== null && ctx.handle.shell.configPaths !== undefined,
  render(body, ctx) {
    let gone = false;
    void (async () => {
      const file = await fileOf(ctx);
      if (!file || gone) return;
      let text: string | null;
      try {
        text = decoder.decode(await (ctx.handle.shell.peekFile ?? ctx.handle.shell.readFile).call(ctx.handle.shell, file.path));
      } catch {
        text = null;
      }
      if (gone) return;
      const where = el('p', 'marxy-card-line', file.name);
      if (text === null || text === '') {
        body.replaceChildren(where, el('p', 'marxy-card-foot', 'Not written yet: Marxy writes it, one line at a time, when you change something here.'));
        return;
      }
      const written = lastWritten(file.path);
      // Marked only while the file is still what Marxy wrote: an edit made elsewhere since has its own changes.
      const changed = written && written.text === text ? written.changed : new Set<number>();
      const pre = el('pre', 'marxy-filecard');
      const lines = text.split('\n');
      if (lines.at(-1) === '') lines.pop();
      lines.forEach((line, i) => {
        const row = el('span', changed.has(i) ? 'marxy-filecard-line marxy-filecard-changed' : 'marxy-filecard-line', line);
        pre.append(row, '\n');
      });
      const foot = el('p', 'marxy-card-foot', changed.size > 0 ? 'The marked lines are the last change. Every other byte is as it was.' : 'Edit it here or in any editor; the app reads it as it changes.');
      body.replaceChildren(where, pre, foot);
      pre.querySelector('.marxy-filecard-changed')?.scrollIntoView({ block: 'nearest' });
    })();
    return () => {
      gone = true;
    };
  },
};
