import { useMemo, type ReactNode } from 'react';
import { ageLabel } from '../../../shared/age';
import type { PrView } from '../../../shared/grouping';
import { detectStacks, membersBottomUp, stackIndex } from '../../../shared/stacks';
import type { ChangeRequest, Snapshot } from '../../../shared/types';
import { Avatar } from './Avatar';
import { PinIcon } from './PinIcon';

interface DrawerProps {
  snapshot: Snapshot;
  views: Map<string, PrView>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onVisualize: (prId: string) => void;
  onTogglePin: (prId: string) => void;
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="sec">{title}</span>
      {children}
    </section>
  );
}

export function Drawer({ snapshot, views, selectedId, onSelect, onVisualize, onTogglePin }: DrawerProps) {
  const index = useMemo(() => stackIndex(detectStacks(snapshot.prs)), [snapshot.prs]);
  const view = selectedId ? views.get(selectedId) : undefined;
  if (!view) {
    return <aside className="drawer" aria-label="Pull request detail"><p className="muted">Select a pull request to see its details.</p></aside>;
  }
  const { pr } = view;
  const pinned = snapshot.settings.pinned.includes(pr.id);
  const failing = pr.checks.filter((check) => check.state === 'failure');
  const unresolved = pr.threads.filter((thread) => !thread.resolved);
  const reviewers = reviewerRows(pr);
  const related = view.ticket ? [...views.values()].filter((other) => other.ticket === view.ticket && other.pr.id !== pr.id) : [];
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
          {unresolved.map((thread) => (
            <a key={thread.url} className="snip" href={thread.url} target="_blank" rel="noopener noreferrer">
              <b>{thread.author.name ?? thread.author.login}:</b> {thread.snippet}
            </a>
          ))}
        </Section>
      )}

      {related.length > 0 && <Section title={`Related PRs · ${view.ticket}`}>{related.map(mini)}</Section>}

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
