import { prTicketKey, ticketKeyOf } from '../tickets';

describe('ticketKeyOf', () => {
  it('reads the key from the branch name first', () => {
    expect(ticketKeyOf({ headRefName: 'bugfix/XX-320-fix-versioning-test', title: 'Fix test (XX-1)' })).toBe('XX-320');
  });
  it('falls back to the title', () => {
    expect(ticketKeyOf({ headRefName: 'fix-versioning', title: '[XX-310] Show the second day' })).toBe('XX-310');
  });
  it('returns null when neither has a key', () => {
    expect(ticketKeyOf({ headRefName: 'dependabot/npm/vite-6.2.0', title: 'Bump vite from 5.4.2 to 6.2.0' })).toBeNull();
  });
  it('does not treat version-like text as a key', () => {
    expect(ticketKeyOf({ headRefName: 'react-router-7', title: 'Upgrade to UTF-8 handling' })).toBeNull();
  });
  it('finds the key after a version-like token in the title', () => {
    expect(ticketKeyOf({ headRefName: 'no-key', title: 'Upgrade UTF-8 to XX-123' })).toBe('XX-123');
  });
  it('finds the key after a version-like token in the branch', () => {
    expect(ticketKeyOf({ headRefName: 'feature/SHA-256-XX-123-hashing', title: 'Add hashing' })).toBe('XX-123');
  });
});

describe('ticketKeyOf with version numbers', () => {
  it('ignores a key-like part of a dotted version such as QA-2.118.3', () => {
    expect(ticketKeyOf({ headRefName: 'service-QA-2.118.3', title: 'Align 2.118.3 with production' })).toBeNull();
    expect(ticketKeyOf({ headRefName: 'service-QA-2.118.3', title: '[XX-5] Align versions' })).toBe('XX-5');
  });

  it('still reads a key followed by a sentence full stop', () => {
    expect(ticketKeyOf({ headRefName: 'main', title: 'Fix the lock for XX-12.' })).toBe('XX-12');
  });
});

describe('prTicketKey', () => {
  it('ignores keys on PRs opened by bots, whose title prefixes only look like ticket keys', () => {
    expect(prTicketKey({ headRefName: 'dependabot/nuget/sdk-8.0', title: '[SDK-10] Bump dotnet/sdk', author: { kind: 'bot' } })).toBeNull();
    expect(prTicketKey({ headRefName: 'XX-7-work', title: 'Work', author: { kind: 'human' } })).toBe('XX-7');
  });
});

