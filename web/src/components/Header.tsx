import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePermissionHint } from '../notifications/permission';
import { REFRESH_OPTIONS, type RefreshSetting, type Snapshot } from '../../../shared/types';
import { ticketAttentionCount } from '../../../shared/ticketLanes';
import { isFirstLoad } from '../lib/firstLoad';
import { storedTime } from '../lib/storedTime';
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

const MENU_ICON = icon(<path d="M4 6h16M4 12h16M4 18h16" />);

const TABS: { value: Tab; label: string; count?: number }[] = [{ value: 'overview', label: 'Overview' }, { value: 'mine', label: 'Mine' }, { value: 'stacks', label: 'Stacks' }];

interface HeaderProps {
  snapshot: Snapshot;
  tab: Tab;
  now: number;
  onTab: (tab: Tab) => void;
  onRefresh: () => Promise<void>;
  onRefreshSetting: (setting: RefreshSetting) => void;
  onOpenSettings: (focusPermission: boolean) => void;
  /** The Tickets tab's Mine filter, so its count matches what the tab shows. */
  ticketsMine?: boolean;
  forcedMode?: 'light' | 'dark' | null;
  themeName?: string;
}

export function Header({ snapshot, tab, now, onTab, onRefresh, onRefreshSetting, onOpenSettings, ticketsMine = false, forcedMode = null, themeName }: HeaderProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const { settings, viewer, fetchedAt } = snapshot;
  const hint = usePermissionHint(settings.notifications);
  const updated = fetchedAt ? relativeTime(now - Date.parse(fetchedAt)) : 'never';
  const attention = ticketAttentionCount(snapshot, { mineOnly: ticketsMine });
  const tabs = settings.ticketsEnabled ? [...TABS, { value: 'tickets' as const, label: 'Tickets', count: attention }] : TABS;
  // Without sign-in or the CLI no refresh is coming, so do not promise one.
  const noUpdateComing = snapshot.banners.some((banner) => banner.kind === 'auth' || banner.kind === 'missing-cli');
  const status = snapshot.fromStore && fetchedAt
    ? `Showing data from ${storedTime(fetchedAt, now)}${noUpdateComing ? '' : ', updating…'}`
    : isFirstLoad(snapshot) ? 'Loading…' : settings.refresh === 'off' ? `Auto-refresh off · updated ${updated}` : `Updated ${updated}`;
  return (
    <header className="top">
      <div className="brand"><img src="/favicon.svg" alt="" width="24" height="24" /><b className="brand-name">Pearspective</b><span className="muted hdr-org" style={{ fontSize: 13 }}>{settings.org}</span></div>
      <nav className="segs" aria-label="Views">
        {tabs.map((item) => (
          <button key={item.value} type="button" className={`seg${tab === item.value ? ' on' : ''}`} aria-pressed={tab === item.value} onClick={() => onTab(item.value)}>{item.label}{item.count ? <> <span className="tab-count">{item.count}</span></> : null}</button>
        ))}
      </nav>
      <span className="grow" />
      <div className="hdr-right">
        <span className="hdr-status" title={status}>{status}</span>
        <span className="hdr-refresh">
          <label className="hdr-interval">
            <span className="sr-only">Auto-refresh interval</span>
            <select aria-label="Auto-refresh interval" value={String(settings.refresh)} onChange={(event) => onRefreshSetting(event.target.value === 'off' ? 'off' : (Number(event.target.value) as RefreshSetting))}>
              {REFRESH_OPTIONS.map((option) => <option key={option} value={String(option)}>{option === 'off' ? 'Off' : `Every ${option}m`}</option>)}
            </select>
          </label>
          <button type="button" className={`icon-btn${refreshing ? ' spinning' : ''}`} aria-label="Refresh now" aria-busy={refreshing || undefined} disabled={refreshing} onClick={async () => { setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } }}>{REFRESH_ICON}</button>
        </span>
        <span className="hdr-secondary">
          <ThemeToggle forcedMode={forcedMode} themeName={themeName} />
          <button type="button" className={`icon-btn${hint ? ' has-dot' : ''}`} aria-label={hint ? 'Settings (desktop notifications not yet allowed)' : 'Settings'} onClick={() => onOpenSettings(hint)}>{SETTINGS_ICON}</button>
        </span>
        {viewer && <span className="who"><Avatar name={viewer.name ?? viewer.login} url={viewer.avatarUrl} size={24} /><span className="who-name" title={viewer.login}>{viewer.name ?? viewer.login}</span></span>}
        {/* Narrow screens move the secondary controls into this menu so the bar stays on one tidy layout. */}
        <div className="hdr-menu" ref={menuRef}>
          <button ref={menuButtonRef} type="button" className={`icon-btn${hint ? ' has-dot' : ''}`} aria-label={hint ? 'More (desktop notifications not yet allowed)' : 'More'} aria-expanded={menuOpen} aria-controls="header-menu" onClick={() => setMenuOpen(!menuOpen)}>{MENU_ICON}</button>
          {menuOpen && (
            <div id="header-menu" className="menu-panel" role="group" aria-label="More">
              <div className="menu-row"><span className="muted">Organisation</span><b>{settings.org}</b></div>
              <div className="menu-row"><span className="muted">{status}</span></div>
              <div className="menu-row"><span className="muted">Theme</span><ThemeToggle forcedMode={forcedMode} themeName={themeName} /></div>
              <button type="button" className="btn menu-item" onClick={() => { setMenuOpen(false); onOpenSettings(hint); }}>{SETTINGS_ICON} Settings</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
