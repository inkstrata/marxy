// The clipboard half of the Shell, apart from Tauri so both shells and the contract test share it
// (J-02, ADR-0065 §2, §3, §5). Nothing here runs on its own: every function acts only when a
// command calls the Shell method that wraps it, so there is no read at construction, on focus or on
// a timer. The native side (`src-tauri/src/pasteboard`) enforces the same rules again.
import type { ClipboardMeta, ClipboardRep, PasteboardTypes, ShellError } from '@marxy/shell-api';

const TEXT = 'public.utf8-plain-text';
const HTML = 'public.html';
const RTF = 'public.rtf';
const URL_TYPE = 'public.url';
const PNG = 'public.png';
const SOURCE = 'org.nspasteboard.source';
const TRANSIENT = 'org.nspasteboard.TransientType';
const CONCEALED = 'org.nspasteboard.ConcealedType';
/** Marxy's bundle identifier, the value of `SOURCE` on every write. */
const BUNDLE_ID = 'dev.marxy.app';

/** What `clipboardRead` may return; Rust never reads another type. */
const READABLE: readonly string[] = [TEXT, HTML, RTF, URL_TYPE, PNG];
/** What `clipboardWriteItem` accepts. The marker types are not on it: the shell adds them. */
const WRITABLE: readonly string[] = [TEXT, HTML, RTF, URL_TYPE];

function shellError(code: ShellError['code'], message: string): Error & { code: ShellError['code'] } {
  return Object.assign(new Error(message), { code });
}

/** Refuse a write the native side would refuse, before any native call. */
function checkWrite(reps: readonly ClipboardRep[]): void {
  if (reps.length === 0) throw shellError('invalid', 'nothing to write');
  const seen = new Set<string>();
  for (const { type } of reps) {
    if (!WRITABLE.includes(type)) {
      throw shellError('invalid', `${type} cannot be written; only text, HTML, RTF and URL can`);
    }
    if (seen.has(type)) throw shellError('invalid', `${type} appears twice in one item`);
    seen.add(type);
  }
}

/** The native calls the Tauri shell makes: an injected `invoke`, so a test can stand in for Rust. */
export type Call = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface NativeRead {
  readonly reps: readonly { readonly type: string; readonly encoding: 'utf8' | 'base64'; readonly data: string }[];
  readonly skipped: readonly { readonly type: string; readonly len: number }[];
}

type NativeError = { readonly code?: ShellError['code']; readonly message?: string };

async function native<T>(call: Call, command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await call<T>(command, args);
  } catch (err) {
    const e = (err ?? {}) as NativeError;
    throw shellError(e.code ?? 'io', e.message ?? (err instanceof Error ? err.message : String(err)));
  }
}

/** UTF-8 helpers. This file is the shell's one exemption from the no-TextEncoder rule (gate:fidelity). */
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
/** Strict: invalid UTF-8 throws `invalid` (never U+FFFD) and a leading BOM is kept, not stripped. */
const text = (b: Uint8Array): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b);
  } catch {
    throw shellError('invalid', 'not valid UTF-8');
  }
};

const decodeBase64 = (data: string): Uint8Array => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

/** The three Shell clipboard methods over J-01's `pasteboard_*` commands. */
function tauriClipboard(call: Call) {
  return {
    clipboardTypes: (): Promise<PasteboardTypes> => native<string[]>(call, 'pasteboard_types'),
    async clipboardRead(type: string): Promise<ClipboardRep | null> {
      if (!READABLE.includes(type)) return null;
      const got = await native<NativeRead>(call, 'pasteboard_read', { types: [type] });
      if (got.skipped.some((s) => s.type === type)) {
        throw shellError('invalid', `${type} is over the 16 MB clipboard cap`);
      }
      const rep = got.reps.find((r) => r.type === type);
      if (!rep) return null;
      return { type, bytes: rep.encoding === 'base64' ? decodeBase64(rep.data) : utf8(rep.data) };
    },
    async clipboardWriteItem(reps: readonly ClipboardRep[], meta?: ClipboardMeta): Promise<void> {
      checkWrite(reps);
      const wire = reps.map((r) => {
        try {
          return { type: r.type, data: text(r.bytes) };
        } catch {
          throw shellError('invalid', `${r.type} is not valid UTF-8`);
        }
      });
      await native<void>(call, 'pasteboard_write', { reps: wire, transient: meta?.transient === true });
    },
  };
}

/**
 * The one runtime export (the shell-boundary test allows a fixed list of names): the type names,
 * the write check and the Tauri adapter. The adapter takes `invoke` as an argument and holds no IPC
 * handle of its own.
 */
export const clipboard = {
  TEXT, HTML, RTF, URL: URL_TYPE, PNG, SOURCE, TRANSIENT, CONCEALED, BUNDLE_ID, READABLE, WRITABLE,
  checkWrite,
  shellError,
  utf8,
  text,
  tauri: tauriClipboard,
};
