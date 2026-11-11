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
import { join as posixJoin, normalize as posixNormalize, resolve as posixResolve } from './posixPath.mjs'
import { MAX_NODE_ATTEMPTS, retryDelayMs, shouldRetryExecution } from './retryPolicy.mjs'
import { Buffer, NodeOnlyError, adaptSolcCalls, loadVendor, prefetchKeyTypes, bindingValue, createFs, createVirtualHttp, extractImports, resolveModule, type LabFileEvent } from './labModules'
import { RSA_CONSTANTS, createCipher, createECDH, generateKeyPairSync, privateDecrypt, publicEncrypt, sign, verify } from './nodeCrypto'
import { isMirrorUrl, mirrorFetch } from './mirror'
import { resilientContractCall, readContract } from './contractReads'

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
  /** Course language of the code, for helpers that print in it (AgentCommunicationHandler). */
  lang?: 'en' | 'es'
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
    const res = await mirrorFetch(`${MIRROR}/accounts/${id}`)
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
    const res = await mirrorFetch(`${MIRROR}/accounts/${evmAddress}`)
    if (!res.ok) return null
    const data = await res.json()
    return typeof data?.account === 'string' ? data.account : null
  } catch {
    return null
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
    publicEncrypt,
    privateDecrypt,
    constants: RSA_CONSTANTS,
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
  return ts ? `${acct}-${ts.replace(/\./g, '-')}` : acct
}

function hashscanUrl (target: any): string {
  const base = 'https://hashscan.io/testnet'
  if (!target) return base
  if (typeof target === 'object') {
    if (target.transactionId) return `${base}/transaction/${txIdForUrl(String(target.transactionId))}`
    if (target.contractId) return `${base}/contract/${target.contractId}`
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
  try { return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))) } catch { return String(v) }
}

/** Run a lab's code in this browser, streaming its output to onLog. */
/** Thrown by process.exit(): stops the lab like Node does. */
class ExitSignal extends Error {
  readonly __hbeExit = true
  constructor (public code: number) { super(`process.exit(${code})`) }
}
const isExit = (e: unknown) => e instanceof ExitSignal

/**
 * What keeps a lab "alive" after its main function returns, as in Node:
 * open topic subscriptions and pending timers. The run ends when the lab
 * calls process.exit(), when nothing is pending, or at the time limit.
 */
interface RunHandles {
  subs: Set<object>
  timers: Set<number>
  clients: Set<any>
  exited: boolean
  wake: () => void
  /** Transactions this run submitted ("0.0.1@secs.nanos"), in order. */
  txs?: string[]
  /** Entities their receipts created, as "kind:id". */
  created?: string[]
  /** Called with a status line for a retry. */
  note?: (text: string) => void
}
let activeRun: RunHandles | null = null

/** Stop a run for good: timers, subscriptions and every client it opened, so nothing more is sent. */
function stopRun (run: RunHandles | null) {
  if (!run) return
  run.exited = true
  run.timers.forEach((id) => { window.clearTimeout(id); window.clearInterval(id) })
  run.timers.clear()
  run.clients.forEach((c) => { try { c.close() } catch {} })
  run.clients.clear()
  run.wake()
}

/** Called when the learner leaves the lab or starts another run: the old run must not keep spending HBAR. */
export function abortActiveRun (): void {
  stopRun(activeRun)
}



const sleepMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Every execute() a lab makes (transactions and queries) goes through here:
 * - transient node errors retry up to MAX_NODE_ATTEMPTS times with backoff,
 *   and the SDK moves to another node (the failed one is marked unhealthy);
 * - "NodeAccountId not recognized" means the client's node map lost entries
 *   (e.g. it was emptied): the testnet node list is restored before retrying;
 * - transaction ids are recorded so the run can link each one on HashScan
 *   and Resources can name the lab that created each entity.
 * A run that was stopped (its client closed) never retries.
 */
function trackExecutions (hedera: any) {
  const proto = hedera.Executable?.prototype
  if (!proto || proto.__hbeExecute) return
  proto.__hbeExecute = true
  const execute = proto.execute
  proto.execute = async function (this: any, client: any, ...rest: any[]) {
    const run = activeRun
    const isTransaction = this instanceof hedera.Transaction
    // Fix the transaction id before the first attempt, so a retry can only resend the same transaction.
    if (isTransaction && client && typeof this.isFrozen === 'function' && !this.isFrozen()) {
      try { this.freezeWith(client) } catch {}
    }
    let lastErr: any
    for (let attempt = 1; attempt <= MAX_NODE_ATTEMPTS; attempt++) {
      try {
        const out = await execute.call(this, client, ...rest)
        if (run && out instanceof hedera.TransactionResponse && out.transactionId) {
          const id = out.transactionId.toString()
          run.txs ||= []
          if (!run.txs.includes(id)) run.txs.push(id)
        }
        if (run && out instanceof hedera.TransactionReceipt) {
          run.created ||= []
          for (const [kind, key] of [['token', 'tokenId'], ['topic', 'topicId'], ['contract', 'contractId'], ['account', 'accountId'], ['file', 'fileId'], ['schedule', 'scheduleId']]) {
            const v = (out as any)[key]
            if (v) { const tag = `${kind}:${v.toString()}`; if (!run.created.includes(tag)) run.created.push(tag) }
          }
        }
        return out
      } catch (err: any) {
        lastErr = err
        const msg = String(err?.message ?? err)
        const stopped = !client || client.__hbeClosed || client._isShutdown || !!run?.exited
        if (!shouldRetryExecution({ isTransaction, message: msg, attempt, stopped })) throw err
        if (/not recognized|healthy working node/i.test(msg)) {
          try { client.setNetwork('testnet') } catch {}
        }
        run?.note?.(`Node error (${msg.slice(0, 80)}). Retrying on another node, attempt ${attempt + 1}/${MAX_NODE_ATTEMPTS}...`)
        await sleepMs(retryDelayMs(attempt))
      }
    }
    throw lastErr
  }
}

/** Every Client a lab (or a library it uses) opens belongs to the run that opened it. */
function trackClients (hedera: any) {
  const C = hedera.Client
  if (C.__hbeTracked) return
  C.__hbeTracked = true
  for (const name of ['forTestnet', 'forMainnet', 'forPreviewnet', 'forName', 'forNetwork', 'fromConfig', 'fromConfigFile']) {
    const original = C[name]
    if (typeof original !== 'function') continue
    C[name] = function (this: any, ...args: any[]) {
      const client = original.apply(this, args)
      activeRun?.clients.add(client)
      return client
    }
  }
}

/**
 * gRPC-web cannot hold the Mirror Node's server stream open in the browser,
 * so TopicMessageQuery.subscribe() polls the Mirror Node REST API instead
 * and hands the listener the same TopicMessage objects (chunks reassembled).
 */
function installRestTopicSubscriptions (hedera: any): void {
  const proto = hedera.TopicMessageQuery.prototype
  if (proto.__restPolling) return
  proto.__restPolling = true
  const b64 = (v: string | null) => (v ? Uint8Array.from(atob(v), (c) => c.charCodeAt(0)) : new Uint8Array())
  const ts = (v: string) => { const [sec, ns = '0'] = v.split('.'); return { seconds: Number(sec), nanos: Number(ns.padEnd(9, '0')) } }
  const tsString = (t: any) => `${t.seconds.toString()}.${t.nanos.toString().padStart(9, '0')}`
  // As in Node, closing the client ends its subscriptions.
  const clientProto = hedera.Client.prototype
  if (!clientProto.__hbeClose) {
    const close = clientProto.close
    clientProto.close = function (this: any, ...args: any[]) { this.__hbeClosed = true; return close.apply(this, args) }
    clientProto.__hbeClose = true
  }
  proto._makeServerStreamRequest = function (this: any, client: any) {
    let stopped = false
    const run = activeRun
    const token = {}
    run?.subs.add(token)
    const release = () => { run?.subs.delete(token); run?.wake() }
    this._handle?._setCall(() => { stopped = true; release() })
    // The lab's listener; process.exit() inside it ends the run instead of counting as an error.
    const deliver = (msg: any) => {
      try {
        const r = this._listener?.(msg)
        if (r && typeof r.catch === 'function') r.catch((e: any) => { if (!isExit(e)) this._errorHandler?.(msg, e) })
      } catch (e) {
        if (!isExit(e)) this._errorHandler?.(msg, e)
      }
    }
    const groups = new Map<string, any[]>()
    let cursor: string | null = null
    const start = this._startTime ? tsString(this._startTime) : null
    const end = this._endTime ? tsString(this._endTime) : null
    let quiet = 0
    let remaining = this._limit && Number(this._limit.toString()) > 0 ? Number(this._limit.toString()) : Infinity
    const done = () => { stopped = true; release(); try { this._completionHandler?.() } catch {} }
    const poll = async () => {
      while (!stopped && !this._handle?._unsubscribed && !run?.exited && !client?.__hbeClosed) {
        let url = `${MIRROR}/topics/${this._topicId.toString()}/messages?order=asc&limit=100`
        if (cursor) url += `&timestamp=gt:${cursor}`
        else if (start) url += `&timestamp=gte:${start}`
        if (end) url += `&timestamp=lte:${end}`
        let data: any = null
        try {
          const res = await mirrorFetch(url, { ttlMs: 0 })
          if (res.ok) data = await res.json()
        } catch {}
        const messages: any[] = data?.messages || []
        for (const m of messages) {
          if (stopped || this._handle?._unsubscribed) return
          cursor = m.consensus_timestamp
          const ci = m.chunk_info
          const raw: any = {
            consensusTimestamp: ts(m.consensus_timestamp),
            message: b64(m.message),
            runningHash: b64(m.running_hash),
            sequenceNumber: m.sequence_number,
            chunkInfo: ci
              ? {
                  number: ci.number,
                  total: ci.total,
                  initialTransactionID: ci.initial_transaction_id
                    ? {
                        accountID: { shardNum: 0, realmNum: 0, accountNum: Number(String(ci.initial_transaction_id.account_id).split('.')[2]) },
                        transactionValidStart: ts(ci.initial_transaction_id.transaction_valid_start),
                        scheduled: !!ci.initial_transaction_id.scheduled,
                        nonce: ci.initial_transaction_id.nonce || 0
                      }
                    : null
                }
              : null
          }
          if (!ci || ci.total === 1) {
            deliver(hedera.TopicMessage._ofSingle(raw))
          } else {
            const key = JSON.stringify(ci.initial_transaction_id)
            const list = groups.get(key) || []
            list.push(raw)
            groups.set(key, list)
            if (list.length < ci.total) continue
            groups.delete(key)
            deliver(hedera.TopicMessage._ofMany(list))
          }
          if (--remaining <= 0) return done()
        }
        if (end && messages.length === 0 && Date.now() / 1000 > Number(end.split('.')[0])) return done()
        // Poll every 2 s, slowing down to 6 s while the topic stays quiet (Mirror Node rate limits).
        quiet = messages.length ? 0 : quiet + 1
        if (messages.length < 100) await new Promise((resolve) => setTimeout(resolve, Math.min(6000, 2000 + quiet * 500)))
      }
    }
    poll().finally(release)
  }
}

export async function executeInBrowser (
  sourceCode: string,
  wallet: BrowserWallet,
  onLog: (line: TerminalLogLine) => void,
  options: RunOptions = {}
): Promise<{ success: boolean; durationMs: number; txIds: string[]; busy?: boolean }> {
  // One run at a time: a second call while a run is live (not stopped by navigation) does nothing.
  if (activeRun && !activeRun.exited) {
    return { success: false, durationMs: 0, txIds: [], busy: true }
  }
  const startTime = Date.now()
  let seq = 0
  const es = options.lang === 'es'
  let printedUrls: Set<string> | undefined

  const emit = (line: Omit<TerminalLogLine, 'id' | 'timestamp'>) => {
    const d = new Date()
    const ts = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
    if (/INSUFFICIENT_(PAYER|ACCOUNT)_BALANCE/.test(String(line.text ?? ''))) lowBalance = true
    for (const u of String(line.text ?? '').match(/https:\/\/hashscan\.io\/[^\s)'"]+/g) || []) printedUrls?.add(u.replace(/[.,;]+$/, ''))
    if (line.url) printedUrls?.add(line.url)
    onLog({ id: `${startTime}-${seq++}`, timestamp: ts, ...line })
  }
  const pushLog = (type: TerminalLogLine['type'], text: string, url?: string) => emit({ type, text, url })
  // When an account runs out of HBAR, say so plainly and where to get more.
  let lowBalance = false
  const lowBalanceHint = () => {
    if (!lowBalance) return
    pushLog('warn', options.lang === 'es'
      ? 'Una cuenta se quedó sin HBAR. Si el drop de bienvenida no alcanza, pide más HBAR de testnet en el faucet oficial (usa TU propio Account ID, por ejemplo 0.0.xxxx). No envíes fondos a la cuenta faucet/operadora de esta app: no es un lugar para depositar; solo fondea el drop de bienvenida.'
      : 'An account ran out of HBAR. If the Welcome Drop is not enough, request more testnet HBAR from the official Hedera faucet (use YOUR own account ID, e.g. 0.0.xxxx). Do not send funds to this app\'s faucet/operator account — it is not a place to deposit; it only funds the Welcome Drop.',
    'https://portal.hedera.com/faucet')
  }

  if (isAccountId(wallet.accountId) && wallet.privateKey) {
    pushLog('system', es ? `Operador ${wallet.accountId} en testnet` : `Operator ${wallet.accountId} on testnet`)
  } else {
    pushLog('warn', options.lang === 'es'
      ? 'No hay una cuenta de testnet. Los labs que envían transacciones fallarán. Ábrela con «Crear billetera».'
      : 'No testnet account configured. Labs that send transactions will fail. Set one up with "Create wallet".')
  }

  const practice = options.practice || {}
  if (labUsesPracticeAccounts(sourceCode)) {
    if (practice.account1 && practice.account2) {
      pushLog('system', es ? `Cuentas de práctica ${practice.account1.accountId} y ${practice.account2.accountId}` : `Practice accounts ${practice.account1.accountId} and ${practice.account2.accountId}`)
    } else {
      pushLog('warn', options.lang === 'es'
        ? 'Este lab usa ACCOUNT_1 / ACCOUNT_2. Asígalas en Billeteras antes de ejecutarlo.'
        : 'This lab uses ACCOUNT_1 / ACCOUNT_2. Assign them under Wallets before you run it.')
    }
  }

  let failedWithExitCode = false
  stopRun(activeRun)
  const run: RunHandles = { subs: new Set(), timers: new Set(), clients: new Set(), exited: false, wake: () => {}, txs: [], created: [] }
  run.note = (text) => pushLog('warn', es ? text.replace('Node error', 'Error del nodo').replace('Retrying on another node, attempt', 'Reintentando en otro nodo, intento') : text)
  // HashScan URLs the lab printed itself, so the summary only adds what is missing.
  printedUrls = new Set<string>()
  const linkSummary = () => {
    const base = 'https://hashscan.io/testnet'
    const missing: { text: string; url: string }[] = []
    for (const id of run.txs || []) {
      const url = `${base}/transaction/${txIdForUrl(id)}`
      if (!printedUrls.has(url)) missing.push({ text: `${es ? 'Transacción' : 'Transaction'} ${id}`, url })
    }
    for (const tag of run.created || []) {
      const [kind, id] = tag.split(':')
      const url = `${base}/${kind}/${id}`
      if (!printedUrls.has(url)) missing.push({ text: `${kind[0].toUpperCase()}${kind.slice(1)} ${id}`, url })
    }
    if (!missing.length) return
    pushLog('system', options.lang === 'es' ? 'En HashScan:' : 'On HashScan:')
    for (const m of missing) emit({ type: 'link', text: `${m.text}: ${m.url}`, url: m.url })
  }
  activeRun = run
  let stuck: { ms: number, reason: string } | null = null
  try {
    const hedera = await import('@hiero-ledger/sdk')
    installRestTopicSubscriptions(hedera)
    trackClients(hedera)
    trackExecutions(hedera)
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
        pushLog('error', es ? `No se pudo cargar la llave del operador: ${keyErr.message}` : `Could not load the operator key: ${keyErr.message}`)
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
      try { return JSON.parse(localStorage.getItem(STATE_STORAGE_KEY) || '{}') } catch { return {} }
    }
    const updateState = (key: string, val: any) => {
      try {
        const obj = readState()
        obj[key] = val
        localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(obj))
      } catch {}
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
        if (code !== 0 || mockProcess.exitCode) failedWithExitCode = true
        run.exited = true
        run.timers.forEach((id) => window.clearTimeout(id))
        run.timers.clear()
        run.wake()
        throw new ExitSignal(code || mockProcess.exitCode || 0)
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
          pushLog('info', es ? `Gas insuficiente; reintentando con ${limit.toLocaleString('en-US')} de gas...` : `Not enough gas; retrying with ${limit.toLocaleString('en-US')} gas...`)
        }
      }
    }
    // Free Mirror Node simulation of a deployment or call (see M99 estimateGas).
    const hexOf = (value: any): string => {
      if (!value) return ''
      if (typeof value === 'string') return value.replace(/^0x/i, '')
      if (typeof value._build === 'function') return Buffer.from(value._build()).toString('hex')
      return Buffer.from(value).toString('hex')
    }
    const estimateGas = async (tx: any, c: any): Promise<{ gas?: number, revert?: string } | null> => {
      let body: any
      if (tx instanceof hedera.ContractCreateTransaction || tx instanceof hedera.ContractCreateFlow) {
        if (!tx.bytecode || !tx.bytecode.length) return null
        body = { data: '0x' + hexOf(tx.bytecode) + hexOf(tx.constructorParameters) }
      } else if (tx instanceof hedera.ContractExecuteTransaction && tx.contractId) {
        body = { to: '0x' + tx.contractId.toEvmAddress(), data: '0x' + hexOf(tx.functionParameters) }
        const value = tx.payableAmount ? Number(tx.payableAmount.toTinybars()) : 0
        if (value) body.value = value
      } else {
        return null
      }
      try {
        body.from = await getAccountEvmAddress(c.operatorAccountId.toString())
        body.estimate = true
        const res = await mirrorFetch(`${getMirrorNodeBaseUrl()}/api/v1/contracts/call`, {
          init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        })
        const data = await res.json().catch(() => null)
        if (res.ok && data?.result) return { gas: parseInt(data.result, 16) }
        const message = data?._status?.messages?.[0]?.message
        return message && /REVERT/i.test(message) ? { revert: message } : null
      } catch {
        return null
      }
    }
    const executeWithGas = async (build: (gas: number) => any, c: any, opts: { gas?: number, maxGas?: number } = {}) => {
      let start = opts.gas
      const probe = await build(opts.gas ?? 300_000)
      const est = await estimateGas(probe, c).catch(() => null)
      // Calls to system contracts (HTS, HSS, ...) can simulate far above what they use: a
      // failed call attempt costs little, so above 3M gas the lab's limit and the retry decide.
      const isCall = probe instanceof hedera.ContractExecuteTransaction
      if (est?.gas && isCall && est.gas > 3_000_000) {
        pushLog('info', options.lang === 'es'
          ? `La simulación pidió ${est.gas.toLocaleString('es-MX')} de gas, poco realista para una llamada (los contratos del sistema son difíciles de simular): se parte del límite del lab.`
          : `The simulation asked for ${est.gas.toLocaleString('en-US')} gas, unrealistic for a call (system contracts are hard to simulate): starting from the lab's limit instead.`)
      } else if (est?.gas) {
        start = Math.min(opts.maxGas ?? MAX_GAS, Math.ceil(est.gas * 1.25) + 5_000)
        pushLog('info', options.lang === 'es'
          ? `Gas estimado por simulación: ${est.gas.toLocaleString('es-MX')} → límite ${start.toLocaleString('es-MX')} (+25%).`
          : `Gas estimated by simulation: ${est.gas.toLocaleString('en-US')} → limit ${start.toLocaleString('en-US')} (+25%).`)
      } else if (est?.revert) {
        pushLog('info', options.lang === 'es'
          ? `La simulación revirtió (${est.revert}). Corre sobre el estado del Mirror Node, que puede ir unos segundos atrás, así que la transacción se envía de todos modos con el límite de gas del lab.`
          : `The simulation reverted (${est.revert}). It runs on Mirror Node state, which can be a few seconds behind, so the transaction is sent anyway with the lab's gas limit.`)
      }
      // A simulated limit can be too low for precompiles (0x167-0x16b): the call then reverts instead
      // of failing with INSUFFICIENT_GAS. Retry once with the lab's own limit before giving up.
      const send = (limit?: number) => withGasRetry(async (gas: number) => {
        const tx = await build(gas)
        const response = await tx.execute(c)
        await response.getReceipt(c)
        return response
      }, { ...opts, gas: limit })
      try {
        return await send(start)
      } catch (error: any) {
        const labGas = opts.gas
        if (labGas == null || start == null || start >= labGas || !/CONTRACT_REVERT_EXECUTED/.test(String(error?.status ?? error?.message))) throw error
        pushLog('info', options.lang === 'es'
          ? `La llamada revirtió con el límite de gas simulado; se reintenta con el límite del lab (${labGas.toLocaleString('es-MX')} de gas)...`
          : `The call reverted with the simulated gas limit; retrying with the lab's limit (${labGas.toLocaleString('en-US')} gas)...`)
        return send(labGas)
      }
    }
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
        const res = await mirrorFetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)
        return res.ok ? res.json() : null
      })
      return data?.evm_address || '0x' + hedera.AccountId.fromString(accountId).toEvmAddress()
    }
    const ensureFunded = async (c: any, accountId: string, minHbar: number) => {
      const account = await waitForMirror(async () => {
        const res = await mirrorFetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`, { ttlMs: 0 })
        return res.ok ? res.json() : null
      })
      const current = (account?.balance?.balance ?? 0) / 1e8
      if (current >= minHbar) return
      const topUp = Math.ceil(minHbar - current)
      pushLog('info', `${accountId} has ${current.toFixed(2)} ℏ; topping up ${topUp} ℏ from your account...`)
      const tx = await new hedera.TransferTransaction()
        .addHbarTransfer(c.operatorAccountId, new hedera.Hbar(-topUp))
        .addHbarTransfer(accountId, new hedera.Hbar(topUp))
        .execute(c)
      await tx.getReceipt(c)
    }
    /** A throwaway account funded by the operator (M99 createLabAccount). */
    const createLabAccount = async (c: any, { hbar = 0.1, ecdsa = false, autoAssociations = -1 } = {}) => {
      const privateKey = ecdsa ? hedera.PrivateKey.generateECDSA() : hedera.PrivateKey.generateED25519()
      const tx = new hedera.AccountCreateTransaction()
        .setInitialBalance(new hedera.Hbar(hbar))
        .setMaxAutomaticTokenAssociations(autoAssociations)
      if (ecdsa) tx.setECDSAKeyWithAlias(privateKey)
      else tx.setKeyWithoutAlias(privateKey.publicKey)
      const receipt = await (await tx.execute(c)).getReceipt(c)
      return { accountId: receipt.accountId, privateKey }
    }
    /** HBAR balance in tinybars from the Mirror Node, always fresh (M99 getMirrorHbarTinybars). */
    // A brand-new account takes a few seconds to reach the Mirror Node: a 404 is retried for up to ~15 s.
    const getMirrorHbarTinybars = async (accountId: string) => {
      for (let attempt = 0; ; attempt++) {
        const res = await mirrorFetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`, { ttlMs: 0 })
        if (res.ok) return Number((await res.json()).balance.balance)
        if (res.status !== 404 || attempt >= 7) throw new Error(`Mirror Node returned ${res.status} for ${accountId}`)
        await sleep(2000)
      }
    }
    /** Reuse the token this lab created on an earlier run (token creation is ~1 USD). See M99 reuseToken. */
    /** A reused entity gets its HashScan link right away, since no transaction will print one. */
    const reusedLink = (kind: 'token' | 'contract' | 'topic', id: string) => {
      const url = `https://hashscan.io/testnet/${kind}/${id}`
      const label = options.lang === 'es' ? { token: 'Token', contract: 'Contrato', topic: 'Tópico' }[kind] : { token: 'Token', contract: 'Contract', topic: 'Topic' }[kind]
      emit({ type: 'link', text: `${label} ${id}${options.lang === 'es' ? ' en HashScan' : ' on HashScan'}: ${url}`, url })
    }
    const reuseToken = async (stateKey: string, create: () => Promise<any>, { check = (_: any) => true, minBalance = 0, treasury = undefined as string | undefined } = {}) => {
      const operator = wallet.accountId
      const [savedId, owner] = String(getState(stateKey) || '').split('@')
      if (savedId && owner === operator) {
        const token = await mirrorFetch(`${getMirrorNodeBaseUrl()}/api/v1/tokens/${savedId}`, { ttlMs: 0 }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        if (token && !token.deleted && token.treasury_account_id === String(treasury ?? operator) && token.pause_status !== 'PAUSED' &&
          !(token.type === 'NON_FUNGIBLE_UNIQUE' && token.supply_type === 'FINITE' && Number(token.total_supply) * 2 > Number(token.max_supply)) && check(token)) {
          const enough = minBalance <= 0 || await mirrorFetch(`${getMirrorNodeBaseUrl()}/api/v1/tokens/${savedId}/balances?account.id=${treasury ?? operator}`, { ttlMs: 0 })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => Number(data?.balances?.[0]?.balance ?? 0) >= minBalance)
            .catch(() => false)
          if (enough) {
            pushLog('info', options.lang === 'es' ? `Reutilizando el token ${savedId} de una ejecución anterior (crear uno cuesta cerca de 1 USD).` : `Reusing token ${savedId} from an earlier run (creating one costs about 1 USD).`)
            reusedLink('token', savedId)
            return hedera.TokenId.fromString(savedId)
          }
        }
      }
      const tokenId = hedera.TokenId.fromString(String(await create()))
      updateState(stateKey, `${tokenId}@${operator}`)
      return tokenId
    }
    /** An ECDSA key the JSON-RPC relay maps to an account (see M99 getJsonRpcSigner). */
    const getJsonRpcSigner = async (c: any, operatorKey: string, { minHbar = 5 } = {}) => {
      const operatorId = c.operatorAccountId.toString()
      const opKey = parsePrivateKey(hedera, operatorKey)
      if (opKey.type === 'secp256k1') {
        const derived = '0x' + opKey.publicKey.toEvmAddress()
        if ((await getAccountEvmAddress(operatorId)).toLowerCase() === derived.toLowerCase()) {
          return { privateKey: opKey, accountId: operatorId, evmAddress: derived }
        }
      }
      const stored = getState('JSON_RPC_SIGNER_KEY')
      const key = stored ? hedera.PrivateKey.fromStringDer(stored) : hedera.PrivateKey.generateECDSA()
      const evmAddress = '0x' + key.publicKey.toEvmAddress()
      if (!stored) {
        pushLog('info', `${operatorId} has no EVM alias; creating an ECDSA alias account for JSON-RPC calls (${evmAddress})...`)
        const tx = await new hedera.TransferTransaction()
          .addHbarTransfer(c.operatorAccountId, new hedera.Hbar(-minHbar))
          .addHbarTransfer(hedera.AccountId.fromEvmAddress(0, 0, evmAddress), new hedera.Hbar(minHbar))
          .execute(c)
        await tx.getReceipt(c)
        updateState('JSON_RPC_SIGNER_KEY', key.toStringDer())
      }
      const account = await waitForMirror(async () => {
        const res = await mirrorFetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${evmAddress}`, { ttlMs: 0 })
        return res.ok ? (await res.json()).account : null
      }, { timeoutMs: 60_000 })
      if (!account) throw new Error(`The Mirror Node does not list ${evmAddress} yet; try again in a minute.`)
      await ensureFunded(c, account, minHbar / 2)
      return { privateKey: key, accountId: account, evmAddress }
    }
    /** Reuse the contract this lab deployed before, if the code is the same (see M99 reuseContract). */
    const reuseContract = async (stateKey: string, identity: string, deploy: () => Promise<any>) => {
      const operator = wallet.accountId
      // Solidity's trailing metadata hash changes with source comments: ignore it.
      const code = String(identity).replace(/a264697066735822[0-9a-f]{68}64736f6c6343[0-9a-f]{6}0033/gi, '')
      const codeHash = Buffer.from(sha256(utf8ToBytes(code))).toString('hex').slice(0, 16)
      const [savedId, owner, savedHash] = String(getState(stateKey) || '').split('@')
      if (savedId && owner === operator && savedHash === codeHash) {
        const contract = await mirrorFetch(`${getMirrorNodeBaseUrl()}/api/v1/contracts/${savedId}`, { ttlMs: 0 })
          .then((r) => (r.ok ? r.json() : null)).catch(() => null)
        if (contract && !contract.deleted) {
          pushLog('info', options.lang === 'es' ? `Reutilizando el contrato ${savedId} de una ejecución anterior (mismo bytecode; desplegar cuesta cerca de 1 USD más gas).` : `Reusing contract ${savedId} from an earlier run (same bytecode; deploying costs about 1 USD plus gas).`)
          reusedLink('contract', savedId)
          return hedera.ContractId.fromString(savedId)
        }
      }
      const contractId = hedera.ContractId.fromString(String(await deploy()))
      updateState(stateKey, `${contractId}@${operator}@${codeHash}`)
      return contractId
    }
    /** Reuse the topic this lab created before (see M99 reuseTopic). */
    const reuseTopic = async (stateKey: string, create: () => Promise<any>, { check = (_: any) => true } = {}) => {
      const operator = wallet.accountId
      const [savedId, owner] = String(getState(stateKey) || '').split('@')
      if (savedId && owner === operator) {
        const topic = await mirrorFetch(`${getMirrorNodeBaseUrl()}/api/v1/topics/${savedId}`, { ttlMs: 0 })
          .then((r) => (r.ok ? r.json() : null)).catch(() => null)
        if (topic && !topic.deleted && check(topic)) {
          pushLog('info', options.lang === 'es'
            ? `Reutilizando el tópico ${savedId} de una ejecución anterior (un tópico con comisiones cuesta cerca de 2 USD).`
            : `Reusing topic ${savedId} from an earlier run (a topic with custom fees costs about 2 USD).`)
          reusedLink('topic', savedId)
          return hedera.TopicId.fromString(savedId)
        }
      }
      const topicId = hedera.TopicId.fromString(String(await create()))
      updateState(stateKey, `${topicId}@${operator}`)
      return topicId
    }
    /** Lowest serial of tokenId that accountId still holds (see M99 findOwnedSerial). */
    const findOwnedSerial = async (tokenId: string, accountId: string) => {
      const data = await waitForMirror(async () => {
        const res = await mirrorFetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}/nfts?token.id=${tokenId}&order=asc&limit=1`, { ttlMs: 0 })
        return res.ok ? res.json() : null
      }, { timeoutMs: 10_000 })
      return data?.nfts?.[0]?.serial_number ?? null
    }
    const parseKey = (value: string) => parsePrivateKey(hedera, value)

    const pathShim: any = {
      sep: '/',
      join: posixJoin,
      resolve: posixResolve,
      normalize: posixNormalize,
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
      emit({ type: 'info', text: es ? `Escrito ${name} (${data.length.toLocaleString('en-US')} bytes)` : `Wrote ${name} (${data.length.toLocaleString('en-US')} bytes)`, kind: 'file', data: { name, mime, url, size: data.length, text } })
    }
    const fs = createFs(files, onWrite)
    const cryptoShim = makeCryptoShim()

    const fmt = (a: any) => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return a.message
      try { return JSON.stringify(a, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) } catch { return String(a) }
    }
    const classify = (msg: string): TerminalLogLine['type'] =>
      /SUCCESS|ÉXITO/.test(msg) ? 'success' : /WARN/.test(msg) ? 'warn' : /FAILED|FALL[OÓ]/.test(msg) ? 'error' : 'info'
    const asJson = (s: string) => {
      const t = s.trim()
      if (!/^[[{]/.test(t) || !t.includes('\n')) return undefined
      try { return JSON.parse(t) } catch { return undefined }
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
      requireEnv: (name: string) => {
        const value = mockProcess.env[name]
        if (!value) throw new Error(options.lang === 'es' ? `Falta ${name}: crea las wallets de práctica en el panel Wallets.` : `Missing ${name}: create the practice wallets in the Wallets panel.`)
        return value
      },
      withGasRetry,
      executeWithGas,
      estimateGas,
      waitForMirror,
      getAccountEvmAddress,
      ensureFunded,
      reuseToken,
      findOwnedSerial,
      reuseContract,
      reuseTopic,
      createLabAccount,
      getMirrorHbarTinybars,
      exitIfStuck: (ms: number, reason = 'the expected network events') => { stuck = { ms, reason } },
      maxTransactionFeeHbar: () => 100,
      MAX_GAS,
      show,
      getJsonRpcSigner,
      resilientContractCall,
      readContract,
    }

    // Labs' own Mirror Node reads share the site's rate limit (fresh data, no cache).
    const labFetch = (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input?.url ?? String(input)
      return isMirrorUrl(url) ? mirrorFetch(url, { ttlMs: 0, init }) : window.fetch(input, init)
    }
    const virtual = createVirtualHttp(EventEmitterShim, labFetch as typeof window.fetch)
    const ctx = { hedera, helpers, fs, crypto: cryptoShim, path: pathShim, EventEmitter: EventEmitterShim, dotenv, http: virtual.http, fetch: virtual.fetch, log: (type: 'info' | 'error', text: string) => pushLog(type, text), lang: options.lang }
    // M99's AgentCommunicationHandler is a Node module; the browser gets the bundled build.
    if (/AgentCommunicationHandler|HybridEncryption/.test(sourceCode)) {
      const vendor = await loadVendor(ctx)
      const suffix = options.lang === 'es' ? 'Es' : 'En'
      helpers.AgentCommunicationHandler = vendor[`AgentCommunicationHandler${suffix}`]
      helpers.HybridEncryption = vendor[`HybridEncryption${suffix}`]
    }
    // standards-sdk was written for @hashgraph/sdk, which had ContractId.fromSolidityAddress; the
    // Hiero SDK it runs on here only has fromEvmAddress (HCS-7's EVMBridge needs the old name).
    const contractIdClass = (hedera as any).ContractId
    if (contractIdClass && typeof contractIdClass.fromSolidityAddress !== 'function') {
      contractIdClass.fromSolidityAddress = (address: string) => contractIdClass.fromEvmAddress(0, 0, address)
    }
    // M99's HCS-1 helpers (M99_Utilities/hcs1.js) use the bundled zstd build in the browser.
    if (/\b(inscribeHcs1|readHcs1)\b/.test(sourceCode)) {
      const vendor = await loadVendor(ctx)
      helpers.inscribeHcs1 = (client: any, bytes: any, mimeType: string, opts?: any) => vendor.hcs1Upload(client, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), mimeType, opts)
      helpers.readHcs1 = async (topicId: string, opts?: any) => {
        const file = await vendor.hcs1Read(String(topicId), { mirrorBase: getMirrorNodeBaseUrl(), ...opts })
        return { ...file, bytes: Buffer.from(file.bytes) }
      }
    }
    // M10's x402 helpers (M99_Utilities/x402.js) are bundled from the course source.
    if (/\b(encodeHeader|decodeHeader|signExactPayment|settleExactPayment|verifyExactPayment|createPaymentRequired|getTransactionRecord|X402_NETWORK)\b/.test(sourceCode)) {
      const vendor = await loadVendor(ctx)
      Object.assign(helpers, vendor[`X402Helpers${options.lang === 'es' ? 'Es' : 'En'}`])
    }
    const { imports, body } = extractImports(sourceCode)
    const bound: Record<string, unknown> = {}
    for (const imp of imports) {
      const mod = await resolveModule(imp.specifier, ctx)
      for (const b of imp.bindings) bound[b.local] = bindingValue(mod, b.imported)
    }
    const __import = (spec: string) => resolveModule(spec, ctx)
    // standards-sdk needs each account's key curve up front (raw keys fit both).
    if (imports.some((i) => i.specifier === '@hashgraphonline/standards-sdk')) {
      const ids = [...Object.entries(readState()), ...Object.entries(env)]
        .filter(([k, v]) => /ACCOUNT|AGENT|OPERATOR|PAYER|SIGNER/i.test(k) && typeof v === 'string' && /^0\.0\.\d+$/.test(v))
        .map(([, v]) => v as string)
      await prefetchKeyTypes(ids)
    }

    // Lab timers keep the run alive like Node's event loop does (unref() releases them).
    const timerHandle = (id: number) => ({
      id,
      unref () { run.timers.delete(id); run.wake(); return this },
      ref () { run.timers.add(id); return this },
      hasRef: () => run.timers.has(id),
      [Symbol.toPrimitive]: () => id
    })
    const idOf = (h: any) => (typeof h === 'object' && h ? h.id : h)
    const labSetTimeout = (fn: (...a: any[]) => void, ms?: number, ...args: any[]) => {
      const id = window.setTimeout(() => {
        run.timers.delete(id)
        if (!run.exited) { try { fn(...args) } catch (e) { if (!isExit(e)) throw e } }
        run.wake()
      }, ms)
      run.timers.add(id)
      return timerHandle(id)
    }
    const labSetInterval = (fn: (...a: any[]) => void, ms?: number, ...args: any[]) => {
      const id = window.setInterval(() => { if (!run.exited) { try { fn(...args) } catch (e) { if (!isExit(e)) throw e } } }, ms)
      run.timers.add(id)
      return timerHandle(id)
    }
    const labClear = (h: any) => { const id = idOf(h); window.clearTimeout(id); window.clearInterval(id); run.timers.delete(id); run.wake() }

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
      setTimeout: labSetTimeout,
      setInterval: labSetInterval,
      clearTimeout: labClear,
      clearInterval: labClear,
      __import,
      ...bound
    }
    const RESERVED = new Set(['default', 'class', 'function', 'delete', 'new', 'return', 'var', 'let', 'const', 'import', 'export', 'this', 'typeof', 'void', 'with', 'yield', 'await', 'enum', 'super', 'in', 'of', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'null', 'true', 'false', 'instanceof', 'debugger', 'extends', 'static'])
    const names = Object.keys(scope).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && !RESERVED.has(n))
    const usesSolc = imports.some((i) => i.specifier === 'solc')
    // process.exit() never returns in Node; here it throws, so the lab's own catch blocks pass it on.
    const exitSafe = (code: string) => code
      .replace(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{/g, (_m, v) => `catch (${v}) { if (${v} && ${v}.__hbeExit) throw ${v};`)
      .replace(/\bcatch\s*\{/g, 'catch (__hbeE) { if (__hbeE && __hbeE.__hbeExit) throw __hbeE;')
    const sanitized = sanitizeSourceForExecution(exitSafe(usesSolc ? adaptSolcCalls(body) : body), entryFunctionName(sourceCode))

     
    const runner = new Function(...names, 'return (async () => {\n' + sanitized + '\n})()')
    const swallowExit = (e: PromiseRejectionEvent) => { if (isExit(e.reason)) e.preventDefault() }
    window.addEventListener('unhandledrejection', swallowExit)
    try {
      try {
        await runner(...names.map((n) => scope[n]))
      } catch (e) {
        if (!isExit(e)) throw e
      }
      // Like Node: stay alive while subscriptions or timers are pending.
      const limitStuck = stuck as { ms: number, reason: string } | null
      const limitMs = limitStuck ? limitStuck.ms : 180_000
      const timedOut = await new Promise<boolean>((resolve) => {
        const limit = window.setTimeout(() => resolve(true), limitMs)
        run.wake = () => {
          if (run.exited || (run.subs.size === 0 && run.timers.size === 0)) { window.clearTimeout(limit); resolve(false) }
        }
        run.wake()
      })
      if (timedOut && !run.exited) {
        pushLog('error', es ? `Detenido tras ${Math.round(limitMs / 1000)} s esperando ${limitStuck ? limitStuck.reason : 'suscripciones o temporizadores pendientes'}.` : `Stopped after ${Math.round(limitMs / 1000)} s waiting for ${limitStuck ? limitStuck.reason : 'pending subscriptions or timers'}.`)
        mockProcess.exitCode = 1
      }
    } finally {
      stopRun(run)
      window.removeEventListener('unhandledrejection', swallowExit)
      linkSummary()
    }
    if (failedWithExitCode) throw new ExitSignal(1)

    try { client.close() } catch {}
    const durationMs = Date.now() - startTime
    // Labs flag handled failures with process.exitCode = 1 instead of throwing.
    if (mockProcess.exitCode) {
      lowBalanceHint()
      pushLog('error', es ? `Terminado con errores en ${(durationMs / 1000).toFixed(2)} s` : `Finished with errors in ${(durationMs / 1000).toFixed(2)} s`)
      return { success: false, durationMs, txIds: run.txs || [] }
    }
    pushLog('system', es ? `Terminado en ${(durationMs / 1000).toFixed(2)} s` : `Finished in ${(durationMs / 1000).toFixed(2)} s`)
    return { success: true, durationMs, txIds: run.txs || [] }
  } catch (err: any) {
    const durationMs = Date.now() - startTime
    const message = err?.message || String(err)
    if (!failedWithExitCode) pushLog('error', es ? `Detenido: ${message}` : `Stopped: ${message}`)
    else pushLog('error', es ? `Terminado con errores en ${(durationMs / 1000).toFixed(2)} s` : `Finished with errors in ${(durationMs / 1000).toFixed(2)} s`)
    lowBalanceHint()
    if (err instanceof NodeOnlyError) {
      pushLog('warn', es ? 'Este lab usa una API exclusiva de Node.js. Los comandos para correrlo en tu máquina están debajo del código.' : 'This lab uses a Node.js-only API. The commands to run it on your machine are below the code.')
    } else if (err instanceof ReferenceError && /require|__dirname/.test(message)) {
      pushLog('warn', es ? 'Este lab usa APIs exclusivas de Node.js. Córrelo localmente con Node.js para ver todo su comportamiento.' : 'This lab uses Node.js-only APIs. Run it locally with Node.js to see its full behaviour.')
    }
    return { success: false, durationMs, txIds: run.txs || [] }
  }
}
