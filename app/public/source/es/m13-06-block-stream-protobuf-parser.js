/**
 * ============================================================================
 * Lab 06: Codificador/Parser Protobuf de Block Stream con los Esquemas HAPI Oficiales
 * [CONCEPTO] BlockItems HIP-1056 Construidos a partir de una Transacción Real de Testnet
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * HIP-1056 reemplaza los archivos de registro (.rcd) con un único Block Stream firmado
 * compuesto de `BlockItem`s (block_header, signed_transaction, transaction_result,
 * state_changes, block_proof...). Los nodos de consenso lo envían a los Block Nodes
 * (HIP-1081); HIP-1193 programa la transición desde el record stream.
 *
 * Este lab usa los esquemas REALES: carga los archivos `.proto` oficiales de
 * hiero-consensus-node (tag fijado) con protobufjs y luego:
 * 1. Envía un mensaje HCS real en testnet y guarda los bytes de la transacción firmada.
 * 2. Lee su resultado de consenso y su bloque desde el Mirror Node.
 * 3. Codifica un `com.hedera.hapi.block.stream.Block` con items BlockHeader,
 *    SignedTransaction y TransactionResult a partir de esos datos reales.
 * 4. Decodifica los bytes y los indexa como lo haría un consumidor de block streams.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * El parseo Protobuf solo es tan bueno como el esquema: carga siempre los protos oficiales
 * de la versión HAPI que reporta la red (`/api/v1/blocks` -> `hapi_version`).
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-1056
 * - https://hips.hedera.com/hip/hip-1081
 * - https://hips.hedera.com/hip/hip-1193
 * - https://github.com/hiero-ledger/hiero-consensus-node/tree/main/hapi/hedera-protobuf-java-api/src/main/proto/block/stream
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M13 Lab 05: Motor Autónomo de Liquidación de Intenciones Cross-Chain
 * - Siguiente: M14 Lab 01: Puntos Inscriptos y Auditables HCS-20
 *
 * [SIMULADO]
 * El Block se arma localmente con datos reales de testnet; no se descarga de un Block Node (los buckets de block stream de testnet son requester-pays y el acceso a Block Nodes está restringido). No incluye state_changes ni block_proof, así que no es un bloque verificable.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red). Descarga ~160 archivos .proto desde GitHub.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M13_Cross_Ledger_and_Data_Streams/06_block_stream_protobuf_parser.js
 * ============================================================================
 */

import crypto from 'crypto'
import protobuf from 'protobufjs'
import { TopicCreateTransaction, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import { getClient, getMirrorNodeBaseUrl, updateState, waitForMirror } from '../M99_Utilities/index.js'

const HAPI_TAG = 'v0.78.1'
const PROTO_BASE = `https://raw.githubusercontent.com/hiero-ledger/hiero-consensus-node/${HAPI_TAG}/hapi/hedera-protobuf-java-api/src/main/proto/`

/** Carga los protos oficiales de block stream y todos sus imports. */
const loadOfficialProtos = async () => {
  const root = new protobuf.Root()
  const seen = new Map()
  const load = (file) => {
    if (file.startsWith('google/protobuf/')) return Promise.resolve()
    if (!seen.has(file)) {
      seen.set(file, (async () => {
        const res = await fetch(PROTO_BASE + file)
        if (!res.ok) throw new Error(`No se pudo descargar ${file}: ${res.status}`)
        const parsed = protobuf.parse(await res.text(), root, { keepCase: true })
        await Promise.all([...(parsed.imports || []), ...(parsed.weakImports || [])].map(load))
      })())
    }
    return seen.get(file)
  }
  await load('block/stream/block.proto')
  for (const f of ['wrappers', 'timestamp', 'empty']) {
    const common = protobuf.common[`google/protobuf/${f}.proto`]
    if (common) root.addJSON(common.nested)
  }
  root.resolveAll()
  return { root, files: seen.size }
}

const mirror = async (path) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1${path}`)
  return res.ok ? res.json() : null
}
const ts = (s) => { const [seconds, nanos] = s.split('.'); return { seconds: Number(seconds), nanos: Number(nanos) } }
const acct = (id) => { const [shardNum, realmNum, accountNum] = id.split('.').map(Number); return { shardNum, realmNum, accountNum } }

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Codificador/Parser Protobuf de Block Stream (Esquemas HAPI Oficiales) ---\n')
  const { client } = getClient()

  try {
    console.log(`[PROCESO] Paso 1: Cargando protos oficiales de block stream desde hiero-consensus-node ${HAPI_TAG}...`)
    const { root, files } = await loadOfficialProtos()
    const Block = root.lookupType('com.hedera.hapi.block.stream.Block')
    const BlockItem = root.lookupType('com.hedera.hapi.block.stream.BlockItem')
    console.log(`[ÉXITO] ${files} archivos .proto procesados. Tipos de BlockItem: ${Object.keys(BlockItem.fields).join(', ')}`)

    console.log('\n[PROCESO] Paso 2: Enviando un mensaje HCS real y guardando sus bytes firmados...')
    const topicId = (await (await new TopicCreateTransaction().setTopicMemo('hbe:block-stream-lab').execute(client)).getReceipt(client)).topicId
    const tx = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage('block-stream lab ping').freezeWith(client).signWithOperator(client)
    const signedTxBytes = (await import('@hiero-ledger/proto')).proto.TransactionList.decode(tx.toBytes()).transactionList[0].signedTransactionBytes
    const res = await tx.execute(client)
    await res.getReceipt(client)
    const txId = res.transactionId.toString()
    console.log(`[ÉXITO] ${txId} (${signedTxBytes.length} bytes firmados)`)

    console.log('\n[PROCESO] Paso 3: Leyendo el resultado de consenso y su bloque desde el Mirror Node...')
    const mirrorId = txId.replace('@', '-').replace(/\.(\d+)$/, '-$1')
    const record = await waitForMirror(async () => (await mirror(`/transactions/${mirrorId}`))?.transactions?.[0], { timeoutMs: 60_000 })
    if (!record) throw new Error('La transacción aún no está en el Mirror Node')
    const block = (await mirror(`/blocks?timestamp=lte:${record.consensus_timestamp}&order=desc&limit=1`)).blocks[0]
    console.log(`[LOG] Block #${block.number} | hapi ${block.hapi_version} | archivo origen ${block.name}`)
    console.log(`[LOG] Resultado ${record.result} | comisión ${record.charged_tx_fee} tinybars | ${record.transfers.length} transferencias`)

    console.log('\n[PROCESO] Paso 4: Codificando un com.hedera.hapi.block.stream.Block con esos datos...')
    const [major, minor, patch] = block.hapi_version.split('.').map(Number)
    const message = Block.fromObject({
      items: [
        { block_header: { hapi_proto_version: { major, minor, patch }, number: block.number, block_timestamp: ts(block.timestamp.from), hash_algorithm: 'SHA2_384' } },
        { signed_transaction: signedTxBytes },
        {
          transaction_result: {
            status: record.result,
            consensus_timestamp: ts(record.consensus_timestamp),
            transaction_fee_charged: record.charged_tx_fee,
            transfer_list: { accountAmounts: record.transfers.map(t => ({ accountID: acct(t.account), amount: t.amount })) }
          }
        }
      ]
    })
    const bytes = Block.encode(message).finish()
    console.log(`[ÉXITO] ${bytes.length} bytes | SHA-384 ${crypto.createHash('sha384').update(bytes).digest('hex').slice(0, 32)}...`)

    console.log('\n[PROCESO] Paso 5: Decodificando e indexando los BlockItems...')
    const decoded = Block.toObject(Block.decode(bytes), { enums: String, longs: String, bytes: String })
    for (const item of decoded.items) {
      const kind = Object.keys(item)[0]
      if (kind === 'block_header') console.log(`➔ block_header: #${item.block_header.number} hapi ${JSON.stringify(item.block_header.hapi_proto_version)}`)
      if (kind === 'signed_transaction') console.log(`➔ signed_transaction: ${item.signed_transaction.length} caracteres base64`)
      if (kind === 'transaction_result') {
        const r = item.transaction_result
        console.log(`➔ transaction_result: ${r.status} at ${r.consensus_timestamp.seconds}.${r.consensus_timestamp.nanos}, comisión ${r.transaction_fee_charged}`)
        for (const aa of r.transfer_list.accountAmounts) console.log(`   ${aa.accountID.shardNum}.${aa.accountID.realmNum}.${aa.accountID.accountNum}: ${aa.amount}`)
      }
    }
    if (decoded.items[2].transaction_result.status !== record.result) throw new Error('No coincide la ida y vuelta')

    updateState('BLOCK_STREAM_LAST_PARSED_BLOCK', String(block.number))

    console.log('\n CONCEPTO CLAVE:')
    console.log('Los block streams son BlockItems definidos por los protos HAPI oficiales. Carga el esquema de la')
    console.log('hapi_version de la red y cada consumidor decodifica los mismos bytes de la misma forma.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Falló el lab de block stream:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLIDO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
