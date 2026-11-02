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
