import { stratify, tree } from 'd3';
import { membersBottomUp, type Stack } from '../../../shared/stacks';
import type { ChangeRequest, StackDetail } from '../../../shared/types';

export const NODE_WIDTH = 340;
export const NODE_HEIGHT = 64;

export interface DiagramNode {
  key: string;
  kind: 'base' | 'merged' | 'open';
  number?: number;
  title?: string;
  state?: 'merged' | 'closed' | 'open';
  parentKey: string | null;
  behindParent?: number;
}

export function stackNodes(detail: StackDetail): DiagramNode[] {
  const nodes: DiagramNode[] = [{ key: 'base', kind: 'base', title: detail.baseRefName, parentKey: null }];
  let below = 'base';
  for (const entry of detail.entries.filter((candidate) => candidate.state !== 'open')) {
    nodes.push({ key: `n${entry.number}`, kind: 'merged', number: entry.number, title: entry.title, state: entry.state, parentKey: below });
    below = `n${entry.number}`;
  }
  const known = new Set(detail.entries.map((entry) => `n${entry.number}`));
  for (const entry of detail.entries.filter((candidate) => candidate.state === 'open')) {
    const declaredParent = entry.parentNumber ? `n${entry.parentNumber}` : undefined;
    nodes.push({
      key: `n${entry.number}`, kind: 'open', number: entry.number, title: entry.title, state: 'open',
      parentKey: declaredParent && known.has(declaredParent) ? declaredParent : below, behindParent: entry.behindParent,
    });
  }
  return nodes;
}

export function nextToMerge(nodes: DiagramNode[]): Set<string> {
  const kindOf = new Map(nodes.map((node) => [node.key, node.kind]));
  return new Set(nodes.filter((node) => node.kind === 'open' && node.parentKey && kindOf.get(node.parentKey) !== 'open').map((node) => node.key));
}

/** Base at y = 0; everything above it has negative y, so the stack grows upwards like the mental model. */
export function layoutStack(nodes: DiagramNode[]) {
  const hierarchy = stratify<DiagramNode>().id((node) => node.key).parentId((node) => node.parentKey)(nodes);
  const root = tree<DiagramNode>().nodeSize([NODE_WIDTH + 40, NODE_HEIGHT + 46])(hierarchy);
  const point = (entry: typeof root) => ({ node: entry.data, x: entry.x, y: entry.y === 0 ? 0 : -entry.y });
  return {
    placed: root.descendants().map(point),
    links: root.links().map((link) => ({ source: point(link.source), target: point(link.target) })),
  };
}

type PlacedPoint = { node: DiagramNode; x: number; y: number };

/**
 * Square-cornered step route in merge direction: from the bottom of the child (link.target)
 * down to half way, across, and down into the top of what it merges into (link.source).
 */
export function edgeRoute(link: { source: PlacedPoint; target: PlacedPoint }): string {
  const childBottom = link.target.y + NODE_HEIGHT / 2;
  const parentTop = link.source.y - (link.source.node.kind === 'base' ? 16 : NODE_HEIGHT / 2);
  const middle = (childBottom + parentTop) / 2;
  // Stop 2px short so the arrowhead tip touches the card edge instead of overlapping it.
  return `M${link.target.x} ${childBottom} V${middle} H${link.source.x} V${parentTop - 2}`;
}

export function localStackDetail(stack: Stack, byId: Map<string, ChangeRequest>): StackDetail {
  const parentOf = new Map(stack.members.map((member) => [member.id, member.parentId]));
  const entries = membersBottomUp(stack).map((id) => {
    const pr = byId.get(id)!;
    const parentId = parentOf.get(id);
    const entry: StackDetail['entries'][number] = { number: pr.number, title: pr.title, state: 'open' };
    if (parentId) entry.parentNumber = byId.get(parentId)!.number;
    return entry;
  });
  const detail: StackDetail = { repo: stack.repo, native: stack.native, baseRefName: stack.baseRefName, entries };
  if (stack.number !== undefined) detail.number = stack.number;
  return detail;
}
