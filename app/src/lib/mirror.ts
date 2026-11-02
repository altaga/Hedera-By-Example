/**
 * The one way the site talks to the public testnet Mirror Node.
 *
 * The public Mirror Node rate-limits per IP, and a learner's browser can fire
 * many reads at once (the resources panel, balances, lab helpers, topic
 * listeners). Every request goes through here:
 *   - at most MAX_CONCURRENT requests in flight and MAX_PER_SECOND started per second;
 *   - identical GETs within a short window share one response (cache);
 *   - 429 Too Many Requests waits (Retry-After or exponential backoff) and retries.
 */
export const MIRROR_HOST = 'https://testnet.mirrornode.hedera.com'

const MAX_CONCURRENT = 4
const MAX_PER_SECOND = 8
const MAX_RETRIES = 4

const queue: (() => void)[] = []
let active = 0
const started: number[] = []

function pump () {
  while (active < MAX_CONCURRENT && queue.length) {
    const now = Date.now()
    while (started.length && now - started[0] >= 1000) started.shift()
    if (started.length >= MAX_PER_SECOND) {
      setTimeout(pump, 1000 - (now - started[0]) + 5)
      return
    }
    started.push(now)
    active++
    queue.shift()!()
  }
}

/** Runs `task` when a slot is free. */
function schedule<T> (task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push(() => {
      task().then(resolve, reject).finally(() => { active--; pump() })
    })
    pump()
  })
}

interface Cached { at: number; status: number; body: string; headers: [string, string][] }
const cache = new Map<string, Cached>()
const inflight = new Map<string, Promise<Cached>>()
const MAX_CACHE = 300

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function load (url: string, init?: RequestInit): Promise<Cached> {
  for (let attempt = 0; ; attempt++) {
    const res = await schedule(() => fetch(url, init))
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('retry-after'))
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt)
      continue
    }
    return { at: Date.now(), status: res.status, body: await res.text(), headers: [...res.headers.entries()] }
  }
}

const toResponse = (c: Cached) => new Response(c.status === 204 ? null : c.body, { status: c.status, headers: c.headers })

export const isMirrorUrl = (url: string) => url.startsWith(MIRROR_HOST)

/**
 * fetch() for Mirror Node URLs. GETs are cached for `ttlMs` (default 4 s;
 * pass 0 for data that must be fresh, such as a topic being followed).
 */
export async function mirrorFetch (url: string, { ttlMs = 4000, init }: { ttlMs?: number, init?: RequestInit } = {}): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase()
  if (method !== 'GET') return schedule(() => fetch(url, init))
  const hit = cache.get(url)
  if (hit && ttlMs > 0 && Date.now() - hit.at < ttlMs) return toResponse(hit)
  let pending = inflight.get(url)
  if (!pending) {
    pending = load(url, init).finally(() => inflight.delete(url))
    inflight.set(url, pending)
  }
  const result = await pending
  if (result.status < 500) {
    cache.set(url, result)
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string)
  }
  return toResponse(result)
}

/** JSON from the Mirror Node API (path like "/api/v1/accounts/0.0.5"), or null on 404. */
export async function mirrorJson<T = any> (pathOrUrl: string, opts?: { ttlMs?: number }): Promise<T | null> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : MIRROR_HOST + pathOrUrl
  const res = await mirrorFetch(url, opts)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Mirror Node ${res.status}`)
  return res.json()
}
