<script setup lang="ts">
// Everything about one alert: the line httpdog printed, each field, the log line behind it and
// the body as it was signed. Used inside the list (under the row) and on the alert's own page.
import type { AlertBody, AlertDetail } from '#shared/api'
import { grouped, printable, stamp, zone } from '~/lib/format'

const props = defineProps<{
  id: number
  /** On the alert's own page there is no need for a link to it */
  standalone?: boolean
}>()

const c = useContent()
const api = useApi()
const now = useNow()

const alert = ref<AlertDetail | null>(null)
const error = ref('')

watch(
  () => props.id,
  async (id) => {
    alert.value = null
    error.value = ''
    try {
      alert.value = await api<AlertDetail>(`/api/alerts/${id}`)
    } catch (cause) {
      const failure = cause as ApiFailure
      error.value = failure.status === 404 ? c.value.detail.notFound : explain(failure, c.value)
    }
  },
  { immediate: true },
)

// The body was verified, but it is still read with care: a future httpdog may send other fields
const body = computed<Partial<AlertBody>>(() => {
  try {
    const parsed: unknown = JSON.parse(alert.value?.body ?? '')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<AlertBody>) : {}
  } catch {
    return {}
  }
})
const text = computed(() => (typeof body.value.text === 'string' ? body.value.text : ''))
// Indented for reading. Each line is cleaned on its own, so the line breaks of the layout stay
const eventJson = computed(() => {
  const event = body.value.event
  return event && typeof event === 'object' ? JSON.stringify(event, null, 2).split('\n').map(printable).join('\n') : ''
})
const link = computed(() => `${location.origin}/alerts/${props.id}`)
</script>

<template>
  <div class="detail">
    <p v-if="error" class="say say--error" role="alert">{{ error }}</p>
    <p v-else-if="!alert" class="dim">{{ c.common.loading }}</p>

    <template v-else>
      <CodeBlock v-if="text" :code="printable(text)" lang="log" :name="c.detail.text" wrap />

      <div class="cols">
        <dl class="fields">
          <dt>{{ c.detail.instance }}</dt>
          <dd>
            <span class="strong">{{ alert.instance }}</span>
            <NuxtLink class="act" :to="{ path: '/', query: { instance: alert.instance } }">{{ c.detail.onlyInstance }}</NuxtLink>
          </dd>

          <dt>{{ c.detail.rule }}</dt>
          <dd>
            <span class="amber">{{ alert.rule }}</span>
            <NuxtLink class="act" :to="{ path: '/', query: { rule: alert.rule } }">{{ c.detail.onlyRule }}</NuxtLink>
          </dd>

          <dt>{{ c.detail.kind }}</dt>
          <dd :class="{ red: alert.kind === 'overload' }">{{ alert.kind }}</dd>

          <dt>{{ c.detail.fired }}</dt>
          <dd>
            <span class="num">{{ stamp(alert.firedAt) }}</span>
            <span class="dim">{{ zone() }} · {{ c.ago(Math.max(0, now - alert.firedAt)) }}</span>
          </dd>

          <dt>{{ c.detail.received }}</dt>
          <dd>
            <span class="num">{{ stamp(alert.receivedAt) }}</span>
            <span class="dim">{{ c.detail.later(alert.receivedAt - alert.firedAt) }}</span>
          </dd>

          <template v-if="alert.groupBy !== null">
            <dt>{{ c.detail.group }}</dt>
            <dd>
              <span><span class="dim">{{ alert.groupBy }}=</span>{{ printable(alert.group ?? '') }}</span>
              <NuxtLink v-if="alert.group" class="act" :to="{ path: '/', query: { q: alert.group } }">{{ c.detail.searchGroup }}</NuxtLink>
            </dd>
          </template>

          <template v-if="alert.hits !== null">
            <dt>{{ c.detail.threshold }}</dt>
            <dd>{{ c.alerts.hits(alert.hits, alert.windowSecs) }}</dd>
          </template>

          <template v-if="alert.dropped !== null">
            <dt>{{ c.detail.dropped }}</dt>
            <dd class="red">{{ c.alerts.dropped(alert.dropped) }}</dd>
          </template>

          <template v-if="alert.deliveries > 1">
            <dt>{{ c.detail.deliveries }}</dt>
            <dd>
              <span>{{ grouped(alert.deliveries) }}</span>
              <span class="dim note">{{ c.detail.deliveriesNote }}</span>
            </dd>
          </template>

          <dt>{{ c.detail.verified }}</dt>
          <dd>
            <span v-if="alert.keyName !== null">{{ alert.keyName }}</span>
            <span v-else class="dim">{{ c.detail.keyGone }}</span>
          </dd>

          <template v-if="alert.version !== 1">
            <dt>{{ c.detail.version }}</dt>
            <dd>
              <span class="amber">{{ alert.version }}</span>
              <span class="dim note">{{ c.detail.versionNote }}</span>
            </dd>
          </template>
        </dl>

        <div class="event">
          <CodeBlock v-if="eventJson" :code="eventJson" lang="json" :name="c.detail.event" :max-lines="22" />
          <p v-else class="dim">{{ c.detail.noEvent }}</p>
        </div>
      </div>

      <details class="raw">
        <summary>{{ c.detail.body }}</summary>
        <CodeBlock :code="alert.body" lang="json" name="application/json" wrap :max-lines="16" />
      </details>

      <p class="acts foot">
        <CopyButton :text="link" :label="c.detail.link" />
        <NuxtLink v-if="!standalone" class="act" :to="`/alerts/${id}`">{{ c.detail.permalink }}</NuxtLink>
      </p>
    </template>
  </div>
</template>

<style scoped>
.detail {
  display: grid;
  gap: 0.9rem;
  min-width: 0;
}
.cols {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 0.9rem 1.6rem;
  align-items: start;
}
.fields {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0.4rem 1.2rem;
  font-size: 0.93rem;
}
.fields dt {
  color: var(--dim);
  white-space: nowrap;
}
.fields dd {
  display: flex;
  flex-wrap: wrap;
  gap: 0.1rem 0.9rem;
  min-width: 0;
  overflow-wrap: anywhere;
}
.note {
  flex-basis: 100%;
  font-size: 0.85rem;
}
.event {
  min-width: 0;
}
.raw summary {
  width: fit-content;
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--dim);
  transition: color 0.15s;
}
.raw summary:hover {
  color: var(--amber);
}
.raw[open] summary {
  margin-bottom: 0.5rem;
}
.foot {
  font-size: 0.85rem;
}
@media (max-width: 900px) {
  .cols {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
