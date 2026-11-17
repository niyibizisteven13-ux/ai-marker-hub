import { useId } from 'react';

/**
 * Landing banner: an owner tells Bwenge what they sold in a chat, the dashboard counts it and the sales line climbs, and the business page
 * with its Order button goes live. Pure SVG + CSS (see .gb-* in landing.css): no script, one 12 s loop, the finished frame for visitors who
 * prefer reduced motion. A three-step tracker under the drawing follows along.
 */
export function GrowthBanner({ labels, className = '' }: { labels: Record<'s1' | 's2' | 's3' | 'gUser' | 'gReply' | 'gSales' | 'gProfit' | 'gOrder' | 'gShop', string>; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <div className={`smb gb ${className}`}>
      <svg viewBox="0 0 520 330" role="presentation" aria-hidden="true">
        <defs>
          <linearGradient id={`gbl-${id}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="var(--teal)" /><stop offset="1" stopColor="var(--accent)" /></linearGradient>
          <linearGradient id={`gba-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".35" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient>
        </defs>
        {/* phone with the chat */}
        <g className="gb-in gb-t0">
          <rect x="14" y="14" width="170" height="302" rx="26" fill="#0F1A27" stroke="#2A3B50" strokeWidth="1.5" />
          <rect x="72" y="22" width="54" height="6" rx="3" fill="#2A3B50" />
        </g>
        <g className="gb-in gb-t1"><rect x="40" y="70" width="136" height="44" rx="14" fill="var(--accent)" /><text x="108" y="97" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="#1A1405">{labels.gUser}</text></g>
        <g className="gb-in gb-t2"><rect x="24" y="130" width="152" height="44" rx="14" fill="#1E2D40" /><text x="100" y="157" textAnchor="middle" fontSize="11.5" fontWeight="600" fill="#EAF0F6">{labels.gReply}</text></g>
                <g className="gb-in gb-t2"><rect x="24" y="270" width="136" height="30" rx="15" fill="none" stroke="#2A3B50" /><circle cx="40" cy="285" r="3" fill="#9AA8B8" /><circle cx="52" cy="285" r="3" fill="#9AA8B8" opacity=".6" /><circle cx="64" cy="285" r="3" fill="#9AA8B8" opacity=".3" /></g>
        {/* the flow */}
        <path className="gb-flow gb-t2" d="M190 150 C 205 150 205 95 222 95" fill="none" stroke={`url(#gbl-${id})`} strokeWidth="2" strokeDasharray="4 5" />
        <path className="gb-flow gb-t4" d="M360 178 C 360 190 360 190 360 198" fill="none" stroke={`url(#gbl-${id})`} strokeWidth="2" strokeDasharray="4 5" />
        {/* dashboard */}
        <g className="gb-in gb-t3">
          <rect x="222" y="14" width="284" height="164" rx="18" fill="#0F1A27" stroke="#2A3B50" strokeWidth="1.5" />
          <text x="240" y="40" fontSize="12" fontWeight="600" fill="#9AA8B8">{labels.gSales}</text>
          <text x="240" y="64" fontSize="19" fontWeight="800" fill="#EAF0F6">RWF 1,250,000</text>
          <rect x="400" y="46" width="84" height="22" rx="11" fill="var(--teal)" opacity=".18" /><text x="442" y="61.5" textAnchor="middle" fontSize="11.5" fontWeight="700" fill="var(--teal)">▲ 12.4%</text>
          <path d="M240 150 L276 134 L312 140 L348 118 L384 124 L420 98 L456 90 L488 76 L488 160 L240 160 Z" fill={`url(#gba-${id})`} />
          <path className="gb-draw" pathLength={1} d="M240 150 L276 134 L312 140 L348 118 L384 124 L420 98 L456 90 L488 76" fill="none" stroke={`url(#gbl-${id})`} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <circle className="gb-dot" cx="488" cy="76" r="5" fill="var(--accent)" stroke="#0F1A27" strokeWidth="2" />
          <text x="240" y="172" fontSize="10.5" fill="#9AA8B8">{labels.gProfit}</text>
        </g>
        {/* the business page */}
        <g className="gb-in gb-t5">
          <rect x="222" y="200" width="284" height="116" rx="18" fill="#0F1A27" stroke="#2A3B50" strokeWidth="1.5" />
          <rect x="236" y="212" width="256" height="34" rx="10" fill="var(--accent)" opacity=".85" />
          <circle cx="254" cy="246" r="14" fill="var(--teal)" stroke="#0F1A27" strokeWidth="3" />
          <text x="278" y="238" fontSize="13" fontWeight="800" fill="#EAF0F6" style={{ transform: 'translateY(22px)' }}>{labels.gShop}</text>
          <rect x="236" y="276" width="70" height="28" rx="9" fill="#1E2D40" /><rect x="312" y="276" width="70" height="28" rx="9" fill="#1E2D40" />
          <rect x="400" y="276" width="92" height="28" rx="14" fill="var(--accent)" /><text x="446" y="294.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="#1A1405">{labels.gOrder}</text>
          <path className="gb-heart" d="M372 262c-4-5-12-2-9 4 2 3 9 8 9 8s7-5 9-8c3-6-5-9-9-4z" transform="translate(-14 -10) scale(1)" fill="#E11D48" />
        </g>
      </svg>
      <ol className="smb-steps gb-steps">{(['s1', 's2', 's3'] as const).map((k, i) => <li key={k} className={`gb-step gb-s${i}`}><span><em>{i + 1}</em>{labels[k]}</span><i><b /></i></li>)}</ol>
    </div>
  );
}
