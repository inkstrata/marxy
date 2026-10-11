// Loads, ahead of the first Source mount, what the editor's first mount imports one after another (V-11).
// A file that opens in Source waits for its editor before it has any text to show, so the fetches are asked for
// together, while the file is read and parsed. A hint only: a module that fails to load here fails again, and
// says so, when Source mounts (view/rendered-view.ts, `showSourceFailure`).

export function warmSourceEditor(path: string): void {
  const load = (fetch: () => Promise<unknown>): void => void fetch().catch(() => {});
  load(() => import('./editor.ts').then((m) => m.loadCodeMirror()));
  load(() => import('./mode-switch.ts'));
  load(() => import('./structure.ts'));
  load(() => import('./paste.ts'));
  load(() => Promise.all([import('@codemirror/commands'), import('@codemirror/search'), import('@codemirror/language')]));
  // The grammar for this file's type, if it has one.
  load(() => import('./language.ts').then((m) => m.languageExtension(path, 0)));
}
