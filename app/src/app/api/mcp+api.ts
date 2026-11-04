/**
 * ============================================================================
 * @file mcp+api.ts
 * Expo Router Server API Route for Universal Model Context Protocol (MCP).
 * Serves POST/GET/OPTIONS at /api/mcp
 * ============================================================================
 * Provides cloud native Streamable HTTP execution for Cursor, Claude Desktop,
 * Windsurf, Antigravity, and autonomous web agents.
 * ============================================================================
 */

import { dispatchMcpRpc, getMcpMetadata } from '../../server/mcpService';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET() {
  const meta = getMcpMetadata();
  return Response.json(meta, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

export async function POST(request: Request) {
  try {
    let payload: any;
    try {
      payload = await request.json();
    } catch (parseErr: any) {
      return Response.json(
        { jsonrpc: '2.0', id: null, error: { code: -32700, message: `Parse error: ${parseErr.message}` } },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const response = await dispatchMcpRpc(payload);
    if (!response) {
      return new Response(null, {
        status: 202,
        headers: CORS_HEADERS,
      });
    }

    return Response.json(response, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
      },
    });
  } catch (err: any) {
    return Response.json(
      { jsonrpc: '2.0', id: null, error: { code: -32603, message: `Internal server error: ${err.message}` } },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
