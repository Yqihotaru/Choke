/**
 * PostgreSQL 唯一索引冲突（23505）。
 * drizzle 有时会把驱动错误包在 cause 里，两处都看一下。
 */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null
  return e?.code === "23505" || e?.cause?.code === "23505"
}
