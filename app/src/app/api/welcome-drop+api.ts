/**
 * @file welcome-drop+api.ts
 * Expo Router Server API Route for Hedera Testnet Welcome Drop disbursements.
 * Serves POST /api/welcome-drop
 */

import { disburseHbar } from '../../server/faucetService';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      evmAddress?: string;
      accountId?: string;
      amount?: number;
      skipCooldown?: boolean;
    };

    if (!body?.evmAddress) {
      return Response.json(
        { success: false, error: 'Missing required field: evmAddress' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const result = await disburseHbar({
      evmAddress: body.evmAddress,
      accountId: body.accountId,
      amount: body.amount ?? 10,
      skipCooldown: body.skipCooldown ?? false,
    });

    const status = result.success ? 200 : 400;
    return Response.json(result, { status, headers: CORS_HEADERS });
  } catch (error: any) {
    return Response.json(
      { success: false, error: error?.message || 'Server error' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
