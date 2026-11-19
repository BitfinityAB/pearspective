import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { checkbox, input } from '@inquirer/prompts';
import { ConfigStore, type Config } from '../server/config';
import { createGhClient } from '../server/gh';
import { GithubProvider, viewerOrganizations } from '../server/providers/codehost/github/provider';
import { buildConfig, defaultOrg, parseRemote, preselect, rankCandidates, validateSelection } from './setup-lib';

const run = promisify(execFile);
// Resolved from this file so setup works from any working directory.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(REPO_ROOT, 'config.json');

async function gitDirs(root: string, depth = 2): Promise<string[]> {
  if (existsSync(join(root, '.git'))) return [root];
  if (depth === 0) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .map((entry) => gitDirs(join(root, entry.name), depth - 1)));
  return nested.flat();
}

async function originOf(dir: string) {
  const { stdout } = await run('git', ['-C', dir, 'remote', 'get-url', 'origin']).catch(() => ({ stdout: '' }));
  return parseRemote(stdout);
}

async function main() {
  const existing: Config | undefined = await ConfigStore.open(CONFIG_PATH).then((store) => store.get()).catch(() => undefined);
  // Pearspective is usually cloned next to the repositories it watches.
  const folder = await input({ message: 'Folder with your git clones', default: dirname(REPO_ROOT) });
  const remotes = (await Promise.all((await gitDirs(resolve(folder))).map(originOf))).filter((remote): remote is NonNullable<typeof remote> => !!remote);
  const gh = createGhClient();
  const viewerOrgs = await viewerOrganizations(gh).catch(() => []);
  const org = await input({ message: 'GitHub organisation', default: defaultOrg({ existing: existing?.codeHost.org, viewerOrgs, remotes }) });
  const cloned = [...new Set(remotes.filter((remote) => remote.owner === org).map((remote) => remote.repo))];
  console.log(`Found ${cloned.length} local clones in ${org}. Asking GitHub for your activity…`);

  const provider = new GithubProvider(gh, org, existing?.reviewerClasses ?? { 'ai-review': [], 'code-analysis': [] });
  const auth = await provider.checkAuth();
  if (!auth.ok) throw new Error(auth.message);
  const activity = await provider.rankReposByActivity(90);
  const candidates = [...new Set([...cloned, ...activity.slice(0, 30).map((repo) => repo.name)])];
  const openCounts = await provider.openCounts(candidates);
  const ranked = rankCandidates(cloned, activity.filter((repo) => candidates.includes(repo.name)), openCounts);
  const preselected = new Set(existing?.codeHost.repos.length ? existing.codeHost.repos : preselect(ranked));

  const repos = await checkbox({
    message: 'Repositories for the Overview (max 10, space to toggle)',
    pageSize: 20,
    choices: ranked.map((repo) => ({
      name: `${repo.name.padEnd(36)} ${String(repo.openCount).padStart(3)} open · activity ${repo.activity}${repo.cloned ? '' : ' · not cloned'}`,
      value: repo.name,
      checked: preselected.has(repo.name),
    })),
    validate: (choices) => validateSelection(choices.map((choice) => choice.value)),
  });

  const config = buildConfig({ org, repos, teams: auth.viewer.teams.map((team) => team.slug), localRepos: cloned }, existing);
  if (existsSync(CONFIG_PATH)) await (await ConfigStore.open(CONFIG_PATH)).save(config);
  else await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Saved ${CONFIG_PATH} with ${repos.length} repositories and teams: ${config.codeHost.teams.join(', ') || 'none'}.`);
  console.log(`API points left: ${provider.lastRateLimit()?.remaining ?? 'unknown'}. Next: npm run dev`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
