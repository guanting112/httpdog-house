// GET /api/alerts/:id: one alert with its whole body.

import type { AlertDetail } from '#shared/api'
import { type AlertRecord, toAlertRow } from '../../utils/alerts'

interface DetailRecord extends AlertRecord {
  version: number
  body: string
  key_name: string | null
}

export default defineEventHandler(async (event): Promise<AlertDetail> => {
  const record = await useDb(event)
    .prepare('SELECT a.*, k.name AS key_name FROM alerts a LEFT JOIN signing_keys k ON k.id = a.key_id WHERE a.id = ?1')
    .bind(idParam(event))
    .first<DetailRecord>()
  if (!record) fail(404, 'not_found', 'no such alert')
  return { ...toAlertRow(record), version: record.version, keyName: record.key_name, body: record.body }
})
