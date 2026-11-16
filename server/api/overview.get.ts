// GET /api/overview: the last 24 hours in numbers, and what the filters can offer.
//
//   instance, rule   narrow the numbers the same way the alert list is narrowed
//
// Read from the roll-up tables the ingest Worker keeps, never from the alerts themselves: the cost
// is a few rows per active instance and rule, however many alerts arrived.

import type { Overview } from '#shared/api'

const HOURS = 24
const TOP = 8

function busiest(totals: Map<string, number>): { name: string; total: number }[] {
  return [...totals]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .slice(0, TOP)
}

export default defineEventHandler(async (event): Promise<Overview> => {
  const db = useDb(event)
  const query = getQuery(event)
  const instance = queryText(query.instance)
  const rule = queryText(query.rule)

  const now = unixNow()
  const lastHour = Math.floor(now / 3600)
  const firstHour = lastHour - (HOURS - 1)

  const [recent, sources] = await db.batch<{ hour: number; instance: string; rule: string; total: number }>([
    db.prepare('SELECT hour, instance, rule, total FROM alert_hours WHERE hour >= ?1').bind(firstHour),
    db.prepare('SELECT 0 AS hour, instance, rule, 0 AS total FROM alert_sources'),
  ])

  const hours = Array.from({ length: HOURS }, (_, i) => ({ hour: firstHour + i, total: 0 }))
  const rules = new Map<string, number>()
  const instances = new Map<string, number>()
  let total = 0
  for (const row of recent!.results) {
    const sameInstance = !instance || row.instance === instance
    const sameRule = !rule || row.rule === rule
    // each list is narrowed by the other filter only, so it still shows what else there is to pick
    if (sameInstance) rules.set(row.rule, (rules.get(row.rule) ?? 0) + row.total)
    if (sameRule) instances.set(row.instance, (instances.get(row.instance) ?? 0) + row.total)
    if (sameInstance && sameRule) {
      total += row.total
      const slot = hours[row.hour - firstHour]
      if (slot) slot.total += row.total
    }
  }

  return {
    now,
    hours,
    total,
    rules: busiest(rules),
    instances: busiest(instances),
    facets: {
      instances: [...new Set(sources!.results.map((row) => row.instance))].sort(),
      rules: [...new Set(sources!.results.map((row) => row.rule))].sort(),
    },
  }
})
