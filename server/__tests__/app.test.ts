import request from 'supertest';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp, DEFAULT_ALLOWED_HOSTS } from '../app';
import { ConfigStore } from '../config';
import { SnapshotHub } from '../hub';
import { Poller } from '../poller';
import { PollLoop, Presence } from '../presence';
import { ProviderError, type CodeHostProvider } from '../providers/types';
import { createFakeProvider } from '../../test/fake-provider';
import { makePr } from '../../test/factories';
import { ThemeRegistry } from '../themes/registry';

const TEST_HOST = 'dashboard.test';
const api = (app: Parameters<typeof request.agent>[0]) => request.agent(app).set('Host', TEST_HOST);

async function setup(overrides: Partial<CodeHostProvider> = {}, builtinDir = join(process.cwd(), 'themes')) {
  const dir = await mkdtemp(join(tmpdir(), 'prdash-app-'));
  const path = join(dir, 'config.json');
  await writeFile(path, JSON.stringify({ codeHost: { provider: 'fake', org: 'acme', repos: ['orders-api'], localRepos: ['orders-api', 'orders-web'] } }));
  const store = await ConfigStore.open(path);
  const fake = createFakeProvider([makePr(), makePr()], { listRepos: async () => [{ name: 'report-service' }], ...overrides });
  const hub = new SnapshotHub();
  const poller = new Poller({ provider: fake.provider, config: () => store.get(), onChange: (snapshot) => hub.publish(snapshot) });
  const presence = new Presence();
  const loop = new PollLoop({ poller, presence, intervalMs: () => null });
  const allowedHosts = [TEST_HOST];
  const userDir = join(dir, 'themes');
  await mkdir(join(userDir, 'calm', 'fonts'), { recursive: true });
  await writeFile(join(userDir, 'calm', 'theme.json'), JSON.stringify({ name: 'Calm', modes: ['dark'], dark: {}, fontFiles: [{ family: 'Calm Sans', file: 'fonts/calm.woff2' }] }));
  await writeFile(join(userDir, 'calm', 'fonts', 'calm.woff2'), 'font');
  await writeFile(join(userDir, 'calm', 'secret.txt'), 'nope');
  const themes = new ThemeRegistry({ builtinDir, userDir });
  await themes.load();
  const app = createApp({ poller, presence, loop, provider: fake.provider, store, hub, themes, allowedHosts });
  return { app, store, presence, poller, allowedHosts };
}

describe('HTTP API', () => {
  it('refreshes on demand and returns the new snapshot', async () => {
    const { app } = await setup();
    const response = await api(app).post('/api/refresh').expect(200);
    expect(response.body.prs).toHaveLength(2);
    const snapshot = await api(app).get('/api/snapshot').expect(200);
    expect(snapshot.body.viewer.login).toBe('alex');
  });

  it('saves a valid refresh interval and rejects an invalid one', async () => {
    const { app, store } = await setup();
    const saved = await api(app).put('/api/settings').send({ refresh: 10 }).expect(200);
    expect(saved.body.refresh).toBe(10);
    expect(store.get().refreshIntervalSec).toBe(600);
    await api(app).put('/api/settings').send({ refresh: 1 }).expect(400);
  });

  it('saves notification settings and rejects malformed ones', async () => {
    const { app, store } = await setup();
    const saved = await api(app).put('/api/settings').send({ notifications: { enabled: true, events: { reviewRequested: true } } }).expect(200);
    expect(saved.body.notifications.enabled).toBe(true);
    expect(saved.body.notifications.events.reviewRequested).toBe(true);
    expect(store.get().notifications).toEqual({ enabled: true, events: { reviewRequested: true } });
    await api(app).put('/api/settings').send({ notifications: { enabled: 'yes' } }).expect(400);
    await api(app).put('/api/settings').send({ notifications: { enabled: true, events: { pinged: true } } }).expect(400);
  });

  it('saves pinned ids and rejects a malformed list', async () => {
    const { app, store } = await setup();
    const saved = await api(app).put('/api/settings').send({ pinned: ['PR_1', 'PR_2'] }).expect(200);
    expect(saved.body.pinned).toEqual(['PR_1', 'PR_2']);
    expect(store.get().pinned).toEqual(['PR_1', 'PR_2']);
    await api(app).put('/api/settings').send({ pinned: [1] }).expect(400);
    await api(app).put('/api/settings').send({ pinned: 'PR_1' }).expect(400);
  });

  it('rejects more than ten repositories', async () => {
    const { app } = await setup();
    const repos = Array.from({ length: 11 }, (_, index) => `repo-${index}`);
    const response = await api(app).put('/api/settings').send({ repos }).expect(400);
    expect(response.body.error).toMatch(/10/);
  });

  it('lists local clones when the search is empty and searches GitHub otherwise', async () => {
    const { app } = await setup();
    expect((await api(app).get('/api/repos').expect(200)).body).toEqual([
      { name: 'orders-api', cloned: true }, { name: 'orders-web', cloned: true },
    ]);
    expect((await api(app).get('/api/repos?q=report').expect(200)).body).toEqual([{ name: 'report-service', cloned: false }]);
  });

  it('tracks presence for connected clients', async () => {
    const { app, presence } = await setup();
    presence.connect('tab-1');
    await api(app).post('/api/presence').send({ client: 'tab-1', visible: false }).expect(204);
    expect(presence.anyVisible()).toBe(false);
  });

  it('streams the snapshot over SSE', async () => {
    const { app, allowedHosts } = await setup();
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    allowedHosts.push(`127.0.0.1:${port}`);
    const controller = new AbortController();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/events?client=tab-1`, { signal: controller.signal });
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const { value } = await response.body!.getReader().read();
      expect(new TextDecoder().decode(value)).toContain('event: snapshot');
    } finally {
      controller.abort();
      server.close();
    }
  });

  it('returns 404 for the stack of a PR that is not stacked', async () => {
    const { app } = await setup();
    await api(app).post('/api/refresh');
    await api(app).get('/api/stack?pr=missing').expect(404);
  });

  it('allows only the local dashboard hosts by default', () => {
    expect(DEFAULT_ALLOWED_HOSTS).toEqual(['127.0.0.1:4100', 'localhost:4100', '127.0.0.1:5173', 'localhost:5173']);
  });

  it('refuses API requests addressed to a foreign host name', async () => {
    const { app } = await setup();
    await request(app).get('/api/snapshot').set('Host', 'attacker.example').expect(403);
    await api(app).get('/api/snapshot').expect(200);
  });

  it('refuses state-changing API requests from a foreign origin', async () => {
    const { app } = await setup();
    await api(app).post('/api/refresh').set('Origin', 'http://attacker.example').expect(403);
    await api(app).post('/api/refresh').set('Origin', 'http://localhost:5173').expect(200);
    await api(app).get('/api/snapshot').set('Origin', 'http://attacker.example').expect(200);
  });

  it('answers failures with a JSON error instead of an HTML page', async () => {
    const { app } = await setup({ listRepos: async () => { throw new ProviderError('failed', 'gh timed out after 60 s'); } });
    const response = await api(app).get('/api/repos?q=report').expect(500);
    expect(response.type).toBe('application/json');
    expect(response.body).toEqual({ error: 'gh timed out after 60 s' });
  });

  it('answers malformed JSON with a 400 JSON error', async () => {
    const { app } = await setup();
    const response = await api(app).put('/api/settings').set('Content-Type', 'application/json').send('{"refresh":').expect(400);
    expect(response.type).toBe('application/json');
    expect(typeof response.body.error).toBe('string');
  });

  it('answers a request without a body with 400', async () => {
    const { app } = await setup();
    expect((await api(app).put('/api/settings').expect(400)).body.error).toEqual(expect.any(String));
    expect((await api(app).post('/api/presence').expect(400)).body.error).toEqual(expect.any(String));
  });

  it('lists themes', async () => {
    const { app } = await setup();
    const response = await api(app).get('/api/themes').expect(200);
    expect(response.body.map((theme: { id: string }) => theme.id)).toEqual(['default', 'calm', 'terminal']);
  });

  it('serves a listed font as woff2 and refuses anything else', async () => {
    const { app } = await setup();
    const response = await api(app).get('/api/themes/calm/files/fonts/calm.woff2').expect(200);
    expect(response.headers['content-type']).toContain('font/woff2');
    await api(app).get('/api/themes/calm/files/secret.txt').expect(404);
    await api(app).get('/api/themes/calm/files/fonts/other.woff2').expect(404);
    await api(app).get('/api/themes/nope/files/fonts/calm.woff2').expect(404);
    await request(app).get('/api/themes/calm/files/fonts/calm.woff2').set('Host', 'attacker.example').expect(403);
  });

  it('serves a built-in font even when the themes folder sits under a dot folder', async () => {
    const hidden = join(await mkdtemp(join(tmpdir(), 'prdash-hidden-')), '.hidden', 'themes');
    await cp(join(process.cwd(), 'themes'), hidden, { recursive: true });
    const { app } = await setup({}, hidden);
    await api(app).get('/api/themes/terminal/files/fonts/JetBrainsMono-Regular.woff2').expect(200);
  });

  it('saves the chosen theme and rejects a malformed id', async () => {
    const { app, store } = await setup();
    const saved = await api(app).put('/api/settings').send({ theme: 'terminal' }).expect(200);
    expect(saved.body.theme).toBe('terminal');
    expect(store.get().theme).toBe('terminal');
    await api(app).put('/api/settings').send({ theme: 'bad id!' }).expect(400);
    await api(app).put('/api/settings').send({ theme: 7 }).expect(400);
  });
});
