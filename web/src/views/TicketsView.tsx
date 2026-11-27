import { useEffect, useMemo, useRef, useState } from 'react';
import { buildTicketLanes, type TicketLaneModel, type TicketRowModel } from '../../../shared/ticketLanes';
import type { Snapshot } from '../../../shared/types';
import { PrStateBadge } from '../components/PrStateBadge';
import { FirstLoadMessage, isFirstLoad } from '../lib/firstLoad';

/** focusKey is a ticket opened from elsewhere (e.g. the PR panel): its row is highlighted and scrolled into view. */
interface TicketsViewProps { snapshot: Snapshot; selectedId: string | null; onSelect: (id: string) => void; mineOnly?: boolean; focusKey?: string | null }

function TicketRow({ row, selectedId, onSelect, focused }: { row: TicketRowModel; selectedId: string | null; onSelect: (id: string) => void; focused: boolean }) {
  const { ticket, check } = row;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: 'center' });
  }, [focused]);
  return (
    <div ref={ref} className={`ticket-row${focused ? ' focus' : ''}`} aria-current={focused ? 'true' : undefined}>
      <div className="ticket-main">
        <span className="rn">{row.key}{ticket?.type ? ` · ${ticket.type}` : ''}</span>
        {ticket ? <a className="title" href={ticket.url} target="_blank" rel="noopener noreferrer">{ticket.summary}</a> : <span className="title">{row.key}</span>}
        <span className="badges">
          <span className={`ticket-chip v-${check.verdict}`}>{ticket?.status.name ?? 'Unknown status'}</span>
          {check.verdict !== 'ok' && check.expected && <span className="muted small">expected {check.expected}</span>}
        </span>
        <span className="muted small">{check.reason}</span>
      </div>
      <div className="ticket-prs">
        {row.open.map((pr) => (
          <button key={pr.id} type="button" className={`mini${pr.id === selectedId ? ' cur' : ''}`} onClick={() => onSelect(pr.id)}>
            <i className={pr.isDraft ? 'fill-draft' : 'fill-waiting'} />
            <span className="mini-text"><PrStateBadge state={pr.isDraft ? 'draft' : 'open'} />{' '}<span className="rn">{pr.repo} #{pr.number}</span>{' '}<span className="mini-title">{pr.title}</span></span>
          </button>
        ))}
        {row.closed.map((pr) => (
          <a key={pr.id} className="mini" href={pr.url} target="_blank" rel="noopener noreferrer">
            <i className={pr.merged ? 'fill-ready' : 'fill-draft'} />
            <span className="mini-text"><PrStateBadge state={pr.merged ? 'merged' : 'closed'} />{' '}<span className="rn">{pr.repo} #{pr.number}</span>{' '}<span className="mini-title">{pr.title} ↗</span></span>
          </a>
        ))}
      </div>
    </div>
  );
}

function TicketLane({ lane, selectedId, onSelect, focusKey }: { lane: TicketLaneModel; selectedId: string | null; onSelect: (id: string) => void; focusKey: string | null }) {
  const holdsFocus = lane.rows.some((row) => row.key === focusKey);
  const [collapsed, setCollapsed] = useState(lane.defaultCollapsed && !holdsFocus);
  // A ticket opened from the PR panel must be visible even in a lane that starts folded.
  useEffect(() => {
    if (holdsFocus) setCollapsed(false);
  }, [holdsFocus, focusKey]);
  return (
    <section className="lane" aria-label={lane.title}>
      <div className="lane-head">
        <button type="button" className="icon-btn ghost" aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${lane.title}`} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="lane-title">{lane.title}</span>
        <span className="muted" style={{ fontSize: 13 }}>{lane.rows.length}</span>
      </div>
      {!collapsed && lane.rows.map((row) => <TicketRow key={row.key} row={row} selectedId={selectedId} onSelect={onSelect} focused={row.key === focusKey} />)}
    </section>
  );
}

export function TicketsView({ snapshot, selectedId, onSelect, mineOnly = false, focusKey = null }: TicketsViewProps) {
  const lanes = useMemo(() => buildTicketLanes(snapshot, { mineOnly }), [snapshot, mineOnly]);
  if (isFirstLoad(snapshot)) return <FirstLoadMessage />;
  const visible = lanes.filter((lane) => lane.rows.length > 0 || lane.key === 'mismatch' || lane.key === 'review');
  if (lanes.every((lane) => lane.rows.length === 0)) {
    return <p className="empty-state">{mineOnly ? 'None of these tickets are or were assigned to you, and none have a pull request by you.' : 'No tickets are referenced by open or recently closed pull requests.'}</p>;
  }
  return <div className="board">{visible.map((lane) => <TicketLane key={lane.key} lane={lane} selectedId={selectedId} onSelect={onSelect} focusKey={focusKey} />)}</div>;
}
