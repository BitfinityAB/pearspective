import { branchColumns, connectorPath, textXFor } from '../lib/stackConnectors';
import type { Stack } from '../../../shared/stacks';

const stackOf = (members: Stack['members']): Stack => ({ id: 's', repo: 'r', native: false, baseRefName: 'main', members, notOpenCount: 0 });

describe('stack connectors', () => {
  it('keeps a straight chain on one trunk', () => {
    const chain = stackOf([{ id: 'a', parentId: null }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }]);
    expect([...branchColumns(chain)]).toEqual([['base', 0], ['a', 0], ['b', 0], ['c', 0]]);
    expect(textXFor(0)).toBe(62);
  });

  it('gives each extra child of a fork its own column', () => {
    const fork = stackOf([{ id: 'lock', parentId: null }, { id: 'settings', parentId: 'lock' }, { id: 'metrics', parentId: 'lock' }]);
    const columns = branchColumns(fork);
    expect(columns.get('settings')).toBe(0);
    expect(columns.get('metrics')).toBe(1);
  });

  it('routes out of the child, down the gutter with square corners, and into the PR it merges into', () => {
    expect(connectorPath({ x: 62, y: 80 }, { x: 62, y: 200 }, 26)).toBe('M56 80 H26 V200 H58');
  });
});
