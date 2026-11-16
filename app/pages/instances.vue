<script setup lang="ts">
// Which httpdog instances exist, as far as this receiver can tell: the ones that have sent
// something, and the ones a key is waiting for.
import type { InstanceRow } from '#shared/api'
import { grouped, stamp } from '~/lib/format'

const c = useContent()
const api = useApi()
const now = useNow()

useHead({ title: () => `${c.value.instances.title} | httpdog house` })

const items = ref<InstanceRow[] | null>(null)
const error = ref('')

async function load() {
  error.value = ''
  try {
    items.value = (await api<{ items: InstanceRow[] }>('/api/instances')).items
  } catch (cause) {
    error.value = explain(cause as ApiFailure, c.value)
  }
}
onMounted(load)

type Status = 'ok' | 'silent' | 'refused'
const status = (row: InstanceRow): Status => (!row.keys.length ? 'refused' : row.seen ? 'ok' : 'silent')
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ c.instances.title }}</h1>
        <p class="page-lead">{{ c.instances.lead }}</p>
      </div>
    </div>

    <p v-if="error" class="say say--error" role="alert">
      {{ error }} <button type="button" class="act" @click="load">{{ c.common.retry }}</button>
    </p>
    <p v-else-if="!items" class="dim">{{ c.common.loading }}</p>
    <div v-else-if="!items.length" class="panel empty">{{ c.instances.empty }}</div>

    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th scope="col">{{ c.instances.columns.name }}</th>
            <th scope="col">{{ c.instances.columns.status }}</th>
            <th scope="col">{{ c.instances.columns.keys }}</th>
            <th scope="col">{{ c.instances.columns.last }}</th>
            <th scope="col" class="right">{{ c.instances.columns.day }}</th>
            <th scope="col" class="right">{{ c.instances.columns.total }}</th>
            <th scope="col" class="right">{{ c.instances.columns.rules }}</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in items" :key="row.name">
            <th scope="row" class="nowrap">{{ row.name }}</th>
            <td class="nowrap">
              <template v-if="status(row) === 'ok'"><i class="dot dot--green" /> {{ c.instances.ok }}</template>
              <span v-else-if="status(row) === 'silent'" class="dim" :title="c.instances.silentNote"><i class="dot dot--off" /> {{ c.instances.silent }}</span>
              <span v-else class="red" :title="c.instances.refusedNote"><i class="dot dot--red" /> {{ c.instances.refused }}</span>
            </td>
            <td>
              <span v-if="row.keys.length" class="chips">
                <span v-for="key in row.keys" :key="key" class="chip">{{ key }}</span>
              </span>
              <span v-else class="dim">{{ c.instances.refusedNote }}</span>
            </td>
            <td class="nowrap">
              <span v-if="row.lastAt !== null" :title="stamp(row.lastAt)">{{ c.ago(Math.max(0, now - row.lastAt)) }}</span>
              <span v-else class="faint">{{ c.common.never }}</span>
            </td>
            <td class="right">{{ grouped(row.day) }}</td>
            <td class="right">{{ grouped(row.total) }}</td>
            <td class="right">{{ row.rules }}</td>
            <td class="right nowrap">
              <NuxtLink v-if="row.seen" class="act" :to="{ path: '/', query: { instance: row.name } }">{{ c.instances.view }}</NuxtLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
