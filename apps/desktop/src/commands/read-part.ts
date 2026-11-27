// Read this part another way: on a fenced part of a Markdown page, the ways it can be read, in a second
// menu where the block menu was. A choice sets the part again in every view of its file (render/parts.ts) and is kept in
// readings.json; the guess, chosen again, forgets the choice.
import { partLongName, partsNow, choosePart, type PartNow } from '../render/parts.ts';
import { openVerbMenu, verbMenuRowAnchor, type MenuAnchor, type VerbMenuRow } from '../selection/verb-menu.ts';
import type { AppContext, Command } from './registry.ts';

interface Selected {
  readonly now: PartNow;
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** The part the selection is, with how it reads now; null for anything but a fenced part of a Markdown page. */
export function selectedPart(ctx: AppContext): Selected | null {
  const sel = ctx.selection;
  if (sel.kind !== 'node' || sel.node.type !== 'codeBlock') return null;
  const snap = ctx.document?.snapshot();
  if (!snap) return null;
  const { start, end } = sel.node.src;
  const now = partsNow(snap.path, snap.ast, snap.buffer.bytes).find((p) => p.part.start === start && p.part.end === end);
  return now ? { now, path: snap.path, bytes: snap.buffer.bytes } : null;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The ways a part can be read, as menu rows: the one it is read as now, and the guess, said as such. */
export function partWayRows(selected: Selected): VerbMenuRow[] {
  const { part, reading } = selected.now;
  return part.ways.map((way) => {
    const words = [way === reading ? 'now' : '', way === part.guess ? (part.from === 'text' ? 'the guess' : 'as its fence says') : ''].filter(Boolean);
    return {
      command: null,
      key: `part.read-as.${way}`,
      title: cap(partLongName(part, way, selected.bytes)),
      ...(words.length > 0 ? { detail: words.join(' · ') } : {}),
      run: () => choosePart(selected.path, part.key, way === part.guess ? null : way),
    };
  });
}

/** From the palette, with no block menu before it: at the part's top-left corner (the menu keeps itself on screen). */
function anchorOf(ctx: AppContext): MenuAnchor {
  const box = ctx.selection.kind === 'node' ? ctx.selection.el.getBoundingClientRect() : null;
  if (box && box.width > 0) return { x: Math.round(box.left), y: Math.round(Math.max(0, box.top)) };
  return { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 3) };
}

export function readPartCommands(): readonly Command[] {
  return [
    {
      id: 'view.read-part',
      title: 'Read this part another way',
      group: 'selection',
      when: (ctx) => (selectedPart(ctx)?.now.part.ways.length ?? 0) > 1,
      detail: (ctx) => {
        const selected = selectedPart(ctx);
        return selected ? partLongName(selected.now.part, selected.now.reading, selected.bytes) : null;
      },
      run: async (ctx) => {
        const selected = selectedPart(ctx);
        if (!selected) return;
        const { part } = selected.now;
        openVerbMenu(verbMenuRowAnchor() ?? anchorOf(ctx), ctx, {
          registered: [],
          allActions: () => {},
          rows: partWayRows(selected),
          label: `Read lines ${part.firstLine} to ${part.lastLine} as`,
        });
      },
    },
  ];
}
