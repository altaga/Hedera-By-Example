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

import { dispatchMcpRpc, getMcpMetadata, type McpContext } from '../../server/mcpService';

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

// A client closing its session. The server keeps no session state, so there is nothing to delete.
export async function DELETE() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  // MCP clients open a server-to-client event stream with GET + Accept: text/event-stream.
  // This server does not push messages, so the spec says to answer 405; anyone else gets the metadata.
  if ((request.headers.get('accept') || '').includes('text/event-stream')) {
    return new Response(null, { status: 405, headers: { ...CORS_HEADERS, Allow: 'POST, DELETE, OPTIONS' } });
  }
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

    // Who is calling (for anonymous analytics only): the session id we issued on `initialize`,
    // or, for clients that ignore sessions, the IP + User-Agent that mcpIdentity hashes per day.
    const ctx: McpContext = {
      sessionId: request.headers.get('mcp-session-id'),
      ip: request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      userAgent: request.headers.get('user-agent'),
      request,
    };
    const response = await dispatchMcpRpc(payload, ctx);
    const sessionHeader: Record<string, string> = ctx.newSessionId ? { 'Mcp-Session-Id': ctx.newSessionId } : {};
    if (!response) {
      return new Response(null, {
        status: 202,
        headers: { ...CORS_HEADERS, ...sessionHeader },
      });
    }

    return Response.json(response, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        ...sessionHeader,
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
