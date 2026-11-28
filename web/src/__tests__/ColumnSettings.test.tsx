// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColumnSettings } from '../components/ColumnSettings';

const copilot = { name: 'Copilot', short: 'Cop', show: true };

describe('ColumnSettings', () => {
  it('offers a checkbox per configured reviewer column', () => {
    render(<ColumnSettings reviewers={{ aiReview: copilot, codeAnalysis: { name: 'CodeScene', short: 'CS', show: false } }} onSave={async () => undefined} />);
    expect(screen.getByRole('checkbox', { name: 'Copilot (Cop)' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'CodeScene (CS)' })).not.toBeChecked();
  });

  it('saves a change', async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ColumnSettings reviewers={{ aiReview: copilot, codeAnalysis: null }} onSave={onSave} />);
    expect(screen.queryByRole('checkbox', { name: /CodeScene/ })).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Copilot (Cop)' }));
    expect(onSave).toHaveBeenCalledWith('aiReview', false);
  });

  it('renders nothing when no reviewer column is configured', () => {
    const { container } = render(<ColumnSettings reviewers={{ aiReview: null, codeAnalysis: null }} onSave={async () => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a failed save', async () => {
    render(<ColumnSettings reviewers={{ aiReview: copilot, codeAnalysis: null }} onSave={async () => { throw new Error('disk full'); }} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Copilot (Cop)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full');
  });
});
