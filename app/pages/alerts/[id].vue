<script setup lang="ts">
// One alert on its own page, so that it has an address to send to someone.
const c = useContent()
const route = useRoute()

const id = computed(() => Number(route.params.id))
const valid = computed(() => Number.isSafeInteger(id.value) && id.value > 0)

useHead({ title: () => `${c.value.detail.title(id.value)} | httpdog house` })
</script>

<template>
  <div>
    <div class="page-head">
      <h1 class="page-title">{{ valid ? c.detail.title(id) : c.notFound.title }}</h1>
      <NuxtLink class="act" to="/">{{ c.common.back }}</NuxtLink>
    </div>
    <section v-if="valid" class="panel">
      <div class="panel-body">
        <AlertDetail :id="id" standalone />
      </div>
    </section>
    <p v-else class="say say--error">{{ c.detail.notFound }}</p>
  </div>
</template>
