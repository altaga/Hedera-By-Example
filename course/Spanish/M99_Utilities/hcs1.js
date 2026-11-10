/**
 * Inscripciones de archivos HCS-1 (https://hol.org/docs/standards/hcs-1/), el mismo formato
 * on-chain que produce Kiloscribe y que lee su CDN:
 *   tópico      submit key, sin admin key, memo "<sha256 del archivo>:zstd:base64"
 *   mensajes    {"o": orden, "c": fragmento}; los fragmentos unidos son "data:<mime>;base64," + base64(zstd(archivo))
 * En el navegador, la web del curso ofrece estas mismas dos funciones.
 */
import { createHash } from 'node:crypto'
import zlib from 'node:zlib'
import { TopicCreateTransaction, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import { getMirrorNodeBaseUrl } from './config.js'
import sleep from './sleep.js'

const CHUNK = 900 // mantiene cada mensaje JSON bajo el límite de 1024 bytes de HCS

/** Inscribe `bytes` como archivo HCS-1 y devuelve el ID de su tópico (como texto). */
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
 * Lee un archivo HCS-1 desde el Mirror Node: ordena los fragmentos por "o", descomprime y
 * comprueba el SHA-256 contra el memo del tópico. Reintenta mientras el Mirror Node se pone al día.
 */
export async function readHcs1 (topicId, { attempts = 10 } = {}) {
  const base = getMirrorNodeBaseUrl()
  const topic = await (await fetch(`${base}/api/v1/topics/${topicId}`)).json()
  const [expectedHash, algo, encoding] = String(topic.memo || '').split(':')
  if (algo !== 'zstd' || encoding !== 'base64' || !/^[0-9a-f]{64}$/.test(expectedHash)) throw new Error(`${topicId} no es un tópico HCS-1 (memo "${topic.memo}")`)
  if (topic.admin_key) throw new Error(`${topicId} tiene admin key, así que no es un tópico HCS-1 válido`)
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
  throw new Error(`El archivo HCS-1 ${topicId} está incompleto o no coincide con el hash de su memo`)
}
