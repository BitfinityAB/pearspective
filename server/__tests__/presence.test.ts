import { HIDDEN_POLL_MS, PollLoop, Presence } from '../presence';
import { emptySnapshot, type Snapshot } from '../../shared/types';

function setup(initialIntervalMs: number | null = 180_000, hiddenMs: number | null = null) {
  const presence = new Presence();
  let snapshot: Snapshot = emptySnapshot('acme');
  let ticks = 0;
  let factor = 1;
  let intervalMs = initialIntervalMs;
  const poller = {
    tick: async () => { ticks += 1; snapshot = { ...snapshot, fetchedAt: new Date(Date.now()).toISOString() }; },
    snapshot: () => snapshot,
    backoffFactor: () => factor,
  };
  const loop = new PollLoop({ poller, presence, intervalMs: () => intervalMs, hiddenIntervalMs: () => hiddenMs });
  loop.start();
  return {
    presence, loop,
    ticks: () => ticks,
    setFactor: (value: number) => (factor = value),
    setIntervalMs: (value: number | null) => (intervalMs = value),
  };
}

describe('Presence', () => {
  it('is visible only while a connected client says so', () => {
    const presence = new Presence();
    presence.connect('tab-1');
    expect(presence.anyVisible()).toBe(true);
    presence.setVisible('tab-1', false);
    expect(presence.anyVisible()).toBe(false);
    presence.setVisible('tab-1', true);
    presence.disconnect('tab-1');
    expect(presence.anyVisible()).toBe(false);
  });
});

describe('PollLoop', () => {
  beforeEach(() => vi.useFakeTimers({ now: Date.parse('2026-11-18T12:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('does not poll while no tab is visible', async () => {
    const { ticks } = setup();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(ticks()).toBe(0);
  });

  it('polls at once when a tab appears and then every interval', async () => {
    const { presence, ticks } = setup();
    presence.connect('tab-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(ticks()).toBe(1);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(ticks()).toBe(2);
  });

  it('pauses when the tab is hidden and resumes without an extra tick if data is fresh', async () => {
    const { presence, ticks } = setup();
    presence.connect('tab-1');
    await vi.advanceTimersByTimeAsync(0);
    presence.setVisible('tab-1', false);
    await vi.advanceTimersByTimeAsync(60_000);
    presence.setVisible('tab-1', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(ticks()).toBe(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ticks()).toBe(2);
  });

  it('loads once and then stops when auto-refresh is off', async () => {
    const { presence, loop, ticks, setIntervalMs } = setup();
    setIntervalMs(null);
    presence.connect('tab-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(ticks()).toBe(1);
    loop.reschedule();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(ticks()).toBe(1);
  });

  it('doubles the interval while the poller asks for backoff', async () => {
    const { presence, ticks, setFactor } = setup();
    setFactor(2);
    presence.connect('tab-1');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(ticks()).toBe(1);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(ticks()).toBe(2);
  });
});

describe('PollLoop visibility hint', () => {
  beforeEach(() => vi.useFakeTimers({ now: Date.parse('2026-11-18T12:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('tells the poller whether any tab was visible', async () => {
    const presence = new Presence();
    const tick = vi.fn(async () => undefined);
    const poller = { tick, snapshot: () => emptySnapshot('acme'), backoffFactor: () => 1 };
    new PollLoop({ poller, presence, intervalMs: () => 180_000, hiddenIntervalMs: () => 300_000 }).start();
    presence.connect('tab-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenLastCalledWith({ hidden: false });
    presence.setVisible('tab-1', false);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(tick).toHaveBeenLastCalledWith({ hidden: true });
  });
});

describe('PollLoop after failures', () => {
  beforeEach(() => vi.useFakeTimers({ now: Date.parse('2026-11-18T12:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  function setupFailing(intervalMs: number | null = 180_000) {
    const presence = new Presence();
    let ticks = 0;
    const poller = {
      tick: async () => { ticks += 1; },
      snapshot: () => emptySnapshot('acme'),
      backoffFactor: () => 1,
    };
    const loop = new PollLoop({ poller, presence, intervalMs: () => intervalMs });
    loop.start();
    return { presence, loop, ticks: () => ticks };
  }

  it('logs a rejected tick and keeps polling', async () => {
    const presence = new Presence();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let ticks = 0;
    const poller = {
      tick: async () => { ticks += 1; throw new Error('tick exploded'); },
      snapshot: () => emptySnapshot('acme'),
      backoffFactor: () => 1,
    };
    const loop = new PollLoop({ poller, presence, intervalMs: () => 180_000 });
    loop.start();
    presence.connect('tab-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('tick'), expect.objectContaining({ message: 'tick exploded' }));
    await vi.advanceTimersByTimeAsync(180_000);
    expect(ticks).toBe(2);
    loop.stop();
    logged.mockRestore();
  });

  it('waits a full interval between failed ticks instead of re-ticking at once', async () => {
    const { presence, ticks } = setupFailing();
    presence.connect('tab-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(ticks()).toBe(1);
    await vi.advanceTimersByTimeAsync(179_000);
    expect(ticks()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ticks()).toBe(2);
  });

  it('does not retry a failed first load in auto-refresh off mode until 60 s have passed', async () => {
    const { presence, loop, ticks, } = setupFailing(null);
    presence.connect('tab-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(ticks()).toBe(1);
    await vi.advanceTimersByTimeAsync(59_000);
    loop.reschedule();
    await vi.advanceTimersByTimeAsync(0);
    expect(ticks()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    loop.reschedule();
    await vi.advanceTimersByTimeAsync(0);
    expect(ticks()).toBe(2);
  });

  it('does not re-arm after stop() while a tick is still in flight', async () => {
    const presence = new Presence();
    let ticks = 0;
    let finishTick: () => void = () => {};
    const poller = {
      tick: () => {
        ticks += 1;
        return new Promise<void>((resolve) => (finishTick = resolve));
      },
      snapshot: () => emptySnapshot('acme'),
      backoffFactor: () => 1,
    };
    const loop = new PollLoop({ poller, presence, intervalMs: () => 180_000 });
    loop.start();
    presence.connect('tab-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(ticks).toBe(1);
    loop.stop();
    finishTick();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(ticks).toBe(1);
  });
});

describe('Presence connections', () => {
  it('knows whether any tab is connected, visible or not', () => {
    const presence = new Presence();
    expect(presence.anyConnected()).toBe(false);
    presence.connect('tab-1');
    presence.setVisible('tab-1', false);
    expect(presence.anyConnected()).toBe(true);
    presence.disconnect('tab-1');
    expect(presence.anyConnected()).toBe(false);
  });
});

describe('PollLoop while hidden', () => {
  beforeEach(() => vi.useFakeTimers({ now: Date.parse('2026-11-18T12:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('keeps polling every hidden interval while a hidden tab stays connected', async () => {
    const { presence, ticks } = setup(180_000, HIDDEN_POLL_MS);
    presence.connect('tab-1');
    await vi.advanceTimersByTimeAsync(0);
    presence.setVisible('tab-1', false);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(ticks()).toBe(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ticks()).toBe(2);
    presence.disconnect('tab-1');
    await vi.advanceTimersByTimeAsync(600_000);
    expect(ticks()).toBe(2);
  });

  it('does not poll a hidden tab when hidden polling is off', async () => {
    const { presence, ticks } = setup(180_000, null);
    presence.connect('tab-1');
    await vi.advanceTimersByTimeAsync(0);
    presence.setVisible('tab-1', false);
    await vi.advanceTimersByTimeAsync(900_000);
    expect(ticks()).toBe(1);
  });
});

describe('PollLoop after a warm start', () => {
  beforeEach(() => vi.useFakeTimers({ now: Date.parse('2026-11-18T12:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  function setupWarm(intervalMs: number | null) {
    const presence = new Presence();
    let ticks = 0;
    const storedAt = new Date(Date.now() - 60_000).toISOString();
    const poller = {
      tick: async () => { ticks += 1; },
      snapshot: () => ({ ...emptySnapshot('acme'), fetchedAt: storedAt, fromStore: true }),
      backoffFactor: () => 1,
    };
    new PollLoop({ poller, presence, intervalMs: () => intervalMs }).start();
    return { presence, ticks: () => ticks };
  }

  it('loads once for a visible tab when auto-refresh is off', async () => {
    const { presence, ticks } = setupWarm(null);
    presence.connect('tab-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(ticks()).toBe(1);
  });

  it('runs the first tick straight away instead of waiting out the stored time', async () => {
    const { presence, ticks } = setupWarm(1_800_000);
    presence.connect('tab-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(ticks()).toBe(1);
  });
});
