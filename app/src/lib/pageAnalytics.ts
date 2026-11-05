/**
 * Client-side PostHog pageviews for Hedera by Example (web only).
 * Never blocks rendering: scheduled idle/timeout, fire-and-forget, silent failures.
 * Uses the public project API key only (EXPO_PUBLIC_HOG_API_KEY). Never the personal key.
 */

export const HBE_EVENT_PAGE_VIEWED = 'hbe_page_viewed'
export const HBE_APP_TAG = 'hedera-by-example'

const POSTHOG_CAPTURE_URL = 'https://us.i.posthog.com/capture/'
const DISTINCT_KEY = 'hbe_anon_id_v1'

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

function publicApiKey (): string | null {
  try {
    const key = (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_HOG_API_KEY) || ''
    return key && key.startsWith('phc_') ? key : null
  } catch (_) {
    return null
  }
}

function anonDistinctId (): string {
  try {
    const existing = window.localStorage.getItem(DISTINCT_KEY)
    if (existing && existing.length >= 8) return existing
  } catch (_) { /* silent */ }
  let id = ''
  try {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `hbe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  } catch (_) {
    id = `hbe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  }
  try { window.localStorage.setItem(DISTINCT_KEY, id) } catch (_) { /* silent */ }
  return id
}

function schedule (fn: () => void): void {
  try {
    const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, opts?: { timeout: number }) => number)
    if (typeof ric === 'function') {
      ric(() => { try { fn() } catch (_) { /* silent */ } }, { timeout: 2000 })
      return
    }
  } catch (_) { /* fall through */ }
  try {
    setTimeout(() => { try { fn() } catch (_) { /* silent */ } }, 0)
  } catch (_) { /* silent */ }
}

function sendPayload (payload: object): void {
  const body = JSON.stringify(payload)
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon(POSTHOG_CAPTURE_URL, blob)) return
    }
  } catch (_) { /* fall through to fetch */ }
  try {
    void fetch(POSTHOG_CAPTURE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      mode: 'cors',
      credentials: 'omit'
    }).catch(() => undefined)
  } catch (_) { /* silent */ }
}

/**
 * Record a page view. Safe to call from React effects; never throws to the caller.
 * No-ops on native / SSR / missing key.
 */
export function recordPageView (input: PageViewInput): void {
  try {
    if (!isWeb()) return
    if (typeof process !== 'undefined' && process.env?.POSTHOG_DISABLED === 'true') return
    const apiKey = publicApiKey()
    if (!apiKey) return

    const path = String(input.path || '/')
    const lang = input.lang || (typeof document !== 'undefined' ? document.documentElement.lang : undefined) || undefined
    const labSlug = input.labSlug || null
    const screenW = typeof window.screen !== 'undefined' ? window.screen.width : undefined
    const screenH = typeof window.screen !== 'undefined' ? window.screen.height : undefined

    const view = input.view || null
    const dedupeKey = `${path}|${lang || ''}|${labSlug || ''}|${view || ''}`
    const now = Date.now()
    if (dedupeKey === lastSentKey && now - lastSentAt < 750) return
    lastSentKey = dedupeKey
    lastSentAt = now

    const payload = {
      api_key: apiKey,
      event: HBE_EVENT_PAGE_VIEWED,
      distinct_id: anonDistinctId(),
      properties: {
        app: HBE_APP_TAG,
        service: 'web',
        path,
        referrer: typeof document !== 'undefined' ? (document.referrer || null) : null,
        lang: lang || null,
        lab_slug: labSlug,
        view,
        screen_width: screenW ?? null,
        screen_height: screenH ?? null,
        timestamp: new Date().toISOString(),
        $process_person_profile: false
      }
    }

    schedule(() => sendPayload(payload))
  } catch (_) {
    /* never block, never throw */
  }
}
