import fs from "node:fs"
import path from "node:path"

import { sql } from "drizzle-orm"

import { db, dbKind } from "../src/db/client"

const dir = path.resolve(import.meta.dirname, "../migrations")
console.log("dbKind:", dbKind)
console.log("migrations dir:", dir, fs.existsSync(dir))
console.log("files:", fs.existsSync(dir) ? fs.readdirSync(dir) : [])

const result = await db.execute(
  sql`select current_database() as db, count(*)::int as tables from information_schema.tables where table_schema = 'public'`,
)
console.log((result as unknown as { rows: unknown[] }).rows)
process.exit(0)
