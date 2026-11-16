// The words of the UI. English unless the reader picks Chinese; the choice is remembered in this
// browser. The browser's own language is not consulted: the UI starts the same for everyone.

import { type Content, en, type Locale } from '~/content/en'
import { zhTw } from '~/content/zh-tw'

const STORAGE_KEY = 'hd_locale'

function remembered(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'zh-tw') return stored
  } catch {
    // storage can be turned off; the default still applies
  }
  return 'en'
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
