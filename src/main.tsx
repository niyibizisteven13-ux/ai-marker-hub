import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
// Self-hosted fonts (no third-party requests): Plus Jakarta Sans for the interface, Bricolage Grotesque for headings, JetBrains Mono for codes.
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/jetbrains-mono';
import App from './App.tsx';
import PlatformNotice from './components/PlatformNotice';
import UpgradeDialog from './components/UpgradeDialog';
import AppLock from './components/AppLock';
import UpdateBanner from './components/UpdateBanner';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <PlatformNotice />
    <UpgradeDialog />
    <AppLock />
    <UpdateBanner />
  </StrictMode>,
);

// Save the public shell and resources already loaded on a first visit.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').then(async () => {
      if (!['/', '/research', '/get-app'].includes(location.pathname)) return;
      const worker = (await navigator.serviceWorker.ready).active;
      const assets = performance.getEntriesByType('resource').map(entry => new URL(entry.name))
        .filter(url => url.origin === location.origin && url.pathname.startsWith('/assets/')).map(url => url.pathname);
      worker?.postMessage({ type: 'WARM_PUBLIC_OFFLINE', assets: [...new Set(assets)] });
    }).catch(() => undefined);
  }, { once: true });
}
