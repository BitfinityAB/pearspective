import type { GhClient } from '../gh';
import { GithubProvider } from './codehost/github/provider';
import type { CodeHostProvider, ReviewerClasses } from './types';

const CODE_HOSTS: Record<string, (org: string, classes: ReviewerClasses, gh: GhClient) => CodeHostProvider> = {
  github: (org, classes, gh) => new GithubProvider(gh, org, classes),
};

export function createCodeHost(config: { codeHost: { provider: string; org: string }; reviewerClasses: ReviewerClasses }, gh: GhClient): CodeHostProvider {
  const factory = CODE_HOSTS[config.codeHost.provider];
  if (!factory) throw new Error(`Unknown code host provider "${config.codeHost.provider}". Available: ${Object.keys(CODE_HOSTS).join(', ')}.`);
  return factory(config.codeHost.org, config.reviewerClasses, gh);
}
