import React from 'react';
import logoUrl from '../assets/bwenge-logo.svg';

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
  className = '',
}) => {
  const isBanner = variant === 'banner';
  const displayMessage = message || label;

  return (
    <div
      className={`bwenge-loader flex flex-col items-center justify-center gap-3 ${className}`}
      role="status"
      aria-label={displayMessage || 'Bwenge is working'}
      aria-live="polite"
      aria-busy="true"
    >
      <div className={`bwenge-loader__mark ${isBanner ? 'bwenge-loader__mark--large' : ''}`} aria-hidden="true">
        <span className="bwenge-loader__orbit bwenge-loader__orbit--outer" />
        <span className="bwenge-loader__orbit bwenge-loader__orbit--inner" />
        <img src={logoUrl} alt="" className="bwenge-loader__logo" />
      </div>
      {displayMessage && <span className={`bwenge-loader__message ${isBanner ? 'text-sm' : 'text-xs'}`}>{displayMessage}</span>}
    </div>
  );
};

export default BwengeLoader;
