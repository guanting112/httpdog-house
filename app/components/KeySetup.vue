<script setup lang="ts">
// What to put on a host so that its httpdog sends here with this key: the two lines of
// secrets.env, the part of the rule file, and how to check. Each block can be copied whole.
const props = defineProps<{
  ingestUrl: string
  fingerprint: string
  /** The names and patterns the key accepts; the first usable one becomes the example */
  patterns: string[]
  /** The secret when the reader has asked to see it; otherwise a placeholder is shown */
  secret?: string
}>()

const c = useContent()

// web-* becomes web-01: something that could be typed as it is and would be accepted
const instance = computed(() => {
  const pattern = props.patterns.find((item) => !item.includes('*')) ?? props.patterns[0] ?? 'web-01'
  return pattern.replaceAll('*', '01') || 'web-01'
})
const secret = computed(() => props.secret ?? c.value.keys.setup.secretPlaceholder)

const env = computed(() => `HTTPDOG_WEBHOOK_URL=${props.ingestUrl}\nHTTPDOG_WEBHOOK_SECRET=${secret.value}`)

const rules = computed(
  () => `instance: ${instance.value}    # ${c.value.keys.setup.instanceComment}

notifiers:
  ops:
    type: webhook
    url_env: HTTPDOG_WEBHOOK_URL
    secret_env: HTTPDOG_WEBHOOK_SECRET`,
)

const check = computed(
  () => `sudo systemctl restart httpdog    # ${c.value.keys.setup.restartComment}

# ${c.value.keys.setup.fingerprintComment(props.fingerprint)}
sudo grep '^HTTPDOG_WEBHOOK_SECRET=' /etc/httpdog/secrets.env | cut -d= -f2- | tr -d '\\n' | sha256sum | cut -c1-8

# ${c.value.keys.setup.testComment}
HTTPDOG_WEBHOOK_SECRET='${secret.value}' bun scripts/send-test-alert.ts ${props.ingestUrl} ${instance.value}`,
)
</script>

<template>
  <div class="setup">
    <p class="dim">{{ c.keys.setupLead }}</p>
    <CodeBlock :code="env" lang="env" :name="c.keys.setup.env" wrap />
    <CodeBlock :code="rules" lang="yaml" :name="c.keys.setup.rules" />
    <CodeBlock :code="check" lang="shell" :name="c.keys.setup.restart" wrap />
  </div>
</template>

<style scoped>
.setup {
  display: grid;
  gap: 0.7rem;
  min-width: 0;
}
</style>
