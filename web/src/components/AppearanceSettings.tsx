import { useId, useRef, useState } from 'react';
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
  // Arrow keys pick one radio after another, so saves overlap; only the latest pick may settle the state.
  const [pending, setPending] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const idPrefix = useId();
  const choose = (id: string) => {
    const request = ++latestRequest.current;
    setError(null);
    setPending(id);
    const isLatest = () => request === latestRequest.current;
    // The app-level error renders behind the modal, so failures are shown here.
    onChoose(id).then(
      () => { if (isLatest()) setPending(null); },
      (caught: unknown) => {
        if (!isLatest()) return;
        setPending(null);
        setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
  };
  const shownChoice = pending ?? chosen;

  return (
    <section className="appearance-settings" aria-label="Appearance">
      <div className="theme-list" role="radiogroup" aria-label="Theme">
        {themes.map((info, index) => {
          const mode = info.theme?.[info.modes[0] ?? 'light'] ?? info.theme?.light ?? info.theme?.dark;
          const noteIds = [...(info.error ? [`${idPrefix}-${index}-error`] : []), ...info.warnings.map((_, warning) => `${idPrefix}-${index}-warning-${warning}`)];
          return (
            <div key={info.id} className="theme-option">
              <label>
                <input type="radio" name="theme" checked={shownChoice === info.id} disabled={!info.valid} aria-describedby={noteIds.join(' ') || undefined} onChange={() => choose(info.id)} />
                <span>{info.name}</span>
                {info.modes.length === 1 && <span className="muted small">{info.modes[0]} only</span>}
                {info.source === 'user' && <span className="muted small">custom</span>}
                {info.valid && mode && (
                  <span className="swatches" aria-hidden="true">
                    {SWATCH_TOKENS.map((token) => <span key={token} data-swatch={token} style={{ background: mode.colors[token] }} />)}
                  </span>
                )}
              </label>
              {info.error && <p id={`${idPrefix}-${index}-error`} className="theme-error small">{info.error}</p>}
              {info.warnings.map((warning, position) => <p key={warning} id={`${idPrefix}-${index}-warning-${position}`} className="theme-warning small">{warning}</p>)}
            </div>
          );
        })}
      </div>
      {error && <p role="alert" className="banner sev-red">{error}</p>}
      <p className="muted small">Add your own: put a JSON file in {folderHint}. Your editor can autocomplete it with theme.schema.json.</p>
    </section>
  );
}
