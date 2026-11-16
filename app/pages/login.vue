<script setup lang="ts">
// The only page that needs no session.
import { DOG_ART } from '~/content/art'
import { nextPath } from '~/lib/route'

definePageMeta({ layout: false })

const c = useContent()
const { setLocale } = useLocale()
const { signIn } = useSession()
const route = useRoute()

const username = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')

useHead({ title: () => `${c.value.login.title} | httpdog house` })

async function submit() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await signIn(username.value, password.value)
    await navigateTo(nextPath(route.query.next))
  } catch (cause) {
    error.value = explain(toFailure(cause), c.value)
    password.value = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="login">
    <pre class="art" aria-hidden="true">{{ DOG_ART }}</pre>

    <form class="panel box" @submit.prevent="submit">
      <header class="panel-bar">
        <span class="panel-name">httpdog house</span>
        <span class="panel-status"><i class="dot" /> {{ c.login.title }}</span>
      </header>
      <div class="panel-body form">
        <p class="lead">{{ c.login.lead }}</p>
        <label class="field">
          <span class="label">{{ c.login.username }}</span>
          <input v-model="username" class="input" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus>
        </label>
        <label class="field">
          <span class="label">{{ c.login.password }}</span>
          <input v-model="password" class="input" type="password" name="password" autocomplete="current-password" required>
        </label>
        <p v-if="error" class="say say--error" role="alert">{{ error }}</p>
        <div class="form-actions">
          <button class="btn btn--primary" :disabled="busy">{{ busy ? c.common.working : c.login.submit }}</button>
          <button type="button" class="act lang" @click="setLocale(c.other.locale)">{{ c.other.label }}</button>
        </div>
      </div>
    </form>
  </main>
</template>

<style scoped>
.login {
  min-height: 100svh;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: clamp(1.5rem, 6vw, 4.5rem);
  padding: 2rem var(--gutter);
  /* a little light behind the dog, so the black is not flat */
  background: radial-gradient(50% 60% at 50% 50%, rgba(255, 180, 84, 0.06), transparent 70%);
}
.art {
  font-size: 0.88rem;
  line-height: 0.92;
  font-weight: 700;
  color: var(--amber);
  text-shadow: 0 0 10px rgba(255, 180, 84, 0.5);
  user-select: none;
}
.box {
  width: min(24rem, 100%);
}
.lead {
  color: var(--dim);
  font-size: 0.93rem;
}
.lang {
  margin-left: auto;
}
@media (max-width: 640px) {
  .art {
    display: none;
  }
}
</style>
