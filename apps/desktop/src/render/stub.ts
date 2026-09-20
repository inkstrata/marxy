// Stub shell for the headless render entry: imageSize from an in-page decoder, no IPC (MARXY-25).
// Lives here rather than apps/desktop/src/shell/ because that directory is outside this story's paths.

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** The privileged surface the headless entry may call. Everything else is `unsupported`. */
export interface StubShell {
  imageSize(path: string): Promise<ImageSize | null>;
  assetUrl(path: string): string;
  readFile(path: string): Promise<Uint8Array>;
  writeFileAtomic(path: string, bytes: Uint8Array): Promise<void>;
  stat(path: string): Promise<null>;
  watch(): Promise<never>;
  listRoot(): Promise<never>;
  fuzzy(): Promise<never>;
  repositoryRoot(): Promise<never>;
  openDialog(): Promise<never>;
  revealInExternalEditor(): Promise<never>;
  clipboardWrite(): Promise<never>;
  onOpenFiles(): void;
  readonly platform: 'macos' | 'linux' | 'windows';
  startupMarks(): Promise<never>;
}

const unsupported = (name: string) => (): Promise<never> => Promise.reject(new Error(`unsupported: ${name}`));

/** Decodes a `data:` URL (or any src the in-page `Image` can load) for reserved width/height. */
export function decodeImageSize(src: string): Promise<ImageSize | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * `assetUrl` is identity so a harness can pass a `data:` URL as the path. `imageSize` then decodes
 * that same string. Named methods the render entry does not need reject rather than silently no-op.
 */
export function createStubShell(): StubShell {
  return {
    assetUrl: (path) => path,
    imageSize: (path) => decodeImageSize(path),
    readFile: unsupported('readFile'),
    writeFileAtomic: unsupported('writeFileAtomic'),
    stat: unsupported('stat'),
    watch: unsupported('watch'),
    listRoot: unsupported('listRoot'),
    fuzzy: unsupported('fuzzy'),
    repositoryRoot: unsupported('repositoryRoot'),
    openDialog: unsupported('openDialog'),
    revealInExternalEditor: unsupported('revealInExternalEditor'),
    clipboardWrite: unsupported('clipboardWrite'),
    onOpenFiles() {},
    platform: 'macos',
    startupMarks: unsupported('startupMarks'),
  };
}
