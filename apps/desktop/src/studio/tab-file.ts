// The Studio's File tab: the look being edited as
// its file, live as the dials move, with Copy, and where the file is kept.
import type { Shell } from '@marxy/shell-api';
import { LOOKS_DIR, LOOK_FILE_SUFFIX, LOOK_STATE_FILE, toFile } from '@marxy/theme';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import { appHandle } from '../commands/app-handle.ts';
import { btn, el } from '../frame/dom.ts';
import { looksFolder } from '../look/store.ts';
import type { StudioPiece } from './context.ts';
import { column } from './dials.ts';
import css from './tabs-caf.css?inline';

export const mountFile: StudioPiece = (host, ctx) => {
  adoptRuntimeSheet(document, 'marxy-studio-caf-style', css);

  const text = el('pre', 'marxy-studio-file-text');
  text.setAttribute('aria-label', 'The look as its file');
  text.tabIndex = 0;
  const where = el('p', 'marxy-studio-file-where');
  const copy = btn('marxy-btn', 'Copy', () => {
    // AppShell narrows the real shell; clipboardWrite is on every real one.
    const shell = appHandle()?.shell as Pick<Shell, 'clipboardWrite'> | undefined;
    const body = toFile(ctx.state(), ctx.editId());
    if (typeof shell?.clipboardWrite !== 'function') return;
    void shell.clipboardWrite({ text: body }).then(
      () => ctx.say(`Copied ${ctx.look().name} as a file`),
      () => ctx.say('The file could not be copied'),
    );
  });
  const side = column(
    'The look as its file',
    el('p', 'marxy-studio-file-say', 'A look is this file. Colours are not in it: they are worked out from the tone and the ink.'),
    copy,
    where,
  );
  side.classList.add('marxy-studio-file-side');
  host.append(side, text);

  const update = (): void => {
    const body = toFile(ctx.state(), ctx.editId());
    if (text.textContent !== body) text.textContent = body;
    const look = ctx.look();
    const dir = looksFolder();
    const beside = dir ? `beside config.toml, in ${dir}` : 'beside config.toml';
    const next = look.mine
      ? `Kept as ${LOOKS_DIR}/${look.id}${LOOK_FILE_SUFFIX} ${beside}; ${LOOK_STATE_FILE} says which look is in use.`
      : `${look.name} ships with Marxy; your changes to it are kept in ${LOOK_STATE_FILE} ${beside}.`;
    if (where.textContent !== next) where.textContent = next;
  };
  const off = ctx.onPaint(update);
  update();
  return off;
};
