<script setup lang="ts">
// The only page that needs no session.
import { DOG_ART, HOUSE_ART } from '~/content/art'
import { nextPath } from '~/lib/route'

definePageMeta({ layout: false })

const c = useContent()
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
    <!-- the dog, sitting in front of its house -->
    <div class="arts" aria-hidden="true">
      <pre class="art art--house">{{ HOUSE_ART }}</pre>
      <pre class="art">{{ DOG_ART }}</pre>
    </div>

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
          <span class="switches">
            <LangMenu />
            <ThemeToggle />
          </span>
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
  /* when the form wraps under the picture, the two stay together in the middle of the page */
  align-content: center;
  gap: clamp(1.5rem, 6vw, 4.5rem);
  padding: 2rem var(--gutter);
  /* a little light behind the dog, so the black is not flat */
  background: radial-gradient(50% 60% at 50% 50%, rgba(var(--amber-rgb), 0.06), transparent 70%);
}
.arts {
  display: flex;
  align-items: flex-end;
  gap: 1.4rem;
}
.art {
  font-size: 0.88rem;
  line-height: 0.92;
  font-weight: 700;
  color: var(--amber);
  text-shadow: 0 0 10px rgba(var(--amber-rgb), calc(0.5 * var(--glow)));
  user-select: none;
}
/* the house stands behind the dog: a little dimmer, and without the glow */
.art--house {
  color: var(--amber-soft);
  text-shadow: none;
}
.box {
  width: min(24rem, 100%);
}
.lead {
  color: var(--dim);
  font-size: 0.93rem;
}
.switches {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
  font-size: 0.9rem;
}
@media (max-width: 640px) {
  .arts {
    display: none;
  }
}
</style>
