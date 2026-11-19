import type { Stack } from '../../../shared/stacks';

export type Point = { x: number; y: number };
export const GUTTER_X = 26;
export const GUTTER_STEP = 12;
// The gap after the last gutter is the visible length of each horizontal arm.
export const ARM_LENGTH = 24;
export const textXFor = (maxColumn: number) => GUTTER_X + (maxColumn + 1) * GUTTER_STEP + ARM_LENGTH;

// A 26-deep chain must not push the text 300px right, so columns are per branch, not per depth.
export function branchColumns(stack: Stack): Map<string, number> {
  const columns = new Map<string, number>([['base', 0]]);
  let next = 1;
  const visit = (parentId: string) => {
    stack.members.filter((member) => (member.parentId ?? 'base') === parentId).forEach((child, index) => {
      columns.set(child.id, index === 0 ? columns.get(parentId)! : next++);
      visit(child.id);
    });
  };
  visit('base');
  return columns;
}

export function connectorPath(from: Point, to: Point, gutterX: number): string {
  return `M${from.x - 6} ${from.y} H${gutterX} V${to.y} H${to.x - 4}`;
}
