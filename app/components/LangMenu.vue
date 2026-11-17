<script setup lang="ts">
// The language, as a menu. The browser's own <select>: it works with a keyboard, a screen reader
// and a phone's picker without anything written here.
import { LANGUAGES } from '~/content/languages'

const c = useContent()
const { locale, setLocale } = useLocale()

function pick(event: Event) {
  const chosen = LANGUAGES.find((language) => language.locale === (event.target as HTMLSelectElement).value)
  if (chosen) setLocale(chosen.locale)
}
</script>

<template>
  <select class="lang-menu" :value="locale" :aria-label="c.language" :title="c.language" @change="pick">
    <option v-for="language in LANGUAGES" :key="language.locale" :value="language.locale" :lang="language.lang">{{ language.label }}</option>
  </select>
</template>

<style scoped>
.lang-menu {
  appearance: none;
  max-width: 100%;
  padding: 0.2em 1.5em 0.2em 0.55em;
  border: 1px solid var(--line-strong);
  border-radius: 0;
  background-color: transparent;
  color: var(--dim);
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s;
  /* the arrow is two small triangles drawn with gradients, as on the other menus (select.input) */
  background-image:
    linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position:
    calc(100% - 0.8em) 55%,
    calc(100% - 0.5em) 55%;
  background-size:
    0.3em 0.3em,
    0.3em 0.3em;
  background-repeat: no-repeat;
}
.lang-menu:hover,
.lang-menu:focus-visible {
  color: var(--amber);
  border-color: var(--amber);
}
/* where the list is drawn by the page rather than by the system, it follows the theme */
.lang-menu option {
  background: var(--bg-inset);
  color: var(--text);
}
</style>
