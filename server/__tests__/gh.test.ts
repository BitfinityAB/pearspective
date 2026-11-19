import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createGhClient, createSpawnRunner, GH_TIMEOUT_MS, type ProcessRunner } from '../gh';
import { ProviderError } from '../providers/types';

const respond = (stdout: string, code = 0, stderr = ''): ProcessRunner => async () => ({ code, stdout, stderr });

describe('createGhClient', () => {
  it('sends GraphQL through stdin and returns the data object', async () => {
    const calls: { args: string[]; stdin?: string }[] = [];
    const client = createGhClient(async (args, stdin) => {
      calls.push({ args, stdin });
      return { code: 0, stdout: JSON.stringify({ data: { viewer: { login: 'alex' } } }), stderr: '' };
    });

    const data = await client.graphql<{ viewer: { login: string } }>('query { viewer { login } }', { first: 1 });

    expect(data.viewer.login).toBe('alex');
    expect(calls[0]!.args).toEqual(['api', 'graphql', '--input', '-']);
    expect(JSON.parse(calls[0]!.stdin!)).toEqual({ query: 'query { viewer { login } }', variables: { first: 1 } });
  });

  it('reports a missing gh binary as missing-cli', async () => {
    const client = createGhClient(async () => { throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }); });
    await expect(client.graphql('query {}')).rejects.toMatchObject({ kind: 'missing-cli' });
  });

  it('reports a logged-out gh as auth', async () => {
    const client = createGhClient(respond('', 4, 'To get started with GitHub CLI, please run:  gh auth login'));
    await expect(client.graphql('query {}')).rejects.toMatchObject({ kind: 'auth' });
  });

  it('reports resource limits and gateway timeouts as too-large so callers can shrink the batch', async () => {
    const limits = createGhClient(respond(JSON.stringify({ errors: [{ message: 'Resource limits for this query exceeded.' }] }), 1));
    await expect(limits.graphql('query {}')).rejects.toMatchObject({ kind: 'too-large' });
    const gateway = createGhClient(respond('', 1, 'gh: HTTP 502: Bad Gateway'));
    await expect(gateway.graphql('query {}')).rejects.toMatchObject({ kind: 'too-large' });
  });

  it('reports rate limiting as rate-limit', async () => {
    const client = createGhClient(respond(JSON.stringify({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }), 1));
    await expect(client.graphql('query {}')).rejects.toMatchObject({ kind: 'rate-limit' });
  });

  it('returns partial data when only some aliases were not found or forbidden', async () => {
    const body = { data: { r0: { name: 'kept' }, r1: null }, errors: [{ type: 'NOT_FOUND', message: "Could not resolve to a Repository with the name 'acme/gone'." }] };
    const client = createGhClient(respond(JSON.stringify(body), 1));
    expect(await client.graphql('query {}')).toEqual({ r0: { name: 'kept' }, r1: null });
  });

  it('reports other GraphQL errors as failed and keeps their message', async () => {
    const client = createGhClient(respond(JSON.stringify({ errors: [{ message: "Field 'nope' doesn't exist" }] }), 1));
    const error = await client.graphql('query {}').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: 'failed', message: "Field 'nope' doesn't exist" });
  });

  it('reports an empty successful GraphQL response as failed instead of throwing a TypeError', async () => {
    const client = createGhClient(respond('', 0));
    await expect(client.graphql('query {}')).rejects.toMatchObject({ kind: 'failed' });
  });

  it('reports a successful GraphQL body without data as failed', async () => {
    const client = createGhClient(respond('{}', 0));
    await expect(client.graphql('query {}')).rejects.toMatchObject({ kind: 'failed' });
  });

  it('reports a successful REST response that is not JSON as failed', async () => {
    const client = createGhClient(respond('<html>oops</html>', 0));
    await expect(client.rest('repos/acme/app')).rejects.toMatchObject({ kind: 'failed' });
  });

  it('keeps network timeouts as failed rather than shrinking the batch', async () => {
    const client = createGhClient(respond('', 1, 'Post "https://api.github.com/graphql": dial tcp: i/o timeout'));
    await expect(client.graphql('query {}')).rejects.toMatchObject({ kind: 'failed' });
  });

  it('calls REST paths with gh api and parses the JSON', async () => {
    const calls: string[][] = [];
    const client = createGhClient(async (args) => {
      calls.push(args);
      return { code: 0, stdout: '{"behind_by":3}', stderr: '' };
    });
    expect(await client.rest<{ behind_by: number }>('repos/acme/app/compare/a...b')).toEqual({ behind_by: 3 });
    expect(calls[0]).toEqual(['api', 'repos/acme/app/compare/a...b']);
  });

  it('reports a gh run that timed out as failed with a readable message', async () => {
    const client = createGhClient(async () => { throw Object.assign(new Error('gh timed out'), { code: 'ETIMEDOUT' }); });
    await expect(client.graphql('query {}')).rejects.toMatchObject({ kind: 'failed', message: 'gh timed out after 60 s' });
  });
});

describe('createSpawnRunner', () => {
  afterEach(() => vi.useRealTimers());

  function hangingChild() {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn(),
    });
    return child;
  }

  it('kills a gh process that never exits and rejects with ETIMEDOUT', async () => {
    vi.useFakeTimers();
    const child = hangingChild();
    const runner = createSpawnRunner((() => child) as any);
    const result = runner(['api', 'graphql']).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(GH_TIMEOUT_MS);

    expect(child.kill).toHaveBeenCalled();
    expect(await result).toMatchObject({ code: 'ETIMEDOUT' });
  });

  it('resolves normally when gh exits before the timeout', async () => {
    vi.useFakeTimers();
    const child = hangingChild();
    const runner = createSpawnRunner((() => child) as any);
    const result = runner(['api', 'graphql']);
    child.stdout.write('{"data":{}}');
    await vi.advanceTimersByTimeAsync(10);
    child.emit('close', 0);
    expect(await result).toEqual({ code: 0, stdout: '{"data":{}}', stderr: '' });
    await vi.advanceTimersByTimeAsync(GH_TIMEOUT_MS);
    expect(child.kill).not.toHaveBeenCalled();
  });
});
