import type { PrView } from '../../../shared/grouping';
import { AgeBar } from './AgeBar';
import { PinIcon } from './PinIcon';
import { StatusSquares } from './StatusSquares';

interface PrRowProps { view: PrView; selected: boolean; pinned?: boolean; indentPx?: number; onSelect: (id: string) => void }

/** indentPx is set for rows inside an expanded stack; it leaves room for the connector gutter and marks the row as a connector anchor. */
export function PrRow({ view, selected, pinned = false, indentPx, onSelect }: PrRowProps) {
  const { pr } = view;
  const badges = [
    ...(view.stackedOn ? [{ label: `stacked on #${view.stackedOn}`, severity: 'info' }] : []),
    ...view.blockers,
    ...(pr.mergeState === 'unknown' ? [{ label: 'Checking mergeability…', severity: 'grey' }] : []),
  ];
  return (
    <button
      type="button"
      className={`row${selected ? ' sel' : ''}`}
      aria-current={selected || undefined}
      data-node={indentPx !== undefined ? pr.id : undefined}
      onClick={() => onSelect(pr.id)}
    >
      <span className="pr" style={indentPx !== undefined ? { paddingLeft: indentPx } : undefined}>
        <span className="prtext">
          <span className="rn">{pinned && <span className="pin-mark" title="Pinned"><PinIcon size={12} /><span className="sr-only">Pinned</span></span>}{pr.repo} #{pr.number}</span>
          <span className="title">{pr.title}</span>
          <span className="badges">
            {badges.map((badge) => <span key={badge.label} className={`badge sev-${badge.severity}`}>{badge.label}</span>)}
          </span>
        </span>
      </span>
      <StatusSquares signals={view.signals} />
      <AgeBar hours={view.ageHours} bucket={view.bucket} />
    </button>
  );
}
