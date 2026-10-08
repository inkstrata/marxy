// Default verbs by selection kind, and the widening rule (ADR-0054, design 03 §Default verbs, C-06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBuffer, parseMarkdown, sectionRange, textOf, type Block, type Document, type Heading, type Inline, type Node } from '@marxy/core';
import type { OperationInput } from '@marxy/core';
import { OPERATIONS } from '@marxy/core/src/operations/index.ts';
import { commands } from '../commands/index.ts';
import { fromOperation, type AppContext, type Command } from '../commands/registry.ts';
import { operationInputFor, operationInputsFor } from './input.ts';
import type { Selection } from './selection.ts';
import {
  COPY_DEFAULT,
  MARKDOWN_COPY,
  MENU_ORDER,
  VERB_KINDS,
  copyDefault,
  firstApplicable,
  markdownCopy,
  verbKindOf,
} from './verbs.ts';

const corpus = (file: string) => fileURLToPath(new URL(`../../../../fixtures/corpus/${file}`, import.meta.url));

function load(file: string, text?: string): { doc: Document; buffer: ReturnType<typeof createBuffer> } {
  const bytes = text === undefined ? readFileSync(corpus(file)) : new TextEncoder().encode(text);
  return { doc: parseMarkdown(bytes, { file }), buffer: createBuffer(file, bytes) };
}

function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function find(doc: Document, pred: (n: Node) => boolean): Node {
  let hit: Node | undefined;
  walk(doc, (n) => {
    if (!hit && pred(n)) hit = n;
  });
  assert.ok(hit, 'fixture node');
  return hit;
}

const nodeSel = (node: Node): Selection => ({ kind: 'node', node: node as Block | Inline, el: null as unknown as Element });

function ctxFor(sel: Selection, doc: Document, buffer: ReturnType<typeof createBuffer>): AppContext {
  return {
    shell: { clipboardWrite: async () => {} },
    selection: sel,
    document: null,
    operationInput: () => operationInputFor(sel, doc, buffer),
    operationInputs: () => operationInputsFor(sel, doc, buffer),
    closePalette: () => {},
    showNotice: () => {},
  };
}

test('every kind has a default copy verb and a markdown copy verb, each listed in its menu', () => {
  for (const kind of VERB_KINDS) {
    assert.ok(COPY_DEFAULT[kind].length > 0, `${kind} COPY_DEFAULT`);
    assert.ok(MARKDOWN_COPY[kind].length > 0, `${kind} MARKDOWN_COPY`);
    for (const id of [...COPY_DEFAULT[kind], ...MARKDOWN_COPY[kind]]) {
      assert.ok(MENU_ORDER[kind].includes(id), `${kind}: ${id} is in the menu`);
    }
  }
});

test('Mod+C can never splice: every registered default leaves the text unchanged over the corpus', () => {
  const ids = new Set(VERB_KINDS.flatMap((k) => [...COPY_DEFAULT[k], ...MARKDOWN_COPY[k]]));
  const ops = OPERATIONS.filter((op) => ids.has(`op.${op.id}`));
  assert.ok(ops.length >= 5, 'the copy packs are registered');
  let ran = 0;
  for (const file of ['02-readme-real-world.md', '03-ai-plan.md']) {
    const { doc, buffer } = load(file);
    const selections: Selection[] = [{ kind: 'document' }];
    walk(doc, (n) => {
      if (n.type === 'document') return;
      selections.push(nodeSel(n));
      if (n.type === 'heading') selections.push({ kind: 'section', heading: n as Heading, range: sectionRange(doc, n as Heading) });
    });
    for (const sel of selections) {
      for (const input of operationInputsFor(sel, doc, buffer)) {
        for (const op of ops) {
          if (!op.canApply(input)) continue;
          ran++;
          assert.equal(op.run(input).replacement, input.text, `${op.id} on ${file} @ ${input.range.start}`);
        }
      }
    }
  }
  assert.ok(ran > 100, `ran ${ran}`);
});

test('the default verbs are clipboard-only app commands or operations, never a buffer edit', async () => {
  // The drag's verbs: run with no DOM they copy the selection's text and touch nothing else.
  const { doc, buffer } = load('03-ai-plan.md');
  const writes: unknown[] = [];
  const ctx: AppContext = {
    ...ctxFor({ kind: 'text', text: 'drag' }, doc, buffer),
    shell: { clipboardWrite: async (d) => void writes.push(d) },
    applyBufferMutation: () => assert.fail('a copy verb edited the buffer'),
  };
  const cmd = copyDefault(ctx, commands());
  assert.equal(cmd?.id, 'selection.copy-rich');
  await cmd.run(ctx);
  assert.deepEqual(writes, [{ text: 'drag' }]);
  assert.equal(markdownCopy(ctx, commands())?.id, 'selection.copy-markdown');
});

test('verbKindOf names a code block, a table cell, a heading, the document, a task paragraph, a paragraph and a drag', () => {
  const { doc } = load('02-readme-real-world.md');
  assert.equal(verbKindOf(nodeSel(find(doc, (n) => n.type === 'codeBlock')), doc), 'code');
  assert.equal(verbKindOf(nodeSel(find(doc, (n) => n.type === 'tableCell')), doc), 'table');
  assert.equal(verbKindOf(nodeSel(find(doc, (n) => n.type === 'tableRow')), doc), 'table');
  assert.equal(verbKindOf(nodeSel(find(doc, (n) => n.type === 'table')), doc), 'table');
  const heading = find(doc, (n) => n.type === 'heading') as Heading;
  assert.equal(verbKindOf(nodeSel(heading), doc), 'section');
  assert.equal(verbKindOf({ kind: 'section', heading, range: sectionRange(doc, heading) }, doc), 'section');
  assert.equal(verbKindOf({ kind: 'document' }, doc), 'document');
  assert.equal(verbKindOf(nodeSel(find(doc, (n) => n.type === 'paragraph')), doc), 'block');
  const gfm = load('09-gfm-everything.md').doc;
  assert.equal(verbKindOf(nodeSel(find(gfm, (n) => n.type === 'link')), gfm), 'inline');
  assert.equal(verbKindOf({ kind: 'text', text: 'x' }, doc), 'text');
  assert.equal(verbKindOf({ kind: 'none' }, doc), null);

  const plan = load('03-ai-plan.md').doc;
  assert.equal(verbKindOf(nodeSel(find(plan, (n) => n.type === 'listItem' && 'task' in n && n.task !== undefined)), plan), 'task');
  // A loose task list keeps its text in a paragraph: the paragraph is the task too.
  const loose = load('loose.md', '- [ ] one\n\n- [x] two\n').doc;
  const para = find(loose, (n) => n.type === 'paragraph');
  assert.equal(verbKindOf(nodeSel(para), loose), 'task');
  const plain = load('plain.md', '- one\n\n- two\n').doc;
  assert.equal(verbKindOf(nodeSel(find(plain, (n) => n.type === 'paragraph')), plain), 'block');
});

test('the defaults: Mod+C by kind, from the table, not by id prefix', () => {
  const { doc, buffer } = load('02-readme-real-world.md');
  const all = commands();
  const pick = (sel: Selection) => copyDefault(ctxFor(sel, doc, buffer), all)?.id;
  const pickMd = (sel: Selection) => markdownCopy(ctxFor(sel, doc, buffer), all)?.id;
  assert.equal(pick(nodeSel(find(doc, (n) => n.type === 'codeBlock'))), 'op.copy-code-clean');
  assert.equal(pickMd(nodeSel(find(doc, (n) => n.type === 'codeBlock'))), 'op.copy-source');
  assert.equal(pick(nodeSel(find(doc, (n) => n.type === 'tableCell'))), 'op.copy-table-tsv');
  assert.equal(pick(nodeSel(find(doc, (n) => n.type === 'heading'))), 'op.copy-section');
  assert.equal(pick({ kind: 'document' }), 'op.copy-section');
  assert.equal(pick(nodeSel(find(doc, (n) => n.type === 'paragraph'))), 'op.copy-rich');
  assert.equal(pickMd(nodeSel(find(doc, (n) => n.type === 'paragraph'))), 'op.copy-source');
  // C-07's copy-source refuses an inline node; the kind keeps the candidate and Mod+C stays native.
  const gfm = load('09-gfm-everything.md');
  const link = nodeSel(find(gfm.doc, (n) => n.type === 'link'));
  assert.equal(copyDefault(ctxFor(link, gfm.doc, gfm.buffer), all), null);
});

test('firstApplicable skips ids not registered and ids that do not apply, in the written order', () => {
  const { doc, buffer } = load('02-readme-real-world.md');
  const ctx = ctxFor({ kind: 'document' }, doc, buffer);
  const no: Command = { id: 'x.no', title: 'No', group: 'app', when: () => false, run: async () => {} };
  const yes: Command = { id: 'x.yes', title: 'Yes', group: 'app', when: () => true, run: async () => {} };
  const also: Command = { id: 'x.also', title: 'Also', group: 'app', when: () => true, run: async () => {} };
  assert.equal(firstApplicable(['x.unregistered', 'x.no', 'x.yes', 'x.also'], ctx, [also, yes, no])?.id, 'x.yes');
  assert.equal(firstApplicable(['x.unregistered', 'x.no'], ctx, [no]), null);
});

test('widening: a table cell offers its table, a task paragraph its item, and the own input comes first', async () => {
  const { doc, buffer } = load('02-readme-real-world.md');
  const cell = find(doc, (n) => n.type === 'tableCell');
  const table = find(doc, (n) => n.type === 'table');
  const inputs = operationInputsFor(nodeSel(cell), doc, buffer);
  assert.deepEqual(inputs.map((i: OperationInput) => i.node?.type), ['tableCell', 'table']);
  assert.equal(inputs[1]!.text, textOf(buffer, table.src));
  const align = fromOperation(OPERATIONS.find((op) => op.id === 'align-table-pipes')!);
  assert.equal(align.when(ctxFor(nodeSel(cell), doc, buffer)), true);
  const row = find(doc, (n) => n.type === 'tableRow');
  assert.equal(align.when(ctxFor(nodeSel(row), doc, buffer)), true);

  const loose = load('loose.md', '- [ ] one\n\n- [x] two\n');
  const para = find(loose.doc, (n) => n.type === 'paragraph');
  const toggle = fromOperation(OPERATIONS.find((op) => op.id === 'toggle-task')!);
  const ctx = ctxFor(nodeSel(para), loose.doc, loose.buffer);
  assert.equal(toggle.when(ctx), true);
  let edit: { range: OperationInput['range']; replacement: string } | undefined;
  await toggle.run({ ...ctx, applyBufferMutation: async (e) => void (edit = e) });
  assert.equal(edit?.replacement, '- [x] one');
  assert.equal(textOf(loose.buffer, edit!.range), '- [ ] one');

  // A plain paragraph widens to nothing.
  const p = find(doc, (n) => n.type === 'paragraph');
  assert.equal(operationInputsFor(nodeSel(p), doc, buffer).length, 1);
});
