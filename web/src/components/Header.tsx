import { useState, type ReactNode } from 'react';
import { REFRESH_OPTIONS, type RefreshSetting, type Snapshot } from '../../../shared/types';
import { isFirstLoad } from '../lib/firstLoad';
import type { Tab } from '../state/urlState';
import { Avatar } from './Avatar';
import { ThemeToggle } from './ThemeToggle';

export function relativeTime(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

const icon = (paths: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
);
const REFRESH_ICON = icon(<><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></>);
const SETTINGS_ICON = icon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>);

const TABS: { value: Tab; label: string }[] = [{ value: 'overview', label: 'Overview' }, { value: 'mine', label: 'Mine' }, { value: 'stacks', label: 'Stacks' }];

interface HeaderProps {
  snapshot: Snapshot;
  tab: Tab;
  now: number;
  onTab: (tab: Tab) => void;
  onRefresh: () => Promise<void>;
  onRefreshSetting: (setting: RefreshSetting) => void;
  onOpenSettings: () => void;
}

export function Header({ snapshot, tab, now, onTab, onRefresh, onRefreshSetting, onOpenSettings }: HeaderProps) {
  const [refreshing, setRefreshing] = useState(false);
  const { settings, viewer, fetchedAt } = snapshot;
  const updated = fetchedAt ? relativeTime(now - Date.parse(fetchedAt)) : 'never';
  return (
    <header className="top">
      <div className="brand"><img src="/favicon.svg" alt="" width="24" height="24" /><b>Pearspective</b><span className="muted" style={{ fontSize: 13 }}>{settings.org}</span></div>
      <nav className="segs" aria-label="Views">
        {TABS.map((item) => (
          <button key={item.value} type="button" className={`seg${tab === item.value ? ' on' : ''}`} aria-pressed={tab === item.value} onClick={() => onTab(item.value)}>{item.label}</button>
        ))}
      </nav>
      <span className="grow" />
      <div className="hdr-right">
        <span>{isFirstLoad(snapshot) ? 'Loading…' : settings.refresh === 'off' ? `Auto-refresh off · updated ${updated}` : `Updated ${updated}`}</span>
        <label>
          <span className="sr-only">Auto-refresh interval</span>
          <select aria-label="Auto-refresh interval" value={String(settings.refresh)} onChange={(event) => onRefreshSetting(event.target.value === 'off' ? 'off' : (Number(event.target.value) as RefreshSetting))}>
            {REFRESH_OPTIONS.map((option) => <option key={option} value={String(option)}>{option === 'off' ? 'Off' : `Every ${option}m`}</option>)}
          </select>
        </label>
        <button type="button" className="icon-btn" aria-label="Refresh now" disabled={refreshing} onClick={async () => { setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } }}>{REFRESH_ICON}</button>
        <ThemeToggle />
        <button type="button" className="icon-btn" aria-label="Settings" onClick={onOpenSettings}>{SETTINGS_ICON}</button>
        {viewer && <span className="who"><Avatar name={viewer.name ?? viewer.login} url={viewer.avatarUrl} size={24} /><span title={viewer.login}>{viewer.name ?? viewer.login}</span></span>}
      </div>
    </header>
  );
}
