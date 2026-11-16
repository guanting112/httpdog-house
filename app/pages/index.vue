<script setup lang="ts">
// The main page: the alerts, newest first. The filters live in the address, so a filtered view
// can be bookmarked or sent to someone, and the back button undoes a filter.
import type { AlertPage, AlertRow, Overview } from '#shared/api'
import { clock, day, fromLocalInput, grouped, printable, stamp, toLocalInput } from '~/lib/format'
import { queryNumber, queryString } from '~/lib/route'

const c = useContent()
const api = useApi()
const route = useRoute()
const router = useRouter()
const { isAdmin } = useSession()

useHead({ title: () => `${c.value.alerts.title} | httpdog house` })

// ---------------------------------------------------------------- filters

const RANGES = { '1h': 3600, '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400 } as const
type Range = keyof typeof RANGES | 'custom' | ''

const filter = computed(() => {
  const range = queryString(route.query.range)
  return {
    instance: queryString(route.query.instance),
    rule: queryString(route.query.rule),
    q: queryString(route.query.q),
    range: (range in RANGES || range === 'custom' ? range : '') as Range,
    from: queryNumber(route.query.from),
    to: queryNumber(route.query.to),
  }
})
const filtered = computed(() => Object.values(filter.value).some((value) => value !== '' && value !== null))

/** Changes some filters and keeps the rest. An empty value removes that filter from the address */
function setFilter(patch: Record<string, string | number | null>) {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...filter.value, ...patch })) {
    if (value !== '' && value !== null) query[key] = String(value)
  }
  if (query.range !== 'custom') {
    delete query.from
    delete query.to
  }
  router.replace({ query })
}

// The search box is typed into; the address follows a moment after the typing stops
const search = ref(filter.value.q)
let typing: ReturnType<typeof setTimeout> | undefined
watch(search, (text) => {
  clearTimeout(typing)
  typing = setTimeout(() => text.trim() !== filter.value.q && setFilter({ q: text.trim() }), 350)
})
watch(
  () => filter.value.q,
  (q) => q !== search.value.trim() && (search.value = q),
)

/** The filters as the API takes them */
function apiQuery(extra: Record<string, string | number> = {}): Record<string, string | number> {
  const f = filter.value
  const query: Record<string, string | number> = {}
  if (f.instance) query.instance = f.instance
  if (f.rule) query.rule = f.rule
  if (f.q) query.q = f.q
  if (f.range === 'custom') {
    if (f.from !== null) query.from = f.from
    if (f.to !== null) query.to = f.to
  } else if (f.range) {
    query.from = Math.floor(Date.now() / 1000) - RANGES[f.range]
  }
  return { ...query, ...extra }
}

// ---------------------------------------------------------------- the list

const items = ref<AlertRow[]>([])
/** The newest alert id the server had at the last look: where the next "anything new?" starts */
const head = ref(0)
const next = ref<number | null>(null)
const searched = ref<AlertPage['searched']>(null)
const loaded = ref(false)
const busy = ref(false)
const error = ref('')
/** Ids that arrived while the page was open; they come in with a flash */
const fresh = ref(new Set<number>())
const opened = ref(new Set<number>())

// Each load gets a number. An answer that comes back after a newer load has started is dropped,
// so a slow answer for old filters cannot replace the list for the current ones
let generation = 0

async function load() {
  const mine = ++generation
  busy.value = true
  error.value = ''
  void loadOverview()
  try {
    const page = await api<AlertPage>('/api/alerts', { query: apiQuery() })
    if (mine !== generation) return
    items.value = page.items
    head.value = page.head
    next.value = page.next
    searched.value = page.searched
    fresh.value = new Set()
    loaded.value = true
  } catch (cause) {
    if (mine === generation) error.value = explain(cause as ApiFailure, c.value)
  } finally {
    if (mine === generation) busy.value = false
  }
}

async function loadOlder() {
  if (next.value === null || busy.value) return
  const mine = generation
  busy.value = true
  error.value = ''
  try {
    const page = await api<AlertPage>('/api/alerts', { query: apiQuery({ before: next.value }) })
    if (mine !== generation) return
    items.value = [...items.value, ...page.items]
    next.value = page.next
    searched.value = page.searched
  } catch (cause) {
    if (mine === generation) error.value = explain(cause as ApiFailure, c.value)
  } finally {
    if (mine === generation) busy.value = false
  }
}

function toggle(id: number) {
  const set = new Set(opened.value)
  if (!set.delete(id)) set.add(id)
  opened.value = set
}

// ---------------------------------------------------------------- the last 24 hours

const overview = ref<Overview | null>(null)

async function loadOverview() {
  const f = filter.value
  try {
    overview.value = await api<Overview>('/api/overview', { query: { ...(f.instance && { instance: f.instance }), ...(f.rule && { rule: f.rule }) } })
  } catch {
    // the numbers are an extra; the list reports its own failures
  }
}

/** The options of a filter: everything that has alerts, plus the current value even if it has none */
function options(known: string[] | undefined, current: string): string[] {
  const all = known ?? []
  return current && !all.includes(current) ? [current, ...all] : all
}

// ---------------------------------------------------------------- live

const LIVE_EVERY_MS = 5000
const LIVE_LIMIT = 100
const OVERVIEW_EVERY_MS = 60_000

const live = ref(true)
// a range that ends in the past can never show anything new
const canLive = computed(() => !(filter.value.range === 'custom' && filter.value.to !== null && filter.value.to * 1000 < Date.now()))
let polling = false

async function poll() {
  if (!live.value || !canLive.value || !loaded.value || busy.value || polling || document.hidden) return
  polling = true
  const mine = generation
  try {
    const page = await api<AlertPage>('/api/alerts', { query: apiQuery({ after: head.value, limit: LIVE_LIMIT }) })
    if (mine !== generation) return
    head.value = page.head
    if (page.items.length >= LIVE_LIMIT) {
      // more arrived than one answer holds, so there would be a gap: read the list again instead
      await load()
    } else if (page.items.length) {
      fresh.value = new Set([...fresh.value, ...page.items.map((item) => item.id)])
      items.value = [...page.items, ...items.value]
      void loadOverview()
    }
  } catch {
    // a missed look is not worth a message; the next one is a few seconds away
  } finally {
    polling = false
  }
}

let liveTimer: ReturnType<typeof setInterval> | undefined
let overviewTimer: ReturnType<typeof setInterval> | undefined
const onVisible = () => !document.hidden && void poll()

onMounted(() => {
  liveTimer = setInterval(poll, LIVE_EVERY_MS)
  overviewTimer = setInterval(() => !document.hidden && void loadOverview(), OVERVIEW_EVERY_MS)
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  clearInterval(liveTimer)
  clearInterval(overviewTimer)
  clearTimeout(typing)
  document.removeEventListener('visibilitychange', onVisible)
})

// Leaving for another page also changes the route; only a change of this page's own filters reloads
watch(
  () => route.fullPath,
  () => route.path === '/' && void load(),
  { immediate: true },
)
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ c.alerts.title }}</h1>
        <p class="page-lead">{{ c.alerts.lead }}</p>
      </div>
    </div>

    <!-- the last 24 hours, narrowed by the same instance and rule as the list -->
    <section class="panel">
      <header class="panel-bar">
        <span class="panel-name">
          {{ c.alerts.summary }}<template v-if="filter.instance"> · {{ filter.instance }}</template><template v-if="filter.rule"> · {{ filter.rule }}</template>
        </span>
        <button
          type="button"
          class="act live"
          :class="{ 'act--on': live && canLive }"
          :disabled="!canLive"
          :aria-pressed="live"
          :title="!canLive ? c.alerts.liveNotNow : live ? c.alerts.liveOn : c.alerts.liveOff"
          @click="live = !live"
        >
          <i class="dot" :class="live && canLive ? 'dot--live' : 'dot--off'" /> {{ live && canLive ? c.alerts.live : c.alerts.liveOff }}
        </button>
      </header>
      <div class="summary">
        <p class="summary-total">{{ overview ? c.alerts.total(overview.total) : c.common.loading }}</p>
        <HourBars v-if="overview" class="summary-bars" :hours="overview.hours" />
        <div v-if="overview?.rules.length" class="summary-top">
          <span class="label">{{ c.alerts.busiestRules }}</span>
          <span class="chips">
            <button
              v-for="rule in overview.rules"
              :key="rule.name"
              type="button"
              class="chip"
              :class="{ 'chip--on': filter.rule === rule.name }"
              @click="setFilter({ rule: filter.rule === rule.name ? '' : rule.name })"
            >
              {{ rule.name }} <span class="dim num">{{ grouped(rule.total) }}</span>
            </button>
          </span>
        </div>
        <div v-if="overview && overview.instances.length > 1" class="summary-top">
          <span class="label">{{ c.alerts.busiestInstances }}</span>
          <span class="chips">
            <button
              v-for="instance in overview.instances"
              :key="instance.name"
              type="button"
              class="chip"
              :class="{ 'chip--on': filter.instance === instance.name }"
              @click="setFilter({ instance: filter.instance === instance.name ? '' : instance.name })"
            >
              {{ instance.name }} <span class="dim num">{{ grouped(instance.total) }}</span>
            </button>
          </span>
        </div>
      </div>
    </section>

    <form class="filters" role="search" @submit.prevent>
      <label class="field">
        <span class="label">{{ c.alerts.instance }}</span>
        <select class="input" :value="filter.instance" @change="setFilter({ instance: ($event.target as HTMLSelectElement).value })">
          <option value="">{{ c.alerts.anyInstance }}</option>
          <option v-for="name in options(overview?.facets.instances, filter.instance)" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>
      <label class="field">
        <span class="label">{{ c.alerts.rule }}</span>
        <select class="input" :value="filter.rule" @change="setFilter({ rule: ($event.target as HTMLSelectElement).value })">
          <option value="">{{ c.alerts.anyRule }}</option>
          <option v-for="name in options(overview?.facets.rules, filter.rule)" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>
      <label class="field">
        <span class="label">{{ c.alerts.time }}</span>
        <select class="input" :value="filter.range" @change="setFilter({ range: ($event.target as HTMLSelectElement).value })">
          <option value="">{{ c.alerts.ranges.all }}</option>
          <option v-for="(_, key) in RANGES" :key="key" :value="key">{{ c.alerts.ranges[key] }}</option>
          <option value="custom">{{ c.alerts.ranges.custom }}</option>
        </select>
      </label>
      <label class="field grow">
        <span class="label">{{ c.alerts.search }}</span>
        <input v-model="search" class="input" type="search" maxlength="200" :placeholder="c.alerts.searchPlaceholder">
      </label>
      <template v-if="filter.range === 'custom'">
        <label class="field">
          <span class="label">{{ c.alerts.from }}</span>
          <input
            class="input"
            type="datetime-local"
            :value="toLocalInput(filter.from)"
            @change="setFilter({ from: fromLocalInput(($event.target as HTMLInputElement).value) })"
          >
        </label>
        <label class="field">
          <span class="label">{{ c.alerts.to }}</span>
          <input
            class="input"
            type="datetime-local"
            :value="toLocalInput(filter.to)"
            @change="setFilter({ to: fromLocalInput(($event.target as HTMLInputElement).value) })"
          >
        </label>
      </template>
      <button v-if="filtered" type="button" class="act clear" @click="router.replace({ query: {} })">{{ c.alerts.clear }}</button>
    </form>

    <p v-if="error" class="say say--error" role="alert">
      {{ error }} <button type="button" class="act" @click="load">{{ c.common.retry }}</button>
    </p>

    <section class="panel list" :aria-busy="busy">
      <header class="head line" aria-hidden="true">
        <span>{{ c.alerts.columns.time }}</span>
        <span>{{ c.alerts.columns.instance }}</span>
        <span>{{ c.alerts.columns.rule }}</span>
        <span>{{ c.alerts.columns.message }}</span>
        <span />
      </header>

      <ol v-if="items.length">
        <template v-for="(alert, i) in items" :key="alert.id">
          <li v-if="i === 0 || day(alert.firedAt) !== day(items[i - 1]!.firedAt)" class="date">{{ day(alert.firedAt) }}</li>
          <li class="row" :class="{ open: opened.has(alert.id), fresh: fresh.has(alert.id), overload: alert.kind === 'overload' }">
            <button type="button" class="line" :aria-expanded="opened.has(alert.id)" :title="c.alerts.open" @click="toggle(alert.id)">
              <span class="c-time num" :title="stamp(alert.firedAt)">{{ clock(alert.firedAt) }}</span>
              <span class="c-instance">{{ alert.instance }}</span>
              <span class="c-rule">{{ alert.rule }}</span>
              <span class="c-message">{{ printable(alert.message) }}</span>
              <span class="c-meta">
                <span v-if="alert.hits !== null" class="mark">{{ c.alerts.hits(alert.hits, alert.windowSecs) }}</span>
                <span v-if="alert.dropped !== null" class="mark red">{{ c.alerts.dropped(alert.dropped) }}</span>
                <span v-if="alert.deliveries > 1" class="mark dim">{{ c.alerts.sentTimes(alert.deliveries) }}</span>
              </span>
            </button>
            <div v-if="opened.has(alert.id)" class="more">
              <AlertDetail :id="alert.id" />
            </div>
          </li>
        </template>
      </ol>

      <div v-else-if="loaded" class="empty">
        <template v-if="filtered">
          <p>{{ c.alerts.noMatch }}</p>
        </template>
        <template v-else>
          <p class="strong">{{ c.alerts.noneYet }}</p>
          <p v-if="isAdmin">
            {{ c.alerts.noneYetAdmin }} <NuxtLink class="link" to="/keys">{{ c.alerts.noneYetAdminLink }}</NuxtLink>
          </p>
          <p v-else>{{ c.alerts.noneYetViewer }}</p>
        </template>
      </div>
      <div v-else-if="!error" class="empty">{{ c.common.loading }}</div>

      <footer v-if="loaded && (items.length || searched)" class="foot">
        <span v-if="searched" class="dim">{{ c.alerts.searchedTo(stamp(searched.to)) }}</span>
        <button v-if="next !== null" type="button" class="act" :disabled="busy" @click="loadOlder">
          {{ busy ? c.common.loading : searched ? c.alerts.searchOlder : c.alerts.older }}
        </button>
        <span v-else class="faint">{{ c.alerts.end }}</span>
      </footer>
    </section>
  </div>
</template>

<style scoped>
/* ---- the last 24 hours */
.live {
  flex: 0 0 auto;
}
.summary {
  display: grid;
  grid-template-columns: max-content minmax(8rem, 22rem) minmax(0, 1fr);
  align-items: center;
  gap: 0.7rem 1.8rem;
  padding: 0.9rem 1rem;
}
.summary-total {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-strong);
  white-space: nowrap;
}
.summary-top {
  grid-column: 1 / -1;
  display: flex;
  align-items: baseline;
  gap: 0.8rem;
  min-width: 0;
}
.summary-top .label {
  flex: 0 0 4.6rem;
}

/* ---- filters */
.filters {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 12rem)) minmax(0, 1fr);
  align-items: end;
  gap: 0.7rem 0.8rem;
}
.clear {
  grid-column: 1 / -1;
  justify-self: start;
  font-size: 0.86rem;
}

/* ---- the list: a grid per line rather than a table, so a line can rearrange itself on a phone */
.list {
  font-size: 0.92rem;
}
.line {
  display: grid;
  grid-template-columns: 4.6rem minmax(0, 9rem) minmax(0, 13rem) minmax(0, 1fr) auto;
  gap: 0 1.1rem;
  align-items: baseline;
  width: 100%;
  padding: 0.42rem 1rem;
  text-align: left;
}
.head {
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  color: var(--dim);
  border-bottom: 1px solid var(--line);
}
.date {
  padding: 0.3rem 1rem;
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  color: var(--faint);
  background: var(--bg);
  border-bottom: 1px dashed var(--line);
}
.row {
  border-bottom: 1px dashed var(--line);
  border-left: 2px solid transparent;
}
.row:last-child {
  border-bottom: 0;
}
.row > .line {
  cursor: pointer;
  transition: background 0.15s;
}
.row > .line:hover {
  background: var(--hover);
}
.row.open {
  border-left-color: var(--amber);
  background: rgba(var(--amber-rgb), 0.045);
}
.row.overload {
  border-left-color: var(--red);
}
.row.fresh {
  animation: arrive 1.6s ease-out;
}
@keyframes arrive {
  from {
    background: rgba(var(--red-rgb), 0.2);
  }
}
.c-time {
  color: var(--dim);
}
.c-instance {
  color: var(--text-strong);
}
.c-rule {
  color: var(--amber);
}
.overload .c-rule {
  color: var(--red);
}
.c-instance,
.c-rule,
.c-message {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.open .c-message {
  white-space: normal;
  overflow-wrap: anywhere;
}
.c-meta {
  display: flex;
  gap: 0.8rem;
  font-size: 0.84rem;
  white-space: nowrap;
}
.mark {
  color: var(--teal);
}
.mark.red {
  color: var(--red);
}
.mark.dim {
  color: var(--dim);
}
.more {
  padding: 0.6rem 1rem 1.1rem;
}
.foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.3rem 1.2rem;
  padding: 0.7rem 1rem;
  border-top: 1px solid var(--line);
  font-size: 0.86rem;
}

@media (max-width: 900px) {
  .summary {
    grid-template-columns: max-content minmax(0, 1fr);
  }
  .filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .filters .grow {
    grid-column: 1 / -1;
  }
}
@media (max-width: 760px) {
  .head {
    display: none;
  }
  /* time and instance on the first line, the rule on the second, the message under them */
  .line {
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas:
      'time instance meta'
      'rule rule rule'
      'message message message';
    gap: 0.05rem 0.8rem;
    padding-block: 0.55rem;
  }
  .c-time {
    grid-area: time;
  }
  .c-instance {
    grid-area: instance;
  }
  .c-rule {
    grid-area: rule;
  }
  .c-message {
    grid-area: message;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .c-meta {
    grid-area: meta;
  }
  .summary-top {
    flex-direction: column;
    gap: 0.3rem;
  }
  .summary-top .label {
    flex: none;
  }
}
</style>
