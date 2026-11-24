import { useState } from 'react';
import type { ThemeInfo } from '../../../shared/types';

const SWATCH_TOKENS = ['bg', 'surface', 'accent', 'blocked', 'waiting', 'ready'] as const;

interface AppearanceSettingsProps {
  themes: ThemeInfo[];
  chosen: string;
  onChoose: (id: string) => Promise<void>;
  folderHint: string;
}

export function AppearanceSettings({ themes, chosen, onChoose, folderHint }: AppearanceSettingsProps) {
  const [error, setError] = useState<string | null>(null);
  const choose = (id: string) => {
    setError(null);
    // The app-level error renders behind the modal, so failures are shown here.
    onChoose(id).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
  };

  return (
    <section className="appearance-settings" aria-label="Appearance">
      <div className="theme-list" role="radiogroup" aria-label="Theme">
        {themes.map((info) => {
          const mode = info.theme?.[info.modes[0] ?? 'light'] ?? info.theme?.light ?? info.theme?.dark;
          return (
            <div key={info.id} className="theme-option">
              <label>
                <input type="radio" name="theme" checked={chosen === info.id} disabled={!info.valid} onChange={() => choose(info.id)} />
                <span>{info.name}</span>
                {info.modes.length === 1 && <span className="muted small">{info.modes[0]} only</span>}
                {info.source === 'user' && <span className="muted small">custom</span>}
                {info.valid && mode && (
                  <span className="swatches" aria-hidden="true">
                    {SWATCH_TOKENS.map((token) => <span key={token} data-swatch={token} style={{ background: mode.colors[token] }} />)}
                  </span>
                )}
              </label>
              {info.error && <p className="theme-error small">{info.error}</p>}
              {info.warnings.map((warning) => <p key={warning} className="theme-warning small">{warning}</p>)}
            </div>
          );
        })}
      </div>
      {error && <p role="alert" className="banner sev-red">{error}</p>}
      <p className="muted small">Add your own: put a JSON file in {folderHint}. Your editor can autocomplete it with theme.schema.json.</p>
    </section>
  );
}
