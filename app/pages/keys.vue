<script setup lang="ts">
// Signing keys: which secret verifies which instances. Admins only.
import type { KeyList, KeyRow } from '#shared/api'
import { parsePatterns } from '#shared/instances'
import { stamp } from '~/lib/format'
import { queryString } from '~/lib/route'

const c = useContent()
const api = useApi()
const now = useNow()
const route = useRoute()
const router = useRouter()

useHead({ title: () => `${c.value.keys.title} | httpdog house` })

const list = ref<KeyList | null>(null)
const error = ref('')

async function load() {
  error.value = ''
  try {
    list.value = await api<KeyList>('/api/admin/keys')
  } catch (cause) {
    error.value = explain(cause as ApiFailure, c.value)
  }
}
onMounted(load)

function replaceKey(key: KeyRow) {
  if (list.value) list.value.keys = list.value.keys.map((item) => (item.id === key.id ? key : item))
}

/** An instance the "rejected" page sent here to be added to a key (?add=web-03) */
const pending = computed(() => queryString(route.query.add))
const ingestUnset = computed(() => !list.value?.ingestUrl || list.value.ingestUrl.includes('.example.'))

// ---------------------------------------------------------------- per key: secret, setup, enable

/** Secrets the admin has asked to see, by key id. Gone when the page is left */
const secrets = ref(new Map<number, string>())
const setupOpen = ref(new Set<number>())
const working = ref<number | null>(null)

async function act(key: KeyRow, action: () => Promise<void>) {
  working.value = key.id
  error.value = ''
  try {
    await action()
  } catch (cause) {
    error.value = explain(cause as ApiFailure, c.value)
  } finally {
    working.value = null
  }
}

const toggleSecret = (key: KeyRow) =>
  act(key, async () => {
    const shown = new Map(secrets.value)
    if (!shown.delete(key.id)) {
      shown.set(key.id, (await api<{ secret: string }>(`/api/admin/keys/${key.id}/secret`, { method: 'POST' })).secret)
    }
    secrets.value = shown
  })

const toggleEnabled = (key: KeyRow) =>
  act(key, async () => {
    replaceKey((await api<{ key: KeyRow }>(`/api/admin/keys/${key.id}`, { method: 'PATCH', body: { enabled: !key.enabled } })).key)
  })

function toggleSetup(key: KeyRow) {
  const open = new Set(setupOpen.value)
  if (!open.delete(key.id)) open.add(key.id)
  setupOpen.value = open
}

// ---------------------------------------------------------------- new key / edit key

const form = reactive({
  open: false,
  /** null while making a new key */
  key: null as KeyRow | null,
  name: '',
  instances: '',
  own: false,
  secret: '',
  busy: false,
  error: '',
})

function openForm(key: KeyRow | null) {
  const patterns = key ? [...key.patterns] : []
  if (pending.value && !patterns.includes(pending.value)) patterns.push(pending.value)
  Object.assign(form, { open: true, key, name: key?.name ?? '', instances: patterns.join('\n'), own: false, secret: '', busy: false, error: '' })
}

/** The key that was just made, with its secret, shown once so it can be put on the hosts */
const created = ref<{ key: KeyRow; secret: string } | null>(null)

async function submitForm() {
  form.busy = true
  form.error = ''
  const body = { name: form.name, patterns: parsePatterns(form.instances) }
  try {
    if (form.key) {
      replaceKey((await api<{ key: KeyRow }>(`/api/admin/keys/${form.key.id}`, { method: 'PATCH', body })).key)
    } else {
      const answer = await api<{ key: KeyRow; secret: string }>('/api/admin/keys', {
        method: 'POST',
        body: { ...body, ...(form.own && { secret: form.secret }) },
      })
      created.value = answer
      await load()
    }
    form.open = false
    // the instance that was waiting to be added has been dealt with
    if (pending.value) router.replace({ query: {} })
  } catch (cause) {
    form.error = explain(cause as ApiFailure, c.value)
  } finally {
    form.busy = false
  }
}

// ---------------------------------------------------------------- delete

const removing = ref<KeyRow | null>(null)
const removeBusy = ref(false)
const removeError = ref('')

async function remove() {
  const key = removing.value
  if (!key) return
  removeBusy.value = true
  removeError.value = ''
  try {
    await api(`/api/admin/keys/${key.id}`, { method: 'DELETE' })
    if (list.value) list.value.keys = list.value.keys.filter((item) => item.id !== key.id)
    removing.value = null
  } catch (cause) {
    removeError.value = explain(cause as ApiFailure, c.value)
  } finally {
    removeBusy.value = false
  }
}
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ c.keys.title }}</h1>
        <p class="page-lead">{{ c.keys.lead }}</p>
      </div>
      <button type="button" class="btn btn--primary" @click="openForm(null)">{{ c.keys.add }}</button>
    </div>

    <p v-if="error" class="say say--error" role="alert">{{ error }}</p>
    <p v-if="pending" class="say say--warn">{{ c.keys.pending(pending) }}</p>
    <p v-if="!list && !error" class="dim">{{ c.common.loading }}</p>

    <template v-if="list">
      <section class="panel">
        <header class="panel-bar">
          <span class="panel-name">{{ c.keys.ingest }}</span>
          <CopyButton :text="list.ingestUrl" />
        </header>
        <div class="panel-body">
          <code class="url">{{ list.ingestUrl || '-' }}</code>
          <p v-if="ingestUnset" class="say say--warn unset">{{ c.keys.ingestUnset }}</p>
        </div>
      </section>

      <div v-if="!list.keys.length" class="panel empty">{{ c.keys.none }}</div>

      <section v-for="key in list.keys" :key="key.id" class="panel">
        <header class="panel-bar">
          <span class="panel-name">{{ key.name }}</span>
          <span class="panel-status" :class="{ dim: !key.enabled }">
            <i class="dot" :class="{ 'dot--off': !key.enabled }" /> {{ key.enabled ? c.keys.enabled : c.keys.disabled }}
          </span>
        </header>
        <div class="panel-body key">
          <dl class="facts">
            <dt>{{ c.keys.instances }}</dt>
            <dd>
              <span v-if="key.patterns.length" class="chips">
                <span v-for="pattern in key.patterns" :key="pattern" class="chip" :title="pattern === '*' ? c.keys.anyInstance : undefined">{{ pattern }}</span>
              </span>
              <span v-else class="amber">{{ c.keys.noInstances }}</span>
            </dd>

            <dt>{{ c.keys.fingerprint }}</dt>
            <dd>
              <code class="strong" :title="c.keys.fingerprintNote">{{ key.fingerprint }}</code>
            </dd>

            <template v-if="secrets.has(key.id)">
              <dt>secret</dt>
              <dd>
                <code class="code">{{ secrets.get(key.id) }}</code>
                <CopyButton :text="secrets.get(key.id) ?? ''" />
              </dd>
            </template>
          </dl>

          <p class="meta dim">
            <span :title="stamp(key.createdAt)">{{ c.keys.createdBy(c.ago(Math.max(0, now - key.createdAt)), key.createdBy) }}</span>
            <span v-if="key.lastUsedAt !== null" :title="stamp(key.lastUsedAt)">{{ c.keys.lastUsed(c.ago(Math.max(0, now - key.lastUsedAt))) }}</span>
            <span v-else>{{ c.keys.neverUsed }}</span>
          </p>

          <p class="acts">
            <button type="button" class="act" @click="openForm(key)">{{ c.keys.edit }}</button>
            <button type="button" class="act" :class="{ 'act--on': setupOpen.has(key.id) }" :aria-expanded="setupOpen.has(key.id)" @click="toggleSetup(key)">
              {{ c.keys.setupAction }}
            </button>
            <button type="button" class="act" :class="{ 'act--on': secrets.has(key.id) }" :disabled="working === key.id" @click="toggleSecret(key)">
              {{ secrets.has(key.id) ? c.keys.hide : c.keys.reveal }}
            </button>
            <button
              type="button"
              class="act"
              :disabled="working === key.id"
              :title="key.enabled ? c.keys.confirmDisable : undefined"
              @click="toggleEnabled(key)"
            >
              {{ key.enabled ? c.keys.disable : c.keys.enable }}
            </button>
            <button type="button" class="act act--danger" @click="((removing = key), (removeError = ''))">{{ c.keys.remove }}</button>
          </p>

          <KeySetup
            v-if="setupOpen.has(key.id)"
            :ingest-url="list.ingestUrl"
            :fingerprint="key.fingerprint"
            :patterns="key.patterns"
            :secret="secrets.get(key.id)"
          />
        </div>
      </section>
    </template>

    <!-- new key, or edit one -->
    <UiDialog :open="form.open" :name="form.key ? c.keys.form.editTitle(form.key.name) : c.keys.form.newTitle" @close="form.open = false">
      <form class="form" @submit.prevent="submitForm">
        <label class="field">
          <span class="label">{{ c.keys.form.name }}</span>
          <input v-model="form.name" class="input" maxlength="64" required autocomplete="off" spellcheck="false">
          <span class="hint">{{ c.keys.form.nameHint }}</span>
        </label>
        <label class="field">
          <span class="label">{{ c.keys.form.instances }}</span>
          <textarea v-model="form.instances" class="input" rows="4" spellcheck="false" autocapitalize="none" placeholder="web-01" />
          <span class="hint">{{ c.keys.form.instancesHint }}</span>
        </label>
        <fieldset v-if="!form.key" class="field secret">
          <legend class="label">{{ c.keys.form.secret }}</legend>
          <label class="choice"><input v-model="form.own" type="radio" :value="false"> {{ c.keys.form.generate }}</label>
          <label class="choice"><input v-model="form.own" type="radio" :value="true"> {{ c.keys.form.own }}</label>
          <template v-if="form.own">
            <input v-model="form.secret" class="input" type="password" minlength="16" maxlength="256" required autocomplete="off" spellcheck="false">
            <span class="hint">{{ c.keys.form.ownHint }}</span>
          </template>
        </fieldset>
        <p v-if="form.error" class="say say--error" role="alert">{{ form.error }}</p>
        <div class="form-actions">
          <button class="btn btn--primary" :disabled="form.busy">{{ form.busy ? c.common.working : form.key ? c.common.save : c.keys.form.create }}</button>
          <button type="button" class="btn" @click="form.open = false">{{ c.common.cancel }}</button>
        </div>
      </form>
    </UiDialog>

    <!-- the key that was just made -->
    <UiDialog :open="created !== null" :name="created ? c.keys.made.title(created.key.name) : ''" @close="created = null">
      <div v-if="created" class="form">
        <p>{{ c.keys.made.lead }}</p>
        <KeySetup
          :ingest-url="list?.ingestUrl ?? ''"
          :fingerprint="created.key.fingerprint"
          :patterns="created.key.patterns"
          :secret="created.secret"
        />
        <div class="form-actions">
          <button type="button" class="btn btn--primary" @click="created = null">{{ c.keys.made.done }}</button>
        </div>
      </div>
    </UiDialog>

    <!-- delete -->
    <UiDialog :open="removing !== null" :name="removing ? c.keys.confirmDelete.title(removing.name) : ''" @close="removing = null">
      <div class="form">
        <p>{{ c.keys.confirmDelete.body }}</p>
        <p v-if="removeError" class="say say--error" role="alert">{{ removeError }}</p>
        <div class="form-actions">
          <button type="button" class="btn btn--danger" :disabled="removeBusy" @click="remove">
            {{ removeBusy ? c.common.working : c.keys.confirmDelete.yes }}
          </button>
          <button type="button" class="btn" @click="removing = null">{{ c.common.cancel }}</button>
        </div>
      </div>
    </UiDialog>
  </div>
</template>

<style scoped>
.url {
  color: var(--text-strong);
  overflow-wrap: anywhere;
}
.unset {
  margin-top: 0.6rem;
}
.key {
  display: grid;
  gap: 0.8rem;
}
.facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0.5rem 1.4rem;
  align-items: baseline;
}
.facts dt {
  color: var(--dim);
  font-size: 0.86rem;
  white-space: nowrap;
}
.facts dd {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.2rem 0.9rem;
  min-width: 0;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.1rem 1.4rem;
  font-size: 0.85rem;
}
.secret {
  margin: 0;
  padding: 0;
  border: 0;
}
.secret legend {
  padding: 0;
  margin-bottom: 0.35rem;
}
</style>
