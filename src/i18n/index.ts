import { vi, type TranslationDictionary } from './vi';

export type Locale = 'vi';

const dictionaries: Record<Locale, TranslationDictionary> = {
  vi,
};

export function getTranslations(locale: Locale = 'vi'): TranslationDictionary {
  return dictionaries[locale];
}

export const t = getTranslations('vi');
