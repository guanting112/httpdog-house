// Dark or light. The choice is remembered in this browser; until one is made, the page follows
// the system's setting.
//
// The attribute that switches the colours (<html data-theme>, see main.css) is first set by the
// small script in nuxt.config.ts, before anything is drawn. This composable takes over from there.

export type Theme = 'dark' | 'light'

/** The same key the script in nuxt.config.ts reads */
const STORAGE_KEY = 'hd_theme'

function initial(): Theme {
  const set = document.documentElement.dataset.theme
  if (set === 'dark' || set === 'light') return set
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function useTheme() {
  const theme = useState<Theme>('theme', initial)

  function setTheme(next: Theme) {
    theme.value = next
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // not remembered, but it still applies until the page is closed
    }
  }

  return { theme, setTheme, toggleTheme: () => setTheme(theme.value === 'dark' ? 'light' : 'dark') }
}
