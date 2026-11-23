import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { createApp } from './app';
import { ConfigError, ConfigStore, hiddenPollInterval } from './config';
import { createGhClient } from './gh';
import { SnapshotHub } from './hub';
import { Poller } from './poller';
import { PollLoop, Presence } from './presence';
import { createCodeHost, createIssueTracker } from './providers/registry';
import { openStorage } from './storage/startup';
import { TicketSync } from './ticket-sync';

const PORT = 4100;
const HOST = '127.0.0.1';

async function main() {
  const configPath = resolve(process.cwd(), 'config.json');
  const store = await ConfigStore.open(configPath);
  const provider = createCodeHost(store.get(), createGhClient());
  // Changing issueTracker in config.json takes effect after a server restart.
  const tracker = createIssueTracker(store.get());
  const { store: database, stored } = openStorage(store.get(), configPath);
  if (stored) tracker?.seedStatusCategories?.(stored.statusCategories);
  const tickets = tracker ? new TicketSync({ tracker, codeHost: provider, now: Date.now, store: database, stored }) : undefined;
  const hub = new SnapshotHub();
  const poller = new Poller({
    provider,
    config: () => store.get(),
    tickets,
    store: database,
    stored,
    onChange: (snapshot) => {
      hub.publish(snapshot);
      // One line per refresh makes it easy to confirm polling slows down or stops when no tab is visible.
      console.log(`[${new Date().toLocaleTimeString()}] ${snapshot.prs.length} PRs, ${snapshot.rateLimit?.remaining ?? '?'} API points left${snapshot.stale ? ', stale' : ''}${snapshot.fromStore ? ', from local database' : ''}`);
    },
  });
  const presence = new Presence();
  const loop = new PollLoop({
    poller,
    presence,
    intervalMs: () => (store.get().refreshIntervalSec === 0 ? null : store.get().refreshIntervalSec * 1000),
    hiddenIntervalMs: () => hiddenPollInterval(store.get()),
  });
  const app = createApp({ poller, presence, loop, provider, store, hub });

  const dist = resolve(process.cwd(), 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }

  app.listen(PORT, HOST, () => console.log(`pearspective API on http://${HOST}:${PORT}`));
  loop.start();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      database.close();
      process.exit(0);
    });
  }
}

main().catch((error) => {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
});
