// Globals Node libraries expect, injected into the vendor bundle (see build-vendor.mjs).
import { Buffer as BufferPolyfill } from 'buffer'

export const Buffer = globalThis.Buffer || BufferPolyfill
export const process = globalThis.process || {
  env: {},
  argv: [],
  version: 'v20.0.0',
  versions: { node: '20.0.0' },
  platform: 'browser',
  cwd: () => '/',
  nextTick: (fn, ...args) => queueMicrotask(() => fn(...args))
}

// fetch() inside bundled libraries goes through the runner (Mirror Node rate limit,
// and 127.0.0.1 requests reach the lab's in-page HTTP servers, e.g. an x402 facilitator).
export const fetch = (...args) => ((globalThis.__HBE_NODE && globalThis.__HBE_NODE.fetch) || globalThis.fetch)(...args)
