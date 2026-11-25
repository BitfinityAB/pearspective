export type ThemeChoice = 'system' | 'light' | 'dark';

export function readTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem('theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', choice);
  } catch {
    // Storage can be blocked; the theme still applies for this page view.
  }
}

/** The light/dark choice: the picked one, else the system preference. A single-mode theme overrides it on the page but leaves it saved. */
export function currentMode(): 'light' | 'dark' {
  const picked = document.documentElement.dataset.theme;
  if (picked === 'light' || picked === 'dark') return picked;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
