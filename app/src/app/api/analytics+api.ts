/**
 * @file analytics+api.ts
 * POST /api/analytics — relays browser analytics to the server-side emitter (schema v1).
 * Only the browser (origin: client) events of HBE are accepted: today `page_viewed`. The route
 * answers 204 right away and sends afterwards; invalid input is dropped, never an error.
 */
import { deferHbeEvent } from '../../server/analytics'

/** Browser events HBE accepts, with exactly their catalog properties (ANALYTICS_EVENTS.md §6). */
const CLIENT_EVENTS: Record<string, readonly string[]> = {
  page_viewed: ['path', 'view', 'lab_slug', 'referrer', 'screen_width', 'screen_height', 'lang']
}

/** Keeps the event's catalog properties (strings clipped, numbers finite); the rest is dropped and logged. */
function pickProperties (event: string, input: Record<string, unknown>): Record<string, unknown> {
  const allowed = CLIENT_EVENTS[event]
  const out: Record<string, unknown> = {}
  const extra: string[] = []
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key)) { extra.push(key); continue }
    if (typeof value === 'string') out[key] = value.slice(0, 300)
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
    else if (value === null) out[key] = null
  }
  if (extra.length) console.warn(`[ANALYTICS] Dropped properties on ${event}: ${extra.join(', ')}`)
  return out
}

export async function POST (request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { event?: unknown, properties?: unknown, device_id?: unknown } | null
    const event = typeof body?.event === 'string' ? body.event : ''
    const properties = body?.properties && typeof body.properties === 'object' && !Array.isArray(body.properties)
      ? body.properties as Record<string, unknown>
      : null
    if (Object.prototype.hasOwnProperty.call(CLIENT_EVENTS, event) && properties) {
      const picked = pickProperties(event, properties)
      // The referrer is stored as its origin only, never the full URL.
      let referrer: string | null = null
      try { referrer = typeof picked.referrer === 'string' && picked.referrer ? new URL(picked.referrer).origin : null } catch { referrer = null }
      deferHbeEvent(event, { ...picked, referrer }, {
        service: 'web',
        origin: 'client',
        identity: { deviceId: typeof body?.device_id === 'string' ? body.device_id : null },
        request
      })
    }
  } catch {
    /* analytics never fails the request */
  }
  return new Response(null, { status: 204 })
}
