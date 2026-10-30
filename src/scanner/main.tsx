import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import TelegramScanApp from './TelegramScanApp';
import TelegramMarkApp from './TelegramMarkApp';
import '../index.css';

// scanner.html?mode=mark is the Mark app (scheme, students, Mark); otherwise the plain scanner.
const markMode = new URLSearchParams(window.location.search).get('mode') === 'mark';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {markMode ? <TelegramMarkApp /> : <TelegramScanApp />}
  </StrictMode>,
);
