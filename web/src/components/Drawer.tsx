import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ageLabel } from '../../../shared/age';
import type { PrView } from '../../../shared/grouping';
import { detectStacks, membersBottomUp, stackIndex } from '../../../shared/stacks';
import { SIGNAL_LABELS } from '../../../shared/status';
import { isTruncatedThreadsPlaceholder } from '../../../shared/threads';
import type { ActorKind, ChangeRequest, Snapshot, Thread } from '../../../shared/types';
import { prTicketKey } from '../../../shared/tickets';
import { isNarrow } from '../lib/layout';
import { Avatar } from './Avatar';
import { PinIcon } from './PinIcon';
import { PrStateBadge } from './PrStateBadge';

interface DrawerProps {
  snapshot: Snapshot;
  views: Map<string, PrView>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onVisualize: (prId: string) => void;
  onTogglePin: (prId: string) => void;
  onClose: () => void;
  /** Opens the Tickets tab at this ticket, listing every PR that references it. */
  onOpenTicket?: (key: string) => void;
}

const REVIEW_LABEL = { approved: 'Approved', changes_requested: 'Changes requested', commented: 'Commented', dismissed: 'Dismissed' } as const;
const REVIEW_SEVERITY = { approved: 'green', changes_requested: 'red', commented: 'grey', dismissed: 'grey' } as const;

interface ReviewerRow { key: string; name: string; avatarUrl?: string; label: string; severity: string }

/** One row per reviewer: their newest review, or "Requested" if they have not reviewed yet. */
function reviewerRows(pr: ChangeRequest): ReviewerRow[] {
  const latest = new Map<string, ChangeRequest['reviews'][number]>();
  for (const review of pr.reviews) {
    if (review.author.kind === 'bot') continue;
    const previous = latest.get(review.author.login);
    if (!previous || previous.submittedAt < review.submittedAt) latest.set(review.author.login, review);
  }
  const rows: ReviewerRow[] = [...latest.values()].map((review) => ({
    key: review.author.login, name: review.author.name ?? review.author.login, avatarUrl: review.author.avatarUrl,
    label: REVIEW_LABEL[review.state], severity: REVIEW_SEVERITY[review.state],
  }));
  for (const request of pr.reviewRequests) {
    if (request.type === 'team') rows.push({ key: `team:${request.slug}`, name: request.slug, avatarUrl: request.avatarUrl, label: 'Requested', severity: 'amber' });
    else if (!latest.has(request.person.login)) rows.push({ key: request.person.login, name: request.person.name ?? request.person.login, avatarUrl: request.person.avatarUrl, label: 'Requested', severity: 'amber' });
  }
  return rows;
}

// People first, matching the Threads signal; automated reviewers have their own signals, so their threads start folded.
const THREAD_GROUPS: { kind: ActorKind; label: string }[] = [
  { kind: 'human', label: 'From people' },
  { kind: 'ai-review', label: `From ${SIGNAL_LABELS.aiReview}` },
  { kind: 'code-analysis', label: `From ${SIGNAL_LABELS.codeAnalysis}` },
  { kind: 'bot', label: 'From bots' },
];

function ThreadLink({ thread }: { thread: Thread }) {
  return (
    <a className="snip" href={thread.url} target="_blank" rel="noopener noreferrer">
      <b>{thread.author.name ?? thread.author.login}:</b> {thread.snippet}
    </a>
  );
}

function UnresolvedThreads({ threads }: { threads: Thread[] }) {
  // The placeholder only says the list is incomplete; it is not a thread anyone started.
  const truncated = threads.find(isTruncatedThreadsPlaceholder);
  const real = threads.filter((thread) => !isTruncatedThreadsPlaceholder(thread));
  return (
    <>
      {THREAD_GROUPS.map(({ kind, label }) => {
        const group = real.filter((thread) => thread.author.kind === kind);
        if (group.length === 0) return null;
        const title = `${label} (${group.length})`;
        const links = group.map((thread) => <ThreadLink key={thread.url} thread={thread} />);
        return kind === 'human'
          ? <div key={kind} className="thread-group"><span className="muted small">{title}</span>{links}</div>
          : <details key={kind} className="thread-group"><summary className="muted small">{title}</summary>{links}</details>;
      })}
      {truncated && <a className="muted small" href={truncated.url} target="_blank" rel="noopener noreferrer">Some threads were not loaded; open the pull request to see them all ↗</a>}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="sec">{title}</span>
      {children}
    </section>
  );
}

export function Drawer({ snapshot, views, selectedId, onSelect, onVisualize, onTogglePin, onClose, onOpenTicket }: DrawerProps) {
  const index = useMemo(() => stackIndex(detectStacks(snapshot.prs)), [snapshot.prs]);
  const view = selectedId ? views.get(selectedId) : undefined;
  const open = !!view;
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // On narrow screens the panel covers the list, so it takes focus and returns it to the row it was opened from.
  useEffect(() => {
    if (!open || !isNarrow()) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // An open stack dialog handles its own Escape.
      if (event.key === 'Escape' && !document.querySelector('.modal-backdrop')) onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.documentElement.classList.add('drawer-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('drawer-open');
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!view) {
    return <aside className="drawer empty" aria-label="Pull request detail"><p className="muted">Select a pull request to see its details.</p></aside>;
  }
  const { pr } = view;
  const pinned = snapshot.settings.pinned.includes(pr.id);
  const failing = pr.checks.filter((check) => check.state === 'failure');
  const unresolved = pr.threads.filter((thread) => !thread.resolved);
  const reviewers = reviewerRows(pr);
  const related = view.ticket ? [...views.values()].filter((other) => other.ticket === view.ticket && other.pr.id !== pr.id) : [];
  const ticketsOn = snapshot.settings.ticketsEnabled && Boolean(view.ticket);
  const ticket = view.ticket ? snapshot.tickets[view.ticket] : undefined;
  const ticketCheck = view.ticket ? snapshot.ticketChecks[view.ticket] : undefined;
  const closedForTicket = ticketsOn ? snapshot.closed.filter((closedPr) => prTicketKey(closedPr) === view.ticket) : [];
  const stackEntry = index.get(pr.id);
  const stackMembers = stackEntry ? membersBottomUp(stackEntry.stack).reverse().map((id) => views.get(id)).filter((member): member is PrView => !!member) : [];
  const ticketHref = view.ticket && snapshot.settings.ticketUrl ? snapshot.settings.ticketUrl.replace('{key}', encodeURIComponent(view.ticket)) : null;
  const mini = (member: PrView) => (
    <button key={member.pr.id} type="button" className={`mini${member.pr.id === pr.id ? ' cur' : ''}`} onClick={() => onSelect(member.pr.id)}>
      <i className={`fill-${member.bucket}`} />
      <span><span className="rn">{member.pr.repo} #{member.pr.number}</span> {member.pr.title}</span>
    </button>
  );

  return (
    <aside className="drawer" aria-label="Pull request detail">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span className="rn grow">{pr.repo} #{pr.number} · {pr.headRefName}</span>
          <button type="button" className={`btn pin-btn${pinned ? ' on' : ''}`} aria-pressed={pinned} onClick={() => onTogglePin(pr.id)}>
            <PinIcon /> {pinned ? 'Unpin' : 'Pin'}
          </button>
          <button ref={closeRef} type="button" className="icon-btn drawer-close" aria-label="Close details" onClick={onClose}>×</button>
        </div>
        <h2>{pr.title}</h2>
        <span className="muted" style={{ fontSize: 13 }}>{pr.author.name ?? pr.author.login} · opened {ageLabel(view.ageHours)} ago</span>
        <span className="badges">{view.blockers.map((blocker) => <span key={blocker.label} className={`badge sev-${blocker.severity}`}>{blocker.label}</span>)}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {view.signals.map((signal) => (
          <div key={signal.key} className="sline">
            <span className={`dot k-${signal.color}`} aria-hidden="true">{signal.glyph}</span>
            <b>{signal.label}</b>
            <span style={{ color: 'var(--text2)' }}>{signal.detail}</span>
          </div>
        ))}
      </div>

      {failing.length > 0 && (
        <Section title="Failing checks">
          {failing.map((check) => (check.url
            ? <a key={check.name} href={check.url} target="_blank" rel="noopener noreferrer">{check.name}</a>
            : <span key={check.name}>{check.name}</span>))}
        </Section>
      )}

      {reviewers.length > 0 && (
        <Section title="Reviewers">
          {reviewers.map((row) => (
            <div key={row.key} className="sline">
              <Avatar name={row.name} url={row.avatarUrl} size={22} />
              <span className="grow">{row.name}</span>
              <span className={`badge sev-${row.severity}`}>{row.label}</span>
            </div>
          ))}
        </Section>
      )}

      {unresolved.length > 0 && (
        <Section title="Unresolved threads">
          <UnresolvedThreads threads={unresolved} />
        </Section>
      )}

      {ticketsOn ? (
        <Section title={`Ticket · ${view.ticket}`}>
          {ticket ? <a href={ticket.url} target="_blank" rel="noopener noreferrer">{ticket.summary} ↗</a> : <span className="muted">Ticket status unavailable</span>}
          {ticket && <span className="muted small">{ticket.type}{ticket.assignee ? ` · ${ticket.assignee.name ?? ticket.assignee.login}` : ''}</span>}
          {ticketCheck && (
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className={`ticket-chip v-${ticketCheck.verdict}`} style={{ marginLeft: 0 }}>{ticket?.status.name ?? 'Unknown status'}</span>
              <span className="small">{ticketCheck.reason}</span>
            </span>
          )}
          {related.map(mini)}
          {closedForTicket.map((closedPr) => (
            <a key={closedPr.id} className="mini" href={closedPr.url} target="_blank" rel="noopener noreferrer">
              <i className={closedPr.merged ? 'fill-ready' : 'fill-draft'} />
              <span className="mini-text"><PrStateBadge state={closedPr.merged ? 'merged' : 'closed'} />{' '}<span className="rn">{closedPr.repo} #{closedPr.number}</span>{' '}<span className="mini-title">{closedPr.title} ↗</span></span>
            </a>
          ))}
          {onOpenTicket && view.ticket && (
            <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => onOpenTicket(view.ticket!)}>Show all pull requests for {view.ticket}</button>
          )}
        </Section>
      ) : related.length > 0 && <Section title={`Related PRs · ${view.ticket}`}>{related.map(mini)}</Section>}

      {stackMembers.length > 0 && stackEntry && (
        <Section title="Stack">
          {stackMembers.map(mini)}
          <span className="muted small" style={{ paddingLeft: 8 }}>
            ↳ {stackEntry.stack.notOpenCount ? `${stackEntry.stack.notOpenCount} merged or closed · ` : ''}{stackEntry.stack.baseRefName}
          </span>
          <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => onVisualize(pr.id)}>Visualize stack</button>
        </Section>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <a href={pr.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>Open on GitHub ↗</a>
        {view.ticket && (ticketHref
          ? <a href={ticketHref} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>{view.ticket} in Jira ↗</a>
          : <span className="rn">{view.ticket}</span>)}
      </div>
    </aside>
  );
}
