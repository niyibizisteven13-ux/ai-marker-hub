import { MapPin } from 'lucide-react';

/**
 * A small map of one place, made from OpenStreetMap tiles (images; no script, no key). The pin is the business. Respect the tile policy: light use,
 * attribution always shown. Clicking is left to the parent (a Directions link).
 */
export function tileOf(lat: number, lng: number, z: number) {
  const n = 2 ** z; const x = ((lng + 180) / 360) * n; const r = (lat * Math.PI) / 180; const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { x0: Math.floor(x), y0: Math.floor(y), fx: x - Math.floor(x), fy: y - Math.floor(y), n };
}
export default function MapTile({ lat, lng, zoom = 16, height = 160, className = '' }: { lat: number; lng: number; zoom?: number; height?: number; className?: string }) {
  const { x0, y0, fx, fy, n } = tileOf(lat, lng, zoom); const cx = 256 + fx * 256, cy = 256 + fy * 256;
  const tiles: Array<{ k: string; src: string; left: number; top: number }> = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const tx = ((x0 + dx) % n + n) % n, ty = y0 + dy; if (ty < 0 || ty >= n) continue; tiles.push({ k: `${dx}${dy}`, src: `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`, left: (dx + 1) * 256, top: (dy + 1) * 256 }); }
  return (
    <div className={`relative overflow-hidden bg-[#E6EEF6] ${className}`} style={{ height }} role="img" aria-label="Map showing the business location">
      <div className="absolute" style={{ width: 768, height: 768, left: `calc(50% - ${cx}px)`, top: height / 2 - cy }}>
        {tiles.map((t) => <img key={t.k} src={t.src} alt="" width={256} height={256} loading="lazy" draggable={false} className="absolute select-none" style={{ left: t.left, top: t.top }} />)}
      </div>
      <MapPin className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full fill-[#DC2626] text-white drop-shadow" size={34} aria-hidden="true" />
      <span className="absolute bottom-0 right-0 bg-white/80 px-1.5 py-0.5 text-[10px] text-[#344054]">© OpenStreetMap contributors</span>
    </div>
  );
}
/** Finds coordinates in whatever the owner pastes: a Google Maps link with @lat,lng or !3d!4d or q=, or plain "lat, lng". Short links cannot be opened from here. */
export function parseCoords(text: string): { lat: number; lng: number } | null {
  const t = decodeURIComponent(text.trim()); const pats = [/@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/, /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/, /[?&](?:q|ll|query|destination)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/, /^(-?\d{1,2}\.\d+)[\s,;]+(-?\d{1,3}\.\d+)$/];
  for (const p of pats) { const m = p.exec(t); if (m) { const lat = Number(m[1]), lng = Number(m[2]); if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }; } }
  return null;
}
