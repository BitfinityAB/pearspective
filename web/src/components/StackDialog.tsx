import { useEffect, useMemo, useRef, useState } from 'react';
import type { PrView } from '../../../shared/grouping';
import type { StackDetail } from '../../../shared/types';
import type { DashboardApi } from '../api/client';
import { StackDiagram } from './StackDiagram';

interface StackDialogProps {
  api: Pick<DashboardApi, 'stackDetail'>;
  prId: string;
  views: Map<string, PrView>;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Changes when the theme does, so the diagram re-reads CSS variables. */
  themeKey?: string;
}

export function StackDialog({ api, prId, views, onSelect, onClose, themeKey }: StackDialogProps) {
  const [detail, setDetail] = useState<StackDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // An inline onClose changes every render; the focus and Escape effect must not re-run for it.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    let active = true;
    api.stackDetail(prId)
      .then((loaded) => { if (active) loaded ? setDetail(loaded) : setError('This PR is not part of a stack any more.'); })
      .catch((caught: Error) => active && setError(`Could not load the stack: ${caught.message}`));
    return () => { active = false; };
  }, [api, prId]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onCloseRef.current();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, []);

  const repo = views.get(prId)?.pr.repo ?? detail?.repo;
  const viewsByNumber = useMemo(
    () => {
      // Only this stack's PRs, so an unrelated PR changing status does not redraw the diagram.
      const numbers = new Set(detail?.entries.filter((entry) => entry.state === 'open').map((entry) => entry.number));
      return new Map([...views.values()].filter((view) => view.pr.repo === repo && numbers.has(view.pr.number)).map((view) => [view.pr.number, view]));
    },
    [views, repo, detail],
  );
  const title = detail ? `${detail.repo} · ${detail.native ? `GitHub stack #${detail.number}` : 'Branch-chained stack'}` : 'Stack';
  const openCount = detail?.entries.filter((entry) => entry.state === 'open').length ?? 0;
  const notOpenCount = (detail?.entries.length ?? 0) - openCount;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => { pressedOnBackdrop.current = event.target === event.currentTarget; }}
      onClick={(event) => { if (pressedOnBackdrop.current && event.target === event.currentTarget) onClose(); }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="stack-dialog-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3 id="stack-dialog-title">{title}</h3>
          {detail && <span className="muted small">{openCount} open, {notOpenCount} merged or closed · onto {detail.baseRefName}</span>}
          <span className="grow" />
          <span className="muted small">Scroll to zoom, drag to pan</span>
          <button ref={closeRef} type="button" className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <p className="empty-state">{error}</p>}
          {!error && !detail && <p className="empty-state">Loading stack…</p>}
          {detail && (
            <StackDiagram
              detail={detail}
              viewsByNumber={viewsByNumber}
              themeKey={themeKey}
              selectedNumber={views.get(prId)?.pr.number}
              label={`Diagram of ${title}`}
              onSelect={(number) => {
                const target = viewsByNumber.get(number);
                if (target) onSelect(target.pr.id);
              }}
            />
          )}
        </div>
        <div className="legend">
          <span><i className="fill-blocked" />Blocked</span><span><i className="fill-waiting" />Waiting for review</span>
          <span><i className="fill-ready" />Ready</span><span><i style={{ background: 'var(--c-merged)', opacity: 0.6 }} />Merged</span>
          <span>Arrow = merges into · label = commits behind its target</span>
        </div>
      </div>
    </div>
  );
}
