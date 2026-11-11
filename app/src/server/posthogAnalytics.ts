/**
 * @file posthogAnalytics.ts
 * Reads from PostHog for Hedera by Example: the faucet's unique-user count. Sending events
 * lives in ./analytics.ts (Hedera analytics schema v1).
 */

import { eventNamesWithLegacy } from '../lib/analyticsSchema';

const POSTHOG_QUERY_HOST = 'https://us.posthog.com';

export const HBE_APP_TAG = 'hedera-by-example';
/** The faucet claim event (v1); history also includes its legacy name. */
export const HBE_EVENT_FAUCET_CLAIM = 'faucet_claimed';

let cachedUserCount = { count: 0, timestamp: 0 };
const CACHE_TTL_MS = 60 * 1000;

function escapeSql(str: string): string {
  return String(str || '').replace(/'/g, "''");
}

/**
 * Unique wallets that claimed the faucet, across the v1 cut-over: the v1 name plus its legacy
 * name. Pre-v1 events have no schema_version and no env, and all count; v1 events count only
 * from production. Never the per-event `anon:` ids.
 */
export async function getFaucetUniqueUsersCount(): Promise<{ ok: boolean; count: number; cached?: boolean; error?: string }> {
  const now = Date.now();
  if (now - cachedUserCount.timestamp < CACHE_TTL_MS) {
    return { ok: true, count: cachedUserCount.count, cached: true };
  }

  const apiKey = process.env.HOG_PERSONAL_API_KEY;
  const projectId = process.env.HOG_PROJECT_ID;
  if (!apiKey || !projectId) {
    return { ok: false, count: cachedUserCount.count, error: 'PostHog query credentials missing' };
  }

  const names = eventNamesWithLegacy(HBE_EVENT_FAUCET_CLAIM).map((n) => `'${escapeSql(n)}'`).join(', ');
  const hogql = `SELECT count(DISTINCT distinct_id) FROM events WHERE event IN (${names}) AND properties.app = '${escapeSql(HBE_APP_TAG)}' AND (properties.schema_version IS NULL OR properties.env = 'production') AND (properties.id_source IS NULL OR properties.id_source != 'none')`;
  try {
    const res = await fetch(`${POSTHOG_QUERY_HOST}/api/projects/${projectId}/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({
        refresh: 'force_blocking',
        query: { kind: 'HogQLQuery', query: hogql },
      }),
    });
    const data = (await res.json()) as any;
    const count = data?.results?.[0]?.[0] ?? 0;
    cachedUserCount = { count, timestamp: now };
    return { ok: true, count, cached: false };
  } catch (err: any) {
    return { ok: false, count: cachedUserCount.count, error: err?.message || 'Query error' };
  }
}
