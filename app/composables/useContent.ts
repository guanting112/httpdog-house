// The words of the UI in the reader's language. The choice is remembered in this browser.

import { type Content, en, type Locale } from '~/content/en'
import { zhTw } from '~/content/zh-tw'

const STORAGE_KEY = 'hd_locale'

function remembered(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'zh-tw') return stored
  } catch {
    // storage can be turned off; the browser's language is still a good guess
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-tw' : 'en'
}

export function useLocale() {
  const locale = useState<Locale>('locale', remembered)
  function setLocale(next: Locale) {
    locale.value = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // not remembered, but it still applies until the page is closed
    }
  }
  return { locale, setLocale }
}

export function useContent(): ComputedRef<Content> {
  const { locale } = useLocale()
  return computed(() => (locale.value === 'zh-tw' ? zhTw : en))
}
