// The page keys that open the Line already in a scope: `@` `/` `#` `:` `!` `%` `~` `&`. Each
// is written bare and with Shift, since a layout types some of them with Shift and others without. `=` stays the look's
// (Text larger has it), so the row filter is `=` typed in the Line.
import { appHandle, palette } from '../commands/app-handle.ts';
import type { Command } from '../commands/registry.ts';

const hasFile = (): boolean => (appHandle()?.panes().focused.path() ?? null) !== null;

const opener = (id: string, mark: string, title: string, needsFile: boolean): Command => ({
  id: `line.${id}`,
  title,
  key: mark,
  keys: [`Shift+${mark}`],
  group: 'app',
  when: needsFile ? hasFile : () => true,
  run: async () => palette()?.open(mark),
});

export function lineCommands(): readonly Command[] {
  return [
    opener('outline', '@', 'A part of this document', true),
    opener('find', '/', 'Find in this document', true),
    opener('grep', '#', 'Search every file in the workspace', false),
    opener('goto', ':', 'A line, or a range of them', true),
    opener('tx', '!', 'Change the text: sort, renumber, align, reformat', true),
    opener('lens', '%', 'A lens: only the tasks, the code, the links, your notes, odd characters', true),
    opener('pair', '~', 'Compare this file with another, or an earlier copy', true),
    opener('as', '&', 'The ways this file can be read, Bytes last', true),
  ];
}
