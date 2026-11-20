import { JiraCliTracker, projectOf } from '../jira-cli';
import list from '../fixtures/list.json';
import view from '../fixtures/view.json';
import { describeIssueTrackerContract } from '../../../issuetracker-contract';
import { errno, fail, fakeRunner, ok } from '../../../../../test/fake-runner';

const BASE = 'https://tracker.example.test/';
const isList = (args: string[]) => args[0] === 'issue' && args[1] === 'list';
const keysIn = (args: string[]): string[] => args[args.indexOf('-q') + 1]!.match(/[A-Z]+-\d+/g) ?? [];
const listReply = (args: string[]) => ok(JSON.stringify(list.filter((raw) => keysIn(args).includes(raw.key))));
const noView = { match: (args: string[]) => args[1] === 'view', reply: () => fail('') };

describe('JiraCliTracker', () => {
  it('reports the login from `jira me`', async () => {
    const { runner } = fakeRunner([{ match: (args) => args[0] === 'me', reply: () => ok('alex\n') }]);
    expect(await new JiraCliTracker(BASE, runner).checkAuth()).toEqual({ ok: true, login: 'alex' });
  });

  it('classifies a missing CLI and a missing token', async () => {
    const missing = fakeRunner([{ match: () => true, reply: () => errno('ENOENT') }]);
    expect(await new JiraCliTracker(BASE, missing.runner).checkAuth()).toMatchObject({ ok: false, reason: 'missing-cli' });
    const noToken = fakeRunner([{ match: () => true, reply: () => fail('The tool needs a Jira API token to function.') }]);
    expect(await new JiraCliTracker(BASE, noToken.runner).checkAuth()).toMatchObject({ ok: false, reason: 'auth' });
  });

  it('reports any other spawn error as a failed check instead of throwing', async () => {
    const denied = fakeRunner([{ match: () => true, reply: () => errno('EACCES') }]);
    expect(await new JiraCliTracker(BASE, denied.runner).checkAuth()).toMatchObject({ ok: false, reason: 'failed' });
  });

  it('treats "No result found" as an empty answer', async () => {
    const { runner } = fakeRunner([{ match: isList, reply: () => fail('No result found for given query in project "XX"') }, noView]);
    expect(await new JiraCliTracker(BASE, runner).getTickets(['XX-1'])).toEqual({ tickets: [], notFound: [] });
    const exitZero = fakeRunner([{ match: isList, reply: () => ok('No result found for given query in project "XX"') }, noView]);
    expect(await new JiraCliTracker(BASE, exitZero.runner).getTickets(['XX-1'])).toEqual({ tickets: [], notFound: [] });
  });

  it('queries one project at a time with --project and no ORDER BY', async () => {
    const { runner, calls } = fakeRunner([{ match: isList, reply: listReply }, noView]);
    const result = await new JiraCliTracker(BASE, runner).getTickets(['XX-1', 'YY-9', 'XX-2']);
    const lists = calls.filter(isList);
    expect(lists.map((args) => args[args.indexOf('--project') + 1])).toEqual(['XX', 'YY']);
    expect(lists.every((args) => !/ORDER BY/i.test(args.join(' ')))).toBe(true);
    expect(result.tickets.map((ticket) => ticket.key)).toEqual(['XX-1', 'XX-2']);
    expect(result.tickets[0]).toEqual({
      key: 'XX-1', summary: 'Add a scheduler lock', type: 'Story', status: { name: 'In Progress', category: null },
      assignee: { login: 'alex', name: 'Alex Rivera', kind: 'human' }, url: 'https://tracker.example.test/browse/XX-1',
    });
  });

  it('splits keys into chunks of 50', async () => {
    const keys = Array.from({ length: 120 }, (_, index) => `XX-${index + 1}`);
    const { runner, calls } = fakeRunner([{ match: isList, reply: () => ok('[]') }, noView]);
    await new JiraCliTracker(BASE, runner).getTickets(keys);
    expect(calls.filter(isList).map((args) => keysIn(args).length)).toEqual([50, 50, 20]);
  });

  it('drops keys named in a not-found error and retries without them', async () => {
    const { runner, calls } = fakeRunner([
      { match: (args) => isList(args) && keysIn(args).includes('XX-404'), reply: () => fail("Error:\n  - An issue with key 'XX-404' does not exist for field 'key'.\n\njira: Received unexpected response '400  '.") },
      { match: isList, reply: listReply },
      noView,
    ]);
    const result = await new JiraCliTracker(BASE, runner).getTickets(['XX-1', 'XX-404']);
    expect(result.notFound).toEqual(['XX-404']);
    expect(result.tickets.map((ticket) => ticket.key)).toEqual(['XX-1']);
    expect(calls.filter(isList)).toHaveLength(2);
  });

  it('halves a chunk when a 400 names no key, leaving the unexplained key unanswered rather than not found', async () => {
    const { runner } = fakeRunner([
      { match: (args) => isList(args) && keysIn(args).includes('XX-7'), reply: () => fail("jira: Received unexpected response '400  '.") },
      { match: isList, reply: listReply },
      noView,
    ]);
    const result = await new JiraCliTracker(BASE, runner).getTickets(['XX-1', 'XX-2', 'XX-7']);
    expect(result.notFound).toEqual([]);
    expect(result.tickets.map((ticket) => ticket.key).sort()).toEqual(['XX-1', 'XX-2']);
  });

  it('throws auth and timeout failures instead of returning partial data', async () => {
    const unauthorized = fakeRunner([{ match: isList, reply: () => fail("jira: Received unexpected response '401  '.") }]);
    await expect(new JiraCliTracker(BASE, unauthorized.runner).getTickets(['XX-1'])).rejects.toMatchObject({ kind: 'auth' });
    const slow = fakeRunner([{ match: isList, reply: () => errno('ETIMEDOUT') }]);
    await expect(new JiraCliTracker(BASE, slow.runner).getTickets(['XX-1'])).rejects.toMatchObject({ kind: 'failed', message: 'jira-cli timed out' });
  });

  it('accepts both a bare array and an { issues } object as list output', async () => {
    const { runner } = fakeRunner([{ match: isList, reply: () => ok(JSON.stringify({ issues: list })) }, noView]);
    expect((await new JiraCliTracker(BASE, runner).getTickets(['XX-1', 'XX-2'])).tickets).toHaveLength(2);
  });

  it('derives the project from a key', () => {
    expect(projectOf('XX-12')).toBe('XX');
    expect(projectOf('AB2-3')).toBe('AB2');
  });
});

describe('JiraCliTracker status categories', () => {
  const viewReply = (args: string[]) => {
    const key = args[2]!;
    const name = list.find((raw) => raw.key === key)!.fields.status.name;
    const category = name === 'In Progress' ? 'indeterminate' : 'done';
    return ok(JSON.stringify({ ...view, key, fields: { status: { name, statusCategory: { key: category } } } }));
  };

  it('learns each status category once with `issue view` and caches it', async () => {
    const { runner, calls } = fakeRunner([{ match: isList, reply: listReply }, { match: (args) => args[1] === 'view', reply: viewReply }]);
    const tracker = new JiraCliTracker(BASE, runner);
    const first = await tracker.getTickets(['XX-1', 'XX-2']);
    expect(first.tickets.map((ticket) => ticket.status.category)).toEqual(['inProgress', 'done']);
    await tracker.getTickets(['XX-1', 'XX-2']);
    expect(calls.filter((args) => args[1] === 'view')).toHaveLength(2);
  });

  it('leaves the category null when `issue view` fails, and tries again next time', async () => {
    const { runner, calls } = fakeRunner([{ match: isList, reply: listReply }, noView]);
    const tracker = new JiraCliTracker(BASE, runner);
    expect((await tracker.getTickets(['XX-1'])).tickets[0]!.status.category).toBeNull();
    await tracker.getTickets(['XX-1']);
    expect(calls.filter((args) => args[1] === 'view')).toHaveLength(2);
  });
});

describeIssueTrackerContract('JiraCliTracker', () => {
  const { runner } = fakeRunner([
    { match: (args) => args[0] === 'me', reply: () => ok('alex') },
    { match: (args) => isList(args) && keysIn(args).includes('XX-404'), reply: () => fail("An issue with key 'XX-404' does not exist for field 'key'.\njira: Received unexpected response '400  '.") },
    { match: isList, reply: listReply },
    { match: (args) => args[1] === 'view', reply: () => ok(JSON.stringify(view)) },
  ]);
  return { tracker: new JiraCliTracker(BASE, runner), knownKeys: ['XX-1', 'XX-2'], unknownKey: 'XX-404' };
});
