import { useCallback, useEffect, useRef, useState } from "react"

import { onIdle } from "@/lib/idle"

/** 预取缓存的页数上限；key 变化时清空 */
const CACHE_LIMIT = 3

interface PagedResult<T> {
  rows: T[]
  total: number
}

interface Loaded<T> extends PagedResult<T> {
  key: string
  page: number
  error: string | null
}

/**
 * 服务端分页查询：key 或 page 变化时中止旧请求再发新请求。
 * 新数据回来前保留上一份 rows（loading=true），换页时网格不闪空；
 * 当前页回来后在空闲时预取下一页，只放内存。key 为空串时不请求。
 */
export function usePagedQuery<T>(
  key: string,
  page: number,
  load: (page: number, signal: AbortSignal) => Promise<PagedResult<T>>,
): { rows: T[] | null; total: number; error: string | null; loading: boolean; retry: () => void } {
  const [state, setState] = useState<Loaded<T> | null>(null)
  const [nonce, setNonce] = useState(0)
  const cache = useRef<{ key: string; pages: Map<number, PagedResult<T>> }>({ key: "", pages: new Map() })
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })
  const retry = useCallback(() => {
    cache.current.pages.clear()
    setNonce((value) => value + 1)
  }, [])

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    if (cache.current.key !== key) cache.current = { key, pages: new Map() }
    const pages = cache.current.pages
    const get = async (index: number) => {
      const cached = pages.get(index)
      if (cached) return cached
      const result = await loadRef.current(index, controller.signal)
      if (controller.signal.aborted) return null
      if (pages.size >= CACHE_LIMIT) pages.delete(pages.keys().next().value!)
      pages.set(index, result)
      return result
    }
    let cancelIdle = () => {}
    get(page)
      .then((result) => {
        if (!result) return
        setState({ ...result, key, page, error: null })
        // 当前页不是最后一页时，它一定是满页，已取到的行数就是页大小
        if (result.rows.length > 0 && (page + 1) * result.rows.length < result.total) {
          cancelIdle = onIdle(() => void get(page + 1).catch(() => {}), 1000)
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        const error = reason instanceof Error && reason.message ? reason.message : "加载失败"
        setState({ rows: [], total: 0, key, page, error })
      })
    return () => {
      controller.abort()
      cancelIdle()
    }
  }, [key, page, nonce])

  const loading = !!key && (state?.key !== key || state.page !== page)
  return {
    rows: state?.rows ?? null,
    total: state?.total ?? 0,
    error: state && !loading ? state.error : null,
    loading,
    retry,
  }
}
