/**
 * @file faucet-analytics.mjs
 * PostHog analytics integration for Hedera by Example (HBE) Faucet.
 *
 * Tracks unique users claiming testnet HBAR, tagged with app='hedera-by-example'
 * and event='hbe_faucet_claimed' to maintain separation within the shared PostHog project.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const POSTHOG_CAPTURE_URL = 'https://us.i.posthog.com/capture/';
const POSTHOG_QUERY_HOST = 'https://us.posthog.com';

export const HBE_EVENT_FAUCET_CLAIM = 'hbe_faucet_claimed';
export const HBE_APP_TAG = 'hedera-by-example';

// In-memory cache for user counts to prevent spamming PostHog HogQL API
let cachedUserCount = { count: 0, timestamp: 0 };
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

/**
 * Escapes single quotes for HogQL literal inclusion.
 * @param {string} str
 * @returns {string}
 */
function escapeSql(str) {
  return String(str || '').replace(/'/g, "''");
}

/**
 * Records a successful faucet disbursement in PostHog.
 * Non-blocking: failures are logged but never interrupt the user payout.
 *
 * @param {object} params
 * @param {string} params.evmAddress
 * @param {string} [params.accountId]
 * @param {number} [params.amount=10]
 * @param {string} [params.txHash]
 * @param {string} [params.network='testnet']
 * @returns {Promise<boolean>}
 */
export async function recordFaucetClaim({
  evmAddress,
  accountId,
  amount = 10,
  txHash,
  network = 'testnet',
}) {
  if (process.env.POSTHOG_DISABLED === 'true') {
    return false;
  }

  const apiKey = process.env.HBE_HOG_API_KEY || process.env.HOG_API_KEY;
  if (!apiKey) {
    console.warn('[ANALYTICS] PostHog API key (HOG_API_KEY) not configured; skipping metric.');
    return false;
  }

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

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.warn(`[ANALYTICS] PostHog capture responded ${res.status}: ${err.slice(0, 100)}`);
      return false;
    }

    // Invalidate count cache on new claim
    cachedUserCount.timestamp = 0;
    return true;
  } catch (err) {
    console.warn('[ANALYTICS] Failed to emit PostHog faucet event:', err.message);
    return false;
  }
}

/**
 * Queries the count of unique users who have claimed from the HBE faucet using HogQL.
 * Uses 60-second in-memory caching to avoid query rate limits.
 *
 * @returns {Promise<{ ok: boolean, count: number, error?: string }>}
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

  const hogql = `
    SELECT
      count(DISTINCT distinct_id)
    FROM events
    WHERE
      event = '${escapeSql(HBE_EVENT_FAUCET_CLAIM)}'
      AND properties.app = '${escapeSql(HBE_APP_TAG)}'
  `.trim();

  try {
    const res = await fetch(`${POSTHOG_QUERY_HOST}/api/projects/${projectId}/query/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: hogql } }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        count: cachedUserCount.count,
        error: `PostHog query failed (${res.status}): ${text.slice(0, 150)}`,
      };
    }

    const data = await res.json();
    const rows = Array.isArray(data.results) ? data.results : [];
    const count = rows[0] && typeof rows[0][0] === 'number' ? rows[0][0] : 0;

    cachedUserCount = { count, timestamp: now };
    return { ok: true, count, cached: false };
  } catch (err) {
    return {
      ok: false,
      count: cachedUserCount.count,
      error: err.message || 'PostHog connection error',
    };
  }
}
