import { useEffect, useRef, useState } from 'react';
import { MAX_REPOS, type NotificationSettings, type RepoRef } from '../../../shared/types';
import type { DashboardApi } from '../api/client';
import { NotificationSettingsSection } from './NotificationSettings';

interface SettingsPanelProps {
  api: Pick<DashboardApi, 'searchRepos'>;
  repos: string[];
  onSave: (repos: string[]) => Promise<void>;
  onClose: () => void;
  focusPermission?: boolean;
  notifications?: { settings: NotificationSettings; onSave: (next: NotificationSettings) => Promise<void> };
}

export function SettingsPanel({ api, repos, onSave, onClose, notifications, focusPermission }: SettingsPanelProps) {
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
          <h3 id="settings-title">Repositories in Overview</h3>
          <span className="muted small">{selected.length} of {MAX_REPOS} selected</span>
          <span className="grow" />
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '12px 18px 0' }}>
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
        {notifications && <NotificationSettingsSection settings={notifications.settings} onSave={notifications.onSave} focusPermission={focusPermission} />}
        {error && <p role="alert" className="banner sev-red">{error}</p>}
        <div className="modal-head" style={{ borderTop: '1px solid var(--hair)', borderBottom: 0, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn"
            disabled={saving || selected.length === 0}
            onClick={async () => {
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
