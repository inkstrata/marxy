export function readRecord(path: string): Record<string, unknown>;
export function updateRecord(
  path: string,
  update: (existing: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown>;
