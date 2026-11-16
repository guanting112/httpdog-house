// A stand-in for a D1 database in tests: the same calls the Workers make, answered by an
// in-memory SQLite that has the real migrations applied. Only what this project uses is here.

import { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(import.meta.dir, '..', 'migrations')

type Bindable = string | number | bigint | boolean | null | Uint8Array

class Statement {
  constructor(
    private readonly db: Database,
    private readonly sql: string,
    private readonly args: Bindable[] = [],
  ) {}

  bind(...args: Bindable[]): Statement {
    return new Statement(this.db, this.sql, args)
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.db.query(this.sql).get(...this.args) as Record<string, unknown> | null
    if (!row) return null
    return (column ? (row[column] ?? null) : row) as T
  }

  async all<T = Record<string, unknown>>() {
    const results = this.db.query(this.sql).all(...this.args) as T[]
    return { results, success: true as const, meta: this.meta() }
  }

  async run() {
    const outcome = this.db.query(this.sql).run(...this.args)
    return { results: [], success: true as const, meta: { ...this.meta(), changes: outcome.changes, last_row_id: Number(outcome.lastInsertRowid) } }
  }

  private meta() {
    const changes = this.db.query('SELECT changes() AS n').get() as { n: number }
    return { changes: changes.n, last_row_id: 0, duration: 0, rows_read: 0, rows_written: 0 }
  }
}

export interface TestDb {
  /** Pass this where a Worker expects `env.DB` */
  d1: D1Database
  /** The SQLite underneath, for a test to look at what was written */
  sqlite: Database
}

export function createTestDb(): TestDb {
  const sqlite = new Database(':memory:')
  // D1 enforces foreign keys
  sqlite.run('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (file.endsWith('.sql')) sqlite.run(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }
  const d1 = {
    prepare: (sql: string) => new Statement(sqlite, sql),
    // D1 runs a batch as one transaction: all of it happens or none of it
    async batch(statements: Statement[]) {
      sqlite.run('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.all())
        sqlite.run('COMMIT')
        return results
      } catch (error) {
        sqlite.run('ROLLBACK')
        throw error
      }
    },
    async exec(sql: string) {
      sqlite.run(sql)
      return { count: 1, duration: 0 }
    },
  }
  return { d1: d1 as unknown as D1Database, sqlite }
}
