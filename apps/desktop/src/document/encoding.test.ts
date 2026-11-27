// What is held for a file read in another encoding follows its store: to a new name (a rename on disk, a Save As)
// and away when the store closes. Over the memory shell, whose decoder is the port of the Rust module.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryShell, type MemoryShell } from '../shell/memory.ts';
import { chooseEncoding, clearEncodingChoices, encodedIo, encodingChoiceOf, encodingChoicesNow, forgetEncoding, heldEncoding, restoreEncodingChoices, textForStore } from './encoding.ts';
import { openDocumentStore, type DocumentStore } from './store.ts';
import { restoreCopy } from '../versions/restore.ts';
import { documentCommands } from '../commands/document.ts';
import type { AppContext } from '../commands/registry.ts';

/** UTF-16LE with its byte-order mark. */
const utf16 = (text: string): Uint8Array => {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    out[2 + i * 2] = text.charCodeAt(i) & 0xff;
    out[3 + i * 2] = text.charCodeAt(i) >> 8;
  }
  return out;
};
const NOTES = 'Field notes: Ærø at low water, Θάλασσα.\n';

async function opened(shell: MemoryShell, path: string): Promise<DocumentStore> {
  const text = await textForStore(shell, path, await shell.peekFile(path), null);
  const io = encodedIo(
    {
      writeFileAtomic: (p, b) => shell.writeFileAtomic(p, b),
      peekFile: (p) => shell.peekFile(p),
    },
    shell,
    path,
  );
  return openDocumentStore(io, path, text);
}

test('a UTF-16 file renamed on disk while open keeps its encoding at the new name, and saves there in it', async () => {
  const shell = createMemoryShell({ '/r/a.txt': utf16(NOTES) });
  const store = await opened(shell, '/r/a.txt');
  assert.equal(heldEncoding('/r/a.txt')?.found.label, 'utf-16le');
  await store.apply({ range: { file: '/r/a.txt', start: 0, end: 5 }, replacement: 'Shore', label: 'edit' });
  // The file is renamed by another program; the store follows it.
  shell.plant('/r/b.txt', await shell.peekFile('/r/a.txt'));
  await store.rename('/r/b.txt');
  assert.equal(heldEncoding('/r/b.txt')?.found.label, 'utf-16le', 'held at the new name');
  assert.equal(heldEncoding('/r/a.txt'), null, 'and not at the old one');
  const saved = await store.save();
  assert.equal(saved.result, 'saved', String(saved.error));
  assert.deepEqual([...(await shell.peekFile('/r/b.txt'))], [...utf16(`Shore${NOTES.slice(5)}`)]);
  store.close();
  forgetEncoding('/r/b.txt');
});

test('Save As writes the encoding and byte-order mark the file was read in, and the old name holds nothing', async () => {
  const shell = createMemoryShell({ '/r/a.txt': utf16(NOTES) });
  const store = await opened(shell, '/r/a.txt');
  const saved = await store.save({ to: '/r/copy.txt' });
  assert.equal(saved.result, 'saved', String(saved.error));
  assert.deepEqual([...(await shell.peekFile('/r/copy.txt'))], [...utf16(NOTES)]);
  assert.equal(heldEncoding('/r/copy.txt')?.found.label, 'utf-16le');
  assert.equal(heldEncoding('/r/a.txt'), null);
  // And on from there: a save in place at the new name is in the same encoding.
  await store.apply({ range: { file: '/r/copy.txt', start: 0, end: 5 }, replacement: 'Shore', label: 'edit' });
  assert.equal((await store.save()).result, 'saved');
  assert.deepEqual([...(await shell.peekFile('/r/copy.txt'))], [...utf16(`Shore${NOTES.slice(5)}`)]);
  store.close();
});

test('what is held for a file in another encoding goes when its store closes', async () => {
  const shell = createMemoryShell({ '/r/a.txt': utf16(NOTES) });
  const store = await opened(shell, '/r/a.txt');
  assert.ok(heldEncoding('/r/a.txt'));
  store.close();
  assert.equal(heldEncoding('/r/a.txt'), null);
});

test('a copy kept before a save holds the file\'s own bytes, and restoring it then saving gives the file back byte for byte', async () => {
  const path = '/r/v.txt';
  const original = utf16('héllo\r\n');
  const shell = createMemoryShell({ [path]: original });
  const kept: Uint8Array[] = [];
  const io = encodedIo(
    {
      writeFileAtomic: (p, b) => shell.writeFileAtomic(p, b),
      peekFile: (p) => shell.peekFile(p),
      beforeOverwrite: async (_p, b) => void kept.push(b.slice()),
    },
    shell,
    path,
  );
  const store = openDocumentStore(io, path, await textForStore(shell, path, original, null));
  await store.apply({ range: { file: path, start: 0, end: 1 }, replacement: 'H', label: 'edit' });
  assert.equal((await store.save()).result, 'saved');
  assert.deepEqual([...kept[0]!], [...original], 'the copy is the file as it was, not the page\'s text');
  assert.equal(await restoreCopy(store, kept[0]!, 0, shell), 'staged');
  assert.equal(new TextDecoder().decode(store.snapshot().buffer.bytes), 'héllo\r\n', 'staged as the text the store holds');
  const saved = await store.save();
  assert.equal(saved.result, 'saved', String(saved.error));
  assert.deepEqual([...(await shell.peekFile(path))], [...original]);
  // The copy is what the file holds now: there is nothing to restore, and nothing is staged.
  const version = store.snapshot().version;
  assert.equal(await restoreCopy(store, original, 0, shell), 'same');
  assert.equal(store.snapshot().version, version);
  store.close();
});

/** UTF-16BE with its byte-order mark. */
const utf16be = (text: string): Uint8Array => {
  const le = utf16(text);
  const out = new Uint8Array(le.length);
  for (let i = 0; i < le.length; i += 2) [out[i], out[i + 1]] = [le[i + 1]!, le[i]!];
  return out;
};
/** A Latin-1 text in windows-1252: one byte per character, no mark. */
const cp1252 = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));
const LATIN = 'Field notes: Ærø and Åland, ½ tide, 3° colder.\n';

for (const [name, bytesOf, text] of [
  ['UTF-16LE', utf16, NOTES],
  ['UTF-16BE', utf16be, NOTES],
  ['windows-1252', cp1252, LATIN],
] as const) {
  test(`Keep mine as a copy writes the copy of a ${name} file in its own encoding, not as UTF-8`, async () => {
    const path = '/r/m.txt';
    const shell = createMemoryShell({ [path]: bytesOf(text) });
    const io = encodedIo(
      {
        writeFileAtomic: (p, b) => shell.writeFileAtomic(p, b),
        writeFileNew: (p, b) => shell.writeFileNew(p, b),
        peekFile: (p) => shell.peekFile(p),
      },
      shell,
      path,
    );
    const store = openDocumentStore(io, path, await textForStore(shell, path, bytesOf(text), null));
    assert.ok(heldEncoding(path), 'read through the decoder');
    await store.apply({ range: { file: path, start: 0, end: 5 }, replacement: 'Shore', label: 'edit' });
    const theirs = `Other${text.slice(5)}`;
    shell.plant(path, bytesOf(theirs));
    assert.equal(await store.reload(new TextEncoder().encode(theirs)), 'kept');
    const out = await store.resolveConflict('mine');
    assert.deepEqual(out, { result: 'resolved', copy: '/r/m (mine).txt' });
    assert.deepEqual([...(await shell.peekFile('/r/m (mine).txt'))], [...bytesOf(`Shore${text.slice(5)}`)], 'the copy is the edits in the file\'s encoding');
    assert.deepEqual([...(await shell.peekFile(path))], [...bytesOf(theirs)], 'the file is as the other program left it');
    store.close();
  });
}

test('Keep mine as a copy of a file whose encoding cannot hold the edits is refused, writes nothing, and leaves the choice pending', async () => {
  const path = '/r/odd.txt';
  // A trailing byte UTF-16 cannot read: the text would not come back to these bytes, so it cannot be written in it.
  const raw = Uint8Array.from([...utf16(NOTES), 0x41]);
  const shell = createMemoryShell({ [path]: raw });
  const io = encodedIo(
    {
      writeFileAtomic: (p, b) => shell.writeFileAtomic(p, b),
      writeFileNew: (p, b) => shell.writeFileNew(p, b),
      peekFile: (p) => shell.peekFile(p),
    },
    shell,
    path,
  );
  const store = openDocumentStore(io, path, await textForStore(shell, path, raw, null));
  assert.equal(heldEncoding(path)?.found.writable, false);
  await store.apply({ range: { file: path, start: 0, end: 5 }, replacement: 'Shore', label: 'edit' });
  shell.plant(path, utf16(`Other${NOTES.slice(5)}`));
  assert.equal(await store.reload(new TextEncoder().encode(`Other${NOTES.slice(5)}`)), 'kept');
  const out = await store.resolveConflict('mine');
  assert.equal(out.result, 'failed');
  assert.equal(shell.hasFile('/r/odd (mine).txt'), false, 'no copy in another encoding');
  assert.ok(store.conflict(), 'the choice is still pending');
  store.close();
});

// The save waits in the copy kept before it, and then at the shell's write (where the file is checked).
for (const where of ['beforeOverwrite', 'writeFileAtomic'] as const) {
  test(`closing a UTF-16 file while its save waits in ${where} still writes UTF-16, not UTF-8`, async () => {
    const path = `/r/closing-${where}.txt`;
    const shell = createMemoryShell({ [path]: utf16(NOTES) });
    let reached: () => void = () => {};
    const waiting = new Promise<void>((r) => (reached = r));
    let go: () => void = () => {};
    const held = new Promise<void>((r) => (go = r));
    const wait = async (): Promise<void> => {
      reached();
      await held;
    };
    const io = encodedIo(
      {
        writeFileAtomic: async (p, b, expected) => {
          if (where === 'writeFileAtomic') await wait();
          return shell.writeFileAtomic(p, b, expected);
        },
        peekFile: (p) => shell.peekFile(p),
        beforeOverwrite: async () => {
          if (where === 'beforeOverwrite') await wait();
        },
      },
      shell,
      path,
    );
    const store = openDocumentStore(io, path, await textForStore(shell, path, utf16(NOTES), null));
    await store.apply({ range: { file: path, start: 0, end: 5 }, replacement: 'Shore', label: 'edit' });
    const saving = store.save();
    await waiting;
    store.close();
    go();
    const saved = await saving;
    assert.equal(saved.result, 'saved', String(saved.error));
    assert.deepEqual([...(await shell.peekFile(path))], [...utf16(`Shore${NOTES.slice(5)}`)]);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(heldEncoding(path), null, 'and what was held for it goes once the save is done');
  });
}

test('a Windows file\'s encoding and its "Read as" choice are the same under every spelling of its path', async () => {
  const path = 'C:\\Notes\\Tide.txt';
  const other = 'c:/notes/./TIDE.txt';
  chooseEncoding(path, 'windows-1252');
  assert.equal(encodingChoiceOf(other), 'windows-1252', 'the choice holds under another spelling');
  assert.deepEqual(encodingChoicesNow(), { 'C:/Notes/Tide.txt': 'windows-1252' }, 'and readings.json keeps the spelling it was made under');
  chooseEncoding(other, null);
  assert.equal(encodingChoiceOf(path), null, 'cleared under the other spelling, it is cleared');
  // A choice the reader made this session, under any spelling, wins over the one read back from readings.json.
  chooseEncoding(other, 'utf-16le');
  restoreEncodingChoices({ 'C:/Notes/Tide.txt': 'windows-1252' }, new Set([other]));
  assert.equal(encodingChoiceOf(path), 'utf-16le');
  clearEncodingChoices();
  const shell = createMemoryShell({});
  await textForStore(shell, path, utf16(NOTES), null);
  assert.equal(heldEncoding(other)?.found.label, 'utf-16le', 'what was read is held for every spelling');
  forgetEncoding(other);
  assert.equal(heldEncoding(path), null);
});

// The two ways a copy cannot be in the file's encoding: a character it has no bytes for, and bytes it does not read back.
for (const [what, path, raw, edit] of [
  ['a character windows-1252 has no bytes for', '/r/latin-mine.txt', cp1252(LATIN), '✓ Shore'],
  ['a file whose bytes UTF-16 does not read back', '/r/odd-mine.txt', Uint8Array.from([...utf16(NOTES), 0x41]), 'Shore'],
] as const) {
  test(`Keep my version as a copy, refused for ${what}, says to copy the text out of Source rather than to try again`, async () => {
    const shell = createMemoryShell({ [path]: raw });
    const io = encodedIo(
      {
        writeFileAtomic: (p, b) => shell.writeFileAtomic(p, b),
        writeFileNew: (p, b) => shell.writeFileNew(p, b),
        peekFile: (p) => shell.peekFile(p),
      },
      shell,
      path,
    );
    const store = openDocumentStore(io, path, await textForStore(shell, path, raw, null));
    await store.apply({ range: { file: path, start: 0, end: 5 }, replacement: edit, label: 'edit' });
    shell.plant(path, cp1252(`Other${LATIN.slice(5)}`));
    assert.equal(await store.reload(new TextEncoder().encode(`Other${LATIN.slice(5)}`)), 'kept');
    const notices: { text: string; kind: string | undefined }[] = [];
    const ctx = { document: store, showNotice: (text: string, opts?: { kind?: string }) => void notices.push({ text, kind: opts?.kind }) } as unknown as AppContext;
    const keepMine = documentCommands().find((c) => c.id === 'document.keep-mine-as-copy')!;
    await keepMine.run(ctx);
    assert.equal(notices.length, 1, JSON.stringify(notices));
    assert.equal(notices[0]!.kind, 'error');
    assert.match(notices[0]!.text, /Could not save a copy in .+, the file's encoding/);
    assert.match(notices[0]!.text, /Open Source \(Mod\+E\) and copy your text out to keep it/);
    assert.doesNotMatch(notices[0]!.text, /Try again/);
    assert.ok(store.conflict(), 'the choice is still pending');
    store.close();
  });
}

test('a UTF-16 file changed underneath: the save is checked against the bytes read, not the page text, and leaves the file as the other program wrote it', async () => {
  const path = '/r/guarded.txt';
  const shell = createMemoryShell({ [path]: utf16(NOTES) });
  const text = await textForStore(shell, path, await shell.peekFile(path), null);
  const expectations: (Uint8Array | undefined)[] = [];
  const io = encodedIo(
    {
      writeFileAtomic: (p, b, expected) => {
        expectations.push(expected);
        return shell.writeFileAtomic(p, b, expected);
      },
      peekFile: (p) => shell.peekFile(p),
    },
    shell,
    path,
  );
  const store = openDocumentStore(io, path, text);
  await store.apply({ range: { file: path, start: 0, end: 5 }, replacement: 'Shore', label: 'edit' });
  const theirs = utf16(`Moved${NOTES.slice(5)}`);
  shell.plant(path, theirs);
  const refused = await store.save();
  assert.equal(refused.result, 'failed');
  assert.equal((refused.error as { code?: string }).code, 'changed');
  assert.deepEqual([...expectations[0]!], [...utf16(NOTES)], 'the file\'s bytes as read, in UTF-16');
  assert.deepEqual([...(await shell.peekFile(path))], [...theirs]);
  // Unchanged underneath, the same save goes through, in the file's encoding.
  shell.plant(path, utf16(NOTES));
  assert.equal((await store.save()).result, 'saved');
  assert.deepEqual([...(await shell.peekFile(path))], [...utf16(`Shore${NOTES.slice(5)}`)]);
  store.close();
});

test('a baseline that is not the text held for the file: the file is read and decoded, and stands only if it reads as that text', async () => {
  const path = '/r/unheld.txt';
  const shell = createMemoryShell({ [path]: utf16(NOTES) });
  // What is held is the file's text; the store's baseline is other text, so the file's bytes for it are not known.
  await textForStore(shell, path, await shell.peekFile(path), null);
  const baseline = new TextEncoder().encode(`Other${NOTES.slice(5)}`);
  const expectations: (Uint8Array | undefined)[] = [];
  const io = encodedIo(
    {
      writeFileAtomic: (p, b, expected) => {
        expectations.push(expected);
        return shell.writeFileAtomic(p, b, expected);
      },
      peekFile: (p) => shell.peekFile(p),
    },
    shell,
    path,
  );
  const store = openDocumentStore(io, path, baseline);
  await store.apply({ range: { file: path, start: 0, end: 5 }, replacement: 'Shore', label: 'edit' });
  const refused = await store.save();
  assert.equal(refused.result, 'failed', 'the file does not read as the baseline');
  assert.equal((refused.error as { code?: string }).code, 'changed');
  assert.deepEqual(expectations, [], 'refused before the shell was asked');
  assert.deepEqual([...(await shell.peekFile(path))], [...utf16(NOTES)]);
  // The file now reads as the baseline: its bytes are what the shell checks.
  shell.plant(path, utf16(`Other${NOTES.slice(5)}`));
  assert.equal((await store.save()).result, 'saved');
  assert.deepEqual([...expectations[0]!], [...utf16(`Other${NOTES.slice(5)}`)]);
  store.close();
});
