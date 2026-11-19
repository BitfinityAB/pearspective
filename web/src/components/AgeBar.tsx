import { ageLabel } from '../../../shared/age';
import type { Bucket } from '../../../shared/status';
import { agePercent } from '../lib/ageScale';

export function AgeBar({ hours, bucket }: { hours: number; bucket: Bucket }) {
  return (
    <span className="age">
      <span className="track"><i className={`fill-${bucket}`} style={{ width: `${agePercent(hours)}%` }} /></span>
      <span className="age-label">{ageLabel(hours)}</span>
    </span>
  );
}
