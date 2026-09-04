import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { Language, LANGUAGES } from './types';
import en from './locales/en';

type Translations = typeof en;

const loaders: Record<Language, () => Promise<{ default: Translations }>> = {
  en: () => Promise.resolve({ default: en }),
  es: () => import('./locales/es'),
  zh: () => import('./locales/zh'),
  fr: () => import('./locales/fr'),
  de: () => import('./locales/de'),
  pt: () => import('./locales/pt'),
  ja: () => import('./locales/ja'),
  ko: () => import('./locales/ko'),
  it: () => import('./locales/it'),
  hi: () => import('./locales/hi'),
};

const cache = new Map<Language, Translations>();
cache.set('en', en);

const dateLocaleMap: Record<Language, string> = {
  en: 'en-US', es: 'es-ES', zh: 'zh-CN', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR', ja: 'ja-JP', ko: 'ko-KR', it: 'it-IT', hi: 'hi-IN',
};

const STORAGE_KEY = 'employee_language';

function getInitialLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && stored in loaders) {
    return stored as Language;
  }
  return 'en';
}

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: Translations;
  dateLocale: string;
}

const LanguageContext = createContext<LanguageContextType | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);
  const [translations, setTranslations] = useState<Translations>(cache.get(language) || en);

  useEffect(() => {
    const cached = cache.get(language);
    if (cached) {
      setTranslations(cached);
      return;
    }
    loaders[language]().then((mod) => {
      cache.set(language, mod.default);
      setTranslations(mod.default);
    });
  }, [language]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
  }, []);

  const dateLocale = dateLocaleMap[language];

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t: translations, dateLocale }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextType {
  const context = useContext(LanguageContext);
  if (!context) {
    return { language: 'en', setLanguage: () => {}, t: en, dateLocale: 'en-US' };
  }
  return context;
}

export { LANGUAGES };
export type { Language };
