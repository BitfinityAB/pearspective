import { TicketSync } from '../ticket-sync';
import { ConfigSchema } from '../config';
import { ProviderError } from '../providers/types';
import { createFakeProvider } from '../../test/fake-provider';
import { createFakeTracker, makeTicket } from '../../test/fake-tracker';
import { makeClosed, makePr } from '../../test/factories';

const config = ConfigSchema.parse({ codeHost: { provider: 'fake', org: 'acme', repos: ['orders-api'] }, issueTracker: { provider: 'jira', baseUrl: 'https://tracker.example.test' } }).issueTracker!;

function setup(start = Date.parse('2026-11-20T12:00:00Z')) {
  const clock = { now: start };
  const code = createFakeProvider([]);
  const fake = createFakeTracker([makeTicket('XX-1', 'In Progress', 'inProgress'), makeTicket('XX-2', 'Done', 'done')]);
  const sync = new TicketSync({ tracker: fake.tracker, codeHost: code.provider, now: () => clock.now });
  return { clock, code, fake, sync };
}

describe('TicketSync', () => {
  it('fetches tickets for keys in open and recently closed PRs', async () => {
    const { code, fake, sync } = setup();
    code.state.closed = [makeClosed({ headRefName: 'XX-2-done', closedAt: '2026-11-19T10:00:00Z' })];
    const state = await sync.sync({ open: [makePr({ headRefName: 'XX-1-work' })], repos: ['orders-api'], config });
    expect(Object.keys(state.tickets).sort()).toEqual(['XX-1', 'XX-2']);
    expect(state.closed).toHaveLength(1);
    expect(fake.state.requested).toEqual([['XX-1', 'XX-2']]);
  });

  it('only asks for new keys between refreshes and everything once the interval has passed', async () => {
    const { clock, fake, sync } = setup();
    await sync.sync({ open: [makePr({ headRefName: 'XX-1-work' })], repos: [], config });
    await sync.sync({ open: [makePr({ headRefName: 'XX-1-work' })], repos: [], config });
    await sync.sync({ open: [makePr({ headRefName: 'XX-1-work' }), makePr({ headRefName: 'XX-2-work' })], repos: [], config });
    clock.now += 601_000;
    await sync.sync({ open: [makePr({ headRefName: 'XX-1-work' }), makePr({ headRefName: 'XX-2-work' })], repos: [], config });
    expect(fake.state.requested).toEqual([['XX-1'], ['XX-2'], ['XX-1', 'XX-2']]);
  });

  it('remembers keys that are not tickets', async () => {
    const { clock, fake, sync } = setup();
    await sync.sync({ open: [makePr({ headRefName: 'ROUTER-7-upgrade' })], repos: [], config });
    clock.now += 601_000;
    await sync.sync({ open: [makePr({ headRefName: 'ROUTER-7-upgrade' })], repos: [], config });
    expect(fake.state.requested).toEqual([['ROUTER-7']]);
  });

  it('shows the tracker message when it is not logged in, without retrying every tick', async () => {
    const { fake, sync } = setup();
    fake.tracker.checkAuth = async () => ({ ok: false, reason: 'auth', message: 'jira-cli is not logged in' });
    const first = await sync.sync({ open: [makePr({ headRefName: 'XX-1-work' })], repos: [], config });
    expect(first.banner).toEqual({ kind: 'tickets', message: 'Ticket status unavailable: jira-cli is not logged in' });
    await sync.sync({ open: [makePr({ headRefName: 'XX-9-new' })], repos: [], config });
    expect(fake.state.requested).toEqual([]);
  });

  it('keeps the last good tickets and says how old they are when a refresh fails', async () => {
    const { clock, fake, sync } = setup();
    await sync.sync({ open: [makePr({ headRefName: 'XX-1-work' })], repos: [], config });
    fake.tracker.getTickets = async () => { throw new ProviderError('failed', 'jira-cli timed out'); };
    clock.now += 25 * 60_000;
    const state = await sync.sync({ open: [makePr({ headRefName: 'XX-1-work' })], repos: [], config });
    expect(state.tickets['XX-1']?.status.name).toBe('In Progress');
    expect(state.banner?.message).toBe('Ticket refresh failed: jira-cli timed out. Showing ticket status from 25 min ago.');
  });

  it('does not re-request a key the tracker silently leaves out until the next full refresh', async () => {
    const { clock, fake, sync } = setup();
    const requested: string[][] = [];
    fake.tracker.getTickets = async (keys) => { requested.push(keys); return { tickets: [], notFound: [] }; };
    const open = [makePr({ headRefName: 'OLD-1-moved' })];
    await sync.sync({ open, repos: [], config });
    await sync.sync({ open, repos: [], config });
    expect(requested).toEqual([['OLD-1']]);
    clock.now += 601_000;
    await sync.sync({ open, repos: [], config });
    expect(requested).toEqual([['OLD-1'], ['OLD-1']]);
  });

  it('dates the failure banner from the last full refresh, not from a small new-key fetch', async () => {
    const { clock, fake, sync } = setup();
    await sync.sync({ open: [makePr({ headRefName: 'XX-1-work' })], repos: [], config });
    clock.now += 2 * 60_000;
    await sync.sync({ open: [makePr({ headRefName: 'XX-1-work' }), makePr({ headRefName: 'XX-2-work' })], repos: [], config });
    fake.tracker.getTickets = async () => { throw new ProviderError('failed', 'jira-cli timed out'); };
    clock.now += 23 * 60_000;
    const state = await sync.sync({ open: [makePr({ headRefName: 'XX-1-work' })], repos: [], config });
    expect(state.banner?.message).toBe('Ticket refresh failed: jira-cli timed out. Showing ticket status from 25 min ago.');
  });
});
