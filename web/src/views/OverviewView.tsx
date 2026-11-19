import { useMemo } from 'react';
import { buildOverviewLanes } from '../../../shared/grouping';
import type { Snapshot } from '../../../shared/types';
import { ColumnHeader } from '../components/ColumnHeader';
import { Lane } from '../components/Lane';
import { FirstLoadMessage, isFirstLoad } from '../lib/firstLoad';
import type { UrlState } from '../state/urlState';

interface OverviewViewProps {
  snapshot: Snapshot;
  url: UrlState;
  now: number;
  onSelect: (id: string) => void;
  onVisualize: (prId: string) => void;
  onOpenSettings: () => void;
}

export function OverviewView({ snapshot, url, now, onSelect, onVisualize, onOpenSettings }: OverviewViewProps) {
  const lanes = useMemo(() => buildOverviewLanes(snapshot, { groupBy: url.groupBy, filters: url.filters, now }), [snapshot, url.groupBy, url.filters, now]);
  if (snapshot.settings.repos.length === 0) {
    return <p className="empty-state">No repositories selected. <button type="button" className="btn" onClick={onOpenSettings}>Choose repositories</button></p>;
  }
  if (isFirstLoad(snapshot)) return <FirstLoadMessage />;
  return (
    <div className="board">
      <ColumnHeader />
      {lanes.map((lane) => <Lane key={`${url.groupBy}:${lane.key}`} lane={lane} selectedId={url.selected} onSelect={onSelect} onVisualize={onVisualize} />)}
      <p className="note">Age axis is log scale: 1 hour to 3 months share one ruler. Bar colour is the PR's bucket; hatched means draft.</p>
    </div>
  );
}
