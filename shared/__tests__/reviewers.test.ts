import { catalogEntryFor, deriveShort, isIgnoredBot, matchesLogin, readableName, toReviewerView } from '../reviewers';

describe('reviewers', () => {
  it('matches exact logins and trailing-star prefixes', () => {
    expect(matchesLogin('codescene-access', 'codescene-*')).toBe(true);
    expect(matchesLogin('codescene', 'codescene-*')).toBe(false);
    expect(matchesLogin('coderabbitai', 'coderabbitai')).toBe(true);
    expect(matchesLogin('coderabbitai2', 'coderabbitai')).toBe(false);
  });

  it('derives an abbreviation from the capitals, else the first three letters', () => {
    expect(deriveShort('CodeScene')).toBe('CS');
    expect(deriveShort('SonarQube Cloud')).toBe('SQC');
    expect(deriveShort('Copilot')).toBe('Cop');
    expect(deriveShort('lint bot')).toBe('lin');
  });

  it('turns a bot login into a readable name', () => {
    expect(readableName('my-review-bot')).toBe('My Review Bot');
    expect(readableName('acme_checker[bot]')).toBe('Acme Checker');
  });

  it('finds known tools and ignores housekeeping bots', () => {
    expect(catalogEntryFor('copilot-pull-request-reviewer')).toMatchObject({ slot: 'aiReview', name: 'Copilot' });
    expect(catalogEntryFor('codescene-delta-analysis')).toMatchObject({ slot: 'codeAnalysis', name: 'CodeScene', logins: ['codescene-*'] });
    expect(catalogEntryFor('unknown-bot')).toBeNull();
    expect(isIgnoredBot('github-actions')).toBe(true);
    expect(isIgnoredBot('dependabot')).toBe(true);
    expect(isIgnoredBot('copilot-pull-request-reviewer')).toBe(false);
  });

  it('builds the snapshot view with a derived abbreviation unless one is set', () => {
    expect(toReviewerView({ name: 'Copilot', logins: ['x'], show: true })).toEqual({ name: 'Copilot', short: 'Cop', show: true });
    expect(toReviewerView({ name: 'CodeScene', logins: ['x'], short: 'Scn', show: false })).toEqual({ name: 'CodeScene', short: 'Scn', show: false });
    expect(toReviewerView(undefined)).toBeNull();
  });
});
