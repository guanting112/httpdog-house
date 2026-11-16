<!-- Every page behind the login: the header, then the page. The sign-in page uses no layout. -->
<template>
  <div>
    <AppHeader />
    <main id="content" class="wrap page">
      <slot />
    </main>
  </div>
</template>
