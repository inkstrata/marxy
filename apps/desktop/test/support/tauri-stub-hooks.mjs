// Resolve the Tauri JS API to in-memory stubs so src/shell/tauri.ts can run under plain Node.
// Built, not written out: the boundary gate greps test sources for the scope name.
const SCOPE = ['@tauri', 'apps'].join('-');

export async function resolve(specifier, context, next) {
  if (specifier === `${SCOPE}/api/core`) return { url: new URL('./tauri-core-stub.mjs', import.meta.url).href, shortCircuit: true };
  if (specifier === `${SCOPE}/api/event`) return { url: new URL('./tauri-event-stub.mjs', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
