import { createIssueTracker } from '../providers/registry';

describe('createIssueTracker', () => {
  it('returns null without an issue tracker config', () => {
    expect(createIssueTracker({})).toBeNull();
  });

  it('returns null when only ticket links are wanted', () => {
    expect(createIssueTracker({ issueTracker: { provider: 'jira', baseUrl: 'https://tracker.example.test', ticketStatus: false } })).toBeNull();
  });

  it('builds the jira adapter and rejects unknown providers', () => {
    expect(createIssueTracker({ issueTracker: { provider: 'jira', baseUrl: 'https://tracker.example.test' } })?.id).toBe('jira');
    expect(() => createIssueTracker({ issueTracker: { provider: 'nope', baseUrl: 'https://tracker.example.test' } })).toThrow(/Unknown issue tracker/);
  });
});
