import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NotificationKind, RefreshSetting, Snapshot } from '../../../shared/types';
import type { DashboardApi } from './client';

export function useDashboard(api: DashboardApi) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const clientId = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    let active = true;
    api.getSnapshot().then((initial) => active && setSnapshot(initial)).catch(() => undefined);
    // The server polls only while some tab is visible, to save API budget.
    const onVisibility = () => void api.setVisible(clientId, document.visibilityState === 'visible');
    const unsubscribe = api.subscribe(clientId, setSnapshot, onVisibility);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [api, clientId]);

  const refreshNow = useCallback(async () => setSnapshot(await api.refreshNow()), [api]);
  const updateSettings = useCallback(async (patch: { refresh?: RefreshSetting; repos?: string[]; pinned?: string[]; notifications?: { enabled: boolean; events?: Partial<Record<NotificationKind, boolean>> } }) => {
    const settings = await api.updateSettings(patch);
    setSnapshot((current) => (current ? { ...current, settings } : current));
  }, [api]);

  return { snapshot, refreshNow, updateSettings };
}
