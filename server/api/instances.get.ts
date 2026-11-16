// GET /api/instances: every instance that has sent an alert, and every name a key lists that has
// not sent one yet, each with the keys that accept it.

import type { InstanceRow } from '#shared/api'
import { matchesInstance } from '#shared/instances'

interface SourceTotals {
  instance: string
  first_at: number
  last_at: number
  total: number
  rules: number
}

export default defineEventHandler(async (event): Promise<{ items: InstanceRow[] }> => {
  const db = useDb(event)
  // the first of the last 24 hourly buckets
  const firstHour = Math.floor(unixNow() / 3600) - 23

  const [sources, day, patterns] = await db.batch<Record<string, unknown>>([
    db.prepare(
      `SELECT instance, min(first_at) AS first_at, max(last_at) AS last_at, sum(total) AS total, count(*) AS rules
         FROM alert_sources GROUP BY instance`,
    ),
    db.prepare('SELECT instance, sum(total) AS total FROM alert_hours WHERE hour >= ?1 GROUP BY instance').bind(firstHour),
    db.prepare(
      `SELECT k.name, p.pattern FROM signing_keys k JOIN key_instances p ON p.key_id = k.id
        WHERE k.enabled = 1 ORDER BY k.name`,
    ),
  ])

  const accepted = patterns!.results as unknown as { name: string; pattern: string }[]
  const keysFor = (instance: string) => [
    ...new Set(accepted.filter((row) => matchesInstance(row.pattern, instance)).map((row) => row.name)),
  ]
  const dayTotals = new Map((day!.results as unknown as { instance: string; total: number }[]).map((row) => [row.instance, row.total]))

  const items: InstanceRow[] = (sources!.results as unknown as SourceTotals[]).map((row) => ({
    name: row.instance,
    seen: true,
    firstAt: row.first_at,
    lastAt: row.last_at,
    total: row.total,
    day: dayTotals.get(row.instance) ?? 0,
    rules: row.rules,
    keys: keysFor(row.instance),
  }))

  // A name written out in full on a key, with nothing received from it yet: worth showing, because
  // "set up but silent" is exactly what someone checks this page for
  const seen = new Set(items.map((item) => item.name))
  for (const { pattern } of accepted) {
    if (pattern.includes('*') || seen.has(pattern)) continue
    seen.add(pattern)
    items.push({ name: pattern, seen: false, firstAt: null, lastAt: null, total: 0, day: 0, rules: 0, keys: keysFor(pattern) })
  }

  // latest first; the ones that never sent anything go last, by name
  items.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0) || a.name.localeCompare(b.name))
  return { items }
})
