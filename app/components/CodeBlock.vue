<script setup lang="ts">
// A block of code or program output under an optional title bar, with a copy button.
import { highlight, type Lang } from '~/lib/highlight'

const props = defineProps<{
  code: string
  lang: Lang
  name?: string
  /** What the copy button copies, when it is not the text shown (a hidden secret, for one) */
  copyText?: string
  /** Long lines wrap instead of scrolling sideways */
  wrap?: boolean
  /** Taller than this many lines scrolls inside the block */
  maxLines?: number
}>()

const lines = computed(() => highlight(props.code, props.lang))
</script>

<template>
  <figure class="block">
    <figcaption class="block-bar">
      <span class="block-name">{{ name }}</span>
      <CopyButton :text="copyText ?? code" />
    </figcaption>
    <pre class="block-pre" :class="{ wrap }" :style="maxLines ? { maxHeight: `${maxLines * 1.55 + 2}em` } : undefined" tabindex="0"><CodeLines :lines="lines" /></pre>
  </figure>
</template>

<style scoped>
.block {
  border: 1px solid var(--line);
  background: var(--bg-inset);
  min-width: 0;
}
.block-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.38rem 0.9rem 0.34rem 1rem;
  border-bottom: 1px solid var(--line);
  font-size: 0.78rem;
  color: var(--dim);
}
.block-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.block-pre {
  margin: 0;
  padding: 0.8rem 1rem 0.9rem;
  overflow: auto;
  font-size: 0.86rem;
  line-height: 1.55;
  color: var(--text);
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}
.block-pre.wrap {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
