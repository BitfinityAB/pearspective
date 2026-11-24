import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { Snapshot, ThemeInfo } from '../../../shared/types';
import type { DashboardApi } from '../api/client';
import { applyThemeCss, clearThemeCss } from './apply';
import { themeCss } from './css';

const RETRY_MS = 5000;

const fontPath = (file: string) => file.split('/').map(encodeURIComponent).join('/');

export function useThemes(api: Pick<DashboardApi, 'getThemes'>, snapshot: Snapshot | null) {
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  // True once the list arrived, or once fetching it has failed for good: only then is "no theme" a settled answer.
  const [settled, setSettled] = useState(false);
  const version = snapshot?.themes.version ?? 0;
  // Before the first snapshot the choice is unknown; guessing Default would overwrite the cached theme and flash.
  const chosen = snapshot ? snapshot.settings.theme : null;

  useEffect(() => {
    if (!snapshot) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Refetched whenever the server reports a changed themes folder, so edits show without a reload.
    const fetchList = (retry: boolean) => {
      api.getThemes().then((list) => {
        if (!current) return;
        setThemes(list);
        setSettled(true);
      }).catch(() => {
        if (!current) return;
        if (retry) timer = setTimeout(() => fetchList(false), RETRY_MS);
        else setSettled(true);
      });
    };
    fetchList(true);
    return () => { current = false; clearTimeout(timer); };
  }, [api, version, snapshot === null]);

  const result = useMemo(() => {
    if (chosen === null) return { themes, active: null, problem: null, forcedMode: null, css: null };
    const byId = new Map(themes.map((theme) => [theme.id, theme]));
    const wanted = byId.get(chosen);
    const fallback = byId.get('default') ?? null;
    const active = wanted?.valid ? wanted : fallback;
    const problem = themes.length === 0 || wanted?.valid
      ? null
      : `Theme '${chosen}' is unavailable: ${wanted ? wanted.error ?? 'it is invalid' : 'it was not found'}. Using Default.`;
    const modes = active?.theme?.modes ?? [];
    const forcedMode = modes.length === 1 ? modes[0]! : null;
    const theme = active?.theme;
    const css = theme ? themeCss(theme, (file) => `/api/themes/${encodeURIComponent(theme.id)}/files/${fontPath(file)}`) : null;
    return { themes, active, problem, forcedMode, css };
  }, [themes, chosen]);

  // A layout effect, so the CSS is in place before children's effects read CSS variables in the same commit.
  useLayoutEffect(() => {
    if (result.css) applyThemeCss(result.css);
    else if (settled && chosen !== null) clearThemeCss();
  }, [result.css, settled, chosen]);

  const { css, ...rest } = result;
  return { ...rest, themeKey: css ?? '' };
}
