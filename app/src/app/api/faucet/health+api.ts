/**
 * @file health+api.ts
 * Expo Router Server API Route for Faucet Health & Connectivity.
 * Serves GET /api/faucet/health
 */

import { getFaucetHealth } from '../../../server/faucetService';

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
    const health = await getFaucetHealth();
    return Response.json(health, { status: 200, headers: CORS_HEADERS });
  } catch (err: any) {
    return Response.json(
      { status: 'error', error: err?.message || 'Failed to inspect faucet health' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
