import { createContext, useContext } from 'react';
import { LOCALES, MESSAGES, type Lang, type Messages } from './messages';

export interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Messages;
  locale: string;
}

export const I18nContext = createContext<I18n>({
  lang: 'pl',
  setLang: () => undefined,
  t: MESSAGES.pl,
  locale: LOCALES.pl,
});

export function useI18n(): I18n {
  return useContext(I18nContext);
}

export const LANG_KEY = 'pdf-insight:lang';

/** Domyślnie polski (brief wymaga komunikatów po polsku); wybór użytkownika jest zapamiętywany. */
export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    return saved === 'en' || saved === 'pl' ? saved : 'pl';
  } catch {
    return 'pl';
  }
}
