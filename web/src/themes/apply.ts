export const THEME_CSS_KEY = 'pearspective.themeCss';

/** With no theme to show, the base stylesheet's tokens must apply rather than a stale theme's. */
export function clearThemeCss(): void {
  document.getElementById('theme')?.remove();
  try {
    localStorage.removeItem(THEME_CSS_KEY);
  } catch {
    // Blocked storage: nothing was cached to begin with.
  }
}

/** One style element holds the active theme, so switching never reloads the page. */
export function applyThemeCss(css: string): void {
  let style = document.getElementById('theme') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'theme';
  }
  style.textContent = css;
  // Last in head so it wins over the app stylesheet at equal specificity, whatever order the build injected links in.
  if (document.head.lastElementChild !== style) document.head.appendChild(style);
  try {
    localStorage.setItem(THEME_CSS_KEY, css);
  } catch {
    // Blocked storage only costs a Default-coloured first paint on the next load.
  }
}
