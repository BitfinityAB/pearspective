// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import type { DashboardApi } from '../api/client';
import { useDashboard } from '../api/useDashboard';

describe('useDashboard', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('reports the real visibility when the stream connects in a hidden tab', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const setVisible = vi.fn(async () => undefined);
    const api = {
      getSnapshot: () => new Promise(() => undefined),
      subscribe: (_clientId: string, _onSnapshot: unknown, onOpen?: () => void) => { onOpen?.(); return () => undefined; },
      setVisible,
    } as unknown as DashboardApi;
    renderHook(() => useDashboard(api));
    expect(setVisible).toHaveBeenCalledWith(expect.any(String), false);
  });
});
