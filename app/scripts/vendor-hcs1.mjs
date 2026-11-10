/**
 * Browser-only patch bundled into hbe-vendor.mjs.
 *
 * standards-sdk stores HCS-11 profiles through the Kiloscribe inscription
 * API, which does not answer browsers (no CORS headers). Here the profile is
 * written straight to Hedera as an HCS-1 file instead, the same on-chain
 * format Kiloscribe produces and its CDN reads:
 *   topic memo  "<sha256 of the file>:zstd:base64"
 *   messages    {"o": order, "c": chunk}, where the chunks joined are
 *               "data:<mime>;base64," + base64(zstd(file))
 * The SDK then points the account memo at it (hcs-11:hcs://1/<topic>).
 *
 * Listing an agent in the public HOL registry needs moonscape.tech, whose API
 * also refuses browsers; in the browser that one step is skipped and the
 * learner is told so. The agent, its topics and its profile are all created.
 */
import { HCS10Client as BaseHCS10Client, HCS11Client } from '@hashgraphonline/standards-sdk'
import { compress, decompress, init } from '@bokuweb/zstd-wasm'

const CHUNK = 900 // keeps each JSON message under the 1024-byte HCS limit

let ready = null
const zstd = () => (ready ||= init('/vendor/zstd.wasm'))

const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
const toBase64 = (bytes) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Write bytes to a new HCS-1 topic and return its ID. */
export async function hcs1Upload (client, bytes, mimeType, { onChunk } = {}) {
  const hedera = globalThis.__HBE_NODE.hedera
  await zstd()
  const hash = toHex(await crypto.subtle.digest('SHA-256', bytes))
  const payload = `data:${mimeType};base64,` + toBase64(compress(bytes, 10))
  const create = await new hedera.TopicCreateTransaction()
    .setTopicMemo(`${hash}:zstd:base64`)
    .setSubmitKey(client.operatorPublicKey)
    .execute(client)
  const topicId = (await create.getReceipt(client)).topicId
  for (let o = 0, i = 0; i < payload.length; o++, i += CHUNK) {
    const message = JSON.stringify({ o, c: payload.slice(i, i + CHUNK) })
    await (await new hedera.TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(message).execute(client)).getReceipt(client)
    onChunk?.(o + 1, Math.ceil(payload.length / CHUNK))
  }
  return topicId.toString()
}

const fromBase64 = (text) => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0))

/** Read an HCS-1 file from the Mirror Node, checking the SHA-256 against the topic memo. */
export async function hcs1Read (topicId, { attempts = 10, mirrorBase } = {}) {
  const base = mirrorBase || globalThis.__HBE_NODE?.mirrorBase || 'https://testnet.mirrornode.hedera.com'
  await zstd()
  // A topic created moments ago may not be on the Mirror Node yet: wait for it (and its memo).
  let topic = {}
  for (let i = 0; i < attempts && !topic.memo; i++) {
    if (i) await new Promise((resolve) => setTimeout(resolve, 2000))
    const res = await fetch(`${base}/api/v1/topics/${topicId}`)
    topic = res.ok ? await res.json() : {}
  }
  const [expectedHash, algo, encoding] = String(topic.memo || '').split(':')
  if (algo !== 'zstd' || encoding !== 'base64' || !/^[0-9a-f]{64}$/.test(expectedHash)) throw new Error(`${topicId} is not an HCS-1 topic (memo "${topic.memo}")`)
  if (topic.admin_key) throw new Error(`${topicId} has an admin key, so it is not a valid HCS-1 topic`)
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const chunks = []
    let url = `${base}/api/v1/topics/${topicId}/messages?limit=100&order=asc`
    while (url) {
      const page = await (await fetch(url)).json()
      for (const m of page.messages || []) {
        try { chunks.push(JSON.parse(new TextDecoder().decode(fromBase64(m.message)))) } catch (_) {}
      }
      url = page.links?.next ? `${base}${page.links.next}` : null
    }
    const joined = chunks.filter((c) => Number.isInteger(c.o) && typeof c.c === 'string').sort((a, b) => a.o - b.o).map((c) => c.c).join('')
    const match = joined.match(/^data:([^;]+);base64,/)
    if (match) {
      try {
        const bytes = decompress(fromBase64(joined.slice(match[0].length)))
        const hash = toHex(await crypto.subtle.digest('SHA-256', bytes))
        if (hash === expectedHash) return { bytes: globalThis.Buffer ? globalThis.Buffer.from(bytes) : bytes, mimeType: match[1], hash, chunks: chunks.length }
      } catch (_) {}
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  throw new Error(`HCS-1 file ${topicId} is incomplete or does not match its memo hash`)
}

HCS11Client.prototype.inscribeProfile = async function (profile) {
  this.logger?.info?.('Storing the HCS-11 profile on HCS-1 directly (browser)')
  const validation = this.validateProfile(profile)
  if (!validation.valid) {
    return { profileTopicId: '', transactionId: '', success: false, error: `Invalid profile: ${validation.errors.join(', ')}` }
  }
  try {
    const json = this.profileToJSONString(profile)
    const profileTopicId = await hcs1Upload(this.client, new TextEncoder().encode(json), 'application/json')
    return { profileTopicId, transactionId: '', success: true }
  } catch (error) {
    return { profileTopicId: '', transactionId: '', success: false, error: error?.message || String(error) }
  }
}

const note = (text) => globalThis.__HBE_NODE?.log?.('info', text)

BaseHCS10Client.prototype.registerAgentWithGuardedRegistry = async function (accountId, _network, options) {
  note(globalThis.__HBE_NODE?.lang === 'es'
    ? `[web] ${accountId} quedó creada con sus tópicos y su perfil HCS-11. Listarla en el registro público de HOL (moonscape.tech) solo funciona fuera del navegador, así que ese paso se omite aquí.`
    : `[web] ${accountId} was created with its topics and HCS-11 profile. Listing it in the public HOL registry (moonscape.tech) only works outside the browser, so that step is skipped here.`)
  const state = { ...(options?.existingState || {}), currentStage: 'complete', completedPercentage: 100 }
  return { success: true, confirmed: false, transactionId: '', state }
}

/**
 * A raw 64-hex private key fits both curves. standards-sdk asks the Mirror
 * Node which one an account uses, but some of its inner clients start signing
 * before that answer and guess ECDSA, so Ed25519 agents get INVALID_SIGNATURE.
 * The runner looks the key types up before the lab starts; this passes the
 * known type explicitly.
 */
export class HCS10Client extends BaseHCS10Client {
  constructor (config) {
    const known = config && !config.keyType && globalThis.__HBE_NODE?.keyTypes?.get(String(config.operatorId))
    super(known ? { ...config, keyType: known } : config)
  }
}
