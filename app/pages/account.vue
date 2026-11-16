<script setup lang="ts">
// Your own account: change the password, pick the language and the look.
const c = useContent()
const api = useApi()
const { locale, setLocale } = useLocale()
const { theme, setTheme } = useTheme()
const { user } = useSession()

useHead({ title: () => `${c.value.account.title} | httpdog house` })

const form = reactive({ current: '', next: '', again: '', busy: false, error: '', done: false })

async function submit() {
  form.error = ''
  form.done = false
  if (form.next !== form.again) {
    form.error = c.value.account.mismatch
    return
  }
  form.busy = true
  try {
    await api('/api/auth/password', { method: 'POST', body: { current: form.current, next: form.next } })
    Object.assign(form, { current: '', next: '', again: '', done: true })
  } catch (cause) {
    form.error = explain(cause as ApiFailure, c.value)
  } finally {
    form.busy = false
  }
}
</script>

<template>
  <div class="account stack">
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ c.account.title }}</h1>
        <p v-if="user" class="page-lead">{{ c.account.signedInAs(user.username, c.users.roles[user.role]) }}</p>
      </div>
    </div>

    <section class="panel">
      <header class="panel-bar">
        <span class="panel-name">{{ c.account.changePassword }}</span>
      </header>
      <form class="panel-body form" @submit.prevent="submit">
        <!-- lets a password manager file the new password under the right account -->
        <input class="sr-only" type="text" name="username" autocomplete="username" :value="user?.username" readonly tabindex="-1" aria-hidden="true">
        <label class="field">
          <span class="label">{{ c.account.current }}</span>
          <input v-model="form.current" class="input" type="password" required autocomplete="current-password">
        </label>
        <label class="field">
          <span class="label">{{ c.account.next }}</span>
          <input v-model="form.next" class="input" type="password" minlength="10" maxlength="200" required autocomplete="new-password">
          <span class="hint">{{ c.account.nextHint }}</span>
        </label>
        <label class="field">
          <span class="label">{{ c.account.again }}</span>
          <input v-model="form.again" class="input" type="password" minlength="10" maxlength="200" required autocomplete="new-password">
        </label>
        <p v-if="form.error" class="say say--error" role="alert">{{ form.error }}</p>
        <p v-if="form.done" class="say say--ok" role="status">{{ c.account.changed }}</p>
        <div class="form-actions">
          <button class="btn btn--primary" :disabled="form.busy">{{ form.busy ? c.common.working : c.account.submit }}</button>
        </div>
      </form>
    </section>

    <section class="panel">
      <header class="panel-bar">
        <span class="panel-name">{{ c.account.language }}</span>
      </header>
      <div class="panel-body chips">
        <button type="button" class="chip" :class="{ 'chip--on': locale === 'en' }" lang="en" @click="setLocale('en')">English</button>
        <button type="button" class="chip" :class="{ 'chip--on': locale === 'zh-tw' }" lang="zh-Hant-TW" @click="setLocale('zh-tw')">繁體中文</button>
      </div>
    </section>

    <section class="panel">
      <header class="panel-bar">
        <span class="panel-name">{{ c.theme.label }}</span>
      </header>
      <div class="panel-body chips">
        <button type="button" class="chip" :class="{ 'chip--on': theme === 'dark' }" :aria-pressed="theme === 'dark'" @click="setTheme('dark')">{{ c.theme.dark }}</button>
        <button type="button" class="chip" :class="{ 'chip--on': theme === 'light' }" :aria-pressed="theme === 'light'" @click="setTheme('light')">{{ c.theme.light }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.account {
  max-width: 34rem;
}
</style>
