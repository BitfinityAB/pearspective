export const DEFAULT_TICKET_PATTERN = /\b([A-Z][A-Z0-9]+-\d+)\b/;
// The pattern also matches version strings like UTF-8, so they are rejected here.
const VERSION_LIKE = /^(UTF|ISO|SHA|ES|TLS|HTTP)-\d+$/;

export function ticketKeyOf(pr: { headRefName: string; title: string }, pattern = DEFAULT_TICKET_PATTERN): string | null {
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (const text of [pr.headRefName, pr.title]) {
    for (const match of text.matchAll(globalPattern)) {
      const key = match[1];
      // A key-like part of a dotted version (e.g. QA-2.118.3) is a release number, not a ticket.
      const partOfVersion = /^\.\d/.test(text.slice((match.index ?? 0) + match[0].length));
      if (key && !VERSION_LIKE.test(key) && !partOfVersion) return key;
    }
  }
  return null;
}

/** Bots such as Dependabot prefix titles with labels like "SDK-10" that look like ticket keys but are not, so their PRs have no ticket. */
export function prTicketKey(pr: { headRefName: string; title: string; author?: { kind: string } }): string | null {
  return pr.author?.kind === 'bot' ? null : ticketKeyOf(pr);
}

