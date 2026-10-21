import { useEffect, useState } from 'react';

const DOMAIN = 'bwenge.space';
const SITE_URL = 'https://' + DOMAIN;
const NAVY = '#0B1420';
const TEAL = '#0F766E';
const MARGIN = 3;

export function QrCard({ qrTitle }: { qrTitle: string }) {
  const [grid, setGrid] = useState<boolean[][] | null>(null);

  useEffect(() => {
    let alive = true;
    import('qrcode').then((mod: any) => {
      const QR = mod.default ?? mod;
      const qr = QR.create(SITE_URL, { errorCorrectionLevel: 'H' });
      const size: number = qr.modules.size;
      const g: boolean[][] = [];
      for (let r = 0; r < size; r++) {
        const row: boolean[] = [];
        for (let c = 0; c < size; c++) row.push(!!qr.modules.get(r, c));
        g.push(row);
      }
      if (alive) setGrid(g);
    });
    return () => {
      alive = false;
    };
  }, []);

  const n = grid ? grid.length : 0;
  const logo = Math.round(n * 0.21);
  const lo = (n - logo) / 2 - 0.6;
  const hi = (n + logo) / 2 + 0.6;
  const isFinder = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const inLogo = (r: number, c: number) =>
    c + 0.5 > lo && c + 0.5 < hi && r + 0.5 > lo && r + 0.5 < hi;
  const eyes: Array<[number, number]> = [[0, 0], [n - 7, 0], [0, n - 7]];

  return (
    <div className="qr">
      <p>{qrTitle}</p>
      <div className="qr-box">
        {grid && (
          <svg
            viewBox={`${-MARGIN} ${-MARGIN} ${n + MARGIN * 2} ${n + MARGIN * 2}`}
            role="img"
            aria-label={`QR code for ${DOMAIN}`}
          >
            {grid.map((row, r) =>
              row.map((on, c) =>
                on && !isFinder(r, c) && !inLogo(r, c) ? (
                  <rect key={r + '-' + c} x={c} y={r} width={1} height={1} rx={0.3} fill={NAVY} />
                ) : null
              )
            )}
            {eyes.map(([x, y]) => (
              <g key={x + '-' + y}>
                <rect x={x} y={y} width={7} height={7} rx={1.8} fill={TEAL} />
                <rect x={x + 1} y={y + 1} width={5} height={5} rx={1.1} fill="#fff" />
                <rect x={x + 2} y={y + 2} width={3} height={3} rx={0.8} fill={NAVY} />
              </g>
            ))}
            <rect
              x={(n - logo) / 2 - 0.5}
              y={(n - logo) / 2 - 0.5}
              width={logo + 1}
              height={logo + 1}
              rx={1.2}
              fill="#fff"
            />
            <image
              href="/logo/bwenge-icon.svg"
              x={(n - logo) / 2}
              y={(n - logo) / 2}
              width={logo}
              height={logo}
              preserveAspectRatio="xMidYMid meet"
            />
          </svg>
        )}
        <div className="qr-scan" aria-hidden="true" />
      </div>
    </div>
  );
}
