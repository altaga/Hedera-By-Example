/**
 * Browser runtime for Hedera by Example.
 *
 * Runs lab code in the visitor's browser with @hiero-ledger/sdk, which talks to
 * Hedera Testnet over gRPC-Web. Keys live in this browser's localStorage only.
 * Node.js-only APIs are shimmed where a faithful browser equivalent exists
 * (hashes, HMAC, random bytes); everything else fails with a clear message
 * telling the learner to run the lab locally.
 */
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js'
import { md5, sha1 } from '@noble/hashes/legacy.js'
import { hmac } from '@noble/hashes/hmac.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

export interface BrowserWallet {
  accountId: string
  privateKey: string
  publicKey: string
  evmAddress?: string
  keyType?: 'ED25519' | 'ECDSA'
  balanceHbar: number | null
}

export interface TerminalLogLine {
  id: string
  timestamp: string
  type: 'info' | 'success' | 'warn' | 'error' | 'link' | 'system'
  text: string
  url?: string
}

export const EMPTY_WALLET: BrowserWallet = {
  accountId: '',
  privateKey: '',
  publicKey: '',
  evmAddress: '',
  balanceHbar: null
}

const WALLET_STORAGE_KEY = 'hbe_playground_wallet_v2'
const STATE_STORAGE_KEY = 'hbe_playground_state'
const MIRROR = 'https://testnet.mirrornode.hedera.com/api/v1'
const ACCOUNT_ID_RE = /^\d+\.\d+\.\d+$/

export const isAccountId = (id: string) => ACCOUNT_ID_RE.test(id.trim())

export function getActiveWallet (): BrowserWallet {
  if (typeof window === 'undefined') return EMPTY_WALLET
  try {
    const raw = localStorage.getItem(WALLET_STORAGE_KEY)
    if (raw) return { ...EMPTY_WALLET, ...JSON.parse(raw) }
  } catch (_) {}
  return EMPTY_WALLET
}

export function saveActiveWallet (wallet: BrowserWallet): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(wallet))
  } catch (_) {}
}

export function clearActiveWallet (): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(WALLET_STORAGE_KEY)
  } catch (_) {}
}

/** HBAR balance of a testnet account from the Mirror Node, or null if unknown. */
export async function fetchLiveBalance (accountId: string): Promise<number | null> {
  const id = accountId.trim()
  if (!isAccountId(id)) return null
  try {
    const res = await fetch(`${MIRROR}/accounts/${id}`, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const data = await res.json()
    if (data?.balance?.balance != null) return Number(data.balance.balance) / 100_000_000
  } catch (err) {
    console.warn('Mirror Node balance lookup failed:', err)
  }
  return null
}

/**
 * Resolve the account ID that the network created for an EVM address
 * (for example after funding it from the portal faucet).
 */
export async function findAccountByEvmAddress (evmAddress: string): Promise<string | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(evmAddress)) return null
  try {
    const res = await fetch(`${MIRROR}/accounts/${evmAddress}`, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data?.account === 'string' ? data.account : null
  } catch (_) {
    return null
  }
}

/** Generate a new key in the browser. The account ID is filled in later. */
export async function createLocalKey (keyType: 'ED25519' | 'ECDSA'): Promise<BrowserWallet> {
  const hedera = await import('@hiero-ledger/sdk')
  const key = keyType === 'ECDSA' ? hedera.PrivateKey.generateECDSA() : hedera.PrivateKey.generateED25519()
  return {
    accountId: '',
    privateKey: key.toStringDer(),
    publicKey: key.publicKey.toStringDer(),
    evmAddress: keyType === 'ECDSA' ? '0x' + key.publicKey.toEvmAddress() : '',
    keyType,
    balanceHbar: null
  }
}

/** Derive public key / EVM address from a pasted private key (DER or hex). */
export async function describePrivateKey (privateKey: string): Promise<Pick<BrowserWallet, 'publicKey' | 'evmAddress' | 'keyType'>> {
  const hedera = await import('@hiero-ledger/sdk')
  const key = parsePrivateKey(hedera, privateKey)
  const isEcdsa = key.type === 'secp256k1'
  return {
    publicKey: key.publicKey.toStringDer(),
    evmAddress: isEcdsa ? '0x' + key.publicKey.toEvmAddress() : '',
    keyType: isEcdsa ? 'ECDSA' : 'ED25519'
  }
}

function parsePrivateKey (hedera: any, raw: string) {
  const value = raw.trim()
  if (/^30[0-9a-fA-F]+$/.test(value) && value.length > 64) return hedera.PrivateKey.fromStringDer(value)
  return hedera.PrivateKey.fromString(value)
}

/**
 * Strip module syntax and the Node entry-point guard so a lab body can run
 * inside an async function, then call main() if the lab defines it.
 */
export function sanitizeSourceForExecution (code: string): string {
  const sanitized = code
    .replace(/import\s+[\s\S]*?from\s*['"][^'"]*['"]\s*;?/gm, '')
    .replace(/import\s*['"][^'"]*['"]\s*;?/gm, '')
    .replace(/export\s+default\s+.*?;?/gm, '')
    .replace(/export\s*\{[^}]*\}\s*;?/gm, '')
    .replace(/if\s*\(\s*process\.argv\[1\][\s\S]*$/gm, '')
    .replace(/import\.meta\.[a-zA-Z0-9_$]+/gm, '""')
    .trim()
  return sanitized + '\n\nif (typeof main === "function") {\n  await main();\n}'
}

class NodeOnlyError extends Error {
  constructor (api: string) {
    super(`${api} is a Node.js API that is not available in the browser runner. Run this lab locally with Node.js.`)
    this.name = 'NodeOnlyError'
  }
}

// Byte output that behaves like a Buffer for the calls the labs make.
function asBufferLike (bytes: Uint8Array) {
  const out = new Uint8Array(bytes) as Uint8Array & { toString: (enc?: string) => string }
  out.toString = (enc?: string) => {
    if (enc === 'hex') return bytesToHex(bytes)
    if (enc === 'base64') return btoa(String.fromCharCode(...bytes))
    return new TextDecoder().decode(bytes)
  }
  return out
}

const toBytes = (chunk: unknown): Uint8Array => {
  if (chunk instanceof Uint8Array) return chunk
  return utf8ToBytes(typeof chunk === 'string' ? chunk : String(chunk))
}

const HASHES: Record<string, any> = { sha1, sha256, sha384, sha512, md5 }

function pickHash (algo: string) {
  const fn = HASHES[String(algo).toLowerCase().replace('-', '')]
  if (!fn) throw new NodeOnlyError(`crypto.createHash('${algo}')`)
  return fn
}

function digestOut (bytes: Uint8Array, enc?: string) {
  if (enc === 'hex') return bytesToHex(bytes)
  if (enc === 'base64') return btoa(String.fromCharCode(...bytes))
  return asBufferLike(bytes)
}

function makeCryptoShim () {
  const supported: Record<string, unknown> = {
    randomBytes: (size: number) => {
      const arr = new Uint8Array(size)
      window.crypto.getRandomValues(arr)
      return asBufferLike(arr)
    },
    randomUUID: () => window.crypto.randomUUID(),
    createHash: (algo: string) => {
      const h = pickHash(algo).create()
      const api = {
        update: (chunk: unknown) => { h.update(toBytes(chunk)); return api },
        digest: (enc?: string) => digestOut(h.digest(), enc)
      }
      return api
    },
    createHmac: (algo: string, key: unknown) => {
      const h = hmac.create(pickHash(algo), toBytes(key))
      const api = {
        update: (chunk: unknown) => { h.update(toBytes(chunk)); return api },
        digest: (enc?: string) => digestOut(h.digest(), enc)
      }
      return api
    }
  }
  return new Proxy(supported, {
    get (target, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop in target) return target[prop]
      if (prop === 'default') return target
      throw new NodeOnlyError(`crypto.${prop}`)
    }
  })
}

// "0.0.123@1700000000.123456789" -> "0.0.123-1700000000-123456789" (Mirror Node / HashScan format)
const txIdForUrl = (id: string) => {
  const [acct, ts] = id.trim().split('@')
  return ts ? `${acct}-${ts.replace('.', '-')}` : acct
}

function hashscanUrl (target: any): string {
  const base = 'https://hashscan.io/testnet'
  if (!target) return base
  if (typeof target === 'object') {
    if (target.transactionId) return `${base}/transaction/${txIdForUrl(String(target.transactionId))}`
    if (target.topicId) return `${base}/topic/${target.topicId}`
    if (target.tokenId) return `${base}/token/${target.tokenId}`
    if (target.accountId) return `${base}/account/${target.accountId}`
  }
  const clean = String(target).trim()
  if (clean.includes('@')) return `${base}/transaction/${txIdForUrl(clean)}`
  if (clean.startsWith('0x')) return `${base}/account/${clean}`
  return `${base}/topic/${clean}`
}

/** Run a lab's code in this browser, streaming console output to onLog. */
export async function executeInBrowser (
  sourceCode: string,
  wallet: BrowserWallet,
  onLog: (line: TerminalLogLine) => void
): Promise<{ success: boolean; durationMs: number }> {
  const startTime = Date.now()
  let seq = 0

  const pushLog = (type: TerminalLogLine['type'], text: string, url?: string) => {
    const d = new Date()
    const ts = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
    onLog({ id: `${startTime}-${seq++}`, timestamp: ts, type, text, url })
  }

  if (isAccountId(wallet.accountId) && wallet.privateKey) {
    pushLog('system', `Operator ${wallet.accountId} on testnet`)
  } else {
    pushLog('warn', 'No testnet account configured. Labs that send transactions will fail; set one up under "Testnet account".')
  }

  try {
    const hedera = await import('@hiero-ledger/sdk')
    const client = hedera.Client.forTestnet()

    if (isAccountId(wallet.accountId) && wallet.privateKey) {
      try {
        client.setOperator(hedera.AccountId.fromString(wallet.accountId), parsePrivateKey(hedera, wallet.privateKey))
      } catch (keyErr: any) {
        pushLog('error', `Could not load the operator key: ${keyErr.message}`)
      }
    }

    // Supports both `const client = getClient()` and `const { client } = getClient()`.
    // Never shadow SDK properties: only add the names the labs destructure.
    const clientWrapper: any = client
    const extras: Record<string, unknown> = {
      client,
      operatorId: wallet.accountId,
      operatorKey: wallet.privateKey,
      network: 'testnet'
    }
    for (const [name, value] of Object.entries(extras)) {
      if (!(name in clientWrapper)) Object.defineProperty(clientWrapper, name, { value, enumerable: false })
    }
    const getClient = () => clientWrapper

    const readState = () => {
      try { return JSON.parse(localStorage.getItem(STATE_STORAGE_KEY) || '{}') } catch (_) { return {} }
    }
    const updateState = (key: string, val: any) => {
      try {
        const obj = readState()
        obj[key] = val
        localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(obj))
      } catch (_) {}
      return val
    }
    const getState = (key: string) => readState()[key]
    const updateEnv = updateState

    const mockProcess = {
      argv: ['node', 'browser.js'],
      env: {
        OPERATOR_ID: wallet.accountId,
        OPERATOR_PRIVATE_KEY: wallet.privateKey,
        OPERATOR_EVM_ADDRESS: wallet.evmAddress || '',
        NETWORK: 'testnet'
      },
      exit: (code: number = 0) => {
        if (code !== 0) throw new Error(`process.exit(${code})`)
      }
    }

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const dotenv = { config: () => ({ parsed: {} }) }
    const getMirrorNodeBaseUrl = () => 'https://testnet.mirrornode.hedera.com'

    const pathShim = {
      join: (...args: string[]) => args.filter(Boolean).join('/'),
      resolve: (...args: string[]) => args.filter(Boolean).join('/'),
      basename: (p: string) => String(p).split(/[\\/]/).pop() || '',
      dirname: (p: string) => String(p).split(/[\\/]/).slice(0, -1).join('/') || '.',
      extname: (p: string) => '.' + String(p).split('.').pop()
    }

    class EventEmitterShim {
      _e: Record<string, Function[]> = {}
      on (e: string, fn: Function) { (this._e[e] = this._e[e] || []).push(fn); return this }
      once (e: string, fn: Function) {
        const g = (...a: any[]) => { this.off(e, g); fn(...a) }
        return this.on(e, g)
      }
      off (e: string, fn: Function) { this._e[e] = (this._e[e] || []).filter((f) => f !== fn); return this }
      emit (e: string, ...args: any[]) { (this._e[e] || []).forEach((fn) => fn(...args)); return true }
    }

    const fmt = (a: any) => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return a.message
      try { return JSON.stringify(a, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) } catch (_) { return String(a) }
    }
    const customConsole = {
      log: (...args: any[]) => {
        const msg = args.map(fmt).join(' ')
        const url = msg.match(/(https:\/\/hashscan\.io\/[^\s)]+)/)
        if (url) pushLog('link', msg, url[1])
        else if (/SUCCESS|ÉXITO|✅/.test(msg)) pushLog('success', msg)
        else if (/WARN|⚠️/.test(msg)) pushLog('warn', msg)
        else if (/FAILED|FALLO|❌/.test(msg)) pushLog('error', msg)
        else pushLog('info', msg)
      },
      info: (...args: any[]) => pushLog('info', args.map(fmt).join(' ')),
      warn: (...args: any[]) => pushLog('warn', args.map(fmt).join(' ')),
      error: (...args: any[]) => pushLog('error', args.map(fmt).join(' ')),
      table: (data: any) => pushLog('info', fmt(data))
    }

    const sanitized = sanitizeSourceForExecution(sourceCode)
    const scopeKeys = Object.keys(hedera)
    const scopeValues = Object.values(hedera)

    // eslint-disable-next-line no-new-func
    const runner = new Function(
      ...scopeKeys,
      'client', 'getClient', 'getHashscanUrl', 'getMirrorNodeBaseUrl',
      'updateState', 'updateEnv', 'getState', 'sleep', 'dotenv',
      'crypto', 'path', 'EventEmitter', 'wallet', 'console', 'process',
      'return (async () => {\n' + sanitized + '\n})()'
    )

    await runner(
      ...scopeValues,
      client, getClient, hashscanUrl, getMirrorNodeBaseUrl,
      updateState, updateEnv, getState, sleep, dotenv,
      makeCryptoShim(), pathShim, EventEmitterShim, wallet, customConsole, mockProcess
    )

    try { client.close() } catch (_) {}
    const durationMs = Date.now() - startTime
    pushLog('system', `Finished in ${(durationMs / 1000).toFixed(2)} s`)
    return { success: true, durationMs }
  } catch (err: any) {
    const durationMs = Date.now() - startTime
    const message = err?.message || String(err)
    pushLog('error', `Stopped: ${message}`)
    if (err instanceof ReferenceError && /Buffer|require|__dirname|fs\b/.test(message)) {
      pushLog('warn', 'This lab uses Node.js-only APIs. Run it locally with Node.js to see its full behaviour.')
    }
    return { success: false, durationMs }
  }
}
