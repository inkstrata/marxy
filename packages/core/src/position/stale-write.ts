// Detects a file that changed under the reader between open and save (ADR-0004, MARXY-34).
// writeFileAtomic has no precondition, so this comparison is what stops last-writer-wins.

/**
 * Why a save must not proceed: the bytes on disk are no longer the bytes that were read.
 * `null` means the on-disk file still matches what the reader opened.
 */
export function staleWriteError(
  path: string,
  expected: Uint8Array,
  onDisk: Uint8Array,
): string | null {
  if (expected.byteLength !== onDisk.byteLength) {
    return `${path}: changed on disk since it was opened; refusing to overwrite`;
  }
  for (let i = 0; i < expected.byteLength; i++) {
    if (expected[i] !== onDisk[i]) {
      return `${path}: changed on disk since it was opened; refusing to overwrite`;
    }
  }
  return null;
}
