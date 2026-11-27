// Which of the proposals are on, as config.toml last said (applyAppConfig sets them). Each proposal asks
// `proposalOn` at the moment it would act, so a switch in Settings takes effect without a restart; one that draws
// something it keeps on the page listens with `onProposals`. The root carries `data-marxy-proposal-<id>` for CSS.
import { PROPOSAL_DEFAULTS, PROPOSAL_IDS, type ProposalId, type Proposals } from '@marxy/theme';

let current: Proposals = PROPOSAL_DEFAULTS;
const listeners = new Set<(now: Proposals, before: Proposals) => void>();

export function proposalOn(id: ProposalId): boolean {
  return current[id];
}

export function proposalsNow(): Proposals {
  return current;
}

export function setProposals(next: Proposals, root: HTMLElement = document.documentElement): void {
  const before = current;
  current = next;
  for (const id of PROPOSAL_IDS) root.toggleAttribute(`data-marxy-proposal-${id.replace(/_/g, '-')}`, next[id]);
  if (PROPOSAL_IDS.some((id) => before[id] !== next[id])) for (const cb of [...listeners]) cb(next, before);
}

/** `cb` hears each change after the first; returns the off switch. */
export function onProposals(cb: (now: Proposals, before: Proposals) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
