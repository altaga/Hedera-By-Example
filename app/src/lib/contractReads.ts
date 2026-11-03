/**
 * @file contractReads.ts
 * Resilient multi-endpoint on-chain reader for smart contract calls and EVM queries.
 * Direct parity with Hedera for Dummies (HFD).
 *
 * Priority Sequence:
 *   1. Hedera Mirror Node (/api/v1/contracts/call) — official, keyless, CORS-open, ~120 ms.
 *   2. Thirdweb Public RPC (Chain 296 testnet / 295 mainnet) — fast JSON-RPC failover.
 *   3. Hashio (testnet.hashio.io) — free public relay, used strictly as LAST resort.
 *
 * Sticky Cursor: The provider that succeeded last is tried first on subsequent reads.
 */

import { ethers } from 'ethers'

const MAINNET = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_HEDERA_NETWORK === 'mainnet')

const MIRROR_CALL_URL = MAINNET
  ? 'https://mainnet-public.mirrornode.hedera.com/api/v1/contracts/call'
  : 'https://testnet.mirrornode.hedera.com/api/v1/contracts/call'

const THIRDWEB_RPC_URL = MAINNET
  ? 'https://295.rpc.thirdweb.com'
  : 'https://296.rpc.thirdweb.com'

const HASHIO_RPC_URL = MAINNET
  ? 'https://mainnet.hashio.io/api'
  : 'https://testnet.hashio.io/api'

export const READ_TIMEOUT_MS = 4000

type Source = {
  name: string
  call: (to: string, data: string, signal: AbortSignal) => Promise<string>
}

async function postJson (url: string, body: unknown, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function jsonRpcSource (name: string, url: string): Source {
  return {
    name,
    call: async (to, data, signal) => {
      const body = (await postJson(
        url,
        { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] },
        signal,
      )) as { result?: unknown; error?: { message?: string } }
      if (typeof body?.result !== 'string') throw new Error(body?.error?.message || 'no result')
      return body.result
    },
  }
}

const MIRROR_SOURCE: Source = {
  name: 'mirror-node',
  call: async (to, data, signal) => {
    const body = (await postJson(MIRROR_CALL_URL, { to, data, block: 'latest' }, signal)) as { result?: unknown; error?: { message?: string } }
    if (typeof body?.result !== 'string') throw new Error(body?.error?.message || 'no result')
    return body.result
  },
}

const SOURCES: Source[] = [
  MIRROR_SOURCE,
  jsonRpcSource('thirdweb', THIRDWEB_RPC_URL),
  jsonRpcSource('hashio', HASHIO_RPC_URL)
]

let preferred = 0

/**
 * Executes an eth_call read with prioritized fallback across Mirror Node, Thirdweb, and Hashio.
 * Throws only if all 3 sources fail.
 */
export async function resilientContractCall (to: string, data: string): Promise<string> {
  const n = SOURCES.length
  let lastErr: Error | null = null

  for (let i = 0; i < n; i++) {
    const idx = (preferred + i) % n
    const source = SOURCES[idx]
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS)

    try {
      const result = await source.call(to, data, controller.signal)
      clearTimeout(timer)
      preferred = idx // Sticky cursor: stay on the working provider
      return result
    } catch (e: any) {
      clearTimeout(timer)
      lastErr = e instanceof Error ? e : new Error(String(e))
    }
  }

  throw lastErr || new Error('All contract read providers failed')
}

/**
 * Direct eth_call read that survives a failing node and decodes the result.
 * Throws only when every source failed.
 */
export async function readContract (
  address: string,
  abi: ethers.InterfaceAbi,
  fn: string,
  args: readonly unknown[] = []
): Promise<ethers.Result> {
  const iface = new ethers.Interface(abi)
  const data = iface.encodeFunctionData(fn, args)
  const raw = await resilientContractCall(address, data)
  return iface.decodeFunctionResult(fn, raw)
}
