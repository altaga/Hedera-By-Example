/**
 * Module system for running course labs in the browser.
 *
 * A lab is an ES module written for Node.js. Instead of a fixed list of
 * globals, we read its leading `import` statements and bind each name to a
 * browser implementation: the real package where one exists (SDK, ethers,
 * protobufjs, buffer, fflate, the Solidity compiler) and faithful shims for
 * Node built-ins (fs over the course files, crypto, path, events…). Anything
 * else becomes a value that throws a clear "Node.js only" error when used,
 * so importing it is harmless until the lab actually needs it.
 */
import { Buffer } from 'buffer'
import { mirrorFetch } from './mirror'

export class NodeOnlyError extends Error {
  constructor (api: string) {
    super(`${api} is only available in Node.js, not in the browser runner. Run this lab locally to use it.`)
    this.name = 'NodeOnlyError'
  }
}

export interface ImportBinding { local: string; imported: string } // imported: 'default' | '*' | name
export interface ParsedImport { specifier: string; bindings: ImportBinding[] }

const IDENT = '[A-Za-z_$][\\w$]*'
const IMPORT_FROM = new RegExp(`import\\s+([\\w$*{},\\s]+?)\\s+from\\s*['"]([^'"]+)['"][ \\t]*;?`, 'y')
const IMPORT_BARE = /import\s*['"]([^'"]+)['"][ \t]*;?/y
const SKIP = /(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)+/y

function parseClause (clause: string): ImportBinding[] {
  const out: ImportBinding[] = []
  let rest = clause.trim()
  const ns = rest.match(new RegExp(`\\*\\s*as\\s+(${IDENT})`))
  const braces = rest.match(/\{([\s\S]*)\}/)
  if (braces) {
    for (const part of braces[1].split(',').map((p) => p.trim()).filter(Boolean)) {
      const [imported, local] = part.split(/\s+as\s+/).map((s) => s.trim())
      out.push({ imported, local: local || imported })
    }
    rest = rest.replace(braces[0], '')
  }
  if (ns) {
    out.push({ imported: '*', local: ns[1] })
    rest = rest.replace(ns[0], '')
  }
  const def = rest.replace(/,/g, ' ').trim()
  if (def) out.push({ imported: 'default', local: def })
  return out
}

/**
 * Split a lab into its leading import statements and the rest of the code.
 * Only the import block at the top is read, so text that merely looks like an
 * import (e.g. a Hardhat config inside a template string) is left alone.
 */
export function extractImports (code: string): { imports: ParsedImport[]; body: string } {
  const imports: ParsedImport[] = []
  let pos = 0
  for (;;) {
    SKIP.lastIndex = pos
    if (SKIP.exec(code)) pos = SKIP.lastIndex
    IMPORT_FROM.lastIndex = pos
    const m = IMPORT_FROM.exec(code)
    if (m) {
      imports.push({ specifier: m[2], bindings: parseClause(m[1]) })
      pos = IMPORT_FROM.lastIndex
      continue
    }
    IMPORT_BARE.lastIndex = pos
    const b = IMPORT_BARE.exec(code)
    if (b) {
      imports.push({ specifier: b[1], bindings: [] })
      pos = IMPORT_BARE.lastIndex
      continue
    }
    break
  }
  return { imports, body: code.slice(pos) }
}

/** A value that throws a clear error as soon as the lab uses it. */
export function nodeOnlyValue (what: string): any {
  const fail = () => { throw new NodeOnlyError(what) }
  return new Proxy(function () {}, {
    get (_t, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined
      return nodeOnlyValue(`${what}.${String(prop)}`)
    },
    apply: fail,
    construct: fail
  })
}

// ---------- fs over the course files ----------

export interface LabFileEvent { name: string; data: Uint8Array }

const baseName = (p: unknown) => {
  const s = p instanceof URL ? p.pathname : String(p)
  return decodeURIComponent(s.split(/[\\/]/).pop() || s)
}
const hasExtension = (p: unknown) => /\.[A-Za-z0-9]+$/.test(baseName(p))

function enoent (p: unknown) {
  return Object.assign(new Error(`ENOENT: no such file or directory, open '${String(p)}'`), { code: 'ENOENT' })
}

export function createFs (files: Map<string, Uint8Array>, onWrite: (e: LabFileEvent) => void) {
  const encodingOf = (opts: any) => (typeof opts === 'string' ? opts : opts?.encoding)
  const toBytes = (data: any, enc?: string) =>
    typeof data === 'string' ? Buffer.from(data, (enc as BufferEncoding) || 'utf8') : Buffer.from(data)

  const fs: any = {
    existsSync: (p: unknown) => files.has(baseName(p)) || !hasExtension(p),
    readFileSync: (p: unknown, opts?: any) => {
      const data = files.get(baseName(p))
      if (!data) throw enoent(p)
      const enc = encodingOf(opts)
      return enc ? Buffer.from(data).toString(enc) : Buffer.from(data)
    },
    writeFileSync: (p: unknown, data: any, opts?: any) => {
      const bytes = toBytes(data, encodingOf(opts))
      files.set(baseName(p), bytes)
      onWrite({ name: baseName(p), data: bytes })
    },
    appendFileSync: (p: unknown, data: any, opts?: any) => {
      const prev = files.get(baseName(p)) || new Uint8Array()
      const bytes = Buffer.concat([Buffer.from(prev), toBytes(data, encodingOf(opts))])
      files.set(baseName(p), bytes)
    },
    mkdirSync: () => undefined,
    mkdtempSync: (prefix: unknown) => `${String(prefix)}${Math.random().toString(36).slice(2, 8)}`,
    rmSync: (p: unknown) => { files.delete(baseName(p)) },
    unlinkSync: (p: unknown) => { files.delete(baseName(p)) },
    readdirSync: () => [...files.keys()],
    statSync: (p: unknown) => {
      const data = files.get(baseName(p))
      if (!data && hasExtension(p)) throw enoent(p)
      return { size: data?.length ?? 0, isFile: () => !!data, isDirectory: () => !data, mtime: new Date() }
    }
  }
  fs.promises = {
    readFile: async (p: unknown, o?: any) => fs.readFileSync(p, o),
    writeFile: async (p: unknown, d: any, o?: any) => fs.writeFileSync(p, d, o),
    appendFile: async (p: unknown, d: any, o?: any) => fs.appendFileSync(p, d, o),
    mkdir: async () => undefined,
    readdir: async () => fs.readdirSync(),
    stat: async (p: unknown) => fs.statSync(p),
    unlink: async (p: unknown) => fs.unlinkSync(p),
    rm: async (p: unknown) => fs.rmSync(p)
  }
  return fs
}

// ---------- Solidity compiler (soljson, WebAssembly) ----------

let solcPromise: Promise<{ compile: (input: string) => Promise<string>; version: () => Promise<string> }> | null = null

/**
 * Loads /vendor/soljson.js in a Web Worker. Chrome does not allow compiling or
 * instantiating its ~24 MB WebAssembly module on the main thread, so compile()
 * is asynchronous here; adaptSolcCalls() adds the matching `await`s to the lab.
 */
export function loadSolc () {
  if (solcPromise) return solcPromise
  solcPromise = new Promise((resolve, reject) => {
    const workerSource = `
      self.Module = { onRuntimeInitialized () {
        const compile = self.Module.cwrap('solidity_compile', 'string', ['string', 'number', 'number'])
        const version = self.Module.cwrap('solidity_version', 'string', [])
        self.onmessage = (e) => {
          const { id, op, input } = e.data
          try { postMessage({ id, ok: true, value: op === 'version' ? version() : compile(input, 0, 0) }) }
          catch (err) { postMessage({ id, ok: false, value: String(err && err.message || err) }) }
        }
        postMessage({ ready: true })
      } }
      importScripts(${JSON.stringify(new URL('/vendor/soljson.js', window.location.href).href)})
    `
    const worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })))
    const pending = new Map<number, (r: { ok: boolean; value: string }) => void>()
    let nextId = 0
    const call = (op: string, input?: string) => new Promise<string>((res, rej) => {
      const id = nextId++
      pending.set(id, (r) => (r.ok ? res(r.value) : rej(new Error(r.value))))
      worker.postMessage({ id, op, input })
    })
    worker.onmessage = (e) => {
      if (e.data?.ready) return resolve({ compile: (input: string) => call('compile', input), version: () => call('version') })
      pending.get(e.data.id)?.(e.data)
      pending.delete(e.data.id)
    }
    worker.onerror = (e) => {
      solcPromise = null
      reject(new Error(`Could not load the Solidity compiler: ${e.message || 'worker error'}`))
    }
  })
  return solcPromise
}

/**
 * In the browser solc.compile() returns a Promise. Make the labs' compile
 * helpers async and await them — e.g. `const compile = (n, src) => {…}` becomes
 * `const compile = async (n, src) => {…}` and `compile(…)` becomes `await compile(…)`.
 * Labs follow this shape: one top-level helper per compile call, called from main().
 */
export function adaptSolcCalls (code: string): string {
  if (!/\bsolc\.compile\(/.test(code)) return code
  const helpers = new Set<string>()
  const lines = code.split('\n')
  let current: string | null = null
  lines.forEach((line, i) => {
    const decl = line.match(/^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/) || line.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/)
    if (decl) current = decl[1]
    if (/\bsolc\.compile\(/.test(line)) {
      lines[i] = line.replace(/(?<!await\s)\bsolc\.compile\(/g, 'await solc.compile(')
      if (current && current !== 'main') helpers.add(current)
    }
  })
  let out = lines.join('\n')
  for (const name of helpers) {
    out = out
      .replace(new RegExp(`^((?:const|let)\\s+${name}\\s*=\\s*)(?!async)\\(`, 'm'), '$1async (')
      .replace(new RegExp(`^function\\s+${name}\\s*\\(`, 'm'), `async function ${name}(`)
      // Calls only: a declaration reads `name =` and `function name(` is excluded.
      .replace(new RegExp(`(?<![\\w$.]|await\\s|function\\s)${name}\\(`, 'g'), `await ${name}(`)
  }
  return out
}

// ---------- module registry ----------

export interface ModuleContext {
  hedera: any
  http?: any
  helpers: Record<string, unknown>
  fs: any
  crypto: any
  path: any
  EventEmitter: any
  dotenv: any
  /** fetch() for this run: 127.0.0.1 reaches the lab's in-page servers (virtual http). */
  fetch?: typeof fetch
  /** Prints a line in the lab output (used by browser patches in the vendor bundle). */
  log?: (type: 'info' | 'error', text: string) => void
  lang?: 'en' | 'es'
}

const NODE_ONLY_MODULES = new Set(['http', 'https', 'net', 'tls', 'dgram', 'child_process', 'worker_threads', 'cluster', 'readline'])

// Loads a module from /vendor without the app bundler rewriting the import.
const importUrl = new Function('u', 'return import(u)') as (u: string) => Promise<any>

let vendorCtx: ModuleContext | null = null
let vendorPromise: Promise<any> | null = null

/** An object whose properties are read from the current run's context, not the first one's. */
const forward = (pick: (ctx: ModuleContext) => any) => new Proxy({}, {
  get (_t, prop) {
    const target = vendorCtx ? pick(vendorCtx) : undefined
    const value = target?.[prop as any]
    return typeof value === 'function' && !/^[A-Z]/.test(String(prop)) ? value.bind(target) : value
  },
  has (_t, prop) { return vendorCtx ? prop in (pick(vendorCtx) || {}) : false },
  // esbuild's interop copies a module's keys (import * as crypto): list and describe them too.
  ownKeys () { return vendorCtx ? Reflect.ownKeys(pick(vendorCtx) || {}) : [] },
  getOwnPropertyDescriptor (_t, prop) {
    const target = vendorCtx ? pick(vendorCtx) : undefined
    if (!target || !(prop in target)) return undefined
    const value = target[prop as any]
    return { configurable: true, enumerable: true, writable: false, value: typeof value === 'function' && !/^[A-Z]/.test(String(prop)) ? value.bind(target) : value }
  }
})

/**
 * Libraries that are Node-only on npm (standards-sdk, did-sdk, the course's
 * AgentCommunicationHandler), bundled by scripts/build-vendor.mjs. Their Node
 * built-ins and Hedera SDK resolve to this run's instances.
 */
/** Remember each account's key curve (from the Mirror Node) for the vendor libraries. */
export async function prefetchKeyTypes (accountIds: string[]): Promise<void> {
  const map: Map<string, string> | undefined = (globalThis as any).__HBE_NODE?.keyTypes
  if (!map) return
  await Promise.all([...new Set(accountIds)].filter((id) => !map.has(id)).slice(0, 30).map(async (id) => {
    try {
      const res = await mirrorFetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${id}?transactions=false`, { ttlMs: 60_000 })
      if (!res.ok) return
      const t = String((await res.json())?.key?._type || '')
      if (t) map.set(id, t.includes('ED25519') ? 'ed25519' : 'ecdsa')
    } catch (_) {}
  }))
}

let zkPromise: Promise<any> | null = null

/** snarkjs + circomlibjs (~4 MB), loaded only by the labs that import them (M8 Lab 09). */
export async function loadZkVendor (ctx: ModuleContext): Promise<any> {
  await loadVendor(ctx) // sets globalThis.__HBE_NODE, which the bundled code may read
  if (!zkPromise) zkPromise = importUrl('/vendor/hbe-zk.mjs').catch((e) => { zkPromise = null; throw e })
  return zkPromise
}

export async function loadVendor (ctx: ModuleContext): Promise<any> {
  vendorCtx = ctx
  if (!vendorPromise) {
    const util = await resolveModule('util', ctx)
    const url = await resolveModule('url', ctx)
    const zlib = await resolveModule('zlib', ctx)
    ;(globalThis as any).__HBE_NODE = {
      hedera: ctx.hedera,
      crypto: forward((c) => c.crypto),
      fs: forward((c) => c.fs),
      path: forward((c) => c.path),
      events: { EventEmitter: ctx.EventEmitter, default: ctx.EventEmitter },
      util,
      url,
      zlib,
      fetch: (input: any, init?: RequestInit) => (vendorCtx?.fetch || window.fetch)(input, init),
      log: (type: 'info' | 'error', text: string) => vendorCtx?.log?.(type, text),
      get lang () { return vendorCtx?.lang },
      empty: () => ({}),
      keyTypes: new Map<string, 'ed25519' | 'ecdsa'>()
    }
    vendorPromise = importUrl('/vendor/hbe-vendor.mjs').catch((e) => { vendorPromise = null; throw e })
  }
  return vendorPromise
}

let sqlPromise: Promise<any> | null = null

/** node:sqlite's DatabaseSync on top of SQLite compiled to WebAssembly (sql.js). */
async function loadSqlite () {
  if (!sqlPromise) {
    sqlPromise = import('sql.js').then((m: any) => (m.default || m)({ locateFile: (f: string) => `/vendor/${f}` }))
  }
  const SQL = await sqlPromise
  const toParams = (args: any[]) => (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])
    ? Object.fromEntries(Object.entries(args[0]).map(([k, v]) => [/^[:@$]/.test(k) ? k : `:${k}`, v as any]))
    : args.map((v) => (typeof v === 'bigint' ? Number(v) : v)))
  class StatementSync {
    constructor (private db: any, private sql: string) {}
    private rows (args: any[]) {
      const stmt = this.db.prepare(this.sql)
      try {
        stmt.bind(toParams(args))
        const out: any[] = []
        while (stmt.step()) out.push(stmt.getAsObject())
        return out
      } finally { stmt.free() }
    }
    run (...args: any[]) {
      this.db.run(this.sql, toParams(args))
      const last = this.db.exec('SELECT last_insert_rowid() AS id')[0]?.values?.[0]?.[0] ?? 0
      return { changes: this.db.getRowsModified(), lastInsertRowid: last }
    }
    get (...args: any[]) { return this.rows(args)[0] }
    all (...args: any[]) { return this.rows(args) }
  }
  class DatabaseSync {
    private db: any
    constructor (_path?: string) { this.db = new SQL.Database() }
    exec (sql: string) { this.db.exec(sql) }
    prepare (sql: string) { return new StatementSync(this.db, sql) }
    close () { this.db.close() }
  }
  return { DatabaseSync, StatementSync, default: { DatabaseSync, StatementSync } }
}

/** Resolve a module specifier to the object the lab's imports are read from. */
export async function resolveModule (specifier: string, ctx: ModuleContext): Promise<any> {
  const spec = specifier.replace(/^node:/, '')
  if (/M99_Utilities|^\.\/(config|storage|resilience|explorer|index)\.js$/.test(specifier)) return { ...ctx.helpers, default: ctx.helpers }
  switch (spec) {
    case '@hiero-ledger/sdk':
    case '@hashgraph/sdk':
      return ctx.hedera
    case 'ethers':
      return import('ethers')
    case 'protobufjs': {
      const m: any = await import('protobufjs')
      return { ...m, default: m.default ?? m }
    }
    case 'buffer':
      return { Buffer, default: { Buffer } }
    case 'crypto':
      return { ...ctx.crypto, default: ctx.crypto }
    case 'path':
      return { ...ctx.path, default: ctx.path }
    case 'fs':
      return { ...ctx.fs, default: ctx.fs }
    case 'fs/promises':
      return { ...ctx.fs.promises, default: ctx.fs.promises }
    case 'events':
      return { EventEmitter: ctx.EventEmitter, default: ctx.EventEmitter }
    case 'perf_hooks':
      return { performance: window.performance, default: { performance: window.performance } }
    case 'url': {
      const url = {
        fileURLToPath: (u: unknown) => (u instanceof URL ? u.pathname : String(u).replace(/^file:\/\//, '')),
        pathToFileURL: (p: string) => new URL(`file://${p}`),
        URL
      }
      return { ...url, default: url }
    }
    case 'util': {
      const util = {
        TextEncoder,
        TextDecoder,
        inspect: (v: unknown) => { try { return JSON.stringify(v, null, 2) } catch (_) { return String(v) } },
        promisify: (fn: any) => (...args: any[]) => new Promise((resolve, reject) => fn(...args, (e: any, r: any) => (e ? reject(e) : resolve(r)))),
        inherits: (ctor: any, superCtor: any) => {
          Object.defineProperty(ctor, 'super_', { value: superCtor, writable: true, configurable: true })
          Object.setPrototypeOf(ctor.prototype, superCtor.prototype)
        },
        deprecate: (fn: any) => fn,
        debuglog: () => () => {},
        format: (f: any, ...args: any[]) => String(f).replace(/%[sdifjoO%]/g, (m) => (m === '%%' ? '%' : (() => { const v = args.shift(); return typeof v === 'object' ? JSON.stringify(v) : String(v) })())) + (args.length ? ' ' + args.map(String).join(' ') : ''),
        isDeepStrictEqual: (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b),
        types: {
          isUint8Array: (v: any) => v instanceof Uint8Array,
          isDate: (v: any) => v instanceof Date,
          isRegExp: (v: any) => v instanceof RegExp,
          isPromise: (v: any) => v instanceof Promise,
          isArrayBuffer: (v: any) => v instanceof ArrayBuffer,
          isTypedArray: (v: any) => ArrayBuffer.isView(v) && !(v instanceof DataView)
        }
      }
      return { ...util, default: util }
    }
    case 'zlib': {
      const f: any = await import('fflate')
      const wrap = (fn: (d: Uint8Array) => Uint8Array) => (d: any) => Buffer.from(fn(typeof d === 'string' ? Buffer.from(d) : d))
      const zlib = {
        gzipSync: wrap(f.gzipSync),
        gunzipSync: wrap(f.gunzipSync),
        deflateSync: wrap(f.zlibSync),
        inflateSync: wrap(f.unzlibSync),
        deflateRawSync: wrap(f.deflateSync),
        inflateRawSync: wrap(f.inflateSync)
      }
      return { ...zlib, default: zlib }
    }
    case 'dotenv':
    case 'dotenv/config':
      return { ...ctx.dotenv, default: ctx.dotenv }
    case 'http':
    case 'https':
      return ctx.http ? { ...ctx.http, default: ctx.http } : nodeOnlyModule(specifier)
    case 'sqlite':
      return loadSqlite()
    case '@hashgraphonline/standards-sdk':
    case '@hiero-did-sdk/core':
    case '@modelcontextprotocol/sdk/server/mcp.js':
    case '@modelcontextprotocol/sdk/client/index.js':
    case '@modelcontextprotocol/sdk/inMemory.js':
    case 'zod': {
      const v = await loadVendor(ctx)
      return { ...v, default: v }
    }
    case 'snarkjs': {
      const zk = await loadZkVendor(ctx)
      return { ...zk.snarkjs, default: zk.snarkjs }
    }
    case 'circomlibjs': {
      const zk = await loadZkVendor(ctx)
      const lib = { buildPoseidon: zk.buildPoseidon, poseidonContract: zk.poseidonContract }
      return { ...lib, default: lib }
    }
    case 'os': {
      // What labs ask of node:os, answered for a browser tab.
      const os = { tmpdir: () => '/tmp', homedir: () => '/home/learner', hostname: () => 'browser', platform: () => 'browser', type: () => 'Browser', EOL: '\n', cpus: () => Array.from({ length: navigator.hardwareConcurrency || 1 }, () => ({ model: 'browser' })) }
      return { ...os, default: os }
    }
    case 'solc': {
      const solc = await loadSolc()
      return { ...solc, default: solc }
    }
  }
  if (NODE_ONLY_MODULES.has(spec)) return nodeOnlyModule(specifier)
  return nodeOnlyModule(specifier)
}

function nodeOnlyModule (specifier: string) {
  return new Proxy({}, {
    get (_t, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined
      return nodeOnlyValue(prop === 'default' ? `'${specifier}'` : `${String(prop)} from '${specifier}'`)
    }
  })
}

/** Read an imported binding from a resolved module (default falls back to the module itself). */
export function bindingValue (mod: any, imported: string) {
  if (imported === '*') return mod
  if (imported === 'default') return mod?.default ?? mod
  return mod?.[imported]
}

export { Buffer }

// ---------- virtual http server ----------

/**
 * In-page stand-in for Node's `http`: createServer() registers a handler on a
 * port, and fetch() / http.request() to 127.0.0.1 or localhost on that port are
 * delivered to it. Responses stream, so SSE (text/event-stream) works.
 */
export function createVirtualHttp (EventEmitter: any, realFetch: typeof fetch) {
  const servers = new Map<number, (req: any, res: any) => void>()

  const targetPort = (u: URL) => (['127.0.0.1', 'localhost', '0.0.0.0'].includes(u.hostname) ? Number(u.port || 80) : NaN)

  /** Run the handler for one request; resolves when headers are sent. */
  function dispatch (url: URL, method: string, headers: Record<string, string>, body: Uint8Array | null,
    onHead: (status: number, headers: Record<string, string>) => void, onData: (c: Uint8Array) => void, onEnd: () => void) {
    const handler = servers.get(targetPort(url))!
    const req = new EventEmitter()
    Object.assign(req, { method, url: url.pathname + url.search, headers, socket: { remoteAddress: '127.0.0.1' } })
    const res = new EventEmitter()
    const resHeaders: Record<string, string> = {}
    let headSent = false
    const sendHead = () => { if (!headSent) { headSent = true; onHead(res.statusCode, resHeaders) } }
    Object.assign(res, {
      statusCode: 200,
      headersSent: false,
      writableEnded: false,
      setHeader: (k: string, v: any) => { resHeaders[k.toLowerCase()] = String(v); return res },
      getHeader: (k: string) => resHeaders[k.toLowerCase()],
      writeHead: (status: number, a?: any, b?: any) => {
        res.statusCode = status
        const h = typeof a === 'object' ? a : b
        if (h) for (const [k, v] of Object.entries(h)) resHeaders[k.toLowerCase()] = String(v)
        res.headersSent = true
        sendHead()
        return res
      },
      flushHeaders: () => sendHead(),
      write: (chunk: any) => { sendHead(); onData(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk)); return true },
      end: (chunk?: any) => {
        if (chunk) res.write(chunk)
        sendHead()
        res.writableEnded = true
        onEnd()
        res.emit('finish')
        return res
      }
    })
    handler(req, res)
    queueMicrotask(() => {
      if (body && body.length) req.emit('data', Buffer.from(body))
      req.emit('end')
    })
    return { abort: () => { req.emit('close'); res.emit('close') } }
  }

  const http: any = {
    createServer: (handler: (req: any, res: any) => void) => {
      const server = new EventEmitter()
      let port = 0
      Object.assign(server, {
        listen: (p: number, ...rest: any[]) => {
          port = Number(p) || 3000
          servers.set(port, handler)
          const cb = rest.find((a) => typeof a === 'function')
          queueMicrotask(() => { cb?.(); server.emit('listening') })
          return server
        },
        close: (cb?: () => void) => { servers.delete(port); queueMicrotask(() => { cb?.(); server.emit('close') }); return server },
        address: () => ({ port, address: '127.0.0.1', family: 'IPv4' })
      })
      return server
    },
    request: (target: any, opts?: any, cb?: (res: any) => void) => {
      if (typeof opts === 'function') { cb = opts; opts = {} }
      const o = typeof target === 'string' || target instanceof URL ? { ...opts } : { ...target }
      const url = typeof target === 'string' || target instanceof URL
        ? new URL(String(target))
        : new URL(`http://${o.hostname || o.host || '127.0.0.1'}:${o.port || 80}${o.path || '/'}`)
      const chunks: Uint8Array[] = []
      const clientReq = new EventEmitter()
      let handle: { abort: () => void } | null = null
      Object.assign(clientReq, {
        write: (c: any) => { chunks.push(Buffer.from(c)); return true },
        setTimeout: () => clientReq,
        setHeader: () => clientReq,
        destroy: () => { handle?.abort(); clientReq.emit('close') },
        end: (c?: any) => {
          if (c) chunks.push(Buffer.from(c))
          if (!servers.has(targetPort(url))) {
            queueMicrotask(() => clientReq.emit('error', Object.assign(new Error(`connect ECONNREFUSED ${url.host}`), { code: 'ECONNREFUSED' })))
            return clientReq
          }
          const incoming = new EventEmitter()
          incoming.setEncoding = () => incoming
          handle = dispatch(url, (o.method || 'GET').toUpperCase(), Object.fromEntries(Object.entries(o.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)])),
            Buffer.concat(chunks),
            (status, headers) => { Object.assign(incoming, { statusCode: status, headers }); cb?.(incoming); clientReq.emit('response', incoming) },
            (c) => incoming.emit('data', Buffer.from(c)),
            () => incoming.emit('end'))
          return clientReq
        }
      })
      return clientReq
    },
    get: (target: any, opts?: any, cb?: (res: any) => void) => { const r = http.request(target, opts, cb); r.end(); return r },
    STATUS_CODES: { 200: 'OK', 402: 'Payment Required', 404: 'Not Found', 500: 'Internal Server Error' }
  }

  /** fetch() that serves 127.0.0.1/localhost from the virtual servers. */
  const virtualFetch = async (input: any, init: any = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, 'http://127.0.0.1')
    if (!servers.has(targetPort(url))) return realFetch(input, init)
    // fetch(new Request(...)) carries method, headers and body on the Request object.
    const req = typeof Request !== 'undefined' && input instanceof Request ? input : null
    const method = String(init.method || req?.method || 'GET').toUpperCase()
    const rawBody = init.body ?? (req && !['GET', 'HEAD'].includes(method) ? new Uint8Array(await req.arrayBuffer()) : null)
    const body = rawBody ? Buffer.from(typeof rawBody === 'string' ? rawBody : new Uint8Array(rawBody)) : null
    const headers: Record<string, string> = {}
    for (const source of [req?.headers, init.headers]) {
      if (source) new Headers(source).forEach((v, k) => { headers[k.toLowerCase()] = v })
    }
    return new Promise((resolve) => {
      let controller!: ReadableStreamDefaultController<Uint8Array>
      const stream = new ReadableStream<Uint8Array>({ start: (c) => { controller = c }, cancel: () => handle.abort() })
      const handle = dispatch(url, method, headers, body,
        (status, h) => resolve(new Response(stream, { status, headers: h })),
        (c) => controller.enqueue(c),
        () => controller.close())
    })
  }

  return { http, fetch: virtualFetch }
}
