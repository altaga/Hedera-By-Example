/**
 * @file stats+api.ts
 * Expo Router Server API Route for Faucet PostHog unique user statistics.
 * Serves GET /api/faucet/stats
 */

import { getFaucetUniqueUsersCount, HBE_APP_TAG, HBE_EVENT_FAUCET_CLAIM } from '../../../server/posthogAnalytics';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET() {
  try {
    const stats = await getFaucetUniqueUsersCount();
    return Response.json(
      {
        app: HBE_APP_TAG,
        event: HBE_EVENT_FAUCET_CLAIM,
        uniqueUsers: stats.count,
        cached: stats.cached ?? false,
        error: stats.error || null,
        timestamp: new Date().toISOString(),
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err: any) {
    return Response.json(
      { status: 'error', error: err?.message || 'Failed to query faucet statistics' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
