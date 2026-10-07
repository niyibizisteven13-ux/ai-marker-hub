import { useEffect } from 'react';

export function useVisualViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const updateHeight = () => {
      if (vv.scale > 1) return;
      if (vv.offsetTop !== 0) {
        window.scrollTo(0, 0);
      }
      document.documentElement.style.setProperty('--app-h', `${vv.height}px`);
    };

    vv.addEventListener('resize', updateHeight);
    vv.addEventListener('scroll', updateHeight);
    updateHeight();

    return () => {
      vv.removeEventListener('resize', updateHeight);
      vv.removeEventListener('scroll', updateHeight);
      document.documentElement.style.removeProperty('--app-h');
    };
  }, []);
}
