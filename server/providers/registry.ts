import type { GhClient } from '../gh';
import { GithubProvider } from './codehost/github/provider';
import { JiraCliTracker } from './issuetracker/jira/jira-cli';
import type { CodeHostProvider, IssueTrackerProvider, ReviewerClasses } from './types';

const CODE_HOSTS: Record<string, (org: string, classes: ReviewerClasses, gh: GhClient) => CodeHostProvider> = {
  github: (org, classes, gh) => new GithubProvider(gh, org, classes),
};

export function createCodeHost(config: { codeHost: { provider: string; org: string }; reviewerClasses: ReviewerClasses }, gh: GhClient): CodeHostProvider {
  const factory = CODE_HOSTS[config.codeHost.provider];
  if (!factory) throw new Error(`Unknown code host provider "${config.codeHost.provider}". Available: ${Object.keys(CODE_HOSTS).join(', ')}.`);
  return factory(config.codeHost.org, config.reviewerClasses, gh);
}

const ISSUE_TRACKERS: Record<string, (baseUrl: string) => IssueTrackerProvider> = {
  jira: (baseUrl) => new JiraCliTracker(baseUrl),
};

export function createIssueTracker(config: { issueTracker?: { provider: string; baseUrl: string } }): IssueTrackerProvider | null {
  if (!config.issueTracker) return null;
  const factory = ISSUE_TRACKERS[config.issueTracker.provider];
  if (!factory) throw new Error(`Unknown issue tracker "${config.issueTracker.provider}". Available: ${Object.keys(ISSUE_TRACKERS).join(', ')}.`);
  return factory(config.issueTracker.baseUrl);
}
