import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
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

// Makes Bwenge installable (Install button on Android, Windows, Mac and Linux). The worker caches nothing; see public/sw.js.
if (import.meta.env.PROD && 'serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
