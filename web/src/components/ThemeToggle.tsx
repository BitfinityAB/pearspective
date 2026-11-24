import { useState, type ReactNode } from 'react';
import { applyTheme, readTheme, type ThemeChoice } from '../theme';

const icon = (paths: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
);

const OPTIONS: { value: ThemeChoice; label: string; icon: ReactNode }[] = [
  { value: 'system', label: 'System', icon: icon(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>) },
  { value: 'light', label: 'Light', icon: icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>) },
  { value: 'dark', label: 'Dark', icon: icon(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />) },
];

interface ThemeToggleProps {
  /** A single-mode theme fixes the mode; the saved choice stays untouched for when a two-mode theme returns. */
  forcedMode?: 'light' | 'dark' | null;
  themeName?: string;
}

export function ThemeToggle({ forcedMode = null, themeName = 'This' }: ThemeToggleProps = {}) {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  return (
    <div className="segs compact" role="group" aria-label="Theme" title={forcedMode ? `${themeName} theme is ${forcedMode} only` : undefined}>
      {OPTIONS.map((option) => {
        const pressed = (forcedMode ?? choice) === option.value;
        return (
        <button
          key={option.value}
          type="button"
          className={`seg${pressed ? ' on' : ''}`}
          style={{ padding: '0 8px' }}
          aria-pressed={pressed}
          disabled={forcedMode !== null}
          aria-label={`${option.label} theme`}
          title={option.label}
          onClick={() => {
            if (forcedMode) return;
            applyTheme(option.value);
            setChoice(option.value);
          }}
        >
          {option.icon}
        </button>
        );
      })}
    </div>
  );
}
