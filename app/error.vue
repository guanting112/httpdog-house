<script setup lang="ts">
// Shown for an address the app does not have, and when a page fails to render.
import type { NuxtError } from '#app'
import { DOG_ART } from '~/content/art'

const props = defineProps<{ error: NuxtError }>()

const c = useContent()
const route = useRoute()
const status = computed(() => props.error?.statusCode ?? 404)
const missing = computed(() => status.value === 404)

useHead({ title: () => `${status.value} | httpdog house`, htmlAttrs: { lang: () => c.value.lang } })
</script>

<template>
  <main class="lost">
    <pre class="art" aria-hidden="true">{{ DOG_ART }}</pre>
    <div>
      <p class="line"><span class="amber">&gt;</span> GET {{ route.path }} <span class="red">{{ status }}</span></p>
      <h1>{{ missing ? c.notFound.title : c.notFound.broken }}</h1>
      <p class="body">{{ missing ? c.notFound.body : c.notFound.brokenBody }}</p>
      <a class="btn btn--primary" href="/" @click.prevent="clearError({ redirect: '/' })">{{ c.notFound.home }}</a>
    </div>
  </main>
</template>

<style scoped>
.lost {
  min-height: 100svh;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: clamp(1.5rem, 6vw, 4rem);
  padding: 2rem var(--gutter);
  background: radial-gradient(50% 60% at 50% 50%, rgba(var(--amber-rgb), 0.06), transparent 70%);
}
.art {
  font-size: 0.88rem;
  line-height: 0.92;
  font-weight: 700;
  color: var(--amber);
  text-shadow: 0 0 10px rgba(var(--amber-rgb), calc(0.5 * var(--glow)));
  user-select: none;
}
.line {
  font-size: 0.9rem;
  color: var(--dim);
  overflow-wrap: anywhere;
}
h1 {
  margin-top: 0.6rem;
  font-size: clamp(1.6rem, 4vw, 2.3rem);
  line-height: 1.15;
  letter-spacing: -0.03em;
  color: var(--text-strong);
}
.body {
  margin: 0.8rem 0 1.8rem;
  color: var(--dim);
}
</style>
