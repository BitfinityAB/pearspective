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
    const snapshot = poller.snapshot();
    expect(snapshot.settings.ticketsEnabled).toBe(true);
    expect(snapshot.tickets['XX-1']?.status.name).toBe('To Do');
    expect(snapshot.ticketChecks['XX-1']?.verdict).toBe('mismatch');

    fake.tracker.checkAuth = async () => ({ ok: false, reason: 'missing-cli', message: 'Ticket status needs jira-cli: install it and run `jira init`.' });
    const failing = new Poller({ provider: code.provider, config: () => config, now: () => now, tickets: new TicketSync({ tracker: fake.tracker, codeHost: code.provider, now: () => now }) });
    await failing.tick();
    expect(failing.snapshot().prs).toHaveLength(1);
    expect(failing.snapshot().banners).toContainEqual({ kind: 'tickets', message: 'Ticket status needs jira-cli: install it and run `jira init`.' });
  });
});
