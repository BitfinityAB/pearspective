// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StacksView } from '../views/StacksView';
import { buildPrViews } from '../../../shared/grouping';
import { emptySnapshot } from '../../../shared/types';
import { makePr } from '../../../test/factories';

vi.mock('../components/StackDiagram', () => ({ StackDiagram: ({ label }: { label: string }) => <div data-testid="diagram">{label}</div> }));

describe('StacksView', () => {
  it('shows one card per stack in the selected repositories', async () => {
    const bottom = makePr({ number: 3420, headRefName: 'lock' });
    const top = makePr({ number: 3421, baseRefName: 'lock' });
    const elsewhere = [makePr({ repo: 'other', headRefName: 'x' }), makePr({ repo: 'other', baseRefName: 'x' })];
    const snapshot = { ...emptySnapshot('acme'), prs: [bottom, top, ...elsewhere], settings: { ...emptySnapshot('acme').settings, repos: ['orders-api'] } };
    const onVisualize = vi.fn();
    render(<StacksView snapshot={snapshot} views={buildPrViews(snapshot, Date.now())} onSelect={() => undefined} onVisualize={onVisualize} />);

    expect(screen.getAllByTestId('diagram')).toHaveLength(1);
    expect(screen.getByText('orders-api')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open large' }));
    expect(onVisualize).toHaveBeenCalledWith(bottom.id);
  });

  it('says so when there are no stacks', () => {
    const snapshot = { ...emptySnapshot('acme'), prs: [makePr()] };
    render(<StacksView snapshot={snapshot} views={buildPrViews(snapshot, Date.now())} onSelect={() => undefined} onVisualize={() => undefined} />);
    expect(screen.getByText('No stacked pull requests in the selected repositories.')).toBeInTheDocument();
  });
});
