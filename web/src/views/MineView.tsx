import { useMemo } from 'react';
import { buildMineLanes } from '../../../shared/grouping';
import type { Snapshot } from '../../../shared/types';
import { ColumnHeader } from '../components/ColumnHeader';
import { Lane } from '../components/Lane';
import { FirstLoadMessage, isFirstLoad } from '../lib/firstLoad';
import type { UrlState } from '../state/urlState';

interface MineViewProps { snapshot: Snapshot; url: UrlState; now: number; onSelect: (id: string) => void; onVisualize: (prId: string) => void }

export function MineView({ snapshot, url, now, onSelect, onVisualize }: MineViewProps) {
  const lanes = useMemo(() => buildMineLanes(snapshot, { filters: url.filters, now }), [snapshot, url.filters, now]);
  if (isFirstLoad(snapshot)) return <FirstLoadMessage />;
  return (
    <div className="board">
      <ColumnHeader />
      {lanes.map((lane) => <Lane key={lane.key} lane={lane} selectedId={url.selected} onSelect={onSelect} onVisualize={onVisualize} />)}
    </div>
  );
}
