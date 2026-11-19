import { createHttpApi } from '../api/client';

describe('createHttpApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('surfaces the server error message when settings are rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'repos must be a list of at most 10 names' }), { status: 400 })));
    await expect(createHttpApi().updateSettings({ repos: [] })).rejects.toThrow('repos must be a list of at most 10 names');
  });

  it('returns null for a PR that is not in a stack', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    expect(await createHttpApi().stackDetail('PR_1')).toBeNull();
  });

  it('sends presence as JSON', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await createHttpApi().setVisible('tab-1', false);
    expect(fetchMock).toHaveBeenCalledWith('/api/presence', expect.objectContaining({ method: 'POST', body: '{"client":"tab-1","visible":false}' }));
  });

  it('calls onOpen each time the stream opens', () => {
    const listeners: Record<string, Array<() => void>> = { open: [] };
    class FakeEventSource {
      addEventListener(type: string, listener: () => void) { (listeners[type] ?? (listeners[type] = [])).push(listener); }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const onOpen = vi.fn();
    createHttpApi().subscribe('tab-1', () => undefined, onOpen);
    listeners.open?.forEach((listener) => listener());
    listeners.open?.forEach((listener) => listener());
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});
