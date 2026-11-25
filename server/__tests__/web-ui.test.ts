import request from 'supertest';
import express from 'express';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveWebUi } from '../web-ui';

async function appWithDist(build: boolean) {
  const dir = await mkdtemp(join(tmpdir(), 'prdash-web-'));
  const distDir = join(dir, 'dist');
  if (build) {
    await mkdir(join(distDir, 'assets'), { recursive: true });
    await writeFile(join(distDir, 'index.html'), '<html>app</html>');
    await writeFile(join(distDir, 'assets', 'main.js'), 'console.log(1)');
  }
  const app = express();
  serveWebUi(app, distDir);
  return { app, distDir };
}

describe('serveWebUi', () => {
  it('serves the built page and its assets', async () => {
    const { app } = await appWithDist(true);
    expect((await request(app).get('/').expect(200)).text).toBe('<html>app</html>');
    expect((await request(app).get('/tickets').expect(200)).text).toBe('<html>app</html>');
    await request(app).get('/assets/main.js').expect(200);
  });

  it('explains how to build the UI when it has not been built', async () => {
    const { app } = await appWithDist(false);
    const response = await request(app).get('/').expect(404);
    expect(response.type).toBe('text/html');
    expect(response.text).toContain('npm run build');
    expect(response.text).toContain('npm run dev');
    expect(response.text).toContain('http://127.0.0.1:5173');
  });

  it('serves the UI once it is built, without a restart', async () => {
    const { app, distDir } = await appWithDist(false);
    await request(app).get('/').expect(404);
    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, 'index.html'), '<html>app</html>');
    expect((await request(app).get('/').expect(200)).text).toBe('<html>app</html>');
  });

  it('leaves API paths to the API', async () => {
    const { app } = await appWithDist(false);
    const response = await request(app).get('/api/nothing').expect(404);
    expect(response.text).not.toContain('npm run build');
  });
});
