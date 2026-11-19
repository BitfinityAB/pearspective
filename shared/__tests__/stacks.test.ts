import { detectStacks, membersBottomUp, stackIndex } from '../stacks';
import { makePr } from '../../test/factories';

describe('detectStacks', () => {
  it('builds a native stack ordered by position and counts entries that are no longer open', () => {
    const native = (number: number, position: number) =>
      makePr({ number, repo: 'field-app', nativeStack: { number: 4964, size: 26, position, baseRefName: 'main' } });
    const prs = [native(4990, 17), native(4988, 15), native(4989, 16)];

    const [stack] = detectStacks(prs);

    expect(stack).toMatchObject({ id: 'field-app#s4964', native: true, number: 4964, baseRefName: 'main', notOpenCount: 23 });
    expect(stack!.members).toEqual([
      { id: 'PR_4988', parentId: null },
      { id: 'PR_4989', parentId: 'PR_4988' },
      { id: 'PR_4990', parentId: 'PR_4989' },
    ]);
  });

  it('leaves a gap in native positions as a stack with a null parent above the gap', () => {
    const native = (number: number, position: number) =>
      makePr({ number, nativeStack: { number: 2640, size: 4, position, baseRefName: 'main' } });
    const [stack] = detectStacks([native(2637, 1), native(2638, 3)]);
    expect(stack!.members).toEqual([{ id: 'PR_2637', parentId: null }, { id: 'PR_2638', parentId: null }]);
  });

  it('chains PRs whose base branch is another open PR head in the same repo, including forks', () => {
    const lock = makePr({ number: 3420, headRefName: 'scheduler-lock', baseRefName: 'main' });
    const settings = makePr({ number: 3421, headRefName: 'lock-settings', baseRefName: 'scheduler-lock' });
    const metrics = makePr({ number: 3422, headRefName: 'lock-metrics', baseRefName: 'scheduler-lock' });
    const unrelated = makePr({ number: 3500, headRefName: 'other', baseRefName: 'main' });

    const [stack] = detectStacks([metrics, unrelated, settings, lock]);

    expect(stack).toMatchObject({ id: 'orders-api#chain-3420', native: false, baseRefName: 'main', notOpenCount: 0 });
    expect(stack!.members).toEqual([
      { id: 'PR_3420', parentId: null },
      { id: 'PR_3421', parentId: 'PR_3420' },
      { id: 'PR_3422', parentId: 'PR_3420' },
    ]);
  });

  it('does not chain across repositories', () => {
    const parent = makePr({ repo: 'orders-api', headRefName: 'shared-name', baseRefName: 'main' });
    const child = makePr({ repo: 'orders-web', headRefName: 'child', baseRefName: 'shared-name' });
    expect(detectStacks([parent, child])).toEqual([]);
  });

  it('prefers the native stack when a PR is in one', () => {
    const native = makePr({ number: 1, headRefName: 'a', nativeStack: { number: 9, size: 2, position: 1, baseRefName: 'main' } });
    const nativeTop = makePr({ number: 2, headRefName: 'b', baseRefName: 'a', nativeStack: { number: 9, size: 2, position: 2, baseRefName: 'main' } });
    const stacks = detectStacks([native, nativeTop]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]!.native).toBe(true);
  });

  it('survives a branch cycle without looping forever', () => {
    const first = makePr({ headRefName: 'a', baseRefName: 'b' });
    const second = makePr({ headRefName: 'b', baseRefName: 'a' });
    expect(() => detectStacks([first, second])).not.toThrow();
  });
});

describe('stackIndex and membersBottomUp', () => {
  it('maps each member to its stack and parent, and orders members from the base upwards', () => {
    const lock = makePr({ number: 3420, headRefName: 'scheduler-lock' });
    const settings = makePr({ number: 3421, headRefName: 'lock-settings', baseRefName: 'scheduler-lock' });
    const top = makePr({ number: 3423, headRefName: 'top', baseRefName: 'lock-settings' });
    const stacks = detectStacks([top, settings, lock]);

    expect(stackIndex(stacks).get('PR_3423')).toEqual({ stack: stacks[0], parentId: 'PR_3421' });
    expect(membersBottomUp(stacks[0]!)).toEqual(['PR_3420', 'PR_3421', 'PR_3423']);
  });
});
