// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationSettingsSection } from '../components/NotificationSettings';
import { PERMISSION_HINT_KEY } from '../notifications/permission';
import { NOTIFICATION_DEFAULTS } from '../../../shared/types';

const settings = { enabled: true, events: { ...NOTIFICATION_DEFAULTS } };
const stubPermission = (permission: NotificationPermission, requestPermission = vi.fn(async () => 'granted' as NotificationPermission)) =>
  vi.stubGlobal('Notification', Object.assign(function () {}, { permission, requestPermission }));

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('NotificationSettingsSection', () => {
  it('saves the master switch and each event toggle', async () => {
    stubPermission('granted');
    const onSave = vi.fn(async () => undefined);
    render(<NotificationSettingsSection settings={settings} onSave={onSave} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Review requested' }));
    expect(onSave).toHaveBeenLastCalledWith({ enabled: true, events: { ...NOTIFICATION_DEFAULTS, reviewRequested: true } });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Notify me about my pull requests' }));
    expect(onSave).toHaveBeenLastCalledWith({ enabled: false, events: { ...NOTIFICATION_DEFAULTS } });
  });

  it('disables the event toggles while the master switch is off', () => {
    stubPermission('granted');
    render(<NotificationSettingsSection settings={{ ...settings, enabled: false }} onSave={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'CI failed' })).toBeDisabled();
  });

  it('asks for desktop permission from a click and shows the result', async () => {
    const requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
    stubPermission('default', requestPermission);
    render(<NotificationSettingsSection settings={settings} onSave={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Allow desktop notifications' }));
    expect(requestPermission).toHaveBeenCalled();
    expect(await screen.findByText('Allowed')).toBeInTheDocument();
  });

  it('explains a blocked or missing Notification API', async () => {
    stubPermission('denied');
    const { unmount } = render(<NotificationSettingsSection settings={settings} onSave={vi.fn()} />);
    expect(screen.getByText('Blocked in your browser settings')).toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();
    render(<NotificationSettingsSection settings={settings} onSave={vi.fn()} />);
    expect(screen.getByText('Not supported in this browser')).toBeInTheDocument();
  });

  it('remembers "Not now" for the permission hint', async () => {
    stubPermission('default');
    render(<NotificationSettingsSection settings={settings} onSave={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(localStorage.getItem(PERMISSION_HINT_KEY)).toBe('1');
  });
});
