<script setup lang="ts">
// Renders highlighted code: one element per line, one <span> per token.
import type { Token } from '~/lib/highlight'

defineProps<{ lines: Token[][] }>()
</script>

<template>
  <code class="code-lines"><span v-for="(line, i) in lines" :key="i" class="code-line"><span v-for="(tk, j) in line" :key="j" :class="tk.t ? `tk-${tk.t}` : undefined">{{ tk.s }}</span>{{ '\n' }}</span></code>
</template>

<style scoped>
.code-lines {
  display: block;
}
.code-line {
  display: block;
  min-height: 1.55em;
}
</style>
