import { detectStacks, membersBottomUp, stackIndex } from '../shared/stacks';
import type { Snapshot, StackDetail, StackEntryDetail } from '../shared/types';
import type { CodeHostProvider } from './providers/types';

export async function buildStackDetail(provider: CodeHostProvider, snapshot: Snapshot, prId: string): Promise<StackDetail | null> {
  const entry = stackIndex(detectStacks(snapshot.prs)).get(prId);
  if (!entry) return null;
  const { stack } = entry;
  const byId = new Map(snapshot.prs.map((pr) => [pr.id, pr]));
  const parentOf = new Map(stack.members.map((member) => [member.id, member.parentId]));
  const ordered = membersBottomUp(stack).map((id) => byId.get(id)!);

  // One failed comparison only costs that entry its behind count, not the whole dialog.
  const comparisons = await Promise.allSettled(ordered.map((pr) => {
    const parent = parentOf.get(pr.id) ? byId.get(parentOf.get(pr.id)!) : undefined;
    return provider.compareRefs(pr.repo, parent?.headRefName ?? pr.baseRefName, pr.headRefName);
  }));
  const open: StackEntryDetail[] = ordered.map((pr, index) => {
    const parent = parentOf.get(pr.id) ? byId.get(parentOf.get(pr.id)!) : undefined;
    const comparison = comparisons[index]!;
    const detail: StackEntryDetail = { number: pr.number, title: pr.title, state: 'open' };
    if (comparison.status === 'fulfilled') detail.behindParent = comparison.value.behindBy;
    if (pr.nativeStack) detail.position = pr.nativeStack.position;
    if (parent) detail.parentNumber = parent.number;
    return detail;
  });

  let notOpen: StackEntryDetail[] = [];
  if (stack.native) {
    const native = await provider.nativeStackEntries(stack.repo, ordered[0]!.number);
    const lowestOpen = Math.min(...ordered.map((pr) => pr.nativeStack?.position ?? Number.POSITIVE_INFINITY));
    notOpen = (native?.entries ?? [])
      .filter((candidate) => candidate.state !== 'open' && candidate.position < lowestOpen)
      .sort((a, b) => a.position - b.position)
      .map((candidate) => ({ number: candidate.number, title: candidate.title, state: candidate.state, position: candidate.position }));
  }

  const detail: StackDetail = { repo: stack.repo, native: stack.native, baseRefName: stack.baseRefName, entries: [...notOpen, ...open] };
  if (stack.number !== undefined) detail.number = stack.number;
  return detail;
}
