<script setup lang="ts">
const c = useContent()
useHead({ htmlAttrs: { lang: () => c.value.lang } })
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>
