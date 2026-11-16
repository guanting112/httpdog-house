<script setup lang="ts">
// Alerts per hour as a row of bars: 24 of them, the newest on the right.
import { clock, day } from '~/lib/format'

const props = defineProps<{ hours: { hour: number; total: number }[] }>()

const c = useContent()
const peak = computed(() => Math.max(1, ...props.hours.map((slot) => slot.total)))
const label = (hour: number) => `${day(hour * 3600).slice(5)} ${clock(hour * 3600).slice(0, 5)}`
</script>

<template>
  <ol class="bars" :aria-label="c.alerts.barsLabel">
    <li v-for="slot in hours" :key="slot.hour" class="bar" :title="c.alerts.bar(label(slot.hour), slot.total)">
      <!-- an hour with one alert next to an hour with a thousand must still be visible -->
      <i :class="{ none: !slot.total }" :style="{ height: slot.total ? `${Math.max(8, (slot.total / peak) * 100)}%` : undefined }" />
      <span class="sr-only">{{ c.alerts.bar(label(slot.hour), slot.total) }}</span>
    </li>
  </ol>
</template>

<style scoped>
.bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 2.6rem;
  min-width: 0;
}
.bar {
  flex: 1 1 0;
  display: flex;
  align-items: flex-end;
  height: 100%;
  min-width: 3px;
  max-width: 14px;
}
.bar i {
  display: block;
  width: 100%;
  background: var(--amber-soft);
  transition: height 0.4s ease, background 0.15s;
}
.bar:last-child i {
  background: var(--amber);
}
.bar:hover i {
  background: var(--text-strong);
}
.bar i.none {
  height: 1px;
  background: var(--line-strong);
}
</style>
