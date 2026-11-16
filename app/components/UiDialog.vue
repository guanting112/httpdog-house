<script setup lang="ts">
// A dialog over the page, built on the browser's own <dialog>: it keeps the focus inside, closes
// on Escape and dims what is behind it. It does not close on a click outside, so a half-filled
// form is not lost to a stray click.
const props = defineProps<{ open: boolean; name: string }>()
const emit = defineEmits<{ close: [] }>()

const c = useContent()
const dialog = ref<HTMLDialogElement>()

function sync() {
  const el = dialog.value
  if (!el) return
  if (props.open && !el.open) el.showModal()
  if (!props.open && el.open) el.close()
}
watch(() => props.open, sync, { flush: 'post' })
onMounted(sync)
</script>

<template>
  <!-- `close` fires for Escape too, so the parent's `open` always follows what the reader did -->
  <dialog ref="dialog" class="dialog" @close="emit('close')">
    <div v-if="open" class="panel">
      <header class="panel-bar">
        <span class="panel-name">{{ name }}</span>
        <button type="button" class="act" @click="emit('close')">{{ c.common.close }}</button>
      </header>
      <div class="dialog-body">
        <slot />
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.dialog {
  width: min(44rem, calc(100vw - 2 * var(--gutter)));
  max-height: calc(100dvh - 2rem);
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  overflow: auto;
}
.dialog::backdrop {
  background: rgba(3, 4, 6, 0.78);
  backdrop-filter: blur(2px);
}
.panel {
  border-color: var(--line-strong);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
}
.dialog-body {
  padding: 1.2rem 1.2rem 1.3rem;
}
</style>
