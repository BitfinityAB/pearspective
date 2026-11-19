import type { BannerMsg } from '../../../shared/types';

const SEVERITY: Record<BannerMsg['kind'], string> = { 'missing-cli': 'sev-red', auth: 'sev-red', 'rate-limit': 'sev-amber', stale: 'sev-amber' };

export function Banners({ banners }: { banners: BannerMsg[] }) {
  if (banners.length === 0) return null;
  return (
    <div role="alert">
      {banners.map((banner) => <div key={banner.kind} className={`banner ${SEVERITY[banner.kind]}`}>{banner.message}</div>)}
    </div>
  );
}
