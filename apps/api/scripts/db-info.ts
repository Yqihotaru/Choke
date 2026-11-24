import fs from "node:fs"
import path from "node:path"

import { sql as sqlTag } from "drizzle-orm"

import { db, sql } from "../src/db/client"

const dir = path.resolve(import.meta.dirname, "../migrations")
console.log("db:", sql ? "postgres" : "pglite (test)")
console.log("migrations dir:", dir, fs.existsSync(dir))
console.log("files:", fs.existsSync(dir) ? fs.readdirSync(dir) : [])

const result = await db.execute(
  sqlTag`select current_database() as db, count(*)::int as tables from information_schema.tables where table_schema = 'public'`,
)
console.log(result)
process.exit(0)
