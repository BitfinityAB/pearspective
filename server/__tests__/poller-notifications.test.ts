import { Poller, withKnownMergeStates } from '../poller';
import { emptySnapshot } from '../../shared/types';
import { ConfigSchema } from '../config';
import { ProviderError } from '../providers/types';
import { createFakeProvider } from '../../test/fake-provider';
import { makePr } from '../../test/factories';

const config = (notifications?: unknown) => ConfigSchema.parse({ codeHost: { provider: 'fake', org: 'acme', repos: ['orders-api'] }, ...(notifications ? { notifications } : {}) });
const failing = [{ name: 'build', state: 'failure' as const, required: true }];

function setup(notifications: unknown = { enabled: true }) {
  let now = Date.parse('2026-11-21T12:00:00Z');
  const pr = makePr({ reviewDecision: 'review_required' });
  const code = createFakeProvider([pr]);
  code.state.mine.authored = [pr.id];
  const poller = new Poller({ provider: code.provider, config: () => config(notifications), now: () => now });
  const failCi = () => { code.state.prs = [{ ...pr, checks: failing, updatedAt: '2026-11-21T12:01:00Z' }]; };
  return { poller, code, pr, failCi, advance: (ms: number) => (now += ms) };
}

describe('Poller notifications', () => {
  it('publishes no batch for the first refresh, then a batch for a change on the viewer\'s PR', async () => {
    const { poller, failCi, advance, pr } = setup();
    await poller.tick();
    expect(poller.snapshot().notification).toBeNull();
    failCi();
    advance(60_000);
    await poller.tick();
    const batch = poller.snapshot().notification!;
    expect(batch.id).toBe('2026-11-21T12:01:00.000Z');
    expect(batch.items).toEqual([expect.objectContaining({ prId: pr.id, events: [{ kind: 'ciFailed' }] })]);
    advance(60_000);
    await poller.tick();
    expect(poller.snapshot().notification).toBeNull();
  });

  it('skips a failed refresh and compares the next good one with the last complete snapshot', async () => {
    const { poller, code, failCi, advance } = setup();
    await poller.tick();
    const fetchFull = code.provider.fetchFull;
    code.provider.fetchFull = async () => { throw new ProviderError('failed', 'boom', []); };
    failCi();
    advance(60_000);
    await poller.tick();
    expect(poller.snapshot().notification).toBeNull();
    code.provider.fetchFull = fetchFull;
    advance(60_000);
    await poller.tick();
    expect(poller.snapshot().notification?.items[0]?.events).toEqual([{ kind: 'ciFailed' }]);
  });

  it('publishes nothing while notifications are off', async () => {
    const { poller, failCi, advance } = setup(null);
    await poller.tick();
    failCi();
    advance(60_000);
    await poller.tick();
    expect(poller.snapshot().notification).toBeNull();
  });

  it('keeps the last known merge state through an unknown reading so a later conflict still notifies', async () => {
    const { poller, code, pr, advance } = setup();
    await poller.tick();
    code.state.prs = [{ ...pr, mergeState: 'unknown', updatedAt: '2026-11-21T12:01:00Z' }];
    advance(60_000);
    await poller.tick();
    expect(poller.snapshot().prs[0]?.mergeState).toBe('unknown');
    code.state.prs = [{ ...pr, mergeState: 'conflicts', updatedAt: '2026-11-21T12:02:00Z' }];
    advance(60_000);
    await poller.tick();
    expect(poller.snapshot().notification?.items[0]?.events).toContainEqual({ kind: 'conflict' });
  });
});

describe('withKnownMergeStates', () => {
  const snapshotOf = (...prs: ReturnType<typeof makePr>[]) => ({ ...emptySnapshot('acme'), prs });

  it('replaces an unknown state with the previous known one and leaves everything else alone', () => {
    const stays = makePr({ id: 'PR_stays', mergeState: 'clean' });
    const unknownNow = makePr({ id: 'PR_unknown', mergeState: 'unknown', title: 'Fresh title' });
    const brandNew = makePr({ id: 'PR_new', mergeState: 'unknown' });
    const stillUnknown = makePr({ id: 'PR_still', mergeState: 'unknown' });
    const previous = snapshotOf(makePr({ id: 'PR_stays', mergeState: 'conflicts' }), makePr({ id: 'PR_unknown', mergeState: 'conflicts' }), makePr({ id: 'PR_still', mergeState: 'unknown' }));
    const next = snapshotOf(stays, unknownNow, brandNew, stillUnknown);
    const merged = withKnownMergeStates(next, previous);
    expect(merged.prs.map((pr) => pr.mergeState)).toEqual(['clean', 'conflicts', 'unknown', 'unknown']);
    expect(merged.prs[1]?.title).toBe('Fresh title');
    expect(next.prs[1]?.mergeState).toBe('unknown');
  });

  it('returns the snapshot as is when there is no previous one', () => {
    const next = snapshotOf(makePr({ mergeState: 'unknown' }));
    expect(withKnownMergeStates(next, null)).toBe(next);
  });
});
