/**
 * @file posthogAnalytics.ts
 * PostHog analytics integration for Hedera by Example (HBE) Faucet Server Functions.
 * Runs strictly server-side in Expo Router API routes.
 */

import { deferTask } from 'expo-server';
import type { McpCaller } from './mcpIdentity';

/**
 * Runs an analytics task after the response is sent (Expo `deferTask`), so it never blocks a
 * user request, and is kept alive until it finishes on the hosting runtime. Any failure is silent.
 * Falls back to a plain detached promise where `deferTask` is unsupported (tests, local node).
 */
export function runAnalyticsSilently(task: () => Promise<unknown>): void {
  const safe = () => task().catch(() => undefined);
  try {
    deferTask(safe);
  } catch (_) {
    try { void safe(); } catch (__) { /* silent */ }
  }
}

const POSTHOG_CAPTURE_URL = 'https://us.i.posthog.com/capture/';
const POSTHOG_QUERY_HOST = 'https://us.posthog.com';

export const HBE_EVENT_FAUCET_CLAIM = 'hbe_faucet_claimed';
export const HBE_EVENT_MCP_TOOL = 'hbe_mcp_tool_called';
export const HBE_EVENT_MCP_SESSION = 'hbe_mcp_session_started';
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
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify(payload),
    });
    if (res.ok) cachedUserCount.timestamp = 0;
    return res.ok;
  } catch (err: any) {
    // silent: analytics failures never surface
    return false;
  }
}

/** Sends one MCP event to PostHog. Never throws: analytics must not break or slow down the MCP. */
async function captureMcpEvent(event: string, caller: McpCaller, properties: Record<string, unknown>): Promise<boolean> {
  if (process.env.POSTHOG_DISABLED === 'true') return false;
  const apiKey = process.env.HBE_HOG_API_KEY || process.env.HOG_API_KEY;
  if (!apiKey) return false;
  try {
    const res = await fetch(POSTHOG_CAPTURE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(2000),
      body: JSON.stringify({
        api_key: apiKey,
        event,
        distinct_id: caller.distinctId,
        properties: {
          app: HBE_APP_TAG,
          service: 'mcp',
          client_name: caller.clientName,
          client_version: caller.clientVersion || null,
          id_source: caller.idSource,
          user_agent: caller.userAgent || null,
          // Kept for the dashboard insights built on the old property.
          client: caller.clientName,
          ...properties,
          $process_person_profile: false,
          timestamp: new Date().toISOString(),
        },
      }),
    });
    return res.ok;
  } catch (err: any) {
    console.warn('[ANALYTICS] Failed to emit PostHog MCP event:', err?.message || err);
    return false;
  }
}

/** One MCP connection started (an `initialize` call). */
export function recordMcpSessionStarted(caller: McpCaller, protocolVersion: string): Promise<boolean> {
  return captureMcpEvent(HBE_EVENT_MCP_SESSION, caller, { protocol_version: protocolVersion });
}

/**
 * Records one MCP tool call. Never sends the query text (only its length) and never throws:
 * analytics must not break or slow down a tool call.
 */
export function recordMcpToolCall({
  caller,
  tool,
  isError = false,
  durationMs,
  labSlug,
  queryLength,
}: {
  caller: McpCaller;
  tool: string;
  isError?: boolean;
  durationMs?: number;
  labSlug?: string;
  queryLength?: number;
}): Promise<boolean> {
  return captureMcpEvent(HBE_EVENT_MCP_TOOL, caller, {
    tool,
    is_error: isError,
    duration_ms: durationMs ?? null,
    lab_slug: labSlug || null,
    query_length: queryLength ?? null,
  });
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
