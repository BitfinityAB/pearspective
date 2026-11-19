import type { ChangeRequestStub } from './types';

export interface StackMember { id: string; parentId: string | null }
export interface Stack {
  id: string;
  repo: string;
  native: boolean;
  number?: number;
  baseRefName: string;
  members: StackMember[];
  /** Entries GitHub still lists in the stack that are not open any more (merged or closed). */
  notOpenCount: number;
}

function nativeStacks(prs: ChangeRequestStub[]): Stack[] {
  const groups = new Map<string, ChangeRequestStub[]>();
  for (const pr of prs) {
    if (!pr.nativeStack) continue;
    const key = `${pr.repo}#s${pr.nativeStack.number}`;
    groups.set(key, [...(groups.get(key) ?? []), pr]);
  }
  return [...groups].map(([id, group]) => {
    const ordered = [...group].sort((a, b) => a.nativeStack!.position - b.nativeStack!.position);
    const byPosition = new Map(ordered.map((pr) => [pr.nativeStack!.position, pr]));
    const first = ordered[0]!;
    return {
      id,
      repo: first.repo,
      native: true,
      number: first.nativeStack!.number,
      baseRefName: first.nativeStack!.baseRefName,
      members: ordered.map((pr) => ({ id: pr.id, parentId: byPosition.get(pr.nativeStack!.position - 1)?.id ?? null })),
      notOpenCount: first.nativeStack!.size - ordered.length,
    };
  });
}

function chainedStacks(prs: ChangeRequestStub[]): Stack[] {
  const candidates = prs.filter((pr) => !pr.nativeStack);
  const byHead = new Map(candidates.map((pr) => [`${pr.repo}\u0000${pr.headRefName}`, pr]));
  const parentOf = new Map<string, ChangeRequestStub>();
  for (const pr of candidates) {
    const parent = byHead.get(`${pr.repo}\u0000${pr.baseRefName}`);
    if (parent && parent.id !== pr.id) parentOf.set(pr.id, parent);
  }

  const rootOf = (pr: ChangeRequestStub): ChangeRequestStub => {
    const seen = new Set<string>();
    let current = pr;
    while (parentOf.has(current.id) && !seen.has(current.id)) {
      seen.add(current.id);
      current = parentOf.get(current.id)!;
    }
    return current;
  };

  const groups = new Map<string, ChangeRequestStub[]>();
  for (const pr of candidates) {
    const isChild = parentOf.has(pr.id);
    const isParent = [...parentOf.values()].some((parent) => parent.id === pr.id);
    if (!isChild && !isParent) continue;
    const root = rootOf(pr);
    groups.set(root.id, [...(groups.get(root.id) ?? []), pr]);
  }

  return [...groups].map(([rootId, group]) => {
    const root = group.find((pr) => pr.id === rootId) ?? group[0]!;
    const ordered = [...group].sort((a, b) => a.number - b.number);
    return {
      id: `${root.repo}#chain-${root.number}`,
      repo: root.repo,
      native: false,
      baseRefName: root.baseRefName,
      members: ordered.map((pr) => ({ id: pr.id, parentId: pr.id === root.id ? null : parentOf.get(pr.id)?.id ?? null })),
      notOpenCount: 0,
    };
  });
}

export function detectStacks(prs: ChangeRequestStub[]): Stack[] {
  return [...nativeStacks(prs), ...chainedStacks(prs)].filter((stack) => stack.members.length >= 2);
}

export function stackIndex(stacks: Stack[]): Map<string, { stack: Stack; parentId: string | null }> {
  const index = new Map<string, { stack: Stack; parentId: string | null }>();
  for (const stack of stacks) for (const member of stack.members) index.set(member.id, { stack, parentId: member.parentId });
  return index;
}

export function membersBottomUp(stack: Stack): string[] {
  const depth = new Map<string, number>();
  const parentOf = new Map(stack.members.map((member) => [member.id, member.parentId]));
  const depthOf = (id: string, guard = 0): number => {
    if (depth.has(id)) return depth.get(id)!;
    const parent = parentOf.get(id);
    const value = parent && guard < stack.members.length ? depthOf(parent, guard + 1) + 1 : 0;
    depth.set(id, value);
    return value;
  };
  return stack.members
    .map((member, order) => ({ id: member.id, depth: depthOf(member.id), order }))
    .sort((a, b) => a.depth - b.depth || a.order - b.order)
    .map((entry) => entry.id);
}
