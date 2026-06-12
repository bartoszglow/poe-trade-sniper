import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MESSAGES, PLURALS, STORAGE_KEY, detectLanguage, interpolate } from './i18n';
import { I18nContext, type I18nValue, type Language } from './i18n';
import type { PluralForms } from './messages';

/**
 * Provides the i18n context: current language (persisted to localStorage), a
 * setter, and the `t` / `tn` translators. Mounted at the app root in main.tsx.
 * The component lives in its own file (hooks/context are in `i18n.ts`) so React
 * Fast Refresh stays happy.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(detectLanguage);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  // Keep the document lang attribute in sync for a11y.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18nValue>(() => {
    const pluralRules = new Intl.PluralRules(language);
    return {
      language,
      setLanguage,
      t: (key, vars) => interpolate(MESSAGES[language][key], vars),
      tn: (key, count, vars) => {
        const forms = PLURALS[language][key];
        const category: keyof PluralForms = pluralRules.select(count);
        const template = forms[category] ?? forms.other;
        return interpolate(template, { count, ...vars });
      },
    };
  }, [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
