import { Poller } from '../poller';
import { TicketSync } from '../ticket-sync';
import { ConfigSchema } from '../config';
import { createFakeProvider } from '../../test/fake-provider';
import { createFakeTracker, makeTicket } from '../../test/fake-tracker';
import { makePr } from '../../test/factories';

describe('Poller with tickets', () => {
  it('publishes tickets and checks with the snapshot, and keeps GitHub data when tickets fail', async () => {
    const now = Date.parse('2026-11-20T12:00:00Z');
    const config = ConfigSchema.parse({ codeHost: { provider: 'fake', org: 'acme', repos: ['orders-api'] }, issueTracker: { provider: 'jira', baseUrl: 'https://tracker.example.test' } });
    const code = createFakeProvider([makePr({ headRefName: 'XX-1-work', createdAt: '2026-11-18T08:00:00Z' })]);
    const fake = createFakeTracker([makeTicket('XX-1', 'To Do', 'todo')]);
    const tickets = new TicketSync({ tracker: fake.tracker, codeHost: code.provider, now: () => now });
    const poller = new Poller({ provider: code.provider, config: () => config, now: () => now, tickets });

    await poller.tick();
    await poller.ticketWork();
    const snapshot = poller.snapshot();
    expect(snapshot.settings.ticketsEnabled).toBe(true);
    expect(snapshot.tickets['XX-1']?.status.name).toBe('To Do');
    expect(snapshot.ticketChecks['XX-1']?.verdict).toBe('mismatch');

    fake.tracker.checkAuth = async () => ({ ok: false, reason: 'missing-cli', message: 'Ticket status needs jira-cli: install it and run `jira init`.' });
    const failing = new Poller({ provider: code.provider, config: () => config, now: () => now, tickets: new TicketSync({ tracker: fake.tracker, codeHost: code.provider, now: () => now }) });
    await failing.tick();
    await failing.ticketWork();
    expect(failing.snapshot().prs).toHaveLength(1);
    expect(failing.snapshot().banners).toContainEqual({ kind: 'tickets', message: 'Ticket status needs jira-cli: install it and run `jira init`.' });
  });

  it('keeps ticket links but turns ticket features off when ticket status is disabled', () => {
    const config = ConfigSchema.parse({ codeHost: { provider: 'fake', org: 'acme', repos: ['orders-api'] }, issueTracker: { provider: 'jira', baseUrl: 'https://tracker.example.test', ticketStatus: false } });
    const poller = new Poller({ provider: createFakeProvider([]).provider, config: () => config });
    expect(poller.snapshot().settings.ticketsEnabled).toBe(false);
    expect(poller.snapshot().settings.ticketUrl).toBe('https://tracker.example.test/browse/{key}');
  });

  it('publishes GitHub data without waiting for a tracker that never answers, and never overlaps ticket work', async () => {
    const now = Date.parse('2026-11-20T12:00:00Z');
    const config = ConfigSchema.parse({ codeHost: { provider: 'fake', org: 'acme', repos: ['orders-api'] }, issueTracker: { provider: 'jira', baseUrl: 'https://tracker.example.test', refreshIntervalSec: 60 } });
    const code = createFakeProvider([makePr({ headRefName: 'XX-1-work' })]);
    let lookups = 0;
    const fake = createFakeTracker([], { getTickets: () => { lookups += 1; return new Promise(() => undefined); } });
    const clock = { now };
    const tickets = new TicketSync({ tracker: fake.tracker, codeHost: code.provider, now: () => clock.now });
    const poller = new Poller({ provider: code.provider, config: () => config, now: () => clock.now, tickets });

    await poller.tick();
    expect(poller.snapshot().prs).toHaveLength(1);
    clock.now += 120_000;
    await poller.tick({ full: true });
    expect(poller.snapshot().fetchedAt).toBe(new Date(clock.now).toISOString());
    expect(lookups).toBe(1);
  });

  it('keeps the ticket banner across GitHub refreshes and re-judges cached tickets on every tick', async () => {
    const start = Date.parse('2026-11-20T12:00:00Z');
    const clock = { now: start };
    const config = ConfigSchema.parse({ codeHost: { provider: 'fake', org: 'acme', repos: ['orders-api'] }, issueTracker: { provider: 'jira', baseUrl: 'https://tracker.example.test' } });
    const code = createFakeProvider([makePr({ headRefName: 'XX-1-work', createdAt: new Date(start - 25 * 60_000).toISOString() })]);
    const fake = createFakeTracker([makeTicket('XX-1', 'To Do', 'todo')]);
    const tickets = new TicketSync({ tracker: fake.tracker, codeHost: code.provider, now: () => clock.now });
    const poller = new Poller({ provider: code.provider, config: () => config, now: () => clock.now, tickets });

    await poller.tick();
    await poller.ticketWork();
    expect(poller.snapshot().ticketChecks['XX-1']?.verdict).toBe('grace');
    clock.now += 6 * 60_000;
    await poller.tick();
    await poller.ticketWork();
    expect(poller.snapshot().ticketChecks['XX-1']?.verdict).toBe('mismatch');
    expect(fake.state.requested).toHaveLength(1);

    fake.tracker.getTickets = async () => { throw new Error('tracker down'); };
    clock.now += 601_000;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await poller.tick();
    await poller.ticketWork();
    errors.mockRestore();
    expect(poller.snapshot().banners.filter((banner) => banner.kind === 'tickets')).toHaveLength(1);
    await poller.tick();
    expect(poller.snapshot().banners.filter((banner) => banner.kind === 'tickets')).toHaveLength(1);
  });
});
