// The languages the UI has, as the language menu lists them. Each is named in its own language
// and never translated: someone who cannot read the page as it is still finds their own.

import type { Locale } from './en'

export interface Language {
  locale: Locale
  /** Its own name */
  label: string
  /** The value of `lang` for that name, so a screen reader says it right */
  lang: string
}

export const LANGUAGES: Language[] = [
  { locale: 'en', label: 'English', lang: 'en' },
  { locale: 'zh-tw', label: '繁體中文', lang: 'zh-Hant-TW' },
]
