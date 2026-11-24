// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { renderHook, waitFor } from '@testing-library/react';
import { useThemes } from '../themes/useThemes';
import { THEME_CSS_KEY } from '../themes/apply';
import { ThemeFileSchema } from '../../../shared/themeSchema';
import { resolveTheme } from '../../../shared/themeResolve';
import { emptySnapshot, type Snapshot, type ThemeInfo } from '../../../shared/types';

const defaults = ThemeFileSchema.parse(JSON.parse(readFileSync('themes/default.json', 'utf8')));
const defaultInfo: ThemeInfo = { id: 'default', name: 'Default', modes: ['light', 'dark'], source: 'builtin', valid: true, warnings: [], theme: resolveTheme('default', defaults, defaults) };
const calmInfo: ThemeInfo = {
  id: 'calm', name: 'Calm', modes: ['dark'], source: 'user', valid: true, warnings: [],
  theme: resolveTheme('calm', ThemeFileSchema.parse({
    name: 'Calm', modes: ['dark'], dark: { colors: { accent: '#88ccff' } },
    fontFiles: [{ family: 'Calm Sans', file: 'fonts/calm-sans.woff2' }],
  }), defaults),
};
const brokenInfo: ThemeInfo = { id: 'broken', name: 'broken', modes: [], source: 'user', valid: false, error: 'x.json: not valid JSON', warnings: [] };

const snapshotWith = (theme: string, version = 0): Snapshot => {
  const base = emptySnapshot('acme');
  return { ...base, settings: { ...base.settings, theme }, themes: { version } };
};

afterEach(() => {
  document.getElementById('theme')?.remove();
  localStorage.removeItem(THEME_CSS_KEY);
  vi.restoreAllMocks();
});

describe('useThemes', () => {
  it('applies the chosen single-mode theme and forces its mode', async () => {
    const api = { getThemes: async () => [defaultInfo, calmInfo] };
    const { result } = renderHook(() => useThemes(api, snapshotWith('calm')));
    await waitFor(() => expect(result.current.active?.id).toBe('calm'));
    expect(result.current.forcedMode).toBe('dark');
    expect(result.current.problem).toBeNull();
    expect(document.getElementById('theme')!.textContent).toContain('#88ccff');
  });

  it('builds font URLs under the theme files route, keeping path slashes', async () => {
    const api = { getThemes: async () => [defaultInfo, calmInfo] };
    renderHook(() => useThemes(api, snapshotWith('calm')));
    await waitFor(() => expect(document.getElementById('theme')).not.toBeNull());
    expect(document.getElementById('theme')!.textContent).toContain('/api/themes/calm/files/fonts/calm-sans.woff2');
  });

  it('falls back to Default with a problem when the chosen theme is missing', async () => {
    const api = { getThemes: async () => [defaultInfo] };
    const { result } = renderHook(() => useThemes(api, snapshotWith('gone')));
    await waitFor(() => expect(result.current.active?.id).toBe('default'));
    expect(result.current.problem).toBe("Theme 'gone' is unavailable: it was not found. Using Default.");
    expect(result.current.forcedMode).toBeNull();
  });

  it('reports the reason when the chosen theme is invalid', async () => {
    const api = { getThemes: async () => [defaultInfo, brokenInfo] };
    const { result } = renderHook(() => useThemes(api, snapshotWith('broken')));
    await waitFor(() => expect(result.current.active?.id).toBe('default'));
    expect(result.current.problem).toBe("Theme 'broken' is unavailable: x.json: not valid JSON. Using Default.");
  });

  it('refetches only when the themes version changes, and does not re-apply on rerender', async () => {
    const getThemes = vi.fn(async () => [defaultInfo, calmInfo]);
    const api = { getThemes };
    const { result, rerender } = renderHook(({ snapshot }) => useThemes(api, snapshot), { initialProps: { snapshot: snapshotWith('calm', 1) } });
    await waitFor(() => expect(result.current.active?.id).toBe('calm'));
    expect(getThemes).toHaveBeenCalledTimes(1);

    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    rerender({ snapshot: snapshotWith('calm', 1) });
    rerender({ snapshot: snapshotWith('calm', 1) });
    expect(getThemes).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();

    rerender({ snapshot: snapshotWith('calm', 2) });
    await waitFor(() => expect(getThemes).toHaveBeenCalledTimes(2));
  });

  it('does nothing until the first snapshot, then applies the chosen theme once', async () => {
    const getThemes = vi.fn(async () => [defaultInfo, calmInfo]);
    const api = { getThemes };
    document.head.appendChild(Object.assign(document.createElement('style'), { id: 'theme', textContent: 'cached' }));
    localStorage.setItem(THEME_CSS_KEY, 'cached');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { result, rerender } = renderHook(({ snapshot }) => useThemes(api, snapshot), { initialProps: { snapshot: null as Snapshot | null } });
    await Promise.resolve();
    expect(getThemes).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ active: null, problem: null, forcedMode: null });
    expect(document.getElementById('theme')!.textContent).toBe('cached');
    expect(setItem).not.toHaveBeenCalled();

    rerender({ snapshot: snapshotWith('calm') });
    await waitFor(() => expect(result.current.active?.id).toBe('calm'));
    expect(getThemes).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(document.getElementById('theme')!.textContent).toContain('#88ccff');
  });
});
