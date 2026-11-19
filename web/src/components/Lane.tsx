import { Fragment, useState } from 'react';
import type { LaneModel } from '../../../shared/grouping';
import type { Bucket } from '../../../shared/status';
import { Avatar } from './Avatar';
import { PrRow } from './PrRow';
import { StackMembers } from './StackMembers';
import { StackRow } from './StackRow';

const BUCKETS: Bucket[] = ['blocked', 'waiting', 'ready', 'draft'];

const ICON_PATHS: Record<'bot' | 'repo' | 'ticket' | 'section', string> = {
  bot: 'M12 3v3M7 8h10a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3zM9 13h.01M15 13h.01',
  repo: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11',
  ticket: 'M4 8a2 2 0 0 0 0 4v4h16v-4a2 2 0 0 0 0-4V4H4zM10 4v12',
  section: 'M4 6h16M4 12h16M4 18h10',
};

function LaneIcon({ lane }: { lane: LaneModel }) {
  if (lane.icon === 'avatar' || lane.icon === 'team') return <Avatar name={lane.title} url={lane.avatarUrl} size={30} />;
  return (
    <span className="lane-icon" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICON_PATHS[lane.icon]} /></svg>
    </span>
  );
}

interface LaneProps { lane: LaneModel; selectedId: string | null; onSelect: (id: string) => void; onVisualize: (prId: string) => void }

export function Lane({ lane, selectedId, onSelect, onVisualize }: LaneProps) {
  const [collapsed, setCollapsed] = useState(lane.defaultCollapsed);
  const [openStacks, setOpenStacks] = useState<Set<string>>(new Set());
  const total = BUCKETS.reduce((sum, bucket) => sum + lane.counts[bucket], 0);
  const summary = `${lane.counts.blocked} blocked · ${lane.counts.waiting} waiting · ${lane.counts.ready} ready${lane.counts.draft ? ` · ${lane.counts.draft} draft` : ''}`;
  const toggleStack = (id: string) => setOpenStacks((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <section className="lane" aria-label={lane.title}>
      <div className="lane-head">
        <button type="button" className="icon-btn ghost" aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${lane.title}`} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▸' : '▾'}
        </button>
        <LaneIcon lane={lane} />
        <span className="lane-title">{lane.title}</span>
        <span className="muted" style={{ fontSize: 13 }}>{total} open</span>
        <span className="grow" />
        <span className="muted small">{summary}</span>
        <span className="stackbar" role="img" aria-label={summary}>
          {BUCKETS.map((bucket) => <span key={bucket} className={`fill-${bucket}`} style={{ width: `${total ? (lane.counts[bucket] / total) * 100 : 0}%` }} />)}
        </span>
      </div>
      {!collapsed && lane.units.length === 0 && <div className="empty">No pull requests match the filters.</div>}
      {!collapsed && lane.units.map((unit) => unit.kind === 'pr'
        ? <PrRow key={unit.view.pr.id} view={unit.view} selected={selectedId === unit.view.pr.id} pinned={unit.pinned} onSelect={onSelect} />
        : (
          <Fragment key={unit.stack.id}>
            <StackRow unit={unit} expanded={openStacks.has(unit.stack.id)} onToggle={() => toggleStack(unit.stack.id)} onVisualize={() => onVisualize(unit.lead.pr.id)} />
            {openStacks.has(unit.stack.id) && (
              <StackMembers stack={unit.stack} membersTopDown={unit.membersTopDown} selectedId={selectedId} onSelect={onSelect} />
            )}
          </Fragment>
        ))}
    </section>
  );
}
