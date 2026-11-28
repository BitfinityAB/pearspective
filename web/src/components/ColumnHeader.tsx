import { AGE_TICKS } from '../../../shared/age';
import type { ReviewerViews } from '../../../shared/reviewers';
import { SIGNAL_LABELS, type SignalKey } from '../../../shared/status';
import { agePercent } from '../lib/ageScale';

const FIXED_SHORT: Partial<Record<SignalKey, string>> = { ci: 'CI', review: 'Rev', threads: 'Thr', mergeable: 'Mrg' };
const ORDER: SignalKey[] = ['ci', 'aiReview', 'codeAnalysis', 'review', 'threads', 'mergeable'];

export function ColumnHeader({ reviewers }: { reviewers: ReviewerViews }) {
  const heads = ORDER.flatMap((key): { key: SignalKey; short: string; title: string }[] => {
    if (key === 'aiReview' || key === 'codeAnalysis') {
      const view = reviewers[key];
      return view?.show ? [{ key, short: view.short, title: view.name }] : [];
    }
    return [{ key, short: FIXED_SHORT[key]!, title: SIGNAL_LABELS[key] }];
  });
  return (
    <div className="cols" aria-hidden="true">
      <span>Pull request</span>
      <span className="sig-heads">
        {heads.map((head) => <span key={head.key} title={head.title}>{head.short}</span>)}
      </span>
      <span className="ruler">
        {AGE_TICKS.map((tick) => (
          <span key={tick.label} style={{ left: `${Math.min(97, Math.max(2, agePercent(tick.hours)))}%` }}>{tick.label}</span>
        ))}
      </span>
    </div>
  );
}
