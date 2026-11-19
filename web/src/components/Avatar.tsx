import { useState } from 'react';

const initialsOf = (name: string) =>
  name.split(/[\s_-]+/).filter(Boolean).map((part) => part[0]!).join('').slice(0, 2).toUpperCase();

function tintIndex(name: string): number {
  let total = 0;
  for (const character of name) total += character.charCodeAt(0);
  return total % 5;
}

/** Decorative: callers always show the name next to it, so screen readers skip it. */
export function Avatar({ name, url, size = 28 }: { name: string; url?: string; size?: number }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className={`avatar av-${tintIndex(name)}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true">
      {initialsOf(name)}
      {url && !failed && (
        <img src={url} alt="" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} style={{ opacity: loaded ? 1 : 0 }} />
      )}
    </span>
  );
}
