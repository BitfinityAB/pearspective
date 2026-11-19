import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigStore } from '../server/config';
import { createGhClient } from '../server/gh';
import { GithubProvider } from '../server/providers/codehost/github/provider';

const config = (await ConfigStore.open(join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'config.json'))).get();
const { org, repos } = config.codeHost;
const provider = new GithubProvider(createGhClient(), org, config.reviewerClasses);

const auth = await provider.checkAuth();
console.log('auth', auth.ok, auth.ok ? auth.viewer.teams.map((team) => team.slug) : auth);

const stubs = await provider.pollLean(repos);
console.log(`lean stubs across ${repos.length} repos`, stubs.length, 'native-stacked', stubs.filter((stub) => stub.nativeStack).length);

const full = await provider.fetchFull(stubs);
console.log('full', full.length, 'merge states', [...new Set(full.map((pr) => pr.mergeState))]);
console.log('max check contexts on one PR', Math.max(...full.map((pr) => pr.checks.length)), '(equal to the contexts(first:) limit means it may be truncated)');
const kinds = new Map<string, string>();
for (const pr of full) {
  for (const review of pr.reviews) kinds.set(review.author.login, review.author.kind);
  for (const thread of pr.threads) kinds.set(thread.author.login, thread.author.kind);
  for (const request of pr.reviewRequests) if (request.type === 'person') kinds.set(request.person.login, request.person.kind);
}
console.log('non-human actors', [...kinds].filter(([, kind]) => kind !== 'human'));

for (const kind of ['authored', 'review-requested'] as const) console.log(kind, (await provider.searchMine(kind)).length);
if (auth.ok) for (const team of auth.viewer.teams) console.log('team', team.slug, (await provider.searchMine('team-review-requested', team.slug)).length);

const stacked = stubs.find((stub) => stub.nativeStack);
if (stacked) console.log('native stack entries', JSON.stringify(await provider.nativeStackEntries(stacked.repo, stacked.number)).slice(0, 300));
const slashed = stubs.find((stub) => stub.headRefName.includes('/'));
if (slashed) console.log('compare with a slash in the branch', slashed.headRefName, await provider.compareRefs(slashed.repo, slashed.baseRefName, slashed.headRefName));

console.log('rate', provider.lastRateLimit());
