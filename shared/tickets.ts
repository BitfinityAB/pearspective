export const DEFAULT_TICKET_PATTERN = /\b([A-Z][A-Z0-9]+-\d+)\b/;
// The pattern also matches version strings like UTF-8, so they are rejected here.
const VERSION_LIKE = /^(UTF|ISO|SHA|ES|TLS|HTTP)-\d+$/;

export function ticketKeyOf(pr: { headRefName: string; title: string }, pattern = DEFAULT_TICKET_PATTERN): string | null {
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (const text of [pr.headRefName, pr.title]) {
    for (const match of text.matchAll(globalPattern)) {
      const key = match[1];
      if (key && !VERSION_LIKE.test(key)) return key;
    }
  }
  return null;
}
