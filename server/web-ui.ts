import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { type Express } from 'express';

const NOT_BUILT_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Pearspective: UI not built</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5">
<h1>The web UI has not been built</h1>
<p>The API is running, but there is no <code>dist/</code> folder to serve the page from. Either:</p>
<ul>
<li>run <code>npm run build</code>, then reload this page, or</li>
<li>stop this server, run <code>npm run dev</code> and open <a href="http://127.0.0.1:5173">http://127.0.0.1:5173</a>.</li>
</ul>
</body>
</html>
`;

export function serveWebUi(app: Express, distDir: string) {
  const indexFile = resolve(distDir, 'index.html');
  app.use(express.static(distDir));
  // Checked per request so a build made while the server runs is picked up without a restart.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    if (existsSync(indexFile)) res.sendFile(indexFile);
    else res.status(404).type('html').send(NOT_BUILT_PAGE);
  });
}
