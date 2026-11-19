import { ticketKeyOf } from '../tickets';

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
