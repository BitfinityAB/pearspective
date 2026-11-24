import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { Snapshot, ThemeInfo } from '../../../shared/types';
import type { DashboardApi } from '../api/client';
import { applyThemeCss } from './apply';
import { themeCss } from './css';

const fontPath = (file: string) => file.split('/').map(encodeURIComponent).join('/');

export function useThemes(api: Pick<DashboardApi, 'getThemes'>, snapshot: Snapshot | null) {
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const version = snapshot?.themes.version ?? 0;
  const chosen = snapshot?.settings.theme ?? 'default';

  useEffect(() => {
    let current = true;
    // Refetched whenever the server reports a changed themes folder, so edits show without a reload.
    api.getThemes().then((list) => current && setThemes(list)).catch(() => undefined);
    return () => { current = false; };
  }, [api, version]);

  const result = useMemo(() => {
    const byId = new Map(themes.map((theme) => [theme.id, theme]));
    const wanted = byId.get(chosen);
    const fallback = byId.get('default') ?? null;
    const active = wanted?.valid ? wanted : fallback;
    const problem = themes.length === 0 || wanted?.valid
      ? null
      : `Theme '${chosen}' is unavailable: ${wanted ? wanted.error : 'it was not found'}. Using Default.`;
    const modes = active?.theme?.modes ?? [];
    const forcedMode = modes.length === 1 ? modes[0]! : null;
    const theme = active?.theme;
    const css = theme ? themeCss(theme, (file) => `/api/themes/${encodeURIComponent(theme.id)}/files/${fontPath(file)}`) : null;
    return { themes, active, problem, forcedMode, css };
  }, [themes, chosen]);

  // A layout effect, so the CSS is in place before children's effects read CSS variables in the same commit.
  useLayoutEffect(() => {
    if (result.css) applyThemeCss(result.css);
  }, [result.css]);

  const { css, ...rest } = result;
  return { ...rest, themeKey: css ?? '' };
}
