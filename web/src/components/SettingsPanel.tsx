import { useEffect, useRef, useState } from 'react';
import { MAX_REPOS, type NotificationSettings, type RepoRef } from '../../../shared/types';
import type { DashboardApi } from '../api/client';
import type { ThemeInfo } from '../../../shared/types';
import { AppearanceSettings } from './AppearanceSettings';
import { NotificationSettingsSection } from './NotificationSettings';

interface SettingsPanelProps {
  api: Pick<DashboardApi, 'searchRepos'>;
  repos: string[];
  onSave: (repos: string[]) => Promise<void>;
  onClose: () => void;
  focusPermission?: boolean;
  notifications?: { settings: NotificationSettings; onSave: (next: NotificationSettings) => Promise<void> };
  appearance?: { themes: ThemeInfo[]; chosen: string; onChoose: (id: string) => Promise<void>; folderHint: string };
}

type SettingsTab = 'repositories' | 'notifications' | 'appearance';

export function SettingsPanel({ api, repos, onSave, onClose, notifications, appearance, focusPermission }: SettingsPanelProps) {
  // The permission hint links straight to the notifications tab.
  const tabs: { value: SettingsTab; label: string }[] = [
    { value: 'repositories', label: 'Repositories' },
    ...(notifications ? [{ value: 'notifications' as const, label: 'Notifications' }] : []),
    ...(appearance ? [{ value: 'appearance' as const, label: 'Appearance' }] : []),
  ];
  const hasTabs = tabs.length > 1;
  const [tab, setTab] = useState<SettingsTab>(notifications && focusPermission ? 'notifications' : 'repositories');
  const [selected, setSelected] = useState<string[]>(repos);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RepoRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A text-selection drag that starts inside the panel and ends on the backdrop must not close it.
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    let active = true;
    // Debounced so typing does not fire one GitHub search per keystroke.
    const timer = setTimeout(() => {
      api.searchRepos(query.trim()).then((found) => active && setResults(found)).catch(() => active && setResults([]));
    }, query ? 300 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [api, query]);

  const candidates = [...selected.map((name) => ({ name })), ...results.filter((repo) => !selected.includes(repo.name))];
  const full = selected.length >= MAX_REPOS;
  const toggle = (name: string) => setSelected((current) => (current.includes(name) ? current.filter((repo) => repo !== name) : [...current, name]));

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => { pressedOnBackdrop.current = event.target === event.currentTarget; }}
      onClick={(event) => { if (pressedOnBackdrop.current && event.target === event.currentTarget) onClose(); }}
    >
      <div className="modal" style={{ height: 'min(640px, 90vh)', width: 'min(560px, 94vw)' }} role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3 id="settings-title">Settings</h3>
          <span className="grow" />
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {hasTabs && (
          <div className="settings-tabs">
            <div className="segs" role="tablist" aria-label="Settings sections">
              {tabs.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  id={`settings-tab-${item.value}`}
                  aria-selected={tab === item.value}
                  aria-controls={`settings-panel-${item.value}`}
                  className={`seg${tab === item.value ? ' on' : ''}`}
                  onClick={() => setTab(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {tab === 'repositories' && (
          <div className="settings-panel" {...(hasTabs ? { role: 'tabpanel', id: 'settings-panel-repositories', 'aria-labelledby': 'settings-tab-repositories' } : {})}>
            <div className="settings-intro">
              <span>Repositories in Overview</span>
              <span className="muted small">{selected.length} of {MAX_REPOS} selected</span>
            </div>
            <div style={{ padding: '0 18px' }}>
              <label className="search" style={{ flex: 'none' }}>
                <span className="sr-only">Search repositories</span>
                <input type="search" aria-label="Search repositories" placeholder="Search the organisation" value={query} onChange={(event) => setQuery(event.target.value)} />
              </label>
            </div>
            <div className="settings-list">
              {candidates.map((repo) => {
                const checked = selected.includes(repo.name);
                return (
                  <label key={repo.name}>
                    <input type="checkbox" checked={checked} disabled={!checked && full} onChange={() => toggle(repo.name)} />
                    <span>{repo.name}</span>
                    {'cloned' in repo && repo.cloned === false && <span className="muted small">not cloned</span>}
                  </label>
                );
              })}
            </div>
          </div>
        )}
        {notifications && tab === 'notifications' && (
          <div className="settings-panel" role="tabpanel" id="settings-panel-notifications" aria-labelledby="settings-tab-notifications">
            <p className="settings-note muted small">Notification changes are saved as you make them.</p>
            <NotificationSettingsSection settings={notifications.settings} onSave={notifications.onSave} focusPermission={focusPermission} />
          </div>
        )}
        {appearance && tab === 'appearance' && (
          <div className="settings-panel" role="tabpanel" id="settings-panel-appearance" aria-labelledby="settings-tab-appearance">
            <p className="settings-note muted small">Appearance changes are saved as you make them.</p>
            <AppearanceSettings {...appearance} />
          </div>
        )}
        {error && <p role="alert" className="banner sev-red">{error}</p>}
        <div className="modal-head" style={{ borderTop: '1px solid var(--hair)', borderBottom: 0, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn"
            disabled={saving || selected.length === 0}
            onClick={async () => {
              // Only a new repository selection needs saving (and waits for the refresh it triggers); other tabs save as you go.
              if (selected.join('\n') === repos.join('\n')) {
                onClose();
                return;
              }
              setSaving(true);
              setError(null);
              try {
                await onSave(selected);
                onClose();
              } catch (caught) {
                setError((caught as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
