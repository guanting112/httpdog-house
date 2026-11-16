// GET /api/alerts: the alert list, newest first.
//
//   instance, rule   exact match
//   q                text anywhere in the body, ignoring case
//   from, to         received between these times (unix seconds)
//   before           only alerts older than this id: the next page
//   after            only alerts newer than this id: what arrived since the last look
//   limit            1 to 200, default 50
//
// Every query here walks an index in id order and stops at `limit`, so the cost of a page does not
// grow with the number of alerts stored. The one exception is `q`, which has to read bodies; it is
// bounded separately, below.

import type { AlertPage } from '#shared/api'
import { ALERT_COLUMNS, type AlertRecord, toAlertRow } from '../../utils/alerts'

const PAGE = 50
const MAX_PAGE = 200

/**
 * How many alerts one text search may read. Without a bound, a search for something rare would
 * read every alert stored, and D1 counts rows read: on the free plan a few such searches a day
 * would use up the allowance the ingest Worker also depends on. A search that reaches the bound
 * says how far back it looked, and the next request carries on from there.
 */
const SEARCH_SPAN = 50_000

export default defineEventHandler(async (event): Promise<AlertPage> => {
  const db = useDb(event)
  const query = getQuery(event)
  const instance = queryText(query.instance)
  const rule = queryText(query.rule)
  const q = queryText(query.q).trim()
  const from = queryInt(query.from)
  const to = queryInt(query.to)
  const before = queryInt(query.before)
  const after = queryInt(query.after)
  const limit = Math.min(Math.max(queryInt(query.limit) ?? PAGE, 1), MAX_PAGE)

  const where: string[] = []
  const args: (string | number | null)[] = []
  const add = (sql: string, ...values: (string | number | null)[]) => {
    where.push(sql)
    args.push(...values)
  }

  if (instance) add('instance = ?', instance)
  if (rule) add('rule = ?', rule)
  // Ids grow with arrival, so a range of time is a range of ids. The two ends are found through
  // the index on received_at, and the list itself can then stay in id order
  if (from !== null) add('id >= (SELECT id FROM alerts WHERE received_at >= ? ORDER BY received_at LIMIT 1)', from)
  if (to !== null) add('id <= (SELECT id FROM alerts WHERE received_at <= ? ORDER BY received_at DESC LIMIT 1)', to)
  if (before !== null) add('id < ?', before)
  if (after !== null) add('id > ?', after)

  // A search stops SEARCH_SPAN ids below where it starts: the page asked for, or the newest alert.
  // With `after` it is bounded already: only what arrived since
  const bounded = q !== '' && after === null
  if (bounded) add('id >= coalesce(?, (SELECT max(id) FROM alerts) + 1) - ?', before, SEARCH_SPAN)
  // The body is JSON, so the text is looked for as JSON would write it (a quote is \" there).
  // instr rather than LIKE: D1 refuses LIKE patterns longer than 50 bytes
  if (q) add('instr(lower(body), lower(?)) > 0', JSON.stringify(q).slice(1, -1))

  // One round trip and one snapshot: `head` is the newest id at the moment the list was read, so
  // a later request with after=head misses nothing and repeats nothing
  const [newest, list] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT max(id) AS head FROM alerts'),
    db
      .prepare(`SELECT ${ALERT_COLUMNS} FROM alerts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`)
      .bind(...args, limit + 1),
  ])
  const head = (newest!.results[0]?.head as number | null) ?? 0
  const results = list!.results as unknown as AlertRecord[]

  const items = results.slice(0, limit).map(toAlertRow)
  if (results.length > limit) return { items, head, next: items[items.length - 1]!.id, searched: null }

  const floor = bounded ? (before ?? head + 1) - SEARCH_SPAN : 0
  if (floor <= 1) return { items, head, next: null, searched: null }

  // The search stopped at `floor` without filling the page. Is there anything older to look at?
  const edge = await db
    .prepare(
      `SELECT (SELECT received_at FROM alerts WHERE id >= ?1 ORDER BY id LIMIT 1) AS at,
              EXISTS (SELECT 1 FROM alerts WHERE id < ?1) AS older`,
    )
    .bind(floor)
    .first<{ at: number | null; older: number }>()
  if (!edge?.older || edge.at === null || (from !== null && edge.at <= from)) return { items, head, next: null, searched: null }
  return { items, head, next: floor, searched: { to: edge.at } }
})
