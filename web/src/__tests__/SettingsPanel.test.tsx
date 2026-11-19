// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPanel } from '../components/SettingsPanel';

const ten = Array.from({ length: 10 }, (_, index) => `repo-${index}`);
const api = { searchRepos: async (q: string) => (q ? [{ name: 'report-service', cloned: false }] : [{ name: 'orders-api', cloned: true }]) };

describe('SettingsPanel', () => {
  it('blocks an eleventh repository until one is removed', async () => {
    render(<SettingsPanel api={api} repos={ten} onSave={async () => undefined} onClose={() => undefined} />);
    const extra = await screen.findByRole('checkbox', { name: /orders-api/ });
    expect(extra).toBeDisabled();
    expect(screen.getByText('10 of 10 selected')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /repo-0/ }));
    expect(extra).toBeEnabled();
  });

  it('searches GitHub and saves the new selection', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<SettingsPanel api={api} repos={['orders-api']} onSave={onSave} onClose={onClose} />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search repositories' }), 'report');
    await userEvent.click(await screen.findByRole('checkbox', { name: /report-service/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(['orders-api', 'report-service']);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the error when saving fails and stays open', async () => {
    const onClose = vi.fn();
    render(<SettingsPanel api={api} repos={['orders-api']} onSave={async () => { throw new Error('repos must be a list of at most 10 names'); }} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('repos must be a list of at most 10 names');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on a backdrop click but not when the press started inside the panel', async () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsPanel api={api} repos={['orders-api']} onSave={async () => undefined} onClose={onClose} />);
    const panel = await screen.findByRole('dialog');
    const backdrop = container.querySelector('.modal-backdrop')!;
    fireEvent.mouseDown(panel);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
