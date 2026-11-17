<script setup lang="ts">
// Dark or light, as one button with an icon. Like a light switch, the icon is what a press gives:
// a sun while the page is dark, a moon while it is light. The words are there for a screen reader
// and as a tooltip.
const c = useContent()
const { theme, toggleTheme } = useTheme()

const next = computed(() => (theme.value === 'dark' ? 'light' : 'dark'))
const label = computed(() => `${c.value.theme.label}: ${c.value.theme[next.value]}`)
</script>

<template>
  <button type="button" class="theme-toggle" :aria-label="label" :title="label" @click="toggleTheme">
    <!-- The icons are drawn here, not loaded: nothing to fetch, and they take the text's colour -->
    <svg v-if="next === 'light'" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </svg>
    <svg v-else viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </svg>
  </button>
</template>

<style scoped>
.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* large enough to press with a finger, without making the bar taller */
  width: 1.9em;
  height: 1.9em;
  color: var(--dim);
  transition: color 0.15s;
}
.theme-toggle:hover {
  color: var(--amber);
}
svg {
  width: 1.2em;
  height: 1.2em;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: square;
  stroke-linejoin: miter;
}
</style>
