import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { checkbox, confirm, input, select } from '@inquirer/prompts';
import { ConfigStore, reviewerClassesOf, type Config } from '../server/config';
import { createGhClient } from '../server/gh';
import { GithubProvider, viewerOrganizations } from '../server/providers/codehost/github/provider';
import { readableName, REVIEWER_SLOTS, type ReviewerSlotKey } from '../shared/reviewers';
import { buildConfig, defaultOrg, parseRemote, preselect, rankCandidates, reviewerCandidates, selectedReposSummary, sortCandidates, validateSelection } from './setup-lib';

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

  const provider = new GithubProvider(gh, org, existing ? reviewerClassesOf(existing) : { 'ai-review': [], 'code-analysis': [] });
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
      short: repo.name,
      checked: preselected.has(repo.name),
    })),
    theme: { style: { renderSelectedChoices: (selected: ReadonlyArray<{ short: string }>) => selectedReposSummary(selected.map((choice) => choice.short)) } },
    validate: (choices) => validateSelection(choices.map((choice) => choice.value)),
  });

  const SLOT_LABEL = { aiReview: 'AI reviewer', codeAnalysis: 'Code analysis tool' } as const;
  console.log('Looking for AI reviewers and code analysis tools in recent PRs…');
  const bots = await provider.reviewingBots(repos).catch(() => []);
  const { bySlot, unknown } = reviewerCandidates(bots, existing?.reviewers);
  for (const bot of unknown) {
    const slot = await select<ReviewerSlotKey | 'ignore'>({
      message: `${bot.login} reviewed ${bot.reviews} recent PRs. What is it?`,
      choices: [{ name: 'AI reviewer', value: 'aiReview' }, { name: 'Code analysis tool', value: 'codeAnalysis' }, { name: 'Ignore', value: 'ignore' }],
      default: 'ignore',
    });
    if (slot === 'ignore') continue;
    const name = await input({ message: 'Name to show for it', default: readableName(bot.login) });
    bySlot[slot].push({ slot, slotConfig: { name, logins: [bot.login], show: true }, reviews: bot.reviews, known: false });
  }
  const reviewers: Config['reviewers'] = {};
  for (const slot of REVIEWER_SLOTS) {
    for (const candidate of sortCandidates(bySlot[slot], existing?.reviewers?.[slot])) {
      const { name, logins } = candidate.slotConfig;
      if (await confirm({ message: `${SLOT_LABEL[slot]}: ${name} (${logins.join(', ')})?`, default: true })) {
        reviewers[slot] = candidate.slotConfig;
        break;
      }
    }
  }

  const config = buildConfig({ org, repos, teams: auth.viewer.teams.map((team) => team.slug), localRepos: cloned, reviewers }, existing);
  if (existsSync(CONFIG_PATH)) await (await ConfigStore.open(CONFIG_PATH)).save(config);
  else await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Saved ${CONFIG_PATH} with ${repos.length} repositories and teams: ${config.codeHost.teams.join(', ') || 'none'}. Columns: ${REVIEWER_SLOTS.map((slot) => reviewers[slot]?.name).filter(Boolean).join(', ') || 'none'}.`);
  console.log(`API points left: ${provider.lastRateLimit()?.remaining ?? 'unknown'}. Next: npm run dev`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
