import { useMemo } from 'react';
import type { PrView } from '../../../shared/grouping';
import { detectStacks } from '../../../shared/stacks';
import type { Snapshot } from '../../../shared/types';
import { StackDiagram } from '../components/StackDiagram';
import { localStackDetail } from '../lib/stackLayout';

interface StacksViewProps { snapshot: Snapshot; views: Map<string, PrView>; onSelect: (id: string) => void; onVisualize: (prId: string) => void; themeKey?: string }

export function StacksView({ snapshot, views, onSelect, onVisualize, themeKey }: StacksViewProps) {
  const byId = useMemo(() => new Map(snapshot.prs.map((pr) => [pr.id, pr])), [snapshot.prs]);
  const stacks = useMemo(
    () => detectStacks(snapshot.prs).filter((stack) => snapshot.settings.repos.includes(stack.repo)),
    [snapshot.prs, snapshot.settings.repos],
  );
  if (stacks.length === 0) return <p className="empty-state">No stacked pull requests in the selected repositories.</p>;
  return (
    <div className="stacks">
      {stacks.map((stack) => {
        const lead = byId.get(stack.members.find((member) => member.parentId === null)?.id ?? stack.members[0]!.id)!;
        const memberIds = new Set(stack.members.map((member) => member.id));
        const viewsByNumber = new Map([...views.values()].filter((view) => memberIds.has(view.pr.id)).map((view) => [view.pr.number, view]));
        return (
          <section key={stack.id} className="scard" aria-label={`${stack.repo} stack`}>
            <div className="scard-head">
              <b>{stack.repo}</b>
              <span className="muted small">
                {stack.native ? `GitHub stack #${stack.number}` : 'branch-chained'} · {stack.members.length} open
                {stack.notOpenCount ? ` · ${stack.notOpenCount} merged or closed` : ''} · {lead.author.name ?? lead.author.login}
              </span>
              <span className="grow" />
              <button type="button" className="btn" onClick={() => onVisualize(lead.id)}>Open large</button>
            </div>
            <StackDiagram
              detail={localStackDetail(stack, byId)}
              viewsByNumber={viewsByNumber}
              wheelZoom={false}
              themeKey={themeKey}
              label={`Diagram of the ${stack.repo} stack`}
              onSelect={(number) => {
                const target = viewsByNumber.get(number);
                if (target) onSelect(target.pr.id);
              }}
            />
          </section>
        );
      })}
    </div>
  );
}
