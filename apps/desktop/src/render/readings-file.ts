// readings.json: how the reader chose to read parts of their files (core `reading/part-choices.ts` is the file, and
// `render/parts.ts` holds the choices). Read once at launch beside frame.json and config.toml and never waited for: a page
// set before it is read is set again when it is. Each choice is written a moment later; a newer Marxy's file is read and
// left as it is. Settings › Privacy forgets them all.
import { PartChoicesFile } from '@marxy/core/src/reading/part-choices.ts';
import type { AppShell } from '../app.ts';
import { said } from '../notices/config-copy.ts';
import { notify } from '../notices/index.ts';
import { onPartChoice, partChoicesNow, restorePartChoices, clearPartChoices } from './parts.ts';
import { colourChoicesNow, onColourChoice, restoreColourChoices } from './colour-tier.ts';
import { aloneChoicesNow, onAloneChoice, restoreAloneChoices } from '../viewers/table-choices.ts';
import { clearEncodingChoices, encodingChoicesNow, onEncodingChoice, restoreEncodingChoices } from '../document/encoding.ts';
import { bytesChoicesNow, onBytesChoice, restoreBytesChoices } from '../read-as/bytes-choice.ts';
import { onSourceChoice, restoreSourceChoices, sourceChoicesNow } from '../read-as/source-choice.ts';

type KeeperShell = Pick<AppShell, 'readFile' | 'writeFileAtomic' | 'configPaths'>;

const WRITE_DELAY_MS = 400;

export interface ReadingsKeeper {
  /** Settles once the file is read, or there is none to read. Never rejects. */
  readonly loaded: Promise<void>;
  flush(): Promise<void>;
  destroy(): void;
}

export type ForgetReadings = 'forgotten' | 'newer' | 'nowhere';

// One per page: a second `startApp` releases the first instance, and its keeper ends when the next one starts.
let active: { forget(): Promise<ForgetReadings>; end(): void } | null = null;

/** Forgets every part's chosen reading, in this window and in readings.json. */
export function forgetPartReadings(): Promise<ForgetReadings> {
  if (active) return active.forget();
  clearPartChoices();
  restoreColourChoices([]);
  restoreAloneChoices([]);
  clearEncodingChoices();
  restoreBytesChoices([]);
  restoreSourceChoices([]);
  return Promise.resolve('nowhere');
}

export function keepPartChoices(shell: KeeperShell | null): ReadingsKeeper {
  active?.end();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let restoring = false;
  let read = false;
  // Chosen before the file was read: those win over what it holds.
  const touched = new Set<string>();

  const file: Promise<PartChoicesFile | null> = (async () => {
    const paths = shell?.configPaths;
    if (!shell || !paths) return null;
    const { data } = await paths();
    if (data === '') return null;
    return PartChoicesFile.open({
      readFile: (path) => shell.readFile(path),
      writeFileAtomic: (path, bytes) => shell.writeFileAtomic(path, bytes),
      dataDirectory: async () => data,
    });
  })().catch((error: unknown) => {
    console.warn(`marxy: readings.json could not be read: ${String(error)}`);
    return null;
  });

  const schedule = (): void => {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => void write(), WRITE_DELAY_MS);
  };

  const chose = (path: string): void => {
    if (restoring) return;
    if (!read) touched.add(path);
    schedule();
  };
  const offParts = onPartChoice(chose);
  // A file coloured anyway past the plain-text tier is kept here too.
  const offColour = onColourChoice(chose);
  // A database read without its log too.
  const offAlone = onAloneChoice(chose);
  // An encoding chosen in Read with encoding... too.
  const offEncoding = onEncodingChoice(chose);
  // A file read as its bytes too.
  const offBytes = onBytesChoice(chose);
  // A code file put in Source too.
  const offSource = onSourceChoice(chose);
  const off = (): void => {
    offBytes();
    offSource();
    offParts();
    offColour();
    offAlone();
    offEncoding();
  };

  const loaded = file.then((opened) => {
    if (opened?.quarantined) {
      notify({
        kind: 'error',
        text: said('readings.json could not be read', 'the old file was kept beside it and a fresh one started', 'Your earlier choices of how to read parts are in the kept copy.'),
      });
    }
    restoring = true;
    try {
      if (opened) {
        restorePartChoices(opened.saved(), touched);
        restoreColourChoices(opened.savedColour(), touched);
        restoreAloneChoices(opened.savedAlone(), touched);
        restoreEncodingChoices(opened.savedEncodings(), touched);
        restoreBytesChoices(opened.savedBytes(), touched);
        restoreSourceChoices(opened.savedSource(), touched);
      }
    } finally {
      restoring = false;
      read = true;
    }
    if (touched.size > 0) schedule();
  });

  async function write(): Promise<void> {
    clearTimeout(timer);
    await loaded;
    if (!dirty) return;
    dirty = false;
    const opened = await file;
    try {
      await opened?.write(partChoicesNow(), { colour: colourChoicesNow(), alone: aloneChoicesNow(), encodings: encodingChoicesNow(), bytes: bytesChoicesNow(), source: sourceChoicesNow() });
    } catch (error) {
      console.warn(`marxy: readings.json could not be written: ${String(error)}`);
    }
  }

  const keeper = {
    async forget(): Promise<ForgetReadings> {
      clearPartChoices();
      restoreColourChoices([]);
      restoreAloneChoices([]);
      clearEncodingChoices();
      restoreBytesChoices([]);
      restoreSourceChoices([]);
      dirty = true;
      await write();
      const opened = await file;
      return opened === null ? 'nowhere' : opened.readOnly ? 'newer' : 'forgotten';
    },
    end() {
      off();
      clearTimeout(timer);
      if (active === keeper) active = null;
    },
  };
  active = keeper;

  return { loaded, flush: write, destroy: keeper.end };
}
