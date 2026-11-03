/**
 * @file posthogAnalytics.ts
 * PostHog analytics integration for Hedera by Example (HBE) Faucet Server Functions.
 * Runs strictly server-side in Expo Router API routes.
 */

const POSTHOG_CAPTURE_URL = 'https://us.i.posthog.com/capture/';
const POSTHOG_QUERY_HOST = 'https://us.posthog.com';

export const HBE_EVENT_FAUCET_CLAIM = 'hbe_faucet_claimed';
export const HBE_APP_TAG = 'hedera-by-example';

let cachedUserCount = { count: 0, timestamp: 0 };
const CACHE_TTL_MS = 60 * 1000;

function escapeSql(str: string): string {
  return String(str || '').replace(/'/g, "''");
}

export async function recordFaucetClaim({
  evmAddress,
  accountId,
  amount = 10,
  txHash,
  network = 'testnet',
}: {
  evmAddress: string;
  accountId?: string;
  amount?: number;
  txHash?: string;
  network?: string;
}): Promise<boolean> {
  if (process.env.POSTHOG_DISABLED === 'true') return false;

  const apiKey = process.env.HBE_HOG_API_KEY || process.env.HOG_API_KEY;
  if (!apiKey) return false;

  const distinctId = (accountId || evmAddress || 'unknown').toLowerCase();
  const payload = {
    api_key: apiKey,
    event: HBE_EVENT_FAUCET_CLAIM,
    distinct_id: distinctId,
    properties: {
      app: HBE_APP_TAG,
      distinct_id: distinctId,
      evm_address: evmAddress,
      account_id: accountId || null,
      amount_hbar: amount,
      tx_hash: txHash || null,
      network,
      service: 'faucet',
      timestamp: new Date().toISOString(),
    },
  };

  try {
    const res = await fetch(POSTHOG_CAPTURE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) cachedUserCount.timestamp = 0;
    return res.ok;
  } catch (err: any) {
    console.warn('[ANALYTICS] Failed to emit PostHog faucet event:', err?.message || err);
    return false;
  }
}

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

  const hogql = `SELECT count(DISTINCT distinct_id) FROM events WHERE event = '${escapeSql(HBE_EVENT_FAUCET_CLAIM)}' AND properties.app = '${escapeSql(HBE_APP_TAG)}'`;
  try {
    const res = await fetch(`${POSTHOG_QUERY_HOST}/api/projects/${projectId}/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: hogql } }),
    });
    const data = (await res.json()) as any;
    const count = data?.results?.[0]?.[0] ?? 0;
    cachedUserCount = { count, timestamp: now };
    return { ok: true, count, cached: false };
  } catch (err: any) {
    return { ok: false, count: cachedUserCount.count, error: err?.message || 'Query error' };
  }
}
