/**
 * @file mcpIdentity.ts
 * Who is calling the MCP server, without storing anything personal.
 *
 * 1. Session (preferred): on `initialize` the server mints an `Mcp-Session-Id` (MCP Streamable
 *    HTTP transport). Compliant clients send it back on every later request, so one id = one
 *    MCP connection. The server keeps no state, so the client's name and version (from
 *    `clientInfo`) travel inside the id itself.
 * 2. Daily hash (fallback): clients that ignore sessions are grouped by
 *    SHA-256(IP + User-Agent + UTC date + salt). The date rotates the id every day, so nobody
 *    can be followed across days, and the IP never leaves this function.
 */

export type McpCaller = {
  /** PostHog distinct_id for this caller. */
  distinctId: string
  /** 'session' when the client sent our Mcp-Session-Id, 'daily_hash' otherwise. */
  idSource: 'session' | 'daily_hash'
  clientName: string
  clientVersion: string
  userAgent: string
}

const PREFIX = 'hbe1.'
const clip = (value: unknown, max: number) => String(value ?? '').replace(/[^\x20-\x7e]/g, '').slice(0, max)

const toBase64Url = (text: string) => {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (value: string) => {
  const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('')

/** New session id for an `initialize` call. Only visible ASCII, as the MCP spec requires. */
export function createSessionId (clientInfo: { name?: unknown, version?: unknown } = {}): string {
  return PREFIX + toBase64Url(JSON.stringify({ s: randomHex(12), n: clip(clientInfo.name, 60), v: clip(clientInfo.version, 30) }))
}

/** Reads a session id minted by createSessionId; null for anything else. */
export function parseSessionId (value: string | null | undefined): { session: string, clientName: string, clientVersion: string } | null {
  if (!value || !value.startsWith(PREFIX) || value.length > 300) return null
  try {
    const data = JSON.parse(fromBase64Url(value.slice(PREFIX.length)))
    if (typeof data?.s !== 'string' || !/^[0-9a-f]{24}$/.test(data.s)) return null
    return { session: data.s, clientName: clip(data.n, 60), clientVersion: clip(data.v, 30) }
  } catch {
    return null
  }
}

async function dailyHash (ip: string, userAgent: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10)
  const salt = (typeof process !== 'undefined' && process.env?.MCP_ANALYTICS_SALT) || 'hbe-mcp'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${day}|${ip}|${userAgent}`))
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Identifies the caller of one request. `clientInfo` is passed on `initialize` (the session id
 * is not issued yet); afterwards the session header carries it.
 */
export async function identifyCaller ({ sessionId, ip, userAgent, clientInfo }: {
  sessionId?: string | null
  ip?: string | null
  userAgent?: string | null
  clientInfo?: { name?: unknown, version?: unknown }
}): Promise<McpCaller> {
  const ua = clip(userAgent, 120)
  const parsed = parseSessionId(sessionId)
  if (parsed) {
    return { distinctId: `mcp:${parsed.session}`, idSource: 'session', clientName: parsed.clientName || 'unknown', clientVersion: parsed.clientVersion, userAgent: ua }
  }
  return {
    distinctId: `mcp-anon:${await dailyHash(clip(ip, 64), ua)}`,
    idSource: 'daily_hash',
    clientName: clip(clientInfo?.name, 60) || 'unknown',
    clientVersion: clip(clientInfo?.version, 30),
    userAgent: ua
  }
}
