interface CacheRecord {
  checkedAt: number
  value: string | null
}

export interface VisitCacheStore {
  get(key: string): Promise<unknown>
  set(key: string, value: CacheRecord, options: { ttl: number }): Promise<unknown>
}

/** Visit-triggered refresh before SSR, with a cooldown on failed attempts too.
 * The store is shared; the promise only deduplicates within this server instance.
 * get/set is not an atomic distributed lock, so cold instances can race. */
export function createVisitCache(options: {
  key: string
  intervalMs: number
  store: VisitCacheStore
  valid: (value: string) => boolean
  refresh: (previous: string | null) => Promise<string | null>
  now?: () => number
}) {
  const now = options.now ?? Date.now
  let local: CacheRecord | null = null
  let pending: Promise<void> | null = null
  const due = () => !local || now() - local.checkedAt >= options.intervalMs
  const save = () => options.store.set(options.key, local!, { ttl: 7 * 24 * 60 * 60 })

  function parse(input: unknown): CacheRecord | null {
    if (!input || typeof input !== 'object') return null
    const record = input as Partial<CacheRecord>
    if (
      typeof record.checkedAt !== 'number' ||
      !Number.isSafeInteger(record.checkedAt) ||
      record.checkedAt < 0 ||
      record.checkedAt > now() ||
      !(record.value === null || (typeof record.value === 'string' && options.valid(record.value)))
    )
      return null
    return record as CacheRecord
  }

  async function loadShared() {
    try {
      const shared = parse(await options.store.get(options.key))
      if (shared && (!local || shared.checkedAt >= local.checkedAt)) local = shared
    } catch {
      local = { checkedAt: now(), value: local?.value ?? null }
    }
  }

  async function refresh() {
    try {
      if (!due()) return

      // Publish only a completed attempt. Publishing the new timestamp with
      // the old value first would let another instance cache stale data for
      // an entire interval while this request is still fetching.
      local = { checkedAt: now(), value: local?.value ?? null }
      try {
        const value = await options.refresh(local.value)
        if (value !== null && options.valid(value)) local = { ...local, value }
      } finally {
        await save()
      }
    } catch {
      local = { checkedAt: now(), value: local?.value ?? null }
    }
  }

  return async function read(fallback: string | null = null): Promise<string | null> {
    if (!pending && due()) {
      pending = loadShared()
        .then(refresh)
        .finally(() => {
          pending = null
        })
    }
    // Resolve the eligible update before rendering, including concurrent visits.
    await pending
    // Cookies are a per-request fallback only, never input to the shared cache.
    return local?.value ?? fallback
  }
}
