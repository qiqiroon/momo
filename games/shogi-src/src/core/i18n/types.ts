export type LocaleCode = string;

export type TranslationMap = Record<string, string>;

export interface LocaleData {
  code: LocaleCode;
  name: string;
  translations: TranslationMap;
}
