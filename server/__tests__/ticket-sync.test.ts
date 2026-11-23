import { TicketSync } from '../ticket-sync';
import { ConfigSchema } from '../config';
import { ProviderError } from '../providers/types';
import { createFakeProvider } from '../../test/fake-provider';
import { createFakeTracker, makeTicket } from '../../test/fake-tracker';
import { makeClosed, makePr } from '../../test/factories';
import { SafeStore } from '../storage/safe-store';
import type { StoredState } from '../storage/store';

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
    const state = await sync.sync({ org: 'acme', open: [makePr({ headRefName: 'XX-1-work' })], repos: ['orders-api'], config });
    expect(Object.keys(state.tickets).sort()).toEqual(['XX-1', 'XX-2']);
    expect(state.closed).toHaveLength(1);
    expect(fake.state.requested).toEqual([['XX-1', 'XX-2']]);
  });

  it('only asks for new keys between refreshes and everything once the interval has passed', async () => {
    const { clock, fake, sync } = setup();
    await sync.sync({ org: 'acme', open: [makePr({ headRefName: 'XX-1-work' })], repos: [], config });
    await sync.sync({ org: 'acme', open: [makePr({ headRefName: 'XX-1-work' })], repos: [], config });
    await sync.sync({ org: 'acme', open: [makePr({ headRefName: 'XX-1-work' }), makePr({ headRefName: 'XX-2-work' })], repos: [], config });
    clock.now += 601_000;
    await sync.sync({ org: 'acme', open: [makePr({ headRefName: 'XX-1-work' }), makePr({ headRefName: 'XX-2-work' })], repos: [], config });
    expect(fake.state.requested).toEqual([['XX-1'], ['XX-2'], ['XX-1', 'XX-2']]);
  });

  it('remembers keys that are not tickets', async () => {
    const { clock, fake, sync } = setup();
    await sync.sync({ org: 'acme', open: [makePr({ headRefName: 'ROUTER-7-upgrade' })], repos: [], config });
    clock.now += 601_000;
    await sync.sync({ org: 'acme', open: [makePr({ headRefName: 'ROUTER-7-upgrade' })], repos: [], config });
    expect(fake.state.requested).toEqual([['ROUTER-7']]);
  });

  it('shows the tracker message when it is not logged in, without retrying every tick', async () => {
    const { fake, sync } = setup();
    fake.tracker.checkAuth = async () => ({ ok: false, reason: 'auth', message: 'jira-cli is not logged in' });
    const first = await sync.sync({ org: 'acme', open: [makePr({ headRefName: 'XX-1-work' })], repos: [], config });
    expect(first.banner).toEqual({ kind: 'tickets', message: 'Ticket status unavailable: jira-cli is not logged in' });
    await sync.sync({ org: 'acme', open: [makePr({ headRefName: 'XX-9-new' })], repos: [], config });
    expect(fake.state.requested).toEqual([]);
  });

  it('keeps the last good tickets and says how old they are when a refresh fails', async () => {
    const { clock, fake, sync } = setup();
    await sync.sync({ org: 'acme', open: [makePr({ headRefName: 'XX-1-work' })], repos: [], config });
    fake.tracker.getTickets = async () => { throw new ProviderError('failed', 'jira-cli timed out'); };
    clock.now += 25 * 60_000;
    const state = await sync.sync({ org: 'acme', open: [makePr({ headRefName: 'XX-1-work' })], repos: [], config });
    expect(state.tickets['XX-1']?.status.name).toBe('In Progress');
    expect(state.banner?.message).toBe('Ticket refresh failed: jira-cli timed out. Showing ticket status from 25 min ago.');
  });

  it('does not re-request a key the tracker silently leaves out until the next full refresh', async () => {
    const { clock, fake, sync } = setup();
    const requested: string[][] = [];
    fake.tracker.getTickets = async (keys) => { requested.push(keys); return { tickets: [], notFound: [] }; };
    const open = [makePr({ headRefName: 'OLD-1-moved' })];
    await sync.sync({ org: 'acme', open, repos: [], config });
    await sync.sync({ org: 'acme', open, repos: [], config });
    expect(requested).toEqual([['OLD-1']]);
    clock.now += 601_000;
    await sync.sync({ org: 'acme', open, repos: [], config });
    expect(requested).toEqual([['OLD-1'], ['OLD-1']]);
  });

  it('dates the failure banner from the last full refresh, not from a small new-key fetch', async () => {
    const { clock, fake, sync } = setup();
    await sync.sync({ org: 'acme', open: [makePr({ headRefName: 'XX-1-work' })], repos: [], config });
    clock.now += 2 * 60_000;
    await sync.sync({ org: 'acme', open: [makePr({ headRefName: 'XX-1-work' }), makePr({ headRefName: 'XX-2-work' })], repos: [], config });
    fake.tracker.getTickets = async () => { throw new ProviderError('failed', 'jira-cli timed out'); };
    clock.now += 23 * 60_000;
    const state = await sync.sync({ org: 'acme', open: [makePr({ headRefName: 'XX-1-work' })], repos: [], config });
    expect(state.banner?.message).toBe('Ticket refresh failed: jira-cli timed out. Showing ticket status from 25 min ago.');
  });

  it('clears an old banner on a refresh that has no keys to look up', async () => {
    const { clock, fake, sync } = setup();
    fake.tracker.checkAuth = async () => ({ ok: false, reason: 'auth', message: 'not logged in' });
    expect((await sync.sync({ org: 'acme', open: [makePr({ headRefName: 'XX-1-work' })], repos: [], config })).banner).not.toBeNull();
    clock.now += 601_000;
    expect((await sync.sync({ org: 'acme', open: [], repos: [], config })).banner).toBeNull();
  });

  it('keeps the previous closed PRs when the code host fails, without a ticket banner or a new login check', async () => {
    const { clock, code, fake, sync } = setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    code.state.closed = [makeClosed({ headRefName: 'XX-2-done', closedAt: '2026-11-19T10:00:00Z' })];
    await sync.sync({ org: 'acme', open: [makePr({ headRefName: 'XX-1-work' })], repos: ['orders-api'], config });
    code.provider.fetchClosed = async () => { throw new ProviderError('auth', 'gh is not logged in'); };
    clock.now += 601_000;
    const state = await sync.sync({ org: 'acme', open: [makePr({ headRefName: 'XX-1-work' })], repos: ['orders-api'], config });
    expect(state.closed).toHaveLength(1);
    expect(state.banner).toBeNull();
    expect(Object.keys(state.tickets).sort()).toEqual(['XX-1', 'XX-2']);
    expect(fake.state.requested).toEqual([['XX-1', 'XX-2'], ['XX-1', 'XX-2']]);
    expect(fake.state.authCalls).toBe(1);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('TicketSync with a store', () => {
  const org = 'acme';
  const emptyRefresh = { org, host: 'example.test', fetchedAt: '2026-11-20T11:00:00.000Z', viewer: { login: 'alex', teams: [] }, upserted: [], removedIds: [], overviewIds: [], mine: { authored: [], requested: [], team: [] } };
  const stored = (overrides: Partial<StoredState>): StoredState => ({
    fetchedAt: '2026-11-20T11:00:00.000Z', viewer: null, prs: [], overviewIds: [], mine: { authored: [], requested: [], team: [] },
    closed: [], tickets: {}, ticketsSyncedAt: null, statusCategories: {}, notTickets: [], ...overrides,
  });

  it('starts from stored tickets and asks the tracker only for unknown keys while a sync is not due', async () => {
    const start = Date.parse('2026-11-20T12:00:00Z');
    const code = createFakeProvider([]);
    const fake = createFakeTracker([makeTicket('XX-1', 'In Progress', 'inProgress'), makeTicket('XX-3', 'Done', 'done')]);
    const sync = new TicketSync({
      tracker: fake.tracker, codeHost: code.provider, now: () => start,
      stored: stored({ tickets: { 'XX-1': makeTicket('XX-1', 'In Progress', 'inProgress') }, notTickets: ['XX-9'], ticketsSyncedAt: new Date(start - 60_000).toISOString() }),
    });
    const state = await sync.sync({ org, open: [makePr({ headRefName: 'XX-1-a' }), makePr({ headRefName: 'XX-9-b' }), makePr({ headRefName: 'XX-3-c' })], repos: ['orders-api'], config });
    expect(fake.state.requested).toEqual([['XX-3']]);
    expect(Object.keys(state.tickets).sort()).toEqual(['XX-1', 'XX-3']);
  });

  it('does a full sync first when the stored sync is older than the interval', async () => {
    const start = Date.parse('2026-11-20T12:00:00Z');
    const code = createFakeProvider([]);
    const fake = createFakeTracker([makeTicket('XX-1', 'In Progress', 'inProgress')]);
    const sync = new TicketSync({
      tracker: fake.tracker, codeHost: code.provider, now: () => start,
      stored: stored({ tickets: { 'XX-1': makeTicket('XX-1', 'In Progress', 'inProgress') }, ticketsSyncedAt: new Date(start - (config.refreshIntervalSec + 1) * 1000).toISOString() }),
    });
    await sync.sync({ org, open: [makePr({ headRefName: 'XX-1-a' })], repos: ['orders-api'], config });
    expect(fake.state.requested).toEqual([['XX-1']]);
  });

  it('saves tickets, not-a-ticket keys, closed PRs, the sync time and learned categories', async () => {
    const start = Date.parse('2026-11-20T12:00:00Z');
    const store = SafeStore.open(':memory:');
    store.saveRefresh(emptyRefresh);
    const code = createFakeProvider([]);
    const closed = makeClosed({ headRefName: 'XX-2-done', closedAt: '2026-11-19T10:00:00Z' });
    code.state.closed = [closed];
    const fake = createFakeTracker([makeTicket('XX-1', 'In Progress', 'inProgress')], { statusCategories: () => ({ 'In Progress': 'inProgress' }) });
    const sync = new TicketSync({ tracker: fake.tracker, codeHost: code.provider, now: () => start, store });
    await sync.sync({ org, open: [makePr({ headRefName: 'XX-1-a' })], repos: ['orders-api'], config });
    const saved = store.load({ org, repos: ['orders-api'] })!;
    expect(Object.keys(saved.tickets)).toEqual(['XX-1']);
    expect(saved.notTickets).toEqual(['XX-2']);
    expect(saved.closed.map((pr) => pr.id)).toEqual([closed.id]);
    expect(saved.ticketsSyncedAt).toBe('2026-11-20T12:00:00.000Z');
    expect(saved.statusCategories).toEqual({ 'In Progress': 'inProgress' });
    expect(store.error).toBeNull();
  });

  it('leaves the stored closed list and sync time alone when fetching closed PRs fails', async () => {
    const earlier = Date.parse('2026-11-20T12:00:00Z');
    const store = SafeStore.open(':memory:');
    store.saveRefresh(emptyRefresh);
    const oldClosed = makeClosed({ headRefName: 'XX-2-done', closedAt: '2026-11-19T10:00:00Z' });
    const code = createFakeProvider([]);
    code.state.closed = [oldClosed];
    const fake = createFakeTracker([makeTicket('XX-1', 'In Progress', 'inProgress'), makeTicket('XX-2', 'Done', 'done')]);
    const clock = { now: earlier };
    const sync = new TicketSync({ tracker: fake.tracker, codeHost: code.provider, now: () => clock.now, store });
    await sync.sync({ org, open: [makePr({ headRefName: 'XX-1-a' })], repos: ['orders-api'], config });
    code.provider.fetchClosed = async () => { throw new ProviderError('auth', 'gh is not logged in'); };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    clock.now += (config.refreshIntervalSec + 1) * 1000;
    await sync.sync({ org, open: [makePr({ headRefName: 'XX-1-a' })], repos: ['orders-api'], config });
    const saved = store.load({ org, repos: ['orders-api'] })!;
    expect(saved.closed.map((pr) => pr.id)).toEqual([oldClosed.id]);
    expect(saved.ticketsSyncedAt).toBe(new Date(earlier).toISOString());
    vi.restoreAllMocks();
  });
});
