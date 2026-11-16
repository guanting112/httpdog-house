<script setup lang="ts">
// What the receiver turned away, and for each reason what to check. This is where "httpdog says
// 401, why?" gets its answer.
import type { RejectionRow } from '#shared/api'
import { clock, day, stamp } from '~/lib/format'

const c = useContent()
const api = useApi()
const now = useNow()

useHead({ title: () => `${c.value.rejected.title} | httpdog house` })

const items = ref<RejectionRow[] | null>(null)
const error = ref('')
const busy = ref(false)

async function load() {
  error.value = ''
  try {
    items.value = (await api<{ items: RejectionRow[] }>('/api/admin/rejections')).items
  } catch (cause) {
    error.value = explain(cause as ApiFailure, c.value)
  }
}
onMounted(load)

async function clear() {
  busy.value = true
  try {
    await api('/api/admin/rejections', { method: 'DELETE' })
    items.value = []
  } catch (cause) {
    error.value = explain(cause as ApiFailure, c.value)
  } finally {
    busy.value = false
  }
}

// A misconfigured httpdog tries each alert 3 times, and keeps trying with every new alert, so the
// same refusal arrives many times over. Rows that differ only in their time are shown as one
interface Group {
  key: string
  /** The newest of them */
  row: RejectionRow
  count: number
  firstAt: number
}
const groups = computed(() => {
  const out: Group[] = []
  for (const row of items.value ?? []) {
    const key = JSON.stringify([row.reason, row.instance, row.ip, row.detail])
    const last = out[out.length - 1]
    if (last?.key === key) {
      last.count++
      last.firstAt = row.at
    } else {
      out.push({ key, row, count: 1, firstAt: row.at })
    }
  }
  return out
})
/** A time of day, with the date only when it is not the same day as `other` */
const since = (at: number, other: number) => (day(at) === day(other) ? clock(at) : stamp(at))

// A reason this version of the UI does not know is still shown, by its own name
const reason = (row: RejectionRow) => c.value.rejected.reasons[row.reason] ?? { name: row.reason, help: '' }
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ c.rejected.title }}</h1>
        <p class="page-lead">{{ c.rejected.lead }}</p>
      </div>
      <div class="acts">
        <button type="button" class="act" @click="load">{{ c.common.refresh }}</button>
        <button v-if="items?.length" type="button" class="act act--danger" :disabled="busy" @click="clear">{{ c.rejected.clear }}</button>
      </div>
    </div>

    <p v-if="error" class="say say--error" role="alert">{{ error }}</p>
    <p v-else-if="!items" class="dim">{{ c.common.loading }}</p>
    <div v-else-if="!items.length" class="panel empty">{{ c.rejected.empty }}</div>

    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th scope="col">{{ c.rejected.columns.time }}</th>
            <th scope="col">{{ c.rejected.columns.reason }}</th>
            <th scope="col">{{ c.rejected.columns.instance }}</th>
            <th scope="col">{{ c.rejected.columns.from }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="{ row, count, firstAt } in groups" :key="row.id">
            <td class="nowrap">
              <span class="num">{{ stamp(row.at) }}</span><br>
              <span class="dim">{{ c.ago(Math.max(0, now - row.at)) }}</span>
              <template v-if="count > 1">
                <br><span class="amber">{{ c.rejected.times(count) }}</span> <span class="dim">{{ c.rejected.since(since(firstAt, row.at)) }}</span>
              </template>
            </td>
            <td class="why">
              <span class="red">{{ reason(row).name }}</span>
              <p class="dim">{{ reason(row).help }}</p>
              <p v-if="row.detail" class="faint">{{ row.detail }}</p>
            </td>
            <td>
              <template v-if="row.instance !== null">
                <span class="strong">{{ row.instance }}</span>
                <template v-if="row.reason === 'unknown_instance'">
                  <br><NuxtLink class="act" :to="{ path: '/keys', query: { add: row.instance } }">{{ c.rejected.addToKey }}</NuxtLink>
                </template>
              </template>
              <span v-else class="faint">-</span>
            </td>
            <td class="nowrap dim">{{ row.ip ?? '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.why {
  min-width: 18rem;
  max-width: 44rem;
}
.why p {
  margin-top: 0.2rem;
  font-size: 0.88rem;
}
</style>
