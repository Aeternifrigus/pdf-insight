import { useI18n } from '../i18n/context';
import { LANGS } from '../i18n/messages';

export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label={t.interfaceLanguage}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={lang === l}
          className={lang === l ? 'is-active' : undefined}
          onClick={() => {
            setLang(l);
          }}
        >
          <span aria-hidden="true">{l.toUpperCase()}</span>
          <span className="visually-hidden">{t.languageNames[l]}</span>
        </button>
      ))}
    </div>
  );
}
