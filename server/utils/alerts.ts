// Rows of the `alerts` table, as the API hands them out.

import type { AlertRow } from '#shared/api'

/** The columns of an alert that the list shows; the body is left out because it can be large */
export const ALERT_COLUMNS =
  'id, received_at, fired_at, instance, kind, rule, message, group_by, group_value, hits, window_secs, dropped, deliveries'

export interface AlertRecord {
  id: number
  received_at: number
  fired_at: number
  instance: string
  kind: string
  rule: string
  message: string
  group_by: string | null
  group_value: string | null
  hits: number | null
  window_secs: number | null
  dropped: number | null
  deliveries: number
}

export function toAlertRow(record: AlertRecord): AlertRow {
  return {
    id: record.id,
    receivedAt: record.received_at,
    firedAt: record.fired_at,
    instance: record.instance,
    kind: record.kind,
    rule: record.rule,
    message: record.message,
    groupBy: record.group_by,
    group: record.group_value,
    hits: record.hits,
    windowSecs: record.window_secs,
    dropped: record.dropped,
    deliveries: record.deliveries,
  }
}
