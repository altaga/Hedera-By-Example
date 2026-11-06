/**
 * Bundles the Node-only libraries some labs import so they run in the browser:
 *   - @hashgraphonline/standards-sdk (HCS-7/10/11/12/14/15-18/20/21/26/27 labs)
 *   - @hiero-did-sdk/core (DID labs)
 *   - the course's AgentCommunicationHandler (M99_Utilities/lib.js, EN and ES)
 *   - the official x402 packages (@x402/core, @x402/hedera, @x402/fetch) and the
 *     course's x402 helpers (M99_Utilities/x402.js), for Module 10
 * Only the names the labs import are kept. Node built-ins and the Hedera SDK
 * are not bundled: they resolve at run time to the runner's own instances
 * (globalThis.__HBE_NODE), so transactions built by these libraries are the
 * same classes the lab's client executes.
 *
 * Output: public/vendor/hbe-vendor.mjs (+ sql.js wasm for node:sqlite).
 */
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'

const ROOT = path.resolve(import.meta.dirname, '..')
const COURSE = path.resolve(ROOT, '..', 'course')
const OUT = path.join(ROOT, 'public', 'vendor')

const LIBS = ['@hashgraphonline/standards-sdk', '@hiero-did-sdk/core']

// x402 entry points the M10 labs import. Each one is exported as its own
// namespace (several define ExactHederaScheme), read back by labModules.ts.
export const X402_MODULES = ['@x402/core/client', '@x402/core/server', '@x402/core/facilitator', '@x402/core/http',
  '@x402/hedera', '@x402/hedera/exact/client', '@x402/hedera/exact/server', '@x402/hedera/exact/facilitator', '@x402/fetch']
export const x402Namespace = (spec) => 'X402_' + spec.replace(/^@x402\//, '').replace(/[^a-z0-9]+/gi, '_')

/** Names each library is imported with, across every lab in both languages. */
function importedNames () {
  const names = Object.fromEntries(LIBS.map((l) => [l, new Set()]))
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.js')) {
        const src = fs.readFileSync(p, 'utf8')
        for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
          if (!names[m[2]]) continue
          for (const n of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) names[m[2]].add(n)
        }
      }
    }
  }
  walk(path.join(COURSE, 'English'))
  walk(path.join(COURSE, 'Spanish'))
  return names
}

// Built-ins and the SDK come from the runner at run time; events, util, stream
// and string_decoder use their npm browser implementations (bundled).
const RUNTIME = {
  '@hashgraph/sdk': 'hedera',
  '@hiero-ledger/sdk': 'hedera',
  crypto: 'crypto',
  fs: 'fs',
  path: 'path',
  url: 'url',
  zlib: 'zlib'
}
const EMPTY = ['os', 'http', 'https', 'net', 'tls', 'child_process', 'worker_threads', 'readline', 'dns', 'assert', 'module', 'vm', 'tty', 'http2', 'perf_hooks', 'async_hooks', 'querystring', 'constants', 'fs/promises', 'stream/web', 'timers', 'process']

const runtimePlugin = {
  name: 'hbe-runtime',
  setup (b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      const spec = args.path.replace(/^node:/, '')
      if (['events', 'util', 'stream', 'string_decoder', 'buffer'].includes(spec) && args.path.startsWith('node:')) {
        return b.resolve(spec, { resolveDir: args.resolveDir, kind: args.kind })
      }
      if (RUNTIME[spec] || EMPTY.includes(spec)) return { path: spec, namespace: 'hbe-runtime' }
      return undefined
    })
    // @x402/hedera only uses the protobuf Key type to read threshold-key accounts; the SDK has it.
    b.onResolve({ filter: /^@hiero-ledger\/proto$/ }, () => ({ path: 'proto', namespace: 'hbe-proto' }))
    b.onLoad({ filter: /.*/, namespace: 'hbe-proto' }, () => ({
      contents: 'const h = globalThis.__HBE_NODE.hedera; module.exports = { proto: h.proto || { Key: { decode () { throw new Error("Threshold-key payers are not supported in the browser runner") } } } }',
      loader: 'js'
    }))
    b.onLoad({ filter: /.*/, namespace: 'hbe-runtime' }, (args) => {
      const key = RUNTIME[args.path]
      const contents = key
        ? `module.exports = globalThis.__HBE_NODE.${key}`
        : `module.exports = (globalThis.__HBE_NODE.empty && globalThis.__HBE_NODE.empty(${JSON.stringify(args.path)})) || {}`
      return { contents, loader: 'js' }
    })
  }
}

export async function buildVendor () {
  fs.mkdirSync(OUT, { recursive: true })
  const names = importedNames()
  const lines = []
  for (const lib of LIBS) {
    // HCS10Client comes from vendor-hcs1.mjs (wrapped), the rest straight from the library.
    const list = [...names[lib]].filter((n) => n !== 'HCS10Client').sort()
    if (list.length) lines.push(`export { ${list.join(', ')} } from '${lib}'`)
  }
  for (const lang of ['English', 'Spanish']) {
    const lib = path.join(COURSE, lang, 'M99_Utilities', 'lib.js').replace(/\\/g, '/')
    const suffix = lang === 'English' ? 'En' : 'Es'
    lines.push(`export { AgentCommunicationHandler as AgentCommunicationHandler${suffix}, HybridEncryption as HybridEncryption${suffix} } from '${lib}'`)
  }
  for (const spec of X402_MODULES) lines.push(`export * as ${x402Namespace(spec)} from '${spec}'`)
  for (const lang of ['English', 'Spanish']) {
    const helpers = path.join(COURSE, lang, 'M99_Utilities', 'x402.js').replace(/\\/g, '/')
    lines.push(`export * as X402Helpers${lang === 'English' ? 'En' : 'Es'} from '${helpers}'`)
  }
  // Browser patches (HCS-1 profile storage) apply when the bundle loads.
  lines.push(`export { HCS10Client } from '${path.join(ROOT, 'scripts', 'vendor-hcs1.mjs').replace(/\\/g, '/')}'`)
  const entry = path.join(OUT, '.vendor-entry.mjs')
  fs.writeFileSync(entry, lines.join('\n') + '\n')
  try {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      mainFields: ['browser', 'module', 'main'],
      nodePaths: [path.join(COURSE, 'node_modules')],
      outfile: path.join(OUT, 'hbe-vendor.mjs'),
      minify: process.env.VENDOR_DEBUG ? false : true,
      treeShaking: true,
      target: 'es2020',
      define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
      inject: [path.join(ROOT, 'scripts', 'vendor-globals.mjs')],
      // The package's own browser build leaves out the builders the labs use: take the full ES build.
      alias: { stream: 'readable-stream', '@hashgraphonline/standards-sdk': path.join(COURSE, 'node_modules', '@hashgraphonline', 'standards-sdk', 'dist', 'es', 'standards-sdk.es.js') },
      plugins: [runtimePlugin],
      logLevel: 'error',
      metafile: true
    })
    const size = fs.statSync(path.join(OUT, 'hbe-vendor.mjs')).size
    // sql.js powers the node:sqlite shim.
    const wasm = path.join(ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
    if (fs.existsSync(wasm)) fs.copyFileSync(wasm, path.join(OUT, 'sql-wasm.wasm'))
    // zstd for HCS-1 uploads (vendor-hcs1.mjs).
    fs.copyFileSync(path.join(ROOT, 'node_modules', '@bokuweb', 'zstd-wasm', 'dist', 'web', 'zstd.wasm'), path.join(OUT, 'zstd.wasm'))
    return { size, inputs: Object.keys(result.metafile.inputs).length }
  } finally {
    fs.rmSync(entry, { force: true })
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  buildVendor().then((r) => console.log(`vendor: ${(r.size / 1024).toFixed(0)} KB from ${r.inputs} files`)).catch((e) => { console.error(e.message); process.exit(1) })
}
