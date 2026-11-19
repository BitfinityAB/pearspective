import { edgeRoute, layoutStack, localStackDetail, nextToMerge, stackNodes } from '../lib/stackLayout';
import { detectStacks } from '../../../shared/stacks';
import type { StackDetail } from '../../../shared/types';
import { makePr } from '../../../test/factories';

const detail: StackDetail = {
  repo: 'field-app', native: true, number: 4964, baseRefName: 'main',
  entries: [
    { number: 4985, title: 'Add storage', state: 'merged', position: 1 },
    { number: 4988, title: 'Offline mode', state: 'open', position: 2, behindParent: 0 },
    { number: 4989, title: 'Orders', state: 'open', position: 3, parentNumber: 4988, behindParent: 3 },
    { number: 4990, title: 'Journal', state: 'open', position: 4, parentNumber: 4988, behindParent: 1 },
  ],
};

describe('stack layout', () => {
  it('chains base, merged entries and open PRs, keeping forks', () => {
    expect(stackNodes(detail).map((node) => [node.key, node.kind, node.parentKey])).toEqual([
      ['base', 'base', null],
      ['n4985', 'merged', 'base'],
      ['n4988', 'open', 'n4985'],
      ['n4989', 'open', 'n4988'],
      ['n4990', 'open', 'n4988'],
    ]);
  });

  it('falls back to the chain below when an open entry names a parent that is not in the stack', () => {
    const orphaned: StackDetail = {
      ...detail,
      entries: [{ number: 7, title: 'Orphan', state: 'open', position: 1, parentNumber: 999 }],
    };
    expect(stackNodes(orphaned).map((node) => [node.key, node.parentKey])).toEqual([['base', null], ['n7', 'base']]);
    expect(() => layoutStack(stackNodes(orphaned))).not.toThrow();
  });

  it('marks open PRs that sit on the base or a merged entry as next to merge', () => {
    expect([...nextToMerge(stackNodes(detail))]).toEqual(['n4988']);
  });

  it('routes each edge downwards in merge direction with square corners, ending just above the target', () => {
    const base = { node: { key: 'base', kind: 'base' as const, parentKey: null }, x: 0, y: 0 };
    const child = { node: { key: 'n1', kind: 'open' as const, parentKey: 'base' }, x: 190, y: -110 };
    // Child bottom = -110 + 32 = -78; base top = -16; middle = -47; arrow stops 2px above the base.
    expect(edgeRoute({ source: base, target: child })).toBe('M190 -78 V-47 H0 V-18');
  });

  it('places the base at the bottom and children above their parents', () => {
    const { placed, links } = layoutStack(stackNodes(detail));
    const y = (key: string) => placed.find((entry) => entry.node.key === key)!.y;
    expect(y('base')).toBe(0);
    expect(y('n4985')).toBeLessThan(y('base'));
    expect(y('n4989')).toBe(y('n4990'));
    expect(links).toHaveLength(4);
  });

  it('builds a detail from snapshot data alone for the Stacks tab', () => {
    const bottom = makePr({ number: 3420, headRefName: 'lock' });
    const top = makePr({ number: 3421, baseRefName: 'lock' });
    const [stack] = detectStacks([bottom, top]);
    expect(localStackDetail(stack!, new Map([[bottom.id, bottom], [top.id, top]]))).toEqual({
      repo: 'orders-api', native: false, baseRefName: 'main',
      entries: [
        { number: 3420, title: bottom.title, state: 'open' },
        { number: 3421, title: top.title, state: 'open', parentNumber: 3420 },
      ],
    });
  });
});
