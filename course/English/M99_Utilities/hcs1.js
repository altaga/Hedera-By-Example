/**
 * HCS-1 file inscriptions (https://hol.org/docs/standards/hcs-1/), the same on-chain format
 * Kiloscribe produces and its CDN reads:
 *   topic       submit key, no admin key, memo "<sha256 of the file>:zstd:base64"
 *   messages    {"o": order, "c": chunk}; the chunks joined are "data:<mime>;base64," + base64(zstd(file))
 * In the browser the course website provides the same two functions.
 */
import { createHash } from 'node:crypto'
import zlib from 'node:zlib'
import { TopicCreateTransaction, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import { getMirrorNodeBaseUrl } from './config.js'
import sleep from './sleep.js'

const CHUNK = 900 // keeps each JSON message under the 1024-byte HCS limit

/** Inscribes `bytes` as an HCS-1 file and returns its topic ID (as a string). */
export async function inscribeHcs1 (client, bytes, mimeType, { onChunk } = {}) {
  const data = Buffer.from(bytes)
  const hash = createHash('sha256').update(data).digest('hex')
  const payload = `data:${mimeType};base64,` + zlib.zstdCompressSync(data, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 10 } }).toString('base64')
  const create = await new TopicCreateTransaction()
    .setTopicMemo(`${hash}:zstd:base64`)
    .setSubmitKey(client.operatorPublicKey)
    .execute(client)
  const topicId = (await create.getReceipt(client)).topicId
  const total = Math.ceil(payload.length / CHUNK)
  for (let o = 0; o < total; o++) {
    const message = JSON.stringify({ o, c: payload.slice(o * CHUNK, (o + 1) * CHUNK) })
    await (await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(message).execute(client)).getReceipt(client)
    onChunk?.(o + 1, total)
  }
  return topicId.toString()
}

/**
 * Reads an HCS-1 file back from the Mirror Node: sorts the chunks by "o", decompresses, and
 * checks the SHA-256 against the topic memo. Retries while the Mirror Node catches up.
 */
export async function readHcs1 (topicId, { attempts = 10 } = {}) {
  const base = getMirrorNodeBaseUrl()
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
        try { chunks.push(JSON.parse(Buffer.from(m.message, 'base64').toString('utf8'))) } catch (_) {}
      }
      url = page.links?.next ? `${base}${page.links.next}` : null
    }
    const joined = chunks.filter((c) => Number.isInteger(c.o) && typeof c.c === 'string').sort((a, b) => a.o - b.o).map((c) => c.c).join('')
    const match = joined.match(/^data:([^;]+);base64,/)
    if (match) {
      try {
        const bytes = zlib.zstdDecompressSync(Buffer.from(joined.slice(match[0].length), 'base64'))
        const hash = createHash('sha256').update(bytes).digest('hex')
        if (hash === expectedHash) return { bytes, mimeType: match[1], hash, chunks: chunks.length }
      } catch (_) {}
    }
    if (attempt < attempts) await sleep(3000)
  }
  throw new Error(`HCS-1 file ${topicId} is incomplete or does not match its memo hash`)
}
