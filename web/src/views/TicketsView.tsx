import { useMemo, useState } from 'react';
import { buildTicketLanes, type TicketLaneModel, type TicketRowModel } from '../../../shared/ticketLanes';
import type { Snapshot } from '../../../shared/types';
import { FirstLoadMessage, isFirstLoad } from '../lib/firstLoad';

interface TicketsViewProps { snapshot: Snapshot; selectedId: string | null; onSelect: (id: string) => void }

function TicketRow({ row, selectedId, onSelect }: { row: TicketRowModel; selectedId: string | null; onSelect: (id: string) => void }) {
  const { ticket, check } = row;
  return (
    <div className="ticket-row">
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
            <span><span className="rn">{pr.repo} #{pr.number}</span> {pr.title} · {pr.isDraft ? 'draft' : 'open'}</span>
          </button>
        ))}
        {row.closed.map((pr) => (
          <a key={pr.id} className="mini" href={pr.url} target="_blank" rel="noopener noreferrer">
            <i className={pr.merged ? 'fill-ready' : 'fill-draft'} />
            <span><span className="rn">{pr.repo} #{pr.number}</span> {pr.title} · {pr.merged ? 'merged' : 'closed'}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function TicketLane({ lane, selectedId, onSelect }: { lane: TicketLaneModel; selectedId: string | null; onSelect: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState(lane.defaultCollapsed);
  return (
    <section className="lane" aria-label={lane.title}>
      <div className="lane-head">
        <button type="button" className="icon-btn ghost" aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${lane.title}`} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="lane-title">{lane.title}</span>
        <span className="muted" style={{ fontSize: 13 }}>{lane.rows.length}</span>
      </div>
      {!collapsed && lane.rows.map((row) => <TicketRow key={row.key} row={row} selectedId={selectedId} onSelect={onSelect} />)}
    </section>
  );
}

export function TicketsView({ snapshot, selectedId, onSelect }: TicketsViewProps) {
  const lanes = useMemo(() => buildTicketLanes(snapshot), [snapshot]);
  if (isFirstLoad(snapshot)) return <FirstLoadMessage />;
  const visible = lanes.filter((lane) => lane.rows.length > 0 || lane.key === 'mismatch' || lane.key === 'review');
  if (lanes.every((lane) => lane.rows.length === 0)) return <p className="empty-state">No tickets are referenced by open or recently closed pull requests.</p>;
  return <div className="board">{visible.map((lane) => <TicketLane key={lane.key} lane={lane} selectedId={selectedId} onSelect={onSelect} />)}</div>;
}
