// MySQL INFORMATION_SCHEMA helper for the `think crud` scaffolder.
// Reads column metadata for a given table so the generator can emit a
// matching TypeORM entity and form fields.
import mysql from 'mysql2/promise'
import { loadDbConfig } from '../../common/env.ts'

export interface ColumnInfo {
  name: string
  dataType: string                 // raw MySQL type: int, varchar, datetime, text, …
  columnType: string               // full type e.g. `varchar(100)`, `enum('a','b')`
  length: number | null
  unsigned: boolean
  nullable: boolean
  default: string | null
  comment: string
  isPk: boolean
  isAuto: boolean
  enumValues: string[] | null
}

export interface TableInfo {
  name: string
  columns: ColumnInfo[]
  pk: ColumnInfo | null
  comment: string
}

const ENUM_RE = /^(?:enum|set)\(([^)]*)\)/i

export async function introspectTable(table: string): Promise<TableInfo | null> {
  const cfg = loadDbConfig()
  const conn = await mysql.createConnection({
    host: cfg.host, port: cfg.port,
    user: cfg.user, password: cfg.password,
    database: cfg.database,
  })
  try {
    const [tblRows] = await conn.query(
      'SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1',
      [cfg.database, table],
    )
    const tbl = (tblRows as Array<{ TABLE_NAME: string; TABLE_COMMENT: string }>)[0]
    if (!tbl) return null

    const [colRows] = await conn.query(
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, CHARACTER_MAXIMUM_LENGTH AS LEN,
              IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA, COLUMN_COMMENT
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [cfg.database, table],
    )
    const cols = colRows as Array<{
      COLUMN_NAME: string; DATA_TYPE: string; COLUMN_TYPE: string;
      LEN: number | null; IS_NULLABLE: 'YES' | 'NO'; COLUMN_DEFAULT: string | null;
      COLUMN_KEY: string; EXTRA: string; COLUMN_COMMENT: string;
    }>

    const columns: ColumnInfo[] = cols.map((c) => {
      const enumMatch = ENUM_RE.exec(c.COLUMN_TYPE)
      const enumValues = enumMatch
        ? enumMatch[1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
        : null
      return {
        name: c.COLUMN_NAME,
        dataType: c.DATA_TYPE.toLowerCase(),
        columnType: c.COLUMN_TYPE,
        length: c.LEN,
        unsigned: /unsigned/i.test(c.COLUMN_TYPE),
        nullable: c.IS_NULLABLE === 'YES',
        default: c.COLUMN_DEFAULT,
        comment: c.COLUMN_COMMENT,
        isPk: c.COLUMN_KEY === 'PRI',
        isAuto: /auto_increment/i.test(c.EXTRA),
        enumValues,
      }
    })
    const pk = columns.find((c) => c.isPk) ?? null

    return {
      name: tbl.TABLE_NAME,
      columns,
      pk,
      comment: tbl.TABLE_COMMENT,
    }
  } finally {
    await conn.end()
  }
}
