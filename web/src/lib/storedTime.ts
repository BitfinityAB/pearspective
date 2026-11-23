const WEEK_MS = 7 * 86_400_000;

/** When stored data was fetched, as short as it can be without being ambiguous. */
export function storedTime(iso: string, now: number, options: { locale?: string; timeZone?: string } = {}): string {
  const { locale, timeZone } = options;
  const at = new Date(iso);
  const time = at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone });
  // en-CA formats as YYYY-MM-DD, which makes a reliable same-day key in any time zone.
  const dayKey = (date: Date) => date.toLocaleDateString('en-CA', { timeZone });
  if (dayKey(at) === dayKey(new Date(now))) return time;
  if (now - at.getTime() < WEEK_MS) return `${at.toLocaleDateString(locale, { weekday: 'short', timeZone })} ${time}`;
  return `${at.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone })} ${time}`;
}
