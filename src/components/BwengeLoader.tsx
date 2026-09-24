import React from 'react';

interface BwengeLoaderProps {
  variant?: 'compact' | 'banner';
  message?: string;
  label?: string;
  className?: string;
}

export const BwengeLoader: React.FC<BwengeLoaderProps> = ({
  variant = 'compact',
  message,
  label,
  className = ""
}) => {
  const size = variant === 'compact' ? 32 : 220;
  const isCompact = variant === 'compact';
  const displayMessage = message || label;

  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes eyeMove {
          0%, 10%   { transform: translateX(0) scale(1); }
          20%       { transform: translateX(-14px) scale(1); }
          33%       { transform: translateX(14px) scale(1); }
          46%, 63%  { transform: translateX(0) scale(1); }
          80%       { transform: translateX(0) scale(1.16); }
          92%, 100% { transform: translateX(0) scale(1); }
        }
        @keyframes wingPulse {
          0%, 46%  { opacity: 1; transform: scale(1); }
          55%, 71% { opacity: .72; transform: scale(1.04); }
          80%      { opacity: 1; transform: scale(1.1); }
          100%     { opacity: 1; transform: scale(1); }
        }
        @keyframes badgeBreathe {
          0%, 46%  { transform: scale(1); }
          55%, 71% { transform: scale(.98); }
          80%      { transform: scale(1.03); }
          100%     { transform: scale(1); }
        }

        .bwenge-loader .eyes {
          animation: eyeMove ${isCompact ? '2.4s' : '6s'} ease-in-out infinite;
          transform-origin: 340px 170px;
        }
        .bwenge-loader .wing {
          animation: wingPulse ${isCompact ? '2.4s' : '6s'} ease-in-out infinite;
          transform-origin: 340px 170px;
        }
        .bwenge-loader .badge {
          animation: badgeBreathe ${isCompact ? '2.4s' : '6s'} ease-in-out infinite;
          transform-origin: 340px 170px;
        }
      `}} />

      <svg
        className="bwenge-loader"
        width={size}
        height={size}
        viewBox="0 0 680 340"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
      >
        <title>Bwenge is thinking</title>
        <g className="badge"><circle cx="340" cy="170" r="130" fill="#0D2B24"/></g>
        <g className="wing"><path d="M 281 208 Q 340 273 399 208 Q 399 244 340 268 Q 281 244 281 208 Z" fill="#9FE1CB"/></g>
        <g className="eyes">
          <circle cx="302" cy="158" r="30.7" fill="#5DCAA5"/>
          <circle cx="378" cy="158" r="30.7" fill="#5DCAA5"/>
          <circle cx="302" cy="158" r="11.8" fill="#0D2B24"/>
          <circle cx="378" cy="158" r="11.8" fill="#0D2B24"/>
        </g>
      </svg>

      {displayMessage && (
        <span className={`${isCompact ? 'text-sm' : 'text-lg font-bold'} text-[#858075] dark:text-[#A0A0AA] animate-pulse`}>
          {displayMessage}
        </span>
      )}
    </div>
  );
};

export default BwengeLoader;
