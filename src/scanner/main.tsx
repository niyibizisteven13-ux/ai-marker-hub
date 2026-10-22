import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import TelegramScanApp from './TelegramScanApp';
import '../index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TelegramScanApp />
  </StrictMode>,
);
