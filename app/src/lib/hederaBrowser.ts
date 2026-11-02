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
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { Buffer, NodeOnlyError, adaptSolcCalls, bindingValue, createFs, createVirtualHttp, extractImports, resolveModule, type LabFileEvent } from './labModules'
import { createCipher, createECDH, generateKeyPairSync, sign, verify } from './nodeCrypto'

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
  /** How to render the line: plain text (default) or structured output. */
  kind?: 'text' | 'table' | 'json' | 'file' | 'visual'
  data?: any
}

export interface PracticeAccount { accountId: string; privateKey: string; evmAddress: string }
export interface PracticeAccounts { account1?: PracticeAccount; account2?: PracticeAccount }

export interface RunOptions {
  /** ACCOUNT_1 / ACCOUNT_2 for labs with more than one party. */
  practice?: PracticeAccounts
  /** Files the lab reads (course assets or the learner's own), by file name. */
  files?: Record<string, Uint8Array>
}

export const EMPTY_WALLET: BrowserWallet = {
  accountId: '',
  privateKey: '',
  publicKey: '',
  evmAddress: '',
  balanceHbar: null
}

const STATE_STORAGE_KEY = 'hbe_playground_state'
const MIRROR = 'https://testnet.mirrornode.hedera.com/api/v1'
const ACCOUNT_ID_RE = /^\d+\.\d+\.\d+$/

export const isAccountId = (id: string) => ACCOUNT_ID_RE.test(id.trim())

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

/** Labs that read ACCOUNT_1_* / ACCOUNT_2_* need practice accounts. */
export const labUsesPracticeAccounts = (code: string) => /ACCOUNT_[12]_/.test(code)

/** Name of the function the lab's entry block calls (usually main). */
function entryFunctionName (code: string): string {
  const m = code.match(/if\s*\(\s*process\.argv\[1\][^\n]*\{\s*\n\s*([A-Za-z_$][\w$]*)\(\)/)
  return m ? m[1] : 'main'
}

/**
 * Turn a lab body (imports already removed) into code that runs inside an
 * async function: drop module syntax and the Node entry guard, give
 * import.meta values that work with new URL()/path, route dynamic import()
 * through the browser module system, then call the entry function.
 */
export function sanitizeSourceForExecution (code: string, entry = 'main'): string {
  const sanitized = code
    .replace(/export\s+default\s+.*?;?/gm, '')
    .replace(/export\s*\{[^}]*\}\s*;?/gm, '')
    .replace(/^[ \t]*export\s+(?=(?:const|let|var|function|class|async)\b)/gm, '')
    .replace(/if\s*\(\s*process\.argv\[1\][\s\S]*$/gm, '')
    .replace(/import\.meta\.url/g, '"file:///lab/lab.js"')
    .replace(/import\.meta\.filename/g, '"/lab/lab.js"')
    .replace(/import\.meta\.dirname/g, '"/lab"')
    .replace(/import\.meta\.[a-zA-Z0-9_$]+/gm, '""')
    .replace(/\bimport\(/g, '__import(')
    .trim()
  return `${sanitized}\n\nif (typeof ${entry} === "function") {\n  await ${entry}();\n}`
}

// Byte output that behaves like a Node Buffer for the calls the labs make.
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

const digestOut = (bytes: Uint8Array, enc?: string) => {
  const buf = Buffer.from(bytes)
  return enc ? buf.toString(enc as BufferEncoding) : buf
}

function makeCryptoShim () {
  const supported: Record<string, unknown> = {
    randomBytes: (size: number) => {
      const arr = new Uint8Array(size)
      window.crypto.getRandomValues(arr)
      return Buffer.from(arr)
    },
    randomUUID: () => window.crypto.randomUUID(),
    randomInt: (min: number, max?: number) => {
      const [lo, hi] = max === undefined ? [0, min] : [min, max]
      const arr = new Uint32Array(1)
      window.crypto.getRandomValues(arr)
      return lo + (arr[0] % (hi - lo))
    },
    createHash: (algo: string) => {
      const h = pickHash(algo).create()
      const api = {
        update: (chunk: unknown, enc?: string) => { h.update(typeof chunk === 'string' && enc ? Buffer.from(chunk, enc as BufferEncoding) : toBytes(chunk)); return api },
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
    },
    timingSafeEqual: (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]),
    createCipheriv: (alg: string, key: any, iv: any) => createCipher(false, alg, key, iv),
    createDecipheriv: (alg: string, key: any, iv: any) => createCipher(true, alg, key, iv),
    createECDH,
    generateKeyPairSync,
    sign,
    verify,
    webcrypto: window.crypto,
    subtle: window.crypto.subtle
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

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
  json: 'application/json', csv: 'text/csv', md: 'text/markdown', txt: 'text/plain', sol: 'text/plain', pem: 'text/plain'
}
export const mimeOf = (name: string) => MIME[name.split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream'

/** Turn console.table input into columns and rows. */
function tableOf (data: any, columns?: string[]) {
  const entries: [string, any][] = Array.isArray(data) ? data.map((v, i) => [String(i), v]) : Object.entries(data || {})
  const cols = columns || [...new Set(entries.flatMap(([, v]) => (v && typeof v === 'object' ? Object.keys(v) : ['Values'])))]
  const rows = entries.map(([k, v]) => [k, ...cols.map((c) => (v && typeof v === 'object' ? v[c] : c === 'Values' ? v : ''))])
  return { columns: ['(index)', ...cols], rows }
}

const jsonSafe = (v: any) => {
  try { return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))) } catch (_) { return String(v) }
}

/** Run a lab's code in this browser, streaming its output to onLog. */
export async function executeInBrowser (
  sourceCode: string,
  wallet: BrowserWallet,
  onLog: (line: TerminalLogLine) => void,
  options: RunOptions = {}
): Promise<{ success: boolean; durationMs: number }> {
  const startTime = Date.now()
  let seq = 0

  const emit = (line: Omit<TerminalLogLine, 'id' | 'timestamp'>) => {
    const d = new Date()
    const ts = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
    onLog({ id: `${startTime}-${seq++}`, timestamp: ts, ...line })
  }
  const pushLog = (type: TerminalLogLine['type'], text: string, url?: string) => emit({ type, text, url })

  if (isAccountId(wallet.accountId) && wallet.privateKey) {
    pushLog('system', `Operator ${wallet.accountId} on testnet`)
  } else {
    pushLog('warn', 'No testnet account configured. Labs that send transactions will fail; set one up under "Testnet account".')
  }

  const practice = options.practice || {}
  if (labUsesPracticeAccounts(sourceCode)) {
    if (practice.account1 && practice.account2) {
      pushLog('system', `Practice accounts ${practice.account1.accountId} and ${practice.account2.accountId}`)
    } else {
      pushLog('warn', 'This lab uses ACCOUNT_1 / ACCOUNT_2. Create practice accounts under "Testnet account" first.')
    }
  }

  let failedWithExitCode = false
  try {
    const hedera = await import('@hiero-ledger/sdk')
    // Same defaults as course/*/M99_Utilities/config.js: a generous fee ceiling
    // (only the real fee is charged) so labs survive fee-schedule changes.
    const createClient = (accountId?: string, privateKey?: any) => {
      const c = hedera.Client.forTestnet()
      c.setDefaultMaxTransactionFee(new hedera.Hbar(100))
      c.setDefaultMaxQueryPayment(new hedera.Hbar(10))
      if (accountId && privateKey) {
        c.setOperator(hedera.AccountId.fromString(accountId), typeof privateKey === 'string' ? parsePrivateKey(hedera, privateKey) : privateKey)
      }
      return c
    }
    const client = createClient()
    if (isAccountId(wallet.accountId) && wallet.privateKey) {
      try {
        client.setOperator(hedera.AccountId.fromString(wallet.accountId), parsePrivateKey(hedera, wallet.privateKey))
      } catch (keyErr: any) {
        pushLog('error', `Could not load the operator key: ${keyErr.message}`)
      }
    }

    // Same shape as course/*/M99_Utilities/config.js getClient().
    const getClient = () => ({ client, operatorId: wallet.accountId, operatorKey: wallet.privateKey, network: 'testnet' })

    const env: Record<string, string> = {
      OPERATOR_ID: wallet.accountId,
      OPERATOR_PRIVATE_KEY: wallet.privateKey,
      OPERATOR_EVM_ADDRESS: wallet.evmAddress || '',
      NETWORK: 'testnet'
    }
    for (const [n, acc] of [['1', practice.account1], ['2', practice.account2]] as const) {
      if (!acc) continue
      env[`ACCOUNT_${n}_ID`] = acc.accountId
      env[`ACCOUNT_${n}_PRIVATE_KEY`] = acc.privateKey
      env[`ACCOUNT_${n}_EVM_ADDRESS`] = acc.evmAddress
    }

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
    const getState = (key: string) => readState()[key] ?? env[key]
    const updateEnv = updateState

    const perf = window.performance
    const mockProcess: any = {
      argv: ['node', '/lab/lab.js'],
      env,
      platform: 'browser',
      version: 'browser',
      exitCode: undefined,
      exit: (code: number = 0) => {
        if (code !== 0 || mockProcess.exitCode) {
          failedWithExitCode = true
          throw new Error(`process.exit(${code || mockProcess.exitCode})`)
        }
      },
      hrtime: Object.assign((prev?: [number, number]) => {
        const ns = Math.round(perf.now() * 1e6)
        const t: [number, number] = [Math.floor(ns / 1e9), ns % 1e9]
        return prev ? [t[0] - prev[0], t[1] - prev[1]] : t
      }, { bigint: () => BigInt(Math.round(perf.now() * 1e6)) }),
      memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0 }),
      uptime: () => perf.now() / 1000,
      on: () => mockProcess,
      once: () => mockProcess,
      nextTick: (fn: (...a: any[]) => void, ...args: any[]) => queueMicrotask(() => fn(...args)),
      stdout: { write: (s: string) => { pushLog('info', String(s).replace(/\n$/, '')); return true } }
    }

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const dotenv = { config: () => ({ parsed: {} }) }
    const getMirrorNodeBaseUrl = () => 'https://testnet.mirrornode.hedera.com'

    // Browser versions of course/*/M99_Utilities/resilience.js.
    const MAX_GAS = 15_000_000
    const withGasRetry = async (run: (gas: number) => Promise<any>, { gas = 300_000, maxGas = MAX_GAS } = {}) => {
      let limit = Math.min(gas, maxGas)
      for (;;) {
        try {
          return await run(limit)
        } catch (error: any) {
          const insufficient = String(error?.status ?? '') === 'INSUFFICIENT_GAS' || /INSUFFICIENT_GAS/.test(String(error?.message ?? error))
          if (!insufficient || limit >= maxGas) throw error
          limit = Math.min(limit * 2, maxGas)
          pushLog('info', `Not enough gas; retrying with ${limit.toLocaleString('en-US')} gas...`)
        }
      }
    }
    const executeWithGas = (build: (gas: number) => any, c: any, opts?: { gas?: number, maxGas?: number }) =>
      withGasRetry(async (gas: number) => {
        const tx = await build(gas)
        const response = await tx.execute(c)
        await response.getReceipt(c)
        return response
      }, opts)
    const waitForMirror = async (check: () => Promise<any>, { timeoutMs = 30_000, intervalMs = 2_000 } = {}) => {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const value = await check().catch(() => null)
        if (value) return value
        if (Date.now() >= deadline) return null
        await sleep(intervalMs)
      }
    }
    const getAccountEvmAddress = async (accountId: string) => {
      const data = await waitForMirror(async () => {
        const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)
        return res.ok ? res.json() : null
      })
      return data?.evm_address || '0x' + hedera.AccountId.fromString(accountId).toEvmAddress()
    }
    const ensureFunded = async (c: any, accountId: string, minHbar: number) => {
      const account = await waitForMirror(async () => {
        const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)
        return res.ok ? res.json() : null
      })
      const current = (account?.balance?.balance ?? 0) / 1e8
      if (current >= minHbar) return
      const topUp = Math.ceil(minHbar - current + 1)
      pushLog('info', `${accountId} has ${current.toFixed(2)} ℏ; topping up ${topUp} ℏ from your account...`)
      const tx = await new hedera.TransferTransaction()
        .addHbarTransfer(c.operatorAccountId, new hedera.Hbar(-topUp))
        .addHbarTransfer(accountId, new hedera.Hbar(topUp))
        .execute(c)
      await tx.getReceipt(c)
    }
    const parseKey = (value: string) => parsePrivateKey(hedera, value)

    const pathShim: any = {
      sep: '/',
      join: (...args: string[]) => args.filter(Boolean).join('/').replace(/\/+/g, '/'),
      resolve: (...args: string[]) => args.filter(Boolean).join('/').replace(/\/+/g, '/'),
      basename: (p: string, ext?: string) => { const b = String(p).split(/[\\/]/).pop() || ''; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b },
      dirname: (p: string) => String(p).split(/[\\/]/).slice(0, -1).join('/') || '.',
      extname: (p: string) => { const b = String(p).split(/[\\/]/).pop() || ''; return b.includes('.') ? '.' + b.split('.').pop() : '' },
      relative: (_from: string, to: string) => to,
      isAbsolute: (p: string) => String(p).startsWith('/')
    }
    pathShim.posix = pathShim

    class EventEmitterShim {
      _e: Record<string, Function[]> = {}
      on (e: string, fn: Function) { (this._e[e] = this._e[e] || []).push(fn); return this }
      addListener (e: string, fn: Function) { return this.on(e, fn) }
      once (e: string, fn: Function) {
        const g = (...a: any[]) => { this.off(e, g); fn(...a) }
        return this.on(e, g)
      }
      off (e: string, fn: Function) { this._e[e] = (this._e[e] || []).filter((f) => f !== fn); return this }
      removeListener (e: string, fn: Function) { return this.off(e, fn) }
      removeAllListeners (e?: string) { if (e) delete this._e[e]; else this._e = {}; return this }
      emit (e: string, ...args: any[]) { (this._e[e] || []).forEach((fn) => fn(...args)); return (this._e[e] || []).length > 0 }
      listenerCount (e: string) { return (this._e[e] || []).length }
    }

    // Files the lab reads; anything it writes is shown in the output.
    const files = new Map<string, Uint8Array>(Object.entries(options.files || {}))
    const onWrite = ({ name, data }: LabFileEvent) => {
      const mime = mimeOf(name)
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }))
      const text = mime.startsWith('text/') || mime === 'application/json' ? new TextDecoder().decode(data.slice(0, 4000)) : undefined
      emit({ type: 'info', text: `Wrote ${name} (${data.length.toLocaleString('en-US')} bytes)`, kind: 'file', data: { name, mime, url, size: data.length, text } })
    }
    const fs = createFs(files, onWrite)
    const cryptoShim = makeCryptoShim()

    const fmt = (a: any) => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return a.message
      try { return JSON.stringify(a, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) } catch (_) { return String(a) }
    }
    const classify = (msg: string): TerminalLogLine['type'] =>
      /SUCCESS|ÉXITO|✅/.test(msg) ? 'success' : /WARN|⚠️/.test(msg) ? 'warn' : /FAILED|FALLO|❌/.test(msg) ? 'error' : 'info'
    const asJson = (s: string) => {
      const t = s.trim()
      if (!/^[[{]/.test(t) || !t.includes('\n')) return undefined
      try { return JSON.parse(t) } catch (_) { return undefined }
    }
    const logWith = (forced?: TerminalLogLine['type']) => (...args: any[]) => {
      // A single object, or a pretty-printed JSON string, is shown as a JSON tree.
      if (args.length === 1 && args[0] && typeof args[0] === 'object' && !(args[0] instanceof Error)) {
        emit({ type: forced || 'info', text: fmt(args[0]), kind: 'json', data: jsonSafe(args[0]) })
        return
      }
      const json = args.length === 1 && typeof args[0] === 'string' ? asJson(args[0]) : undefined
      if (json !== undefined) {
        emit({ type: forced || 'info', text: args[0], kind: 'json', data: json })
        return
      }
      const msg = args.map(fmt).join(' ')
      const url = msg.match(/(https:\/\/hashscan\.io\/[^\s)]+)/)
      if (url && !forced) emit({ type: 'link', text: msg, url: url[1] })
      else emit({ type: forced || classify(msg), text: msg })
    }
    const customConsole = {
      log: logWith(),
      info: logWith('info'),
      debug: logWith('info'),
      warn: logWith('warn'),
      error: logWith('error'),
      table: (data: any, columns?: string[]) => emit({ type: 'info', text: fmt(data), kind: 'table', data: tableOf(data, columns) }),
      dir: logWith('info'),
      group: logWith('info'),
      groupEnd: () => {},
      time: () => {},
      timeEnd: () => {}
    }

    // course/*/M99_Utilities/show.js: visuals are drawn by the web page.
    const visual = (type: string) => (spec: Record<string, unknown>) =>
      emit({ type: 'info', text: String(spec?.title ?? type), kind: 'visual', data: { ...jsonSafe(spec), type: spec?.type && type === 'chart' ? spec.type : type } })
    const show = {
      table: customConsole.table,
      json: (value: unknown) => emit({ type: 'info', text: fmt(value), kind: 'json', data: jsonSafe(value) }),
      chart: visual('chart'),
      merkle: visual('merkle'),
      dag: visual('dag'),
      shards: visual('shards'),
      states: visual('states')
    }
    const nodeOnly = (name: string) => () => { throw new NodeOnlyError(name) }
    const helpers: Record<string, unknown> = {
      getClient,
      getHashscanUrl: hashscanUrl,
      getMirrorNodeBaseUrl,
      getJsonRpcUrl: () => 'https://testnet.hashio.io/api',
      updateState,
      updateEnv,
      getState,
      sleep,
      loadEnv: () => {},
      createClient,
      parsePrivateKey: parseKey,
      withGasRetry,
      executeWithGas,
      waitForMirror,
      getAccountEvmAddress,
      ensureFunded,
      exitIfStuck: () => {},
      maxTransactionFeeHbar: () => 100,
      MAX_GAS,
      show,
      getJsonRpcSigner: nodeOnly('getJsonRpcSigner (JSON-RPC relay signing)'),
      AgentCommunicationHandler: class { constructor () { throw new NodeOnlyError('AgentCommunicationHandler') } }
    }

    const virtual = createVirtualHttp(EventEmitterShim, window.fetch.bind(window))
    const ctx = { hedera, helpers, fs, crypto: cryptoShim, path: pathShim, EventEmitter: EventEmitterShim, dotenv, http: virtual.http }
    const { imports, body } = extractImports(sourceCode)
    const bound: Record<string, unknown> = {}
    for (const imp of imports) {
      const mod = await resolveModule(imp.specifier, ctx)
      for (const b of imp.bindings) bound[b.local] = bindingValue(mod, b.imported)
    }
    const __import = (spec: string) => resolveModule(spec, ctx)

    // Globals a Node module sees without importing them, then the lab's own imports.
    const scope: Record<string, unknown> = {
      ...hedera,
      ...helpers,
      client,
      wallet,
      console: customConsole,
      process: mockProcess,
      Buffer,
      fetch: virtual.fetch,
      __import,
      ...bound
    }
    const RESERVED = new Set(['default', 'class', 'function', 'delete', 'new', 'return', 'var', 'let', 'const', 'import', 'export', 'this', 'typeof', 'void', 'with', 'yield', 'await', 'enum', 'super', 'in', 'of', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'null', 'true', 'false', 'instanceof', 'debugger', 'extends', 'static'])
    const names = Object.keys(scope).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && !RESERVED.has(n))
    const usesSolc = imports.some((i) => i.specifier === 'solc')
    const sanitized = sanitizeSourceForExecution(usesSolc ? adaptSolcCalls(body) : body, entryFunctionName(sourceCode))

    // eslint-disable-next-line no-new-func
    const runner = new Function(...names, 'return (async () => {\n' + sanitized + '\n})()')
    await runner(...names.map((n) => scope[n]))

    try { client.close() } catch (_) {}
    const durationMs = Date.now() - startTime
    // Labs flag handled failures with process.exitCode = 1 instead of throwing.
    if (mockProcess.exitCode) {
      pushLog('error', `Finished with errors in ${(durationMs / 1000).toFixed(2)} s`)
      return { success: false, durationMs }
    }
    pushLog('system', `Finished in ${(durationMs / 1000).toFixed(2)} s`)
    return { success: true, durationMs }
  } catch (err: any) {
    const durationMs = Date.now() - startTime
    const message = err?.message || String(err)
    if (!failedWithExitCode) pushLog('error', `Stopped: ${message}`)
    else pushLog('error', `Finished with errors in ${(durationMs / 1000).toFixed(2)} s`)
    if (err instanceof NodeOnlyError) {
      pushLog('warn', 'This lab uses a Node.js-only API. The commands to run it on your machine are below the code.')
    } else if (err instanceof ReferenceError && /require|__dirname/.test(message)) {
      pushLog('warn', 'This lab uses Node.js-only APIs. Run it locally with Node.js to see its full behaviour.')
    }
    return { success: false, durationMs }
  }
}
