import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildPrViews, type PrView } from '../../shared/grouping';
import type { Bucket } from '../../shared/status';
import { mineIsUnknown } from '../../shared/ticketLanes';
import type { DashboardApi } from './api/client';
import { useDashboard } from './api/useDashboard';
import { Banners } from './components/Banners';
import { Drawer } from './components/Drawer';
import { Header } from './components/Header';
import { SettingsPanel } from './components/SettingsPanel';
import { StackDialog } from './components/StackDialog';
import { Toasts } from './components/Toasts';
import { Toolbar } from './components/Toolbar';
import { stacksZoomHint } from './lib/zoomHint';
import { useNotifications } from './notifications/useNotifications';
import { useUrlState } from './state/urlState';
import { MineView } from './views/MineView';
import { OverviewView } from './views/OverviewView';
import { TicketsView } from './views/TicketsView';
import { StacksView } from './views/StacksView';

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function bucketCounts(ids: string[], views: Map<string, PrView>): Record<Bucket, number> {
  const counts: Record<Bucket, number> = { blocked: 0, waiting: 0, ready: 0, draft: 0 };
  for (const id of new Set(ids)) {
    const view = views.get(id);
    if (view) counts[view.bucket] += 1;
  }
  return counts;
}

export function App({ api }: { api: DashboardApi }) {
  const { snapshot, refreshNow, updateSettings } = useDashboard(api);
  const [url, setUrl] = useUrlState();
  const now = useNow(15_000);
  const [stackPrId, setStackPrId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusPermission, setFocusPermission] = useState(false);
  const openSettings = useCallback((focus = false) => { setFocusPermission(focus); setSettingsOpen(true); }, []);
  const closeSettings = useCallback(() => { setFocusPermission(false); setSettingsOpen(false); }, []);
  const [clientError, setClientError] = useState<string | null>(null);
  const reportError = useCallback((error: unknown) => setClientError(error instanceof Error ? error.message : String(error)), []);
  const views = useMemo(() => (snapshot ? buildPrViews(snapshot, now) : new Map<string, PrView>()), [snapshot, now]);
  const select = useCallback((id: string) => setUrl({ selected: id }), [setUrl]);
  const closeStack = useCallback(() => setStackPrId(null), []);
  const closeDrawer = useCallback(() => setUrl({ selected: null }), [setUrl]);
  const togglePin = useCallback((id: string) => {
    if (!snapshot) return;
    // Drop pins of PRs that are no longer open so the list does not grow forever.
    const open = new Set(snapshot.prs.map((pr) => pr.id));
    const current = snapshot.settings.pinned.filter((pinnedId) => open.has(pinnedId));
    const pinned = current.includes(id) ? current.filter((pinnedId) => pinnedId !== id) : [...current, id];
    updateSettings({ pinned }).catch(reportError);
  }, [snapshot, updateSettings, reportError]);

  const notifications = useNotifications(snapshot, {
    onOpenPr: (prId) => setUrl({ selected: prId, tab: url.tab === 'stacks' ? 'mine' : url.tab }),
    onOpenMine: () => setUrl({ tab: 'mine' }),
  });

  if (!snapshot) return <div className="app"><p className="loading">Loading…</p></div>;

  const tab = url.tab === 'tickets' && !snapshot.settings.ticketsEnabled ? 'overview' : url.tab;
  const ids = tab === 'mine' ? [...snapshot.mine.authored, ...snapshot.mine.requested, ...snapshot.mine.team] : snapshot.overviewIds;
  return (
    <div className="app">
      <Header
        snapshot={snapshot}
        tab={tab}
        now={now}
        onTab={(tab) => setUrl({ tab })}
        onRefresh={() => refreshNow().then(() => setClientError(null), reportError)}
        onRefreshSetting={(refresh) => void updateSettings({ refresh }).catch(reportError)}
        onOpenSettings={openSettings}
      />
      <Banners banners={snapshot.banners} />
      {clientError && (
        <div role="alert" className="banner sev-red" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="grow">{clientError}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss error" onClick={() => setClientError(null)}>×</button>
        </div>
      )}
      {tab === 'stacks'
        ? <><div className="toolbar"><span className="muted">Every stack in the selected repositories. {stacksZoomHint(navigator.platform || navigator.userAgent)}</span></div>
            <StacksView snapshot={snapshot} views={views} onSelect={(id) => setUrl({ selected: id, tab: 'overview' })} onVisualize={setStackPrId} /></>
        : (
          <>
            {tab !== 'tickets' && <Toolbar url={url} counts={bucketCounts(ids, views)} onChange={setUrl} />}
            {tab === 'tickets' && (
              <div className="toolbar">
                <button
                  type="button"
                  className={`chip${url.ticketsMine ? '' : ' off'}`}
                  aria-pressed={url.ticketsMine}
                  title={mineIsUnknown(snapshot) ? 'Could not tell for every ticket whether it is yours, so some of yours may be hidden.' : 'Tickets you created, or are or were assignee on'}
                  onClick={() => setUrl({ ticketsMine: !url.ticketsMine })}
                >
                  Mine
                </button>
                <span className="muted">Tickets referenced by open and recently closed pull requests, checked against their PRs.</span>
              </div>
            )}
            <div className="layout">
              <main className="board-wrap">
                {tab === 'overview' && <OverviewView snapshot={snapshot} url={url} now={now} onSelect={select} onVisualize={setStackPrId} onOpenSettings={() => openSettings()} />}
                {tab === 'mine' && <MineView snapshot={snapshot} url={url} now={now} onSelect={select} onVisualize={setStackPrId} />}
                {tab === 'tickets' && <TicketsView snapshot={snapshot} selectedId={url.selected} onSelect={select} mineOnly={url.ticketsMine} />}
              </main>
              <Drawer snapshot={snapshot} views={views} selectedId={url.selected} onSelect={select} onVisualize={setStackPrId} onTogglePin={togglePin} onClose={closeDrawer} />
            </div>
          </>
        )}
      {stackPrId && (
        <StackDialog
          api={api}
          prId={stackPrId}
          views={views}
          onClose={closeStack}
          onSelect={(id) => {
            setStackPrId(null);
            setUrl({ selected: id, tab: url.tab === 'stacks' ? 'overview' : url.tab });
          }}
        />
      )}
      {settingsOpen && (
        <SettingsPanel api={api} repos={snapshot.settings.repos} onSave={(repos) => updateSettings({ repos })} onClose={closeSettings} focusPermission={focusPermission} notifications={{ settings: snapshot.settings.notifications, onSave: (next) => updateSettings({ notifications: next }) }} />
      )}
      <Toasts toasts={notifications.toasts} onOpen={notifications.open} onDismiss={notifications.dismiss} />
    </div>
  );
}
