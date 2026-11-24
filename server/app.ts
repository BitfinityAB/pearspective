import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { MAX_PINNED, MAX_REPOS, REFRESH_OPTIONS, type RefreshSetting } from '../shared/types';
import { NotificationsSchema, refreshToSeconds, type ConfigStore } from './config';
import type { SnapshotHub } from './hub';
import type { Poller } from './poller';
import type { PollLoop, Presence } from './presence';
import type { CodeHostProvider } from './providers/types';
import { buildStackDetail } from './stack-detail';
import type { ThemeRegistry } from './themes/registry';

export interface AppDeps {
  poller: Poller;
  presence: Presence;
  loop: PollLoop;
  provider: CodeHostProvider;
  store: ConfigStore;
  hub: SnapshotHub;
  themes: ThemeRegistry;
  /** Host headers the API answers to; defaults to the API and dev-server addresses. */
  allowedHosts?: string[];
}

const THEME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const DEFAULT_ALLOWED_HOSTS = ['127.0.0.1:4100', 'localhost:4100', '127.0.0.1:5173', 'localhost:5173'];
const ALLOWED_ORIGINS = new Set(DEFAULT_ALLOWED_HOSTS.map((host) => `http://${host}`));

// A page on another site could otherwise reach the API through DNS rebinding or a cross-site form post.
function localOnly(allowedHosts: string[]): RequestHandler {
  return (req, res, next) => {
    if (!allowedHosts.includes(req.headers.host ?? '')) {
      res.status(403).json({ error: 'Unknown host' });
      return;
    }
    const origin = req.headers.origin;
    if (req.method !== 'GET' && origin !== undefined && !ALLOWED_ORIGINS.has(origin)) {
      res.status(403).json({ error: 'Unknown origin' });
      return;
    }
    next();
  };
}

const jsonErrors: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const status = typeof error?.status === 'number' && error.status >= 400 && error.status < 600 ? error.status : 500;
  res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
};

export function createApp({ poller, presence, loop, provider, store, hub, themes, allowedHosts = DEFAULT_ALLOWED_HOSTS }: AppDeps) {
  const app = express();
  app.use('/api', localOnly(allowedHosts));
  app.use(express.json());

  app.get('/api/themes', (_req, res) => res.json(themes.list()));

  // Express 5 wildcard syntax: the rest of the path after files/ is the font path.
  app.get('/api/themes/:id/files/*file', (req, res) => {
    const file = ([] as string[]).concat(req.params.file as string | string[]).join('/');
    const path = themes.fontPath(String(req.params.id), file);
    if (!path) { res.status(404).json({ error: 'Not found' }); return; }
    res.type('font/woff2').sendFile(path);
  });

  app.get('/api/snapshot', (_req, res) => res.json(poller.snapshot()));

  app.get('/api/events', (req, res) => {
    const client = String(req.query.client ?? `anon-${Date.now()}`);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = (snapshot: unknown) => res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
    send(poller.snapshot());
    const unsubscribe = hub.subscribe(send);
    presence.connect(client);
    req.on('close', () => {
      unsubscribe();
      presence.disconnect(client);
    });
  });

  app.post('/api/presence', (req, res) => {
    const { client, visible } = req.body ?? {};
    if (typeof client !== 'string') {
      res.status(400).json({ error: 'client is required' });
      return;
    }
    presence.setVisible(client, Boolean(visible));
    res.status(204).end();
  });

  app.post('/api/refresh', async (_req, res) => {
    await poller.tick();
    loop.reschedule();
    res.json(poller.snapshot());
  });

  app.put('/api/settings', async (req, res) => {
    const { refresh, repos, pinned, notifications, theme } = (req.body ?? {}) as { refresh?: RefreshSetting; repos?: unknown; pinned?: unknown; notifications?: unknown; theme?: unknown };
    if (refresh === undefined && repos === undefined && pinned === undefined && notifications === undefined && theme === undefined) {
      res.status(400).json({ error: 'Send refresh, repos, pinned, notifications or theme' });
      return;
    }
    if (refresh !== undefined && !(REFRESH_OPTIONS as readonly unknown[]).includes(refresh)) {
      res.status(400).json({ error: `refresh must be one of ${REFRESH_OPTIONS.join(', ')}` });
      return;
    }
    if (repos !== undefined && (!Array.isArray(repos) || repos.length > MAX_REPOS || repos.some((repo) => typeof repo !== 'string'))) {
      res.status(400).json({ error: `repos must be a list of at most ${MAX_REPOS} names` });
      return;
    }
    if (pinned !== undefined && (!Array.isArray(pinned) || pinned.length > MAX_PINNED || pinned.some((id) => typeof id !== 'string'))) {
      res.status(400).json({ error: `pinned must be a list of at most ${MAX_PINNED} ids` });
      return;
    }
    if (theme !== undefined && (typeof theme !== 'string' || !THEME_ID.test(theme))) {
      res.status(400).json({ error: 'theme must be a theme id' });
      return;
    }
    const parsedNotifications = notifications === undefined ? undefined : NotificationsSchema.safeParse(notifications);
    if (parsedNotifications && !parsedNotifications.success) {
      res.status(400).json({ error: `notifications are invalid: ${parsedNotifications.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}` });
      return;
    }
    const current = store.get();
    await store.save({
      ...current,
      refreshIntervalSec: refresh !== undefined ? refreshToSeconds(refresh) : current.refreshIntervalSec,
      codeHost: { ...current.codeHost, repos: (repos as string[] | undefined) ?? current.codeHost.repos },
      pinned: (pinned as string[] | undefined) ?? current.pinned,
      notifications: parsedNotifications ? parsedNotifications.data : current.notifications,
      theme: (theme as string | undefined) ?? current.theme,
    });
    poller.refreshSettings();
    if (repos !== undefined) await poller.tick();
    loop.reschedule();
    res.json(poller.snapshot().settings);
  });

  app.get('/api/repos', async (req, res) => {
    const text = String(req.query.q ?? '').trim();
    const local = new Set(store.get().codeHost.localRepos);
    const repos = text ? await provider.listRepos(text) : [...local].map((name) => ({ name }));
    res.json(repos.map((repo) => ({ ...repo, cloned: local.has(repo.name) })));
  });

  app.get('/api/stack', async (req, res) => {
    const detail = await buildStackDetail(provider, poller.snapshot(), String(req.query.pr ?? ''));
    if (!detail) {
      res.status(404).json({ error: 'Not part of a stack' });
      return;
    }
    res.json(detail);
  });

  app.use('/api', jsonErrors);
  return app;
}
