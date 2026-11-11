/**
 * @file analytics.ts
 * The one server-side PostHog emitter for Hedera by Example (Hedera analytics schema v1).
 * Every HBE event goes through trackHbeEvent: page views (relayed by /api/analytics), MCP
 * sessions and tool calls, and faucet claims. See ANALYTICS_EVENTS.md at the repo root.
 *
 * PostHog never blocks or breaks HBE: callers schedule the send with deferHbeEvent (Expo's
 * deferTask, which keeps the work alive after the response on EAS Hosting), every error is
 * caught and only logged, and the PostHog fetch gives up after 5 s.
 */

import { deferTask } from 'expo-server'
import pkg from '../../package.json'
import {
  buildCapturePayload,
  formatAppVersion,
  isBotUserAgent,
  isEventAllowedForApp,
  resolveEnv,
  resolveIdentity,
  sanitizeProperties,
  type AnalyticsApp,
  type AnalyticsNetwork,
  type AnalyticsOrigin,
  type IdentityInput
} from '../lib/analyticsSchema'

const APP: AnalyticsApp = 'hedera-by-example'
const POSTHOG_CAPTURE_URL = 'https://us.i.posthog.com/capture/'
const SEND_TIMEOUT_MS = 5000
/** Hosts that serve the production deployment; other *.expo.app hosts are preview deployments. */
const PRODUCTION_HOSTS = ['hbe.expo.app']
/** Header that marks a request as test traffic, matched against HBE_TEST_API_KEY. */
const TEST_KEY_HEADER = 'x-hbe-test-key'

export type HbeService = 'web' | 'mcp' | 'faucet'

export interface TrackOptions {
  service: HbeService
  origin: AnalyticsOrigin
  identity: IdentityInput
  /** The incoming request: bot check, test key, env and geo come from it. */
  request?: Request | null
  /** Hedera network for faucet events; null for web and MCP. */
  network?: AnalyticsNetwork | null
  /** The event comes from a browser surface (web, the browser's faucet claim): bots don't count. */
  fromBrowser?: boolean
}

const header = (request: Request | null | undefined, name: string): string | null => {
  try { return request?.headers.get(name) ?? null } catch { return null }
}

/** On EAS Hosting there is no VERCEL_ENV: ANALYTICS_ENV wins, else the request host decides. */
function resolveHbeEnv (request: Request | null | undefined) {
  const override = process.env.ANALYTICS_ENV
  if (override) return resolveEnv(override)
  let host = ''
  try { host = request ? new URL(request.url).hostname : '' } catch { host = '' }
  if (!host) host = (header(request, 'host') || '').split(':')[0]
  if (PRODUCTION_HOSTS.includes(host)) return resolveEnv('production')
  if (host.endsWith('.expo.app')) return resolveEnv('preview')
  return resolveEnv(undefined)
}

const PRIVATE_IP = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|::$|f[cd][0-9a-f]{2}:|fe80:)/i

/** First public IP from x-forwarded-for, x-real-ip or cf-connecting-ip. */
function clientIp (request: Request | null | undefined): string | null {
  const candidates = [
    (header(request, 'x-forwarded-for') || '').split(',')[0],
    header(request, 'x-real-ip'),
    header(request, 'cf-connecting-ip')
  ]
  for (const raw of candidates) {
    const ip = (raw || '').trim()
    if (ip && !PRIVATE_IP.test(ip)) return ip
  }
  return null
}

function countryCode (request: Request | null | undefined): string | null {
  const code = (header(request, 'x-vercel-ip-country') || header(request, 'cf-ipcountry') || '').trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9]$/.test(code) || code === 'XX' || code === 'T1') return null
  return code
}

function isTestRequest (request: Request | null | undefined): boolean {
  const testKey = process.env.HBE_TEST_API_KEY
  return Boolean(testKey) && header(request, TEST_KEY_HEADER) === testKey
}

/**
 * Builds and sends one v1 event. Never throws and never rejects; resolves when the send
 * finished, failed or timed out. Callers in a request path use deferHbeEvent instead.
 */
export async function trackHbeEvent (event: string, properties: Record<string, unknown>, options: TrackOptions): Promise<void> {
  try {
    const { service, origin, request = null, network = null } = options
    // 1. Test traffic and bots.
    if (process.env.POSTHOG_DISABLED === 'true') return
    if (isTestRequest(request) || properties?.is_test === true) return
    if ((service === 'web' || options.fromBrowser) && isBotUserAgent(header(request, 'user-agent'))) return
    // 2. Only catalog events for this app.
    if (!isEventAllowedForApp(event, APP)) {
      console.warn(`[ANALYTICS] Event not in the v1 catalog for ${APP}: ${event}`)
      return
    }
    const apiKey = process.env.HBE_HOG_API_KEY || process.env.HOG_API_KEY
    if (!apiKey) return
    // 3. Clean properties.
    const { properties: clean, dropped } = sanitizeProperties(properties || {})
    if (dropped.length) console.warn(`[ANALYTICS] Dropped properties on ${event}: ${dropped.join(', ')}`)
    // 4-5. Identity and envelope.
    const identity = resolveIdentity(options.identity)
    const payload = buildCapturePayload(apiKey, event, clean, {
      app: APP,
      service,
      origin,
      // EAS Hosting has no VERCEL_GIT_COMMIT_SHA: app_version is the package version alone there.
      appVersion: formatAppVersion(pkg.version, process.env.VERCEL_GIT_COMMIT_SHA),
      env: resolveHbeEnv(request),
      network,
      identity
    })
    // 6. Geo, from the request.
    const ip = clientIp(request)
    if (ip) payload.properties.$ip = ip
    const country = countryCode(request)
    if (country) {
      payload.properties.country = country
      payload.properties.$geoip_country_code = country
    }
    // 7. Send, with a 5 s limit.
    const res = await fetch(POSTHOG_CAPTURE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    })
    if (!res.ok) console.warn(`[ANALYTICS] PostHog answered ${res.status} for ${event}`)
  } catch (err: any) {
    console.warn('[ANALYTICS] Failed to send event:', err?.message || err)
  }
}

/**
 * 8. Schedules trackHbeEvent without blocking the caller: inside a request it runs in Expo's
 * deferTask (kept alive after the response, like waitUntil); outside one (scripts, tests,
 * the local Node server) it is sent directly. Never throws.
 */
export function deferHbeEvent (event: string, properties: Record<string, unknown>, options: TrackOptions): void {
  deferAnalytics(() => trackHbeEvent(event, properties, options))
}

/** Same scheduling for work that must run before the event is built (e.g. the async MCP identity). */
export function deferAnalytics (task: () => Promise<unknown>): void {
  const safe = () => Promise.resolve().then(task).catch((err: any) => { console.warn('[ANALYTICS] Deferred task failed:', err?.message || err) })
  try {
    deferTask(safe)
  } catch {
    try { void safe() } catch { /* never throws */ }
  }
}
