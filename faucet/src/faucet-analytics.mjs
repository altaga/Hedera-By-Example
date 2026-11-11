/**
 * @file faucet-analytics.mjs
 * PostHog for the standalone Hedera by Example faucet server (Hedera analytics schema v1).
 * Same rules as the app's emitter (app/src/server/analytics.ts), see ANALYTICS_EVENTS.md:
 * catalog events only, sanitized properties, the v1 envelope, test traffic and bots skipped,
 * a 5 s limit on the send, and no error ever reaches the faucet's caller.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  buildCapturePayload,
  eventNamesWithLegacy,
  formatAppVersion,
  isBotUserAgent,
  isEventAllowedForApp,
  resolveEnv,
  resolveIdentity,
  sanitizeProperties,
} from './analyticsSchema.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const PKG_VERSION = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')).version;

const POSTHOG_CAPTURE_URL = 'https://us.i.posthog.com/capture/';
const POSTHOG_QUERY_HOST = 'https://us.posthog.com';
const SEND_TIMEOUT_MS = 5000;
const TEST_KEY_HEADER = 'x-test-api-key';

export const HBE_APP_TAG = 'hedera-by-example';
export const HBE_EVENT_FAUCET_CLAIM = 'faucet_claimed';

// In-memory cache for user counts to prevent spamming PostHog HogQL API
let cachedUserCount = { count: 0, timestamp: 0 };
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

function escapeSql(str) {
  return String(str || '').replace(/'/g, "''");
}

/** Reads one header from a Node `IncomingMessage` (lowercase keys; arrays joined). */
function header(req, name) {
  const value = req?.headers?.[name];
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'string' ? value : null;
}

const PRIVATE_IP = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|::$|f[cd][0-9a-f]{2}:|fe80:)/i;

function clientIp(req) {
  const candidates = [
    (header(req, 'x-forwarded-for') || '').split(',')[0],
    header(req, 'x-real-ip'),
    header(req, 'cf-connecting-ip'),
  ];
  for (const raw of candidates) {
    const ip = (raw || '').trim();
    if (ip && !PRIVATE_IP.test(ip)) return ip;
  }
  return null;
}

function countryCode(req) {
  const code = (header(req, 'x-vercel-ip-country') || header(req, 'cf-ipcountry') || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]$/.test(code) || code === 'XX' || code === 'T1') return null;
  return code;
}

/**
 * Builds and sends one v1 event. Never throws; resolves when the send finished, failed or
 * timed out. The server awaits it after the response has been written.
 *
 * @param {string} event
 * @param {Record<string, unknown>} properties
 * @param {{ service: string, origin: 'client'|'server', identity: object, req?: import('http').IncomingMessage, network?: 'testnet'|'mainnet'|null, fromBrowser?: boolean }} options
 */
export async function trackHbeEvent(event, properties, options) {
  try {
    const { service, origin, req = null, network = null } = options;
    if (process.env.POSTHOG_DISABLED === 'true') return;
    const testKey = process.env.TEST_API_KEY;
    if ((testKey && header(req, TEST_KEY_HEADER) === testKey) || properties?.is_test === true) return;
    if ((service === 'web' || options.fromBrowser) && isBotUserAgent(header(req, 'user-agent'))) return;
    if (!isEventAllowedForApp(event, HBE_APP_TAG)) {
      console.warn(`[ANALYTICS] Event not in the v1 catalog for ${HBE_APP_TAG}: ${event}`);
      return;
    }
    const apiKey = process.env.HBE_HOG_API_KEY || process.env.HOG_API_KEY;
    if (!apiKey) return;
    const { properties: clean, dropped } = sanitizeProperties(properties || {});
    if (dropped.length) console.warn(`[ANALYTICS] Dropped properties on ${event}: ${dropped.join(', ')}`);
    const payload = buildCapturePayload(apiKey, event, clean, {
      app: HBE_APP_TAG,
      service,
      origin,
      appVersion: formatAppVersion(PKG_VERSION, process.env.VERCEL_GIT_COMMIT_SHA),
      // The standalone faucet is not on Vercel: ANALYTICS_ENV says where it runs (default development).
      env: resolveEnv(process.env.ANALYTICS_ENV),
      network,
      identity: resolveIdentity(options.identity),
    });
    const ip = clientIp(req);
    if (ip) payload.properties.$ip = ip;
    const country = countryCode(req);
    if (country) {
      payload.properties.country = country;
      payload.properties.$geoip_country_code = country;
    }
    const res = await fetch(POSTHOG_CAPTURE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) console.warn(`[ANALYTICS] PostHog answered ${res.status} for ${event}`);
    else if (event === HBE_EVENT_FAUCET_CLAIM) cachedUserCount.timestamp = 0;
  } catch (err) {
    console.warn('[ANALYTICS] Failed to send event:', err?.message || err);
  }
}

/**
 * Unique wallets that claimed the faucet, across the v1 cut-over (v1 + legacy name): every
 * pre-v1 event (no schema_version, no env), v1 events from production only, never `anon:` ids.
 */
export async function getFaucetUniqueUsersCount() {
  const now = Date.now();
  if (now - cachedUserCount.timestamp < CACHE_TTL_MS) {
    return { ok: true, count: cachedUserCount.count, cached: true };
  }

  const apiKey = process.env.HOG_PERSONAL_API_KEY;
  const projectId = process.env.HOG_PROJECT_ID;

  if (!apiKey || !projectId) {
    return {
      ok: false,
      count: cachedUserCount.count,
      error: 'PostHog query credentials (HOG_PERSONAL_API_KEY / HOG_PROJECT_ID) not configured',
    };
  }

  const names = eventNamesWithLegacy(HBE_EVENT_FAUCET_CLAIM).map((n) => `'${escapeSql(n)}'`).join(', ');
  const hogql = `
    SELECT
      count(DISTINCT distinct_id)
    FROM events
    WHERE
      event IN (${names})
      AND properties.app = '${escapeSql(HBE_APP_TAG)}'
      AND (properties.schema_version IS NULL OR properties.env = 'production')
      AND (properties.id_source IS NULL OR properties.id_source != 'none')
  `.trim();

  try {
    const res = await fetch(`${POSTHOG_QUERY_HOST}/api/projects/${projectId}/query/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({
        refresh: 'force_blocking',
        query: { kind: 'HogQLQuery', query: hogql },
      }),
    });
    const data = await res.json();
    const count = data?.results?.[0]?.[0] ?? 0;
    cachedUserCount = { count, timestamp: now };
    return { ok: true, count, cached: false };
  } catch (err) {
    return { ok: false, count: cachedUserCount.count, error: err?.message || 'Query error' };
  }
}
