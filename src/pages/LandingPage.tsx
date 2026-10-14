import { useEffect } from 'react';
import '../styles/landing.css';
import { useLang } from '../i18n/useLang';
import { useTheme } from '../hooks/useTheme';
import { BrandLogo } from '../components/BrandLogo';
import { LogoHeroOutline } from '../components/LogoHeroOutline';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ThemeToggle } from '../components/ThemeToggle';
import { AuthFlow } from '../components/AuthFlow';
import { NewAccountBlock } from '../components/NewAccountBlock';
import { FeatureChips } from '../components/FeatureChips';
import { QrCard } from '../components/QrCard';

export default function LandingPage({ onLoginSuccess }: { onLoginSuccess: (user?: any) => void }) {
  const { lang, setLang, t } = useLang();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    document.title = 'Bwenge — Sign in';
  }, []);

  return (
    <>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="goldGrad" x1="10%" y1="0%" x2="90%" y2="100%">
            <stop offset="0%" stopColor="#F6B94A" />
            <stop offset="100%" stopColor="#E08C1E" />
          </linearGradient>
          <linearGradient id="tealGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4CE5D6" />
            <stop offset="100%" stopColor="#1FB3A6" />
          </linearGradient>
        </defs>
      </svg>
      <div className="page">
        <main className="left">
          <div className="top">
            <div className="brand">
              <BrandLogo />
              <div>
                <b>Bwenge</b>
                <span>{t('tag')}</span>
              </div>
            </div>
            <div className="ctrls">
              <LanguageSwitcher lang={lang} setLang={setLang} />
              <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
            </div>
          </div>

          <div className="mid">
            <h1>
              <span>{t('h1a')}</span>
              <br />
              <em>{t('h1b')}</em>
            </h1>
            <p className="sub">{t('sub')}</p>

            <AuthFlow
              t={t}
              onLoginSuccess={onLoginSuccess}
              onCreateAccount={() => {
                window.history.pushState({}, '', '/signup');
                window.dispatchEvent(new Event('open-signup-modal'));
              }}
              onTerms={() => {
                window.location.href = '/terms';
              }}
              onPrivacy={() => {
                window.location.href = '/privacy';
              }}
            />

            <NewAccountBlock
              title={t('newh')}
              createText={t('create')}
              onCreate={() => {
                window.history.pushState({}, '', '/signup');
                window.dispatchEvent(new Event('open-signup-modal'));
              }}
            />
          </div>

          <div className="foot">
            <a href="/about" onClick={(e) => { e.preventDefault(); window.location.href = '/about'; }}>
              {t('about')}
            </a>
            <a href="mailto:support@bwenge.space?subject=Support%20Ticket%20-%20Bwenge%20AI%20Studio" onClick={(e) => { e.preventDefault(); window.location.href = 'mailto:support@bwenge.space?subject=Support%20Ticket%20-%20Bwenge%20AI%20Studio'; }}>
              {t('help')}
            </a>
            <a href="/terms" onClick={(e) => { e.preventDefault(); window.location.href = '/terms'; }}>
              {t('terms2')}
            </a>
            <a href="/privacy" onClick={(e) => { e.preventDefault(); window.location.href = '/privacy'; }}>
              {t('privacy2')}
            </a>
            <span>© 2026 Bwenge</span>
          </div>
        </main>

        <aside className="hero" aria-hidden="true">
          <LogoHeroOutline />
          <FeatureChips c1={t('c1')} c2={t('c2')} c3={t('c3')} />
          <QrCard qrTitle={t('qr')} />
        </aside>
      </div>
    </>
  );
}
