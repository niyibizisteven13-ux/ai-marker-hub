import { Lang } from '../i18n/landing';

export function LanguageSwitcher({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="seg" role="group" aria-label="Language">
      <button type="button" data-lang="en" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
        EN
      </button>
      <button type="button" data-lang="rw" aria-pressed={lang === 'rw'} onClick={() => setLang('rw')}>
        RW
      </button>
      <button type="button" data-lang="fr" aria-pressed={lang === 'fr'} onClick={() => setLang('fr')}>
        FR
      </button>
    </div>
  );
}
