/** Below this width the detail panel opens fullscreen over the list. Keep in sync with app.css. */
export const NARROW_QUERY = '(max-width: 1100px)';

export const isNarrow = (): boolean => window.matchMedia?.(NARROW_QUERY).matches ?? false;
