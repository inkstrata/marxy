// The proposals, installed once at start. Each asks whether it is on when it would act (`proposalOn`), so none
// needs installing again when Settings switches it.
import type { AppHandle } from '../app-types.ts';
import { installInspector } from './inspector.ts';
import { installMinimap } from './minimap.ts';
import { installNotesInPlace } from './notes-in-place.ts';
import { installPaging } from './paging.ts';
import { installTableAids } from './table-aids.ts';

export function installProposals(handle: AppHandle): () => void {
  const offs = [installTableAids(), installPaging(handle), installMinimap(handle), installInspector(handle), installNotesInPlace(handle)];
  return () => offs.forEach((off) => off());
}
