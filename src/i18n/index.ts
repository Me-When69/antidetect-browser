import type { LocaleCode } from '@shared/types';
import { vi, type TranslationDictionary } from './vi';
import { en } from './en';

const dictionaries: Record<LocaleCode, TranslationDictionary> = {
  vi,
  en,
};

export function getTranslations(locale: LocaleCode = 'vi'): TranslationDictionary {
  return dictionaries[locale] ?? vi;
}

export const t = getTranslations('vi');
export type { TranslationDictionary };
