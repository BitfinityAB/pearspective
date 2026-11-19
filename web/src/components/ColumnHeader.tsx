import { AGE_TICKS } from '../../../shared/age';
import { SIGNAL_LABELS } from '../../../shared/status';
import { agePercent } from '../lib/ageScale';

const SHORT = { ci: 'CI', aiReview: 'Cop', codeAnalysis: 'CS', review: 'Rev', threads: 'Thr', mergeable: 'Mrg' } as const;

export function ColumnHeader() {
  return (
    <div className="cols" aria-hidden="true">
      <span>Pull request</span>
      <span className="sig-heads">
        {(Object.keys(SHORT) as (keyof typeof SHORT)[]).map((key) => <span key={key} title={SIGNAL_LABELS[key]}>{SHORT[key]}</span>)}
      </span>
      <span className="ruler">
        {AGE_TICKS.map((tick) => (
          <span key={tick.label} style={{ left: `${Math.min(97, Math.max(2, agePercent(tick.hours)))}%` }}>{tick.label}</span>
        ))}
      </span>
    </div>
  );
}
