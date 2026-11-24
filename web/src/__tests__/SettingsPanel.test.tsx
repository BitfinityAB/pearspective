// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPanel } from '../components/SettingsPanel';

const ten = Array.from({ length: 10 }, (_, index) => `repo-${index}`);
const notifications = { settings: { enabled: true, events: { ciFailed: true, ciPassed: true, approved: true, changesRequested: true, readyToMerge: true, conflict: true, newComment: true, newThread: true, reviewRequested: false } }, onSave: async () => undefined };
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
    render(<SettingsPanel api={api} repos={['orders-api', 'billing']} onSave={async () => { throw new Error('repos must be a list of at most 10 names'); }} onClose={onClose} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /billing/ }));
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

  it('splits repositories and notifications into tabs, keeping unsaved repository changes', async () => {
    const onSave = vi.fn(async () => undefined);
    render(<SettingsPanel api={api} repos={['orders-api']} onSave={onSave} onClose={() => undefined} notifications={notifications} />);
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    const repositoriesTab = within(dialog).getByRole('tab', { name: 'Repositories' });
    const notificationsTab = within(dialog).getByRole('tab', { name: 'Notifications' });
    expect(repositoriesTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('checkbox', { name: 'Notify me about my pull requests' })).toBeNull();

    await userEvent.click(await screen.findByRole('checkbox', { name: /orders-api/ }));
    await userEvent.click(notificationsTab);
    expect(notificationsTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Notifications' })).toContainElement(screen.getByRole('checkbox', { name: 'Notify me about my pull requests' }));
    expect(screen.queryByRole('searchbox', { name: 'Search repositories' })).toBeNull();

    await userEvent.click(repositoriesTab);
    expect(screen.getByRole('checkbox', { name: /orders-api/ })).not.toBeChecked();
  });

  it('opens on the notifications tab when asked to focus the permission row', () => {
    render(<SettingsPanel api={api} repos={['orders-api']} onSave={async () => undefined} onClose={() => undefined} notifications={notifications} focusPermission />);
    expect(screen.getByRole('tab', { name: 'Notifications' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows no tabs without notification settings', () => {
    render(<SettingsPanel api={api} repos={['orders-api']} onSave={async () => undefined} onClose={() => undefined} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search repositories' })).toBeInTheDocument();
  });

  it('adds an Appearance tab that shows the theme list when given themes', async () => {
    const appearance = { themes: [], chosen: 'default', onChoose: async () => undefined, folderHint: 'the themes folder' };
    render(<SettingsPanel api={api} repos={['orders-api']} onSave={async () => undefined} onClose={() => undefined} notifications={notifications} appearance={appearance} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
    expect(screen.getByRole('tabpanel', { name: 'Appearance' })).toContainElement(screen.getByRole('radiogroup', { name: 'Theme' }));
  });

  it('closes on Save without saving when the repositories did not change', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<SettingsPanel api={api} repos={['orders-api']} onSave={onSave} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
