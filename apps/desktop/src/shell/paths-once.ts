import type { AppShell } from '../app-types.ts';

type ConfigPaths = NonNullable<AppShell['configPaths']>;

/**
 * `configPaths` asked of the shell once per app: config.toml, frame.json and kinds.json all start from the same answer,
 * and the launch asks before first text. A failed answer is not kept, so a later read asks again.
 */
export function pathsOnce(configPaths: AppShell['configPaths']): AppShell['configPaths'] {
  if (configPaths === undefined) return undefined;
  let answer: ReturnType<ConfigPaths> | null = null;
  return () =>
    (answer ??= configPaths().catch((e: unknown) => {
      answer = null;
      throw e;
    }));
}
