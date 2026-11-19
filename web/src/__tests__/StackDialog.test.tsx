// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StackDialog } from '../components/StackDialog';

vi.mock('../components/StackDiagram', () => ({ StackDiagram: ({ label }: { label: string }) => <div data-testid="diagram">{label}</div> }));

const detail = {
  repo: 'field-app', native: true, number: 4964, baseRefName: 'main',
  entries: [
    { number: 4985, title: 'Add storage', state: 'merged' as const, position: 1 },
    { number: 4988, title: 'Offline mode', state: 'open' as const, position: 2 },
  ],
};

describe('StackDialog', () => {
  it('loads the stack and titles the dialog', async () => {
    render(<StackDialog api={{ stackDetail: async () => detail }} prId="PR_4988" views={new Map()} onSelect={() => undefined} onClose={() => undefined} />);
    expect(await screen.findByRole('dialog', { name: 'field-app · GitHub stack #4964' })).toBeInTheDocument();
    expect(screen.getByText('1 open, 1 merged or closed · onto main')).toBeInTheDocument();
    expect(screen.getByTestId('diagram')).toBeInTheDocument();
  });

  it('closes on Escape and from the close button', async () => {
    const onClose = vi.fn();
    render(<StackDialog api={{ stackDetail: async () => detail }} prId="PR_4988" views={new Map()} onSelect={() => undefined} onClose={onClose} />);
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('explains a failure to load', async () => {
    render(<StackDialog api={{ stackDetail: async () => { throw new Error('gh failed'); } }} prId="PR_1" views={new Map()} onSelect={() => undefined} onClose={() => undefined} />);
    expect(await screen.findByText('Could not load the stack: gh failed')).toBeInTheDocument();
  });

  it('keeps focus and uses the latest onClose when the parent re-renders with a new callback', async () => {
    const api = { stackDetail: async () => detail };
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(<StackDialog api={api} prId="PR_4988" views={new Map()} onSelect={() => undefined} onClose={first} />);
    await screen.findByRole('dialog');
    const closeButton = screen.getByRole('button', { name: 'Close' });
    expect(closeButton).toHaveFocus();
    closeButton.blur();
    rerender(<StackDialog api={api} prId="PR_4988" views={new Map()} onSelect={() => undefined} onClose={latest} />);
    expect(closeButton).not.toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('closes on a backdrop click but not when the press started inside the dialog', async () => {
    const onClose = vi.fn();
    const { container } = render(<StackDialog api={{ stackDetail: async () => detail }} prId="PR_4988" views={new Map()} onSelect={() => undefined} onClose={onClose} />);
    const dialog = await screen.findByRole('dialog');
    const backdrop = container.querySelector('.modal-backdrop')!;
    fireEvent.mouseDown(dialog);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
