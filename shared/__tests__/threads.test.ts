import { isTruncatedThreadsPlaceholder, truncatedThreadsPlaceholder } from '../threads';

describe('truncated threads placeholder', () => {
  it('is an unresolved thread that the helper recognises', () => {
    const placeholder = truncatedThreadsPlaceholder('https://example.test/acme/orders-api/pull/1');
    expect(placeholder).toMatchObject({ resolved: false, url: 'https://example.test/acme/orders-api/pull/1' });
    expect(isTruncatedThreadsPlaceholder(placeholder)).toBe(true);
    expect(isTruncatedThreadsPlaceholder({ ...placeholder, author: { login: 'sam', kind: 'human' } })).toBe(false);
  });
});
