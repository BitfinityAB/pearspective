import { resolve } from 'node:path';
import { createApp } from './app';
import { ConfigError, ConfigStore, hiddenPollInterval } from './config';
import { createGhClient } from './gh';
import { SnapshotHub } from './hub';
import { Poller } from './poller';
import { PollLoop, Presence } from './presence';
import { createCodeHost, createIssueTracker } from './providers/registry';
import { ThemeRegistry, themeDirs } from './themes/registry';
import { openStorage } from './storage/startup';
import { TicketSync } from './ticket-sync';
import { serveWebUi } from './web-ui';

const PORT = 4100;
const HOST = '127.0.0.1';

async function main() {
  const configPath = resolve(process.cwd(), 'config.json');
  const store = await ConfigStore.open(configPath);
  const provider = createCodeHost(store.get(), createGhClient());
  // Changing issueTracker in config.json takes effect after a server restart.
  const tracker = createIssueTracker(store.get());
  const { store: database, stored, statusCategories } = openStorage(store.get(), configPath);
  // Status categories are global, so they are worth seeding even when this org has no stored state.
  tracker?.seedStatusCategories?.(statusCategories);
  const tickets = tracker ? new TicketSync({ tracker, codeHost: provider, now: Date.now, store: database, stored }) : undefined;
  const themes: ThemeRegistry = new ThemeRegistry({
    ...themeDirs(configPath),
    onChange: () => poller.setThemesVersion(themes.version()),
  });
  await themes.load();
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
  poller.setThemesVersion(themes.version());
  themes.watch();
  const presence = new Presence();
  const loop = new PollLoop({
    poller,
    presence,
    intervalMs: () => (store.get().refreshIntervalSec === 0 ? null : store.get().refreshIntervalSec * 1000),
    hiddenIntervalMs: () => hiddenPollInterval(store.get()),
  });
  const app = createApp({ poller, presence, loop, provider, store, hub, themes });

  serveWebUi(app, resolve(process.cwd(), 'dist'));

  app.listen(PORT, HOST, () => console.log(`pearspective API on http://${HOST}:${PORT}`));
  loop.start();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      themes.close();
      database.close();
      process.exit(0);
    });
  }
}

main().catch((error) => {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
});
