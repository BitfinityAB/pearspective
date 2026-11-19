import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PrView } from '../../../shared/grouping';
import type { Stack } from '../../../shared/stacks';
import { branchColumns, connectorPath, GUTTER_STEP, GUTTER_X, textXFor, type Point } from '../lib/stackConnectors';
import { PrRow } from './PrRow';

interface StackMembersProps { stack: Stack; membersTopDown: PrView[]; selectedId: string | null; onSelect: (id: string) => void }
interface Link { key: string; d: string; hot: boolean }

export function StackMembers({ stack, membersTopDown, selectedId, onSelect }: StackMembersProps) {
  const markerId = useId().replace(/:/g, '');
  const boxRef = useRef<HTMLDivElement>(null);
  const columns = useMemo(() => branchColumns(stack), [stack]);
  const textX = textXFor(Math.max(...columns.values()));
  const [links, setLinks] = useState<Link[]>([]);

  // Anchors depend on rendered layout (badges wrap, fonts load), so links are measured after layout and on resize.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const parentOf = new Map(stack.members.map((member) => [member.id, member.parentId ?? 'base']));
    const measure = () => {
      const frame = box.getBoundingClientRect();
      const anchors = new Map<string, Point>();
      box.querySelectorAll<HTMLElement>('[data-node]').forEach((node) => {
        const anchor = (node.querySelector('.title, .base-pill') ?? node).getBoundingClientRect();
        anchors.set(node.dataset.node!, { x: anchor.left - frame.left, y: anchor.top + anchor.height / 2 - frame.top });
      });
      const next: Link[] = [];
      for (const view of membersTopDown) {
        const parent = parentOf.get(view.pr.id) ?? 'base';
        // Arrows follow the merge direction: from a PR down to the branch it merges into.
        const from = anchors.get(view.pr.id);
        const to = anchors.get(parent);
        if (!from || !to) continue;
        next.push({
          key: view.pr.id,
          d: connectorPath(from, to, GUTTER_X + (columns.get(view.pr.id) ?? 0) * GUTTER_STEP),
          hot: selectedId === view.pr.id || selectedId === parent,
        });
      }
      setLinks(next.sort((a, b) => Number(a.hot) - Number(b.hot)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [stack, membersTopDown, columns, selectedId]);

  return (
    <div className="stack-members" ref={boxRef}>
      {membersTopDown.map((view) => (
        <PrRow key={view.pr.id} view={view} indentPx={textX - 16} selected={selectedId === view.pr.id} onSelect={onSelect} />
      ))}
      <div className="stack-base" data-node="base" style={{ paddingLeft: textX }}>
        <span className="base-pill">{stack.baseRefName}</span>
        {stack.notOpenCount > 0 && <span className="muted small">{stack.notOpenCount} merged or closed below</span>}
      </div>
      <svg className="stack-links" aria-hidden="true">
        <defs>
          {(['idle', 'hot'] as const).map((state) => (
            <marker key={state} id={`${markerId}-${state}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" className={`arrow${state === 'hot' ? ' hot' : ''}`} />
            </marker>
          ))}
        </defs>
        {links.map((link) => (
          <path key={link.key} className={`link${link.hot ? ' hot' : ''}`} d={link.d} markerEnd={`url(#${markerId}-${link.hot ? 'hot' : 'idle'})`} />
        ))}
      </svg>
    </div>
  );
}
