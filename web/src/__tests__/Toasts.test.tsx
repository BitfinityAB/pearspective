// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toasts } from '../components/Toasts';

const toast = (n: number) => ({ key: `k${n}`, prId: `PR_${n}`, title: `orders-api #${n}`, body: 'CI failed' });

describe('Toasts', () => {
  it('shows at most three, counts the rest, and opens or dismisses on click', async () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(<Toasts toasts={[toast(1), toast(2), toast(3), toast(4)]} onOpen={onOpen} onDismiss={onDismiss} />);
    expect(screen.getAllByRole('button', { name: /orders-api #/ })).toHaveLength(3);
    expect(screen.getByText('+1 more')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /orders-api #2/ }));
    expect(onOpen).toHaveBeenCalledWith(toast(2));
    await userEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]!);
    expect(onDismiss).toHaveBeenCalledWith('k2');
  });

  it('dismisses each toast after eight seconds', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toasts toasts={[toast(1)]} onOpen={vi.fn()} onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(8_000));
    expect(onDismiss).toHaveBeenCalledWith('k1');
    vi.useRealTimers();
  });
});
