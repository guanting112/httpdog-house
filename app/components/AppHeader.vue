<script setup lang="ts">
// The bar at the top of every page behind the login: where you are, where you can go, who you are.
const c = useContent()
const { setLocale } = useLocale()
const { user, isAdmin, signOut } = useSession()
const route = useRoute()

const links = computed(() => [
  // an alert's own page (/alerts/12) still belongs to "alerts"
  { to: '/', label: c.value.nav.alerts, on: route.path === '/' || route.path.startsWith('/alerts') },
  { to: '/instances', label: c.value.nav.instances, on: route.path === '/instances' },
  ...(isAdmin.value
    ? [
        { to: '/keys', label: c.value.nav.keys, on: route.path === '/keys' },
        { to: '/rejected', label: c.value.nav.rejected, on: route.path === '/rejected' },
        { to: '/users', label: c.value.nav.users, on: route.path === '/users' },
      ]
    : []),
])
</script>

<template>
  <header class="top">
    <a class="skip" href="#content">{{ c.nav.skip }}</a>
    <div class="wrap top-in">
      <NuxtLink class="brand" to="/" aria-label="httpdog house">
        httpdog<span class="cursor" aria-hidden="true" /><span class="brand-tag">house</span>
      </NuxtLink>
      <nav class="nav" aria-label="Pages">
        <NuxtLink v-for="link in links" :key="link.to" :to="link.to" :class="{ on: link.on }" :aria-current="link.on ? 'page' : undefined">
          {{ link.label }}
        </NuxtLink>
      </nav>
      <div class="tools">
        <button type="button" class="lang" :lang="c.other.locale === 'zh-tw' ? 'zh-Hant-TW' : 'en'" @click="setLocale(c.other.locale)">
          {{ c.other.label }}
        </button>
        <NuxtLink v-if="user" class="who" to="/account" :class="{ on: route.path === '/account' }">{{ user.username }}</NuxtLink>
        <button type="button" class="act" @click="signOut">{{ c.nav.signOut }}</button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.top {
  position: sticky;
  top: 0;
  z-index: 50;
  background: rgba(6, 8, 12, 0.82);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line);
  font-size: 0.9rem;
}
.top-in {
  display: flex;
  align-items: center;
  gap: 0.2rem 1.8rem;
  min-height: var(--header-h);
}
.brand {
  font-weight: 700;
  font-size: 1.08rem;
  color: var(--text-strong);
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.cursor {
  display: inline-block;
  width: 0.55em;
  height: 1em;
  margin-left: 0.14em;
  vertical-align: -0.14em;
  background: var(--amber);
  animation: blink 1.1s steps(1) infinite;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
.brand-tag {
  margin-left: 0.6em;
  font-weight: 400;
  font-size: 0.8rem;
  color: var(--dim);
  letter-spacing: 0.04em;
}
.nav {
  display: flex;
  gap: 1.5rem;
  margin-right: auto;
  color: var(--dim);
}
.nav a,
.who,
.lang {
  white-space: nowrap;
  transition: color 0.15s;
}
.nav a:hover,
.who:hover,
.lang:hover {
  color: var(--amber);
}
.nav a.on {
  color: var(--text-strong);
}
.nav a.on::before {
  content: '> ';
  color: var(--amber);
}
.tools {
  display: flex;
  align-items: center;
  gap: 1.2rem;
  color: var(--dim);
}
.who {
  color: var(--text);
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
}
.who.on {
  color: var(--amber);
}
.skip {
  position: absolute;
  left: 8px;
  top: -60px;
  padding: 0.5em 0.8em;
  background: var(--amber);
  color: #000;
  z-index: 60;
}
.skip:focus {
  top: 8px;
}

/* Narrow screens: the pages move to a second row that scrolls sideways, so every one stays reachable */
@media (max-width: 860px) {
  .top-in {
    flex-wrap: wrap;
    padding-top: 0.55rem;
  }
  .tools {
    margin-left: auto;
  }
  .nav {
    order: 3;
    width: 100%;
    margin: 0;
    padding-block: 0.45rem 0.55rem;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .nav::-webkit-scrollbar {
    display: none;
  }
  .brand-tag {
    display: none;
  }
}
</style>
