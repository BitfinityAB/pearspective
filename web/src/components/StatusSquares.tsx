import type { Signal } from '../../../shared/status';

export function StatusSquares({ signals, size = 28 }: { signals: Signal[]; size?: number }) {
  return (
    <span className="sigs" style={size < 28 ? { gap: 3 } : undefined}>
      {signals.map((signal) => (
        <span
          key={signal.key}
          className={`dot k-${signal.color}`}
          role="img"
          aria-label={`${signal.label}: ${signal.detail}`}
          title={`${signal.label}: ${signal.detail}`}
          style={size < 28 ? { width: size, height: size, fontSize: 10 } : undefined}
        >
          {signal.glyph}
        </span>
      ))}
    </span>
  );
}
