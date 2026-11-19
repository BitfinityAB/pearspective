// Inline diagrams only zoom with the modifier held, so a plain wheel still scrolls the page.
export function stacksZoomHint(platform: string): string {
  const modifier = /Mac|iPhone|iPad/i.test(platform) ? '⌘ Cmd' : 'Ctrl';
  return `Hold ${modifier} and scroll to zoom, drag to pan, click a PR to open it.`;
}
