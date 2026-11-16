import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import PlatformNotice from './components/PlatformNotice';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <PlatformNotice />
  </StrictMode>,
);
