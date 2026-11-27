// One way to read a file a store keeps: its bytes, absent (nothing there: the store starts empty), or failed (it is
// there and could not be read: the store keeps the reader's file, never writes defaults over it).

export type ReadOutcome =
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  | { readonly kind: 'absent' }
  | { readonly kind: 'failed'; readonly error: unknown };

/** Only `code: 'not-found'` (shell-api's ShellError) is absent; any other rejection is failed. */
export async function readOrMissing(read: () => Promise<Uint8Array>): Promise<ReadOutcome> {
  try {
    return { kind: 'bytes', bytes: await read() };
  } catch (error) {
    return (error as { code?: unknown } | null)?.code === 'not-found' ? { kind: 'absent' } : { kind: 'failed', error };
  }
}

/** A failure's own words, for the one notice that says the file was kept. */
export const failureText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
