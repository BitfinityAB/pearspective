// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbar } from '../components/Toolbar';
import { parseUrlState } from '../state/urlState';

const counts = { blocked: 7, waiting: 7, ready: 4, draft: 2 };

describe('Toolbar', () => {
  it('toggles a status chip and reports the new filter', async () => {
    const onChange = vi.fn();
    render(<Toolbar url={parseUrlState('')} counts={counts} onChange={onChange} />);
    const drafts = screen.getByRole('button', { name: /Drafts/ });
    expect(drafts).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(drafts);
    expect(onChange).toHaveBeenCalledWith({ filters: expect.objectContaining({ show: { blocked: true, waiting: true, ready: true, draft: true } }) });
  });

  it('changes grouping and sort order', async () => {
    const onChange = vi.fn();
    render(<Toolbar url={parseUrlState('')} counts={counts} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ticket' }));
    await userEvent.click(screen.getByRole('button', { name: /Oldest first/ }));
    expect(onChange).toHaveBeenCalledWith({ groupBy: 'ticket' });
    expect(onChange).toHaveBeenCalledWith({ filters: expect.objectContaining({ newestFirst: true }) });
  });

  it('hides Group by on the Mine tab', () => {
    render(<Toolbar url={parseUrlState('?tab=mine')} counts={counts} onChange={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Ticket' })).toBeNull();
  });
});
