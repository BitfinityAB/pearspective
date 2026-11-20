import type { TicketBrief } from '../../../shared/grouping';

/** label overrides the default "KEY · Status" text, e.g. to show only the status in a lane header. */
export function TicketChip({ brief, label }: { brief: TicketBrief; label?: string }) {
  const text = label ?? (brief.statusName ? `${brief.key} · ${brief.statusName}` : brief.key);
  return <span className={`ticket-chip v-${brief.verdict}`} title={brief.reason}>{text}</span>;
}
