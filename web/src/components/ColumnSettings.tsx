import { useState } from 'react';
import { REVIEWER_SLOTS, type ReviewerSlotKey, type ReviewerViews } from '../../../shared/reviewers';

interface ColumnSettingsProps { reviewers: ReviewerViews; onSave: (slot: ReviewerSlotKey, show: boolean) => Promise<void> }

/** Only tools named in config.json get a column, so only they can be shown or hidden. */
export function ColumnSettings({ reviewers, onSave }: ColumnSettingsProps) {
  const [error, setError] = useState<string | null>(null);
  const configured = REVIEWER_SLOTS.flatMap((slot) => (reviewers[slot] ? [{ slot, view: reviewers[slot]! }] : []));
  if (configured.length === 0) return null;
  return (
    <fieldset className="column-settings">
      <legend>Columns</legend>
      {configured.map(({ slot, view }) => (
        <label key={slot}>
          <input
            type="checkbox"
            checked={view.show}
            onChange={(event) => {
              setError(null);
              onSave(slot, event.target.checked).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
            }}
          />
          {` ${view.name} (${view.short})`}
        </label>
      ))}
      {error && <p role="alert" className="banner sev-red">{error}</p>}
    </fieldset>
  );
}
