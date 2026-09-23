// Source mode: CodeMirror 6, defaults, mode switch, buffer commit (MARXY-37).

export { defaultModeForPath, extensionOf, themeCssOpenNotice } from './default-mode.ts';
export { languageExtension, LARGE_FILE_BYTES } from './language.ts';
export { marxyCodeMirrorTheme } from './theme-bridge.ts';
export {
  leaveSourceMode,
  cmDocText,
  everyLineEndingIsCrlf,
  bytesFingerprint,
  type LeaveSourceResult,
} from './buffer-commit.ts';
export {
  renderedByteToCmPos,
  sourceVisibleByteOffset,
  scrollSourceToByte,
  selectionToCmRange,
  cmSelectionToBytes,
  byteToRenderedSelection,
} from './mode-switch.ts';
export {
  createSourceEditor,
  loadCodeMirror,
  isLargeSourceFile,
  editorDocConfig,
  baseExtensions,
  type SourceEditor,
  type SourceEditorOptions,
} from './editor.ts';
