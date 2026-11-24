// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from '../components/ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('starts on System and marks it pressed', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'System theme' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('applies and remembers Dark, and System clears both again', async () => {
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button', { name: 'Dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');

    await userEvent.click(screen.getByRole('button', { name: 'System theme' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('theme')).toBeNull();
  });
});

describe('ThemeToggle with a forced mode', () => {
  it('disables every button, shows the forced mode as pressed and explains why', async () => {
    localStorage.clear();
    render(<ThemeToggle forcedMode="dark" themeName="Terminal" />);
    for (const name of ['System theme', 'Light theme', 'Dark theme']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'Dark theme' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'System theme' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('group', { name: 'Theme' })).toHaveAttribute('title', 'Terminal theme is dark only');
    await userEvent.click(screen.getByRole('button', { name: 'Light theme' }));
    expect(localStorage.getItem('theme')).toBeNull();
  });
});

describe('ThemeToggle forced mode round trip', () => {
  it('keeps the saved choice while the mode is forced', async () => {
    localStorage.clear();
    const { rerender } = render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button', { name: 'Light theme' }));
    rerender(<ThemeToggle forcedMode="dark" themeName="Terminal" />);
    rerender(<ThemeToggle forcedMode={null} />);
    expect(screen.getByRole('button', { name: 'Light theme' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('theme')).toBe('light');
  });
});
