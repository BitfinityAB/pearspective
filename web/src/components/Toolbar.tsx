import type { GroupBy } from '../../../shared/grouping';
import type { Bucket } from '../../../shared/status';
import type { UrlState } from '../state/urlState';

const CHIPS: { bucket: Bucket; label: string }[] = [
  { bucket: 'blocked', label: 'Blocked' }, { bucket: 'waiting', label: 'Waiting' }, { bucket: 'ready', label: 'Ready' }, { bucket: 'draft', label: 'Drafts' },
];
const GROUPS: { value: GroupBy; label: string }[] = [{ value: 'author', label: 'Author' }, { value: 'repo', label: 'Repository' }, { value: 'ticket', label: 'Ticket' }];

interface ToolbarProps { url: UrlState; counts: Record<Bucket, number>; onChange: (patch: Partial<UrlState>) => void }

export function Toolbar({ url, counts, onChange }: ToolbarProps) {
  const { filters } = url;
  return (
    <section className="toolbar" aria-label="Filters">
      {url.tab === 'overview' && (
        <div className="segs" style={{ background: 'var(--surface)' }} role="group" aria-label="Group by">
          <span className="lbl" aria-hidden="true">Group by</span>
          {GROUPS.map((group) => (
            <button key={group.value} type="button" className={`seg${url.groupBy === group.value ? ' on' : ''}`} aria-pressed={url.groupBy === group.value} onClick={() => onChange({ groupBy: group.value })}>
              {group.label}
            </button>
          ))}
        </div>
      )}
      <div className="status-chips" role="group" aria-label="Status filter">
        {CHIPS.map((chip) => (
          <button
            key={chip.bucket}
            type="button"
            className={`chip${filters.show[chip.bucket] ? '' : ' off'}`}
            aria-pressed={filters.show[chip.bucket]}
            onClick={() => onChange({ filters: { ...filters, show: { ...filters.show, [chip.bucket]: !filters.show[chip.bucket] } } })}
          >
            <span className={`d fill-${chip.bucket}`} />{chip.label}<span className="n">{counts[chip.bucket]}</span>
          </button>
        ))}
      </div>
      <label className="search">
        <span className="sr-only">Search pull requests</span>
        <input value={filters.q} placeholder="Search title, branch, repo" onChange={(event) => onChange({ filters: { ...filters, q: event.target.value } })} />
      </label>
      <button type="button" className="chip sort-chip" onClick={() => onChange({ filters: { ...filters, newestFirst: !filters.newestFirst } })}>
        ⇅ {filters.newestFirst ? 'Newest first' : 'Oldest first'}
      </button>
    </section>
  );
}
