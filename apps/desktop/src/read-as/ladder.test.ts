import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { AppHandle } from '../app.ts';
import { setAppHandle } from '../commands/app-handle.ts';
import type { AppContext } from '../commands/registry.ts';
import { bytesChosen, setBytesChosen } from './bytes-choice.ts';
import { readAs, readingsFor } from './ladder.ts';

interface FakePane {
  path: () => string;
  viewer: unknown;
  view: { viewer: () => unknown };
  content: { detected: () => unknown; open: () => Promise<void> };
}

const pane = (path: string, viewer: unknown, chose = false): FakePane => {
  const p: FakePane = {
    path: () => path,
    viewer,
    view: { viewer: () => p.viewer },
    content: { detected: () => ({ kind: 'code', reasons: [{ decisive: true, tier: chose ? 1 : 4, signal: 'the extension' }] }), open: async () => {} },
  };
  return p;
};

/** A handle over `panes` (the first focused); `onRun` is what a kind's Show as does. */
function handle(panes: FakePane[], onRun: (id: string) => void = () => {}): string[] {
  const ran: string[] = [];
  const ids = ['kind.show-as.detected', 'kind.show-as.code', 'kind.show-as.notes'];
  setAppHandle({
    panes: () => ({ focused: panes[0], panes }),
    currentPath: () => panes[0]!.path(),
    open: async () => {},
    commands: () =>
      ids.map((id) => ({
        id,
        run: async () => {
          ran.push(id);
          onRun(id);
        },
      })),
  } as unknown as AppHandle);
  return ran;
}

const ctx = {} as AppContext;
const image = { kind: 'image', binary: false, headSay: () => null };

test('a text file read by a page of the app\'s own (an SVG) offers no kind, which would be kept and never shown', () => {
  handle([pane('/r/a.svg', image)]);
  const ways = readingsFor('/r/a.svg');
  assert.deepEqual(ways.map((w) => w.id), ['', 'bytes']);
  assert.equal(ways[0]?.current, true);
  // A kind kept from before is still not what the pane shows: As found is.
  handle([pane('/r/a.svg', image, true)]);
  assert.equal(readingsFor('/r/a.svg')[0]?.current, true);
  // A text view offers the kinds.
  handle([pane('/r/a.ts', null)]);
  assert.ok(readingsFor('/r/a.ts').some((w) => w.id === 'notes'));
});

test('a kind chosen for a file another pane shows is not kept for the focused pane\'s file', async () => {
  const ran = handle([pane('/r/a.md', null), pane('/r/b.md', null)]);
  // The refusal is said in the pane's notices, which need a DOM node does not have.
  await readAs('/r/b.md', 'notes', ctx).catch((e: unknown) => assert.ok(e instanceof ReferenceError, String(e)));
  assert.deepEqual(ran, []);
  await readAs('/r/a.md', 'notes', ctx);
  assert.deepEqual(ran, ['kind.show-as.notes']);
});

test('a kind chosen over Bytes that Show as refuses leaves Bytes chosen, as the pane still shows them', async () => {
  const p = pane('/r/a.md', { kind: 'card', binary: false, headSay: () => null });
  const card = p.viewer;
  handle([p]);
  setBytesChosen('/r/a.md', true);
  await readAs('/r/a.md', 'notes', ctx);
  assert.equal(bytesChosen('/r/a.md'), true, 'nothing was read again');
  // Show as that reopens the file: the text view replaces the card, and Bytes are no longer chosen.
  handle([p], () => {
    p.viewer = null;
  });
  await readAs('/r/a.md', 'notes', ctx);
  assert.equal(bytesChosen('/r/a.md'), false);
  assert.notEqual(p.viewer, card);
});
