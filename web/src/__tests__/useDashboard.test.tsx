// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { emptySnapshot, type Snapshot } from '../../../shared/types';

type Settings = Snapshot['settings'];
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

  it('keeps the settings from the latest save when an older response arrives last', async () => {
    const initial = emptySnapshot('acme');
    const replies: { resolve: (settings: Settings) => void; reject: (error: Error) => void }[] = [];
    const api = {
      getSnapshot: async () => initial,
      subscribe: () => () => undefined,
      setVisible: async () => undefined,
      updateSettings: () => new Promise<Settings>((resolve, reject) => replies.push({ resolve, reject })),
    } as unknown as DashboardApi;
    const { result } = renderHook(() => useDashboard(api));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());

    let older!: Promise<void>;
    let newer!: Promise<void>;
    act(() => {
      older = result.current.updateSettings({ theme: 'default' });
      newer = result.current.updateSettings({ theme: 'terminal' });
    });
    await act(async () => {
      replies[1]!.resolve({ ...initial.settings, theme: 'terminal' });
      await newer;
    });
    await act(async () => {
      replies[0]!.resolve({ ...initial.settings, theme: 'default' });
      await older;
    });
    expect(result.current.snapshot!.settings.theme).toBe('terminal');
  });

  it('still rejects an older save that fails after a newer one', async () => {
    const initial = emptySnapshot('acme');
    const replies: { resolve: (settings: Settings) => void; reject: (error: Error) => void }[] = [];
    const api = {
      getSnapshot: async () => initial,
      subscribe: () => () => undefined,
      setVisible: async () => undefined,
      updateSettings: () => new Promise<Settings>((resolve, reject) => replies.push({ resolve, reject })),
    } as unknown as DashboardApi;
    const { result } = renderHook(() => useDashboard(api));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());

    let older!: Promise<void>;
    act(() => {
      older = result.current.updateSettings({ pinned: ['PR_1'] });
      void result.current.updateSettings({ theme: 'terminal' });
    });
    replies[1]!.resolve({ ...initial.settings, theme: 'terminal' });
    replies[0]!.reject(new Error('disk full'));
    await expect(older).rejects.toThrow('disk full');
  });
});
