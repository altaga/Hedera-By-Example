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
  helpers: Record<string, unknown>
  fs: any
  crypto: any
  path: any
  EventEmitter: any
  dotenv: any
}

const NODE_ONLY_MODULES = new Set(['http', 'https', 'net', 'tls', 'dgram', 'child_process', 'worker_threads', 'cluster', 'sqlite', 'readline'])

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
        promisify: (fn: any) => (...args: any[]) => new Promise((resolve, reject) => fn(...args, (e: any, r: any) => (e ? reject(e) : resolve(r))))
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
