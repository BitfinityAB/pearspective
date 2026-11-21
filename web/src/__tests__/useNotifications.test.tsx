// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { LAST_NOTIFICATION_KEY, useNotifications } from '../notifications/useNotifications';
import { emptySnapshot, type NotificationBatch, type Snapshot } from '../../../shared/types';

const item = (n: number) => ({ prId: `PR_${n}`, repo: 'orders-api', number: n, title: `Change ${n}`, url: `https://example.test/pr/${n}`, events: [{ kind: 'ciFailed' as const }] });
const batch = (id: string, count = 1): NotificationBatch => ({ id, at: id, items: Array.from({ length: count }, (_, index) => item(index + 1)) });
const withBatch = (notification: NotificationBatch | null): Snapshot => ({ ...emptySnapshot('acme'), notification });

let visibility: DocumentVisibilityState = 'visible';
const shown: { title: string; options: NotificationOptions }[] = [];

beforeEach(() => {
  localStorage.clear();
  shown.length = 0;
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  vi.stubGlobal('Notification', Object.assign(function (this: object, title: string, options: NotificationOptions) { shown.push({ title, options }); return { close: () => undefined, onclick: null }; }, { permission: 'granted' }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function render(initial: Snapshot | null) {
  const handlers = { onOpenPr: vi.fn(), onOpenMine: vi.fn() };
  const hook = renderHook(({ snapshot }) => useNotifications(snapshot, handlers), { initialProps: { snapshot: initial } });
  return { ...hook, handlers };
}

describe('useNotifications', () => {
  it('does not replay the batch present when the page loads', () => {
    const { result, rerender } = render(null);
    rerender({ snapshot: withBatch(batch('2026-11-21T12:00:00Z')) });
    expect(result.current.toasts).toEqual([]);
    expect(localStorage.getItem(LAST_NOTIFICATION_KEY)).toBe('2026-11-21T12:00:00Z');
  });

  it('shows a newer batch as toasts while visible, once', () => {
    const { result, rerender } = render(withBatch(null));
    rerender({ snapshot: withBatch(batch('2026-11-21T12:05:00Z')) });
    expect(result.current.toasts).toEqual([{ key: '2026-11-21T12:05:00Z:PR_1', prId: 'PR_1', title: 'orders-api #1', body: 'CI failed' }]);
    rerender({ snapshot: { ...withBatch(batch('2026-11-21T12:05:00Z')), fetchedAt: 'later' } });
    expect(result.current.toasts).toHaveLength(1);
  });

  it('skips a batch another tab already showed', () => {
    localStorage.setItem(LAST_NOTIFICATION_KEY, '2026-11-21T12:05:00Z');
    const { result, rerender } = render(withBatch(null));
    rerender({ snapshot: withBatch(batch('2026-11-21T12:05:00Z')) });
    expect(result.current.toasts).toEqual([]);
  });

  it('summarises more than three PRs in one toast that opens Mine', () => {
    const { result, rerender, handlers } = render(withBatch(null));
    rerender({ snapshot: withBatch(batch('2026-11-21T12:05:00Z', 4)) });
    expect(result.current.toasts).toEqual([expect.objectContaining({ prId: null, title: '4 of your PRs changed' })]);
    act(() => result.current.open(result.current.toasts[0]!));
    expect(handlers.onOpenMine).toHaveBeenCalled();
    expect(result.current.toasts).toEqual([]);
  });

  it('sends browser notifications while hidden, tagged by PR', () => {
    vi.useFakeTimers();
    visibility = 'hidden';
    const { result, rerender } = render(withBatch(null));
    rerender({ snapshot: withBatch(batch('2026-11-21T12:05:00Z')) });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.toasts).toEqual([]);
    expect(shown).toEqual([{ title: 'orders-api #1', options: { body: 'CI failed', tag: 'PR_1', renotify: true } }]);
    expect(localStorage.getItem(LAST_NOTIFICATION_KEY)).toBe('2026-11-21T12:05:00Z');
  });

  it('leaves the batch unclaimed in a hidden tab that cannot notify, so a visible tab still shows it', () => {
    visibility = 'hidden';
    vi.stubGlobal('Notification', Object.assign(function () { throw new Error('unused'); }, { permission: 'default' }));
    const { rerender } = render(withBatch(null));
    rerender({ snapshot: withBatch(batch('2026-11-21T12:05:00Z')) });
    expect(localStorage.getItem(LAST_NOTIFICATION_KEY)).toBeNull();
    cleanup();
    visibility = 'visible';
    const visible = render(withBatch(null));
    visible.rerender({ snapshot: withBatch(batch('2026-11-21T12:05:00Z')) });
    expect(visible.result.current.toasts).toHaveLength(1);
  });

  it('shows nothing from a hidden tab when another tab claimed the batch during the delay', () => {
    vi.useFakeTimers();
    visibility = 'hidden';
    const { result, rerender } = render(withBatch(null));
    rerender({ snapshot: withBatch(batch('2026-11-21T12:05:00Z')) });
    localStorage.setItem(LAST_NOTIFICATION_KEY, '2026-11-21T12:05:00Z');
    act(() => { vi.advanceTimersByTime(2000); });
    expect(shown).toEqual([]);
    expect(result.current.toasts).toEqual([]);
  });

  it('shows toasts instead when the tab became visible during the delay', () => {
    vi.useFakeTimers();
    visibility = 'hidden';
    const { result, rerender } = render(withBatch(null));
    rerender({ snapshot: withBatch(batch('2026-11-21T12:05:00Z')) });
    visibility = 'visible';
    act(() => { vi.advanceTimersByTime(2000); });
    expect(shown).toEqual([]);
    expect(result.current.toasts).toHaveLength(1);
  });

  it('does not throw when the browser refuses to construct a notification', () => {
    vi.useFakeTimers();
    visibility = 'hidden';
    vi.stubGlobal('Notification', Object.assign(function () { throw new TypeError('Illegal constructor'); }, { permission: 'granted' }));
    const { rerender } = render(withBatch(null));
    rerender({ snapshot: withBatch(batch('2026-11-21T12:05:00Z')) });
    expect(() => act(() => { vi.advanceTimersByTime(2000); })).not.toThrow();
  });
});
