<script setup lang="ts">
// Who can sign in. Admins only.
import type { Role, UserRow } from '#shared/api'
import { stamp } from '~/lib/format'

const c = useContent()
const api = useApi()
const now = useNow()
const { user: me } = useSession()

useHead({ title: () => `${c.value.users.title} | httpdog house` })

const items = ref<UserRow[] | null>(null)
const error = ref('')
const working = ref<number | null>(null)

async function load() {
  error.value = ''
  try {
    items.value = (await api<{ items: UserRow[] }>('/api/admin/users')).items
  } catch (cause) {
    error.value = explain(cause as ApiFailure, c.value)
  }
}
onMounted(load)

/** Change one thing about an account, and show the row as the server now has it */
async function change(user: UserRow, body: { role?: Role; disabled?: boolean }) {
  working.value = user.id
  error.value = ''
  try {
    const answer = await api<{ user: UserRow }>(`/api/admin/users/${user.id}`, { method: 'PATCH', body })
    items.value = (items.value ?? []).map((item) => (item.id === user.id ? answer.user : item))
  } catch (cause) {
    error.value = explain(cause as ApiFailure, c.value)
  } finally {
    working.value = null
  }
}

// ---------------------------------------------------------------- new user

const form = reactive({ open: false, username: '', password: '', role: 'viewer' as Role, busy: false, error: '' })

function openForm() {
  Object.assign(form, { open: true, username: '', password: '', role: 'viewer', busy: false, error: '' })
}

async function create() {
  form.busy = true
  form.error = ''
  try {
    const answer = await api<{ user: UserRow }>('/api/admin/users', {
      method: 'POST',
      body: { username: form.username, password: form.password, role: form.role },
    })
    items.value = [...(items.value ?? []), answer.user].sort((a, b) => a.username.localeCompare(b.username))
    form.open = false
  } catch (cause) {
    form.error = explain(cause as ApiFailure, c.value)
  } finally {
    form.busy = false
  }
}

// ---------------------------------------------------------------- new password for someone / delete

const reset = reactive({ user: null as UserRow | null, password: '', busy: false, error: '' })
const removing = reactive({ user: null as UserRow | null, busy: false, error: '' })

async function setPassword() {
  if (!reset.user) return
  reset.busy = true
  reset.error = ''
  try {
    await api(`/api/admin/users/${reset.user.id}`, { method: 'PATCH', body: { password: reset.password } })
    reset.user = null
  } catch (cause) {
    reset.error = explain(cause as ApiFailure, c.value)
  } finally {
    reset.busy = false
  }
}

async function remove() {
  const user = removing.user
  if (!user) return
  removing.busy = true
  removing.error = ''
  try {
    await api(`/api/admin/users/${user.id}`, { method: 'DELETE' })
    items.value = (items.value ?? []).filter((item) => item.id !== user.id)
    removing.user = null
  } catch (cause) {
    removing.error = explain(cause as ApiFailure, c.value)
  } finally {
    removing.busy = false
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ c.users.title }}</h1>
        <p class="page-lead">{{ c.users.lead }}</p>
      </div>
      <button type="button" class="btn btn--primary" @click="openForm">{{ c.users.add }}</button>
    </div>

    <p v-if="error" class="say say--error error" role="alert">{{ error }}</p>
    <p v-if="!items && !error" class="dim">{{ c.common.loading }}</p>

    <div v-if="items" class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th scope="col">{{ c.users.columns.name }}</th>
            <th scope="col">{{ c.users.columns.role }}</th>
            <th scope="col">{{ c.users.columns.status }}</th>
            <th scope="col">{{ c.users.columns.created }}</th>
            <th scope="col">{{ c.users.columns.lastLogin }}</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in items" :key="user.id">
            <th scope="row" class="nowrap">
              {{ user.username }} <span v-if="user.id === me?.id" class="chip chip--on">{{ c.users.you }}</span>
            </th>
            <td :class="{ amber: user.role === 'admin' }">{{ c.users.roles[user.role] }}</td>
            <td class="nowrap">
              <span v-if="user.disabled" class="dim"><i class="dot dot--off" /> {{ c.users.disabled }}</span>
              <template v-else><i class="dot dot--green" /> {{ c.users.active }}</template>
            </td>
            <td class="nowrap dim" :title="stamp(user.createdAt)">{{ c.ago(Math.max(0, now - user.createdAt)) }}</td>
            <td class="nowrap dim">
              <span v-if="user.lastLoginAt !== null" :title="stamp(user.lastLoginAt)">{{ c.ago(Math.max(0, now - user.lastLoginAt)) }}</span>
              <span v-else class="faint">{{ c.common.never }}</span>
            </td>
            <td>
              <span class="acts">
                <!-- what would lock you out of your own account is left to another admin -->
                <template v-if="user.id !== me?.id">
                  <button type="button" class="act" :disabled="working === user.id" @click="change(user, { role: user.role === 'admin' ? 'viewer' : 'admin' })">
                    {{ user.role === 'admin' ? c.users.makeViewer : c.users.makeAdmin }}
                  </button>
                  <button type="button" class="act" :disabled="working === user.id" @click="change(user, { disabled: !user.disabled })">
                    {{ user.disabled ? c.users.enable : c.users.disable }}
                  </button>
                  <button type="button" class="act" @click="Object.assign(reset, { user, password: '', busy: false, error: '' })">
                    {{ c.users.resetPassword }}
                  </button>
                  <button type="button" class="act act--danger" @click="Object.assign(removing, { user, busy: false, error: '' })">
                    {{ c.users.remove }}
                  </button>
                </template>
                <NuxtLink v-else class="act" to="/account">{{ c.account.changePassword }}</NuxtLink>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <UiDialog :open="form.open" :name="c.users.form.title" @close="form.open = false">
      <form class="form" @submit.prevent="create">
        <label class="field">
          <span class="label">{{ c.users.form.username }}</span>
          <input v-model="form.username" class="input" maxlength="32" required autocomplete="off" autocapitalize="none" spellcheck="false">
          <span class="hint">{{ c.users.form.usernameHint }}</span>
        </label>
        <label class="field">
          <span class="label">{{ c.users.form.password }}</span>
          <input v-model="form.password" class="input" type="password" minlength="10" maxlength="200" required autocomplete="new-password">
          <span class="hint">{{ c.users.form.passwordHint }}</span>
        </label>
        <label class="field">
          <span class="label">{{ c.users.form.role }}</span>
          <select v-model="form.role" class="input">
            <option value="viewer">{{ c.users.roles.viewer }}</option>
            <option value="admin">{{ c.users.roles.admin }}</option>
          </select>
        </label>
        <p v-if="form.error" class="say say--error" role="alert">{{ form.error }}</p>
        <div class="form-actions">
          <button class="btn btn--primary" :disabled="form.busy">{{ form.busy ? c.common.working : c.users.form.create }}</button>
          <button type="button" class="btn" @click="form.open = false">{{ c.common.cancel }}</button>
        </div>
      </form>
    </UiDialog>

    <UiDialog :open="reset.user !== null" :name="reset.user ? c.users.reset.title(reset.user.username) : ''" @close="reset.user = null">
      <form class="form" @submit.prevent="setPassword">
        <p>{{ c.users.reset.body }}</p>
        <label class="field">
          <span class="label">{{ c.users.form.password }}</span>
          <input v-model="reset.password" class="input" type="password" minlength="10" maxlength="200" required autocomplete="new-password">
          <span class="hint">{{ c.users.form.passwordHint }}</span>
        </label>
        <p v-if="reset.error" class="say say--error" role="alert">{{ reset.error }}</p>
        <div class="form-actions">
          <button class="btn btn--primary" :disabled="reset.busy">{{ reset.busy ? c.common.working : c.users.reset.submit }}</button>
          <button type="button" class="btn" @click="reset.user = null">{{ c.common.cancel }}</button>
        </div>
      </form>
    </UiDialog>

    <UiDialog :open="removing.user !== null" :name="removing.user ? c.users.confirmDelete.title(removing.user.username) : ''" @close="removing.user = null">
      <div class="form">
        <p>{{ c.users.confirmDelete.body }}</p>
        <p v-if="removing.error" class="say say--error" role="alert">{{ removing.error }}</p>
        <div class="form-actions">
          <button type="button" class="btn btn--danger" :disabled="removing.busy" @click="remove">
            {{ removing.busy ? c.common.working : c.users.confirmDelete.yes }}
          </button>
          <button type="button" class="btn" @click="removing.user = null">{{ c.common.cancel }}</button>
        </div>
      </div>
    </UiDialog>
  </div>
</template>

<style scoped>
.error {
  margin-bottom: 0.9rem;
}
</style>
