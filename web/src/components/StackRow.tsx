import type { Unit } from '../../../shared/grouping';
import type { Bucket } from '../../../shared/status';
import { AgeBar } from './AgeBar';
import { PinIcon } from './PinIcon';

type StackUnit = Extract<Unit, { kind: 'stack' }>;
interface StackRowProps { unit: StackUnit; expanded: boolean; onToggle: () => void; onVisualize: () => void }

export function StackRow({ unit, expanded, onToggle, onVisualize }: StackRowProps) {
  const { stack, lead, membersTopDown } = unit;
  const counts: Record<Bucket, number> = { blocked: 0, waiting: 0, ready: 0, draft: 0 };
  membersTopDown.forEach((view) => (counts[view.bucket] += 1));
  const top = membersTopDown[0]!;
  const kind = stack.native ? `GitHub stack #${stack.number}` : 'branch-chained';
  const summary = `${counts.blocked} blocked, ${counts.waiting} waiting, ${counts.ready} ready`;
  return (
    <div className="row stack">
      <span className="pr">
        <button type="button" className="toggle" aria-expanded={expanded} onClick={onToggle}>
          <span aria-hidden="true" style={{ width: 14 }}>{expanded ? '▾' : '▸'}</span>
          <span className="prtext">
            <span className="rn">{unit.pinned && <span className="pin-mark" title="Pinned"><PinIcon size={12} /><span className="sr-only">Pinned</span></span>}{stack.repo} · {kind} · #{lead.pr.number} → #{top.pr.number}</span>
            <span className="title">Stack of {membersTopDown.length} open PRs{stack.notOpenCount ? ` · ${stack.notOpenCount} merged or closed` : ''}</span>
            <span className="badges">
              {counts.blocked > 0 && <span className="badge sev-red">{counts.blocked} blocked</span>}
              {counts.waiting > 0 && <span className="badge sev-amber">{counts.waiting} waiting</span>}
              {counts.ready > 0 && <span className="badge sev-green">{counts.ready} ready</span>}
            </span>
          </span>
        </button>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="pips" role="img" aria-label={summary}>
          {[...membersTopDown].reverse().map((view) => <i key={view.pr.id} className={`fill-${view.bucket}`} />)}
        </span>
        <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={onVisualize}>Visualize stack</button>
      </span>
      <AgeBar hours={lead.ageHours} bucket={lead.bucket} />
    </div>
  );
}
