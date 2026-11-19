import { stacksZoomHint } from '../lib/zoomHint';

describe('stacksZoomHint', () => {
  it('names the Cmd key on macOS', () => {
    expect(stacksZoomHint('MacIntel')).toBe('Hold ⌘ Cmd and scroll to zoom, drag to pan, click a PR to open it.');
  });

  it('names the Ctrl key elsewhere', () => {
    expect(stacksZoomHint('Win32')).toBe('Hold Ctrl and scroll to zoom, drag to pan, click a PR to open it.');
    expect(stacksZoomHint('Linux x86_64')).toBe('Hold Ctrl and scroll to zoom, drag to pan, click a PR to open it.');
  });
});
