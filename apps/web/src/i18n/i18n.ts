import { createContext, useContext } from 'react';
import {
  EN,
  EN_PLURALS,
  PL,
  PL_PLURALS,
  type MessageKey,
  type PluralForms,
  type PluralKey,
} from './messages';

/** Supported languages — drives the Settings select (open/closed: add a row). */
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'pl', label: 'Polski' },
] as const;

export type Language = (typeof LANGUAGES)[number]['code'];

export const STORAGE_KEY = 'sniper.language';
const DEFAULT_LANGUAGE: Language = 'en';

export const MESSAGES: Record<Language, Record<MessageKey, string>> = { en: EN, pl: PL };
export const PLURALS: Record<Language, Record<PluralKey, PluralForms>> = {
  en: EN_PLURALS,
  pl: PL_PLURALS,
};

type Vars = Record<string, string | number>;

/** Replace {name} placeholders with the provided values. */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function detectLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'pl') return stored;
  return navigator.language.toLowerCase().startsWith('pl') ? 'pl' : DEFAULT_LANGUAGE;
}

/**
 * Translator for code that runs outside the React tree (the SSE hit handler
 * building system notifications). Reads the persisted language directly, so it
 * stays in sync with the provider without a context.
 */
export function translateStatic(key: MessageKey, vars?: Vars): string {
  return interpolate(MESSAGES[detectLanguage()][key], vars);
}

export interface I18nValue {
  language: Language;
  setLanguage: (language: Language) => void;
  /** Translate a singular message key, with optional {placeholder} vars. */
  t: (key: MessageKey, vars?: Vars) => string;
  /** Translate a count-sensitive phrase (correct Polish one/few/many). */
  tn: (key: PluralKey, count: number, vars?: Vars) => string;
}

export const I18nContext = createContext<I18nValue | null>(null);

function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}

/** Singular translator: `const t = useT(); t('settings.title')`. */
export function useT(): I18nValue['t'] {
  return useI18n().t;
}

/** Plural translator: `const tn = useTn(); tn('searches.hitCount', count)`. */
export function useTn(): I18nValue['tn'] {
  return useI18n().tn;
}

/** Current language + setter, for the Settings language select. */
export function useLanguage(): [Language, (language: Language) => void] {
  const { language, setLanguage } = useI18n();
  return [language, setLanguage];
}
