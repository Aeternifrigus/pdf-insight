import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { I18nContext, initialLang, LANG_KEY } from './context';
import { LOCALES, MESSAGES, type Lang } from './messages';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    // Domyślne komunikaty walidacji Zod (np. w „Szczegółach technicznych”) w języku interfejsu.
    z.config(lang === 'pl' ? z.locales.pl() : z.locales.en());
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* brak dostępu do pamięci: wybór działa do końca sesji */
    }
  }, []);

  const value = useMemo(
    () => ({ lang, setLang, t: MESSAGES[lang], locale: LOCALES[lang] }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
