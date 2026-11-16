<script setup lang="ts">
// [ copy ]: puts a text on the clipboard and says so for a moment.
const props = defineProps<{ text: string; label?: string }>()

const c = useContent()
const done = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

async function copy() {
  try {
    await navigator.clipboard.writeText(props.text)
    done.value = true
    clearTimeout(timer)
    timer = setTimeout(() => (done.value = false), 1600)
  } catch {
    // clipboard access can be refused; the text is still there to select
  }
}
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <button type="button" class="act" :class="{ 'act--done': done }" @click="copy">
    {{ done ? c.common.copied : (label ?? c.common.copy) }}
  </button>
</template>
