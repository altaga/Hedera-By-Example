/**
 * Page views for Hedera by Example (web only), Hedera analytics schema v1.
 * The browser never talks to PostHog and holds no PostHog key: it posts `page_viewed` to HBE's
 * own /api/analytics, which builds the envelope and sends it server-side.
 * Never blocks rendering: scheduled when idle, keepalive request, every failure silent.
 */

const ANALYTICS_URL = '/api/analytics'
/** The visitor's anonymous UUID (v4), the same one HBE has always kept for page views. */
const DEVICE_ID_KEY = 'hbe_anon_id_v1'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Dedupe identical captures from double effects (same path/view within 750ms).
let lastSentKey = ''
let lastSentAt = 0

type PageViewInput = {
  path: string
  lang?: string
  labSlug?: string | null
  view?: string
}

function isWeb (): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function newUuidV4 (): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function deviceId (): string | null {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY)
    if (existing && UUID_V4.test(existing)) return existing
  } catch { /* storage blocked: fall through */ }
  try {
    const id = newUuidV4()
    try { window.localStorage.setItem(DEVICE_ID_KEY, id) } catch { /* silent */ }
    return id
  } catch {
    return null
  }
}

function schedule (fn: () => void): void {
  try {
    const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, opts?: { timeout: number }) => number)
    if (typeof ric === 'function') {
      ric(() => { try { fn() } catch { /* silent */ } }, { timeout: 2000 })
      return
    }
  } catch { /* fall through */ }
  try {
    setTimeout(() => { try { fn() } catch { /* silent */ } }, 0)
  } catch { /* silent */ }
}

/** Origin of the referring page only, never the full URL. */
function referrerOrigin (): string | null {
  try {
    return document.referrer ? new URL(document.referrer).origin : null
  } catch {
    return null
  }
}

export function recordPageView (input: PageViewInput): void {
  try {
    if (!isWeb()) return

    const path = String(input.path || '/')
    const lang = input.lang || document.documentElement.lang || null
    const labSlug = input.labSlug || null
    const view = input.view || null

    const dedupeKey = `${path}|${lang || ''}|${labSlug || ''}|${view || ''}`
    const now = Date.now()
    if (dedupeKey === lastSentKey && now - lastSentAt < 750) return
    lastSentKey = dedupeKey
    lastSentAt = now

    const body = JSON.stringify({
      event: 'page_viewed',
      device_id: deviceId(),
      properties: {
        path,
        view,
        lab_slug: labSlug,
        referrer: referrerOrigin(),
        screen_width: typeof window.screen !== 'undefined' ? window.screen.width : null,
        screen_height: typeof window.screen !== 'undefined' ? window.screen.height : null,
        lang
      }
    })

    schedule(() => {
      try {
        void fetch(ANALYTICS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
          credentials: 'omit'
        }).catch(() => undefined)
      } catch { /* silent */ }
    })
  } catch {
    /* never block, never throw */
  }
}
