import { useState, useEffect, useCallback } from 'react';
import { dictionaries, Lang } from './landing';

export function useLang() {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem('bwenge-lang');
      if (saved && (saved === 'en' || saved === 'rw' || saved === 'fr')) {
        return saved as Lang;
      }
    } catch {}
    return 'en';
  });

  useEffect(() => {
    try {
      localStorage.setItem('bwenge-lang', lang);
    } catch {}
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
  }, []);

  const t = useCallback(
    (key: keyof typeof dictionaries['en'], params?: Record<string, string | number>) => {
      const dict = dictionaries[lang] || dictionaries.en;
      let text = (dict as any)[key] || (dictionaries.en as any)[key] || key;
      if (params) {
        Object.entries(params).forEach(([k, val]) => {
          text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(val));
        });
      }
      return text;
    },
    [lang]
  );

  return { lang, setLang, t };
}
