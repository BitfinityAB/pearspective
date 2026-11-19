import { buildStackDetail } from '../stack-detail';
import { createFakeProvider } from '../../test/fake-provider';
import { makePr } from '../../test/factories';
import { emptySnapshot } from '../../shared/types';

describe('buildStackDetail', () => {
  it('lists merged native entries below the open ones and fills behind counts', async () => {
    const bottom = makePr({ number: 4988, headRefName: 'offline-mode', nativeStack: { number: 4964, size: 4, position: 3, baseRefName: 'main' } });
    const top = makePr({ number: 4989, headRefName: 'orders', nativeStack: { number: 4964, size: 4, position: 4, baseRefName: 'main' } });
    const { provider } = createFakeProvider([bottom, top], {
      nativeStackEntries: async () => ({
        number: 4964, baseRefName: 'main',
        entries: [
          { position: 1, number: 4985, title: 'Add storage', state: 'merged' },
          { position: 2, number: 4986, title: 'Prefetch profile', state: 'merged' },
          { position: 3, number: 4988, title: bottom.title, state: 'open' },
          { position: 4, number: 4989, title: top.title, state: 'open' },
        ],
      }),
      compareRefs: async (_repo, base, head) => ({ behindBy: base === 'offline-mode' && head === 'orders' ? 2 : 0 }),
    });
    const snapshot = { ...emptySnapshot('acme'), prs: [bottom, top] };

    const detail = await buildStackDetail(provider, snapshot, top.id);

    expect(detail).toEqual({
      repo: 'orders-api', native: true, number: 4964, baseRefName: 'main',
      entries: [
        { number: 4985, title: 'Add storage', state: 'merged', position: 1 },
        { number: 4986, title: 'Prefetch profile', state: 'merged', position: 2 },
        { number: 4988, title: bottom.title, state: 'open', position: 3, behindParent: 0 },
        { number: 4989, title: top.title, state: 'open', position: 4, parentNumber: 4988, behindParent: 2 },
      ],
    });
  });

  it('leaves the behind count out for a comparison that failed instead of failing the whole stack', async () => {
    const bottom = makePr({ number: 3420, headRefName: 'lock' });
    const top = makePr({ number: 3421, headRefName: 'unlock', baseRefName: 'lock' });
    const { provider } = createFakeProvider([bottom, top], {
      compareRefs: async (_repo, base) => {
        if (base === 'lock') throw new Error('compare failed');
        return { behindBy: 1 };
      },
    });

    const detail = await buildStackDetail(provider, { ...emptySnapshot('acme'), prs: [bottom, top] }, top.id);

    expect(detail!.entries).toEqual([
      { number: 3420, title: bottom.title, state: 'open', behindParent: 1 },
      { number: 3421, title: top.title, state: 'open', parentNumber: 3420 },
    ]);
  });

  it('returns null for a PR that is not in a stack', async () => {
    const lone = makePr();
    const { provider } = createFakeProvider([lone]);
    expect(await buildStackDetail(provider, { ...emptySnapshot('acme'), prs: [lone] }, lone.id)).toBeNull();
  });
});
