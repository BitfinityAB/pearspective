import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { createApp } from './app';
import { ConfigError, ConfigStore } from './config';
import { createGhClient } from './gh';
import { SnapshotHub } from './hub';
import { Poller } from './poller';
import { PollLoop, Presence } from './presence';
import { createCodeHost } from './providers/registry';

const PORT = 4100;
const HOST = '127.0.0.1';

async function main() {
  const store = await ConfigStore.open(resolve(process.cwd(), 'config.json'));
  const provider = createCodeHost(store.get(), createGhClient());
  const hub = new SnapshotHub();
  const poller = new Poller({
    provider,
    config: () => store.get(),
    onChange: (snapshot) => {
      hub.publish(snapshot);
      // One line per refresh makes it easy to confirm polling stops when no tab is visible.
      console.log(`[${new Date().toLocaleTimeString()}] ${snapshot.prs.length} PRs, ${snapshot.rateLimit?.remaining ?? '?'} API points left${snapshot.stale ? ', stale' : ''}`);
    },
  });
  const presence = new Presence();
  const loop = new PollLoop({
    poller,
    presence,
    intervalMs: () => (store.get().refreshIntervalSec === 0 ? null : store.get().refreshIntervalSec * 1000),
  });
  const app = createApp({ poller, presence, loop, provider, store, hub });

  const dist = resolve(process.cwd(), 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }

  app.listen(PORT, HOST, () => console.log(`pearspective API on http://${HOST}:${PORT}`));
  loop.start();
}

main().catch((error) => {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
});
