import { buildTicketChecks, globToRegExp, type TicketRules } from '../ticketChecks';
import type { PrState, StatusCategory, Ticket, Verdict } from '../types';
import { makeClosed, makePr } from '../../test/factories';

const now = Date.parse('2026-11-20T12:00:00Z');
const rules: TicketRules = { ignoreBases: ['release/*'], graceMinutes: 30, expectedStatuses: {} };
const ticket = (name: string, category: StatusCategory | null): Ticket => ({ key: 'XX-1', summary: 'Add lock', type: 'Story', status: { name, category }, url: 'https://tracker.example.test/browse/XX-1' });
const old = '2026-11-18T08:00:00Z';
const check = (input: { open?: ReturnType<typeof makePr>[]; closed?: ReturnType<typeof makeClosed>[]; status?: Ticket | null; rules?: TicketRules }) =>
  buildTicketChecks({
    open: input.open ?? [],
    closed: input.closed ?? [],
    tickets: input.status === null ? {} : { 'XX-1': input.status ?? ticket('In Progress', 'inProgress') },
    rules: input.rules ?? rules,
    now,
  })['XX-1']!;

describe('globToRegExp', () => {
  it('matches whole branch names with * and ?', () => {
    expect(globToRegExp('release/*').test('release/next')).toBe(true);
    expect(globToRegExp('release/*').test('main')).toBe(false);
    expect(globToRegExp('hotfix-?').test('hotfix-1')).toBe(true);
    expect(globToRegExp('a.b').test('axb')).toBe(false);
  });
});

describe('buildTicketChecks', () => {
  const openPr = (overrides = {}) => makePr({ headRefName: 'XX-1-add-lock', createdAt: old, ...overrides });
  const merged = (overrides = {}) => makeClosed({ headRefName: 'XX-1-add-lock', closedAt: old, ...overrides });

  type CheckInput = Parameters<typeof check>[0];
  it.each<[string, CheckInput, Verdict, PrState]>([
    ['open PR, ticket in progress', { open: [openPr()] }, 'ok', 'open'],
    ['open PR, ticket still to do', { open: [openPr()], status: ticket('To Do', 'todo') }, 'mismatch', 'open'],
    ['open PR, ticket already done', { open: [openPr()], status: ticket('Done', 'done') }, 'mismatch', 'open'],
    ['draft beats merged', { open: [openPr({ isDraft: true })], closed: [merged()] }, 'ok', 'draft'],
    ['merged, ticket in review (categories allow it)', { closed: [merged()], status: ticket('In Review', 'inProgress') }, 'ok', 'merged'],
    ['merged, ticket still to do', { closed: [merged()], status: ticket('To Do', 'todo') }, 'mismatch', 'merged'],
    ['merged plus abandoned counts as merged', { closed: [merged(), merged({ merged: false })], status: ticket('Done', 'done') }, 'ok', 'merged'],
    ['only abandoned PRs need a human', { closed: [merged({ merged: false })] }, 'review', 'abandoned'],
  ])('%s', (_label, input, verdict, prState) => {
    const result = check(input);
    expect(result.verdict).toBe(verdict);
    expect(result.prState).toBe(prState);
  });

  it('uses configured names instead of categories, case-insensitively', () => {
    const named: TicketRules = { ...rules, expectedStatuses: { merged: ['Ready for Test', 'Done'], open: ['in review'] } };
    const mismatch = check({ closed: [merged()], status: ticket('In Review', 'inProgress'), rules: named });
    expect(mismatch.verdict).toBe('mismatch');
    expect(mismatch.expected).toBe('Ready for Test or Done');
    expect(mismatch.reason).toMatch(/^PR merged \d+d ago; ticket is In Review \(expected Ready for Test or Done\)\.$/);
    expect(check({ open: [openPr()], status: ticket('In Review', 'inProgress'), rules: named }).verdict).toBe('ok');
  });

  it('accepts a configured abandoned status', () => {
    const named: TicketRules = { ...rules, expectedStatuses: { abandoned: ["Won't Do"] } };
    expect(check({ closed: [merged({ merged: false })], status: ticket("Won't Do", 'done'), rules: named }).verdict).toBe('ok');
  });

  it('holds back a fresh change for the grace period', () => {
    const fresh = check({ closed: [merged({ closedAt: '2026-11-20T11:50:00Z' })], status: ticket('To Do', 'todo') });
    expect(fresh.verdict).toBe('grace');
    expect(fresh.since).toBe('2026-11-20T11:50:00Z');
  });

  it('skips a ticket whose PRs all go into ignored bases and names those branches', () => {
    const result = check({ open: [openPr({ baseRefName: 'release/next' })], closed: [merged({ baseRefName: 'release/next' }), merged({ baseRefName: 'release/8.15' })] });
    expect(result.verdict).toBe('skipped');
    expect(result.prState).toBeNull();
    expect(result.reason).toBe('Only PRs into ignored branches (release/8.15, release/next); nothing to check.');
  });

  it('judges a ticket on its counted PRs when some go into ignored bases', () => {
    expect(check({ open: [openPr(), openPr({ baseRefName: 'release/next' })] }).verdict).toBe('ok');
  });

  it('reports unknown without a ticket or before the category is learned', () => {
    expect(check({ open: [openPr()], status: null }).verdict).toBe('unknown');
    expect(check({ open: [openPr()], status: ticket('Doing', null) }).verdict).toBe('unknown');
  });

  it('does not check keys on PRs opened by bots', () => {
    const bot = makePr({ headRefName: 'dependabot/actions/setup-node', title: '[ACTION-6] Bump setup-node', author: { login: 'dependabot', kind: 'bot' } });
    expect(buildTicketChecks({ open: [bot], closed: [], tickets: {}, rules, now })).toEqual({});
  });

  it('only creates checks for keys found in PRs', () => {
    const checks = buildTicketChecks({ open: [makePr({ headRefName: 'no-key' })], closed: [], tickets: {}, rules, now });
    expect(checks).toEqual({});
  });
});
