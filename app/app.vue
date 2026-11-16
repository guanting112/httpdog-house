<script setup lang="ts">
const c = useContent()
const { theme } = useTheme()

useHead({
  htmlAttrs: { lang: () => c.value.lang, 'data-theme': () => theme.value },
  meta: [
    // the colour the browser paints its own bars with: the page background of each theme (main.css)
    { name: 'theme-color', content: () => (theme.value === 'light' ? '#f6f4ee' : '#06080c') },
    { name: 'color-scheme', content: () => theme.value },
  ],
})
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>
