import { blockersOf, bucketOf, reviewCounts, signalsOf } from '../status';
import { makePerson, makePr } from '../../test/factories';

const signal = (pr: ReturnType<typeof makePr>, key: string) => signalsOf(pr).find((s) => s.key === key)!;
const copilot = makePerson('copilot-pull-request-reviewer', 'ai-review');
const codescene = makePerson('codescene-access', 'code-analysis');

describe('signalsOf', () => {
  it('returns six signals in a fixed order', () => {
    expect(signalsOf(makePr()).map((s) => s.key)).toEqual(['ci', 'aiReview', 'codeAnalysis', 'review', 'threads', 'mergeable']);
  });

  describe('CI', () => {
    it('is grey when there are no checks', () => {
      expect(signal(makePr({ checks: [] }), 'ci').color).toBe('grey');
    });
    it('is red when a required check failed', () => {
      const pr = makePr({ checks: [{ name: 'e2e-android', state: 'failure', required: true }] });
      expect(signal(pr, 'ci')).toMatchObject({ color: 'red', glyph: '✕', detail: 'Required check failed: e2e-android' });
    });
    it('is amber when only a non-required check failed', () => {
      const pr = makePr({ checks: [{ name: 'lint-extra', state: 'failure', required: false }, { name: 'build', state: 'success', required: true }] });
      expect(signal(pr, 'ci').color).toBe('amber');
    });
    it('is amber while a check is pending', () => {
      const pr = makePr({ checks: [{ name: 'build', state: 'pending', required: true }] });
      expect(signal(pr, 'ci')).toMatchObject({ color: 'amber', detail: '1 running' });
    });
    it('is green when every check passed', () => {
      expect(signal(makePr(), 'ci')).toMatchObject({ color: 'green', detail: 'All 1 checks passed' });
    });
  });

  describe('AI review (Copilot)', () => {
    it('is grey when not requested and not reviewed', () => {
      expect(signal(makePr(), 'aiReview').color).toBe('grey');
    });
    it('is amber when requested but not reviewed yet', () => {
      const pr = makePr({ reviewRequests: [{ type: 'person', person: copilot }] });
      expect(signal(pr, 'aiReview')).toMatchObject({ color: 'amber', detail: 'Requested, not reviewed yet' });
    });
    it('is amber when it reviewed and left unresolved threads', () => {
      const pr = makePr({
        reviews: [{ author: copilot, state: 'commented', submittedAt: '2026-11-16T08:00:00Z' }],
        threads: [{ resolved: false, author: copilot, snippet: 'Possible null', url: 'u' }],
      });
      expect(signal(pr, 'aiReview')).toMatchObject({ color: 'amber', detail: 'Reviewed, 1 unresolved' });
    });
    it('is green when it reviewed and every thread it opened is resolved', () => {
      const pr = makePr({
        reviews: [{ author: copilot, state: 'commented', submittedAt: '2026-11-16T08:00:00Z' }],
        threads: [{ resolved: true, author: copilot, snippet: 'x', url: 'u' }],
      });
      expect(signal(pr, 'aiReview').color).toBe('green');
    });
  });

  describe('code analysis (CodeScene)', () => {
    it('is grey without a review', () => {
      expect(signal(makePr(), 'codeAnalysis').color).toBe('grey');
    });
    it('follows its latest review state', () => {
      const pr = makePr({
        reviews: [
          { author: codescene, state: 'changes_requested', submittedAt: '2026-11-15T08:00:00Z' },
          { author: codescene, state: 'approved', submittedAt: '2026-11-16T08:00:00Z' },
        ],
      });
      expect(signal(pr, 'codeAnalysis').color).toBe('green');
    });
    it('is red when its latest review requested changes', () => {
      const pr = makePr({ reviews: [{ author: codescene, state: 'changes_requested', submittedAt: '2026-11-16T08:00:00Z' }] });
      expect(signal(pr, 'codeAnalysis').color).toBe('red');
    });
  });

  describe('human review', () => {
    it.each([
      ['approved', 'green'],
      ['review_required', 'amber'],
      ['changes_requested', 'red'],
      [null, 'grey'],
    ] as const)('maps decision %s to %s', (decision, color) => {
      expect(signal(makePr({ reviewDecision: decision }), 'review').color).toBe(color);
    });
  });

  describe('threads', () => {
    it('counts only unresolved human threads and shows the count as the glyph', () => {
      const pr = makePr({
        threads: [
          { resolved: false, author: makePerson('robin'), snippet: 'a', url: 'u' },
          { resolved: false, author: makePerson('robin'), snippet: 'b', url: 'u' },
          { resolved: false, author: copilot, snippet: 'c', url: 'u' },
          { resolved: true, author: makePerson('robin'), snippet: 'd', url: 'u' },
        ],
      });
      expect(signal(pr, 'threads')).toMatchObject({ color: 'amber', glyph: '2', detail: '2 unresolved' });
    });
  });

  describe('mergeable', () => {
    it.each([
      ['clean', 'green'],
      ['blocked', 'amber'],
      ['unstable', 'amber'],
      ['conflicts', 'red'],
      ['behind', 'red'],
      ['unknown', 'grey'],
    ] as const)('maps %s to %s', (state, color) => {
      expect(signal(makePr({ mergeState: state }), 'mergeable').color).toBe(color);
    });
    it('shows an ellipsis while mergeability is being computed', () => {
      expect(signal(makePr({ mergeState: 'unknown' }), 'mergeable')).toMatchObject({ glyph: '…', detail: 'Checking…' });
    });
  });
});

describe('blockersOf', () => {
  it('returns nothing for a clean approved PR', () => {
    expect(blockersOf(makePr())).toEqual([]);
  });
  it('lists every blocker as its own badge', () => {
    const pr = makePr({
      isDraft: true,
      mergeState: 'conflicts',
      reviewDecision: 'changes_requested',
      checks: [{ name: 'build', state: 'failure', required: true }],
      threads: [{ resolved: false, author: makePerson('robin'), snippet: 'a', url: 'u' }],
    });
    expect(blockersOf(pr).map((b) => b.label)).toEqual([
      'Draft', 'Conflicts', 'Required check failed', 'Changes requested', '1 unresolved thread',
    ]);
  });
  it('marks a missing approval as amber, not red', () => {
    expect(blockersOf(makePr({ reviewDecision: 'review_required' }))).toEqual([{ label: 'Needs approval', severity: 'amber' }]);
  });
  it('treats being behind the base branch as red', () => {
    expect(blockersOf(makePr({ mergeState: 'behind' }))).toEqual([{ label: 'Behind base', severity: 'red' }]);
  });
});

describe('bucketOf', () => {
  it('puts drafts in the draft bucket regardless of other state', () => {
    expect(bucketOf(makePr({ isDraft: true, mergeState: 'conflicts' }))).toBe('draft');
  });
  it('is blocked when any red blocker exists', () => {
    expect(bucketOf(makePr({ mergeState: 'conflicts' }))).toBe('blocked');
  });
  it('is waiting when only an approval is missing', () => {
    expect(bucketOf(makePr({ reviewDecision: 'review_required', mergeState: 'blocked' }))).toBe('waiting');
  });
  it('is waiting while checks run or mergeability is unknown', () => {
    expect(bucketOf(makePr({ checks: [{ name: 'build', state: 'pending', required: true }] }))).toBe('waiting');
    expect(bucketOf(makePr({ mergeState: 'unknown' }))).toBe('waiting');
  });
  it('is ready when nothing blocks or waits', () => {
    expect(bucketOf(makePr())).toBe('ready');
  });
});

describe('reviewCounts', () => {
  it('counts each human reviewer once by their latest state', () => {
    const sam = makePerson('sam');
    const pr = makePr({
      reviews: [
        { author: sam, state: 'changes_requested', submittedAt: '2026-11-14T08:00:00Z' },
        { author: sam, state: 'approved', submittedAt: '2026-11-15T08:00:00Z' },
        { author: makePerson('robin'), state: 'changes_requested', submittedAt: '2026-11-15T09:00:00Z' },
        { author: copilot, state: 'commented', submittedAt: '2026-11-15T10:00:00Z' },
      ],
    });
    expect(reviewCounts(pr)).toEqual({ approved: 1, changesRequested: 1 });
  });
});
