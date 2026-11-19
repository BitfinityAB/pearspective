export const AGE_DOMAIN_HOURS: [number, number] = [1, 2160];

export const AGE_TICKS = [
  { hours: 1, label: '1h' }, { hours: 6, label: '6h' }, { hours: 24, label: '1d' }, { hours: 72, label: '3d' },
  { hours: 168, label: '1w' }, { hours: 336, label: '2w' }, { hours: 720, label: '1mo' }, { hours: 2160, label: '3mo' },
];

export function ageHours(createdAt: string, now: number): number {
  return Math.max(1, Math.floor((now - Date.parse(createdAt)) / 3_600_000));
}

export function ageLabel(hours: number): string {
  if (hours < 24) return `${hours}h`;
  if (hours < 336) return `${Math.round(hours / 24)}d`;
  return `${Math.round(hours / 168)}w`;
}
