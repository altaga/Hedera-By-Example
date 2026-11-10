/**
 * ============================================================================
 * Lab 10: Transacciones en Lote Atómico (HIP-551)
 * [CONCEPTO] Varias Transacciones Firmadas, una Unidad Todo-o-Nada, sin Contrato
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Una BatchTransaction lleva hasta 50 transacciones internas (6 KB en total) que
 * llegan a consenso juntas: o todas surten efecto o ninguna. Cada transacción interna
 * es una transacción normal con su propio pagador y firmas; lo que la ata al lote es
 * su batch key (batchify la fija, marca el nodo como 0.0.0 y firma). El lote externo
 * debe firmarse con cada batch key. Este lab liquida un intercambio de HBAR entre dos
 * partes más un registro HCS de la operación en un solo lote, y luego envía un lote
 * cuyo último paso falla y comprueba en el Mirror Node que ninguno de sus pasos
 * anteriores quedó aplicado.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Atómico no quiere decir gratis: cuando un lote falla, las transacciones internas que corrieron se cobran igual; solo se revierten sus efectos. Y desde v0.76.3 un lote puede tener como máximo una llamada a contrato, como último paso; las llamadas a contrato dentro de lotes están en desuso (su eliminación está prevista para marzo de 2027), así que mantén los lotes nativos (HBAR, tokens, topics, cuentas) y lleva la lógica de contratos al contrato.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-551
 * - https://docs.hedera.com/native/transactions/batch
 * - https://docs.hedera.com/native/transactions/batch#limits-on-batch-size
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M4 Lab 09: Préstamos Flash Sin Capital y Liquidación Atómica en Capa 1
 * - Siguiente: M5 Lab 01: Creación de Topic HCS Inmutable
 *
 * [ SECUENCIA ]
 * Note Lab: Interna 1: ACCOUNT_1 le paga a ACCOUNT_2 (firma ACCOUNT_1)
 * Note Lab: Interna 2: ACCOUNT_2 le devuelve más a ACCOUNT_1 (firma ACCOUNT_2)
 * Note Lab: Interna 3: El registro de la operación en HCS (firmas tú)
 * Lab -> Hedera: BatchTransaction (firmada con la batch key)
 * Hedera -> Lab: SUCCESS: las tres aplicadas en timestamps de consenso consecutivos
 * Lab -> Hedera: Un segundo lote cuyo último paso sobregira a ACCOUNT_2
 * Hedera -> Lab: INNER_TRANSACTION_FAILED: nada aplicado
 * Lab -> Mirror Node: Saldos y topic sin cambios
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet paga el lote, tiene la batch key y escribe el registro HCS.
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 intercambian 0.10 ℏ y 0.12 ℏ (cada una paga su comisión interna).
 * - Costo: <1 ℏ la primera vez (topic); unos 0.05 ℏ por ejecución después, repartidos entre las tres cuentas.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M4_Token_Operations_Atomic_Swaps/10_hip551_atomic_batch.js
 * ============================================================================
 */

import { BatchTransaction, Hbar, TopicCreateTransaction, TopicMessageSubmitTransaction, TransferTransaction } from '@hiero-ledger/sdk'
import { getClient, createClient, parsePrivateKey, ensureFunded, reuseTopic, waitForMirror, getMirrorNodeBaseUrl, getHashscanUrl, updateState, show } from '../M99_Utilities/index.js'

const mirror = (path) => fetch(`${getMirrorNodeBaseUrl()}/api/v1${path}`).then((r) => (r.ok ? r.json() : null))
const hbarOf = async (id) => (await mirror(`/accounts/${id}`))?.balance?.balance ?? 0
const topicSequence = async (topicId) => (await mirror(`/topics/${topicId}/messages?limit=1&order=desc`))?.messages?.[0]?.sequence_number ?? 0
const mirrorTxId = (txId) => txId.toString().replace('@', '-').replace(/\.(\d+)$/, '-$1')

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Transacciones en Lote Atómico (HIP-551) ---\n')
  const { client, operatorKey } = getClient()
  const ids = [process.env.ACCOUNT_1_ID, process.env.ACCOUNT_2_ID]
  const keys = [process.env.ACCOUNT_1_PRIVATE_KEY, process.env.ACCOUNT_2_PRIVATE_KEY]
  if (ids.some((v) => !v) || keys.some((v) => !v)) {
    console.error('[FALLO] Faltan credenciales de ACCOUNT_1 / ACCOUNT_2 en .env.')
    process.exitCode = 1
    return
  }
  const [aliceId, bobId] = ids
  const alice = createClient(aliceId, keys[0])
  const bob = createClient(bobId, keys[1])
  // La batch key: quien la tiene decide si estas transacciones internas se envían, y juntas.
  const batchKey = parsePrivateKey(operatorKey)

  try {
    await ensureFunded(client, aliceId, 2)
    await ensureFunded(client, bobId, 2)
    const topicId = await reuseTopic('REUSE_M4_10_TRADE_LOG', async () => {
      const receipt = await (await new TopicCreateTransaction().setTopicMemo('HBE M4-10 atomic batch trade log').execute(client)).getReceipt(client)
      return receipt.topicId
    })

    // 1. Tres transacciones internas, cada una armada y firmada por su propio pagador, todas atadas a la batch key.
    const swap = async ({ aToB, bToA, memo }) => {
      const leg1 = await new TransferTransaction()
        .addHbarTransfer(aliceId, new Hbar(-aToB))
        .addHbarTransfer(bobId, new Hbar(aToB))
        .setTransactionMemo(`${memo} leg 1`)
        .batchify(alice, batchKey.publicKey)
      const leg2 = await new TransferTransaction()
        .addHbarTransfer(bobId, new Hbar(-bToA))
        .addHbarTransfer(aliceId, new Hbar(bToA))
        .setTransactionMemo(`${memo} leg 2`)
        .batchify(bob, batchKey.publicKey)
      const record = await new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(JSON.stringify({ trade: memo, aToB, bToA, parties: [aliceId, bobId] }))
        .batchify(client, batchKey.publicKey)
      return [leg1, leg2, record]
    }

    const before = { alice: await hbarOf(aliceId), bob: await hbarOf(bobId), seq: await topicSequence(topicId) }
    const inner = await swap({ aToB: 0.1, bToA: 0.12, memo: 'trade-1' })
    const kinds = ['Transferencia HBAR (pata 1)', 'Transferencia HBAR (pata 2)', 'Mensaje HCS (registro)']
    show.table(inner.map((tx, i) => ({ interna: i + 1, tipo: kinds[i], pagador: tx.transactionId.accountId.toString(), nodo: tx.nodeAccountIds.map(String).join(','), 'batch key': 'operador' })))

    // 2. El lote: el operador paga la transacción externa y firma con la batch key.
    const batch = await new BatchTransaction().setInnerTransactions(inner).freezeWith(client).sign(batchKey)
    const response = await batch.execute(client)
    const receipt = await response.getReceipt(client)
    console.log(`[ÉXITO] Lote ${receipt.status}: ${response.transactionId}`)
    console.log(`[EXPLORER] ${getHashscanUrl(response)}`)

    // Cada transacción interna es su propia transacción en el Mirror Node, todas con timestamps consecutivos.
    const innerRecords = await waitForMirror(async () => {
      const rows = await Promise.all(batch.innerTransactionIds.map((id) => mirror(`/transactions/${mirrorTxId(id)}`)))
      return rows.every((r) => r?.transactions?.length) ? rows.map((r) => r.transactions[0]) : null
    })
    show.table(innerRecords.map((t, i) => ({ interna: i + 1, nombre: t.name, resultado: t.result, consenso: t.consensus_timestamp, 'con batch key': Boolean(t.batch_key) })))
    const after = await waitForMirror(async () => {
      const seq = await topicSequence(topicId)
      return seq > before.seq ? { alice: await hbarOf(aliceId), bob: await hbarOf(bobId), seq } : null
    })
    console.log(`[ÉXITO] Intercambio aplicado: ${aliceId} ${((after.alice - before.alice) / 1e8).toFixed(4)} ℏ, ${bobId} ${((after.bob - before.bob) / 1e8).toFixed(4)} ℏ (comisiones incluidas); registro #${after.seq} en ${topicId}`)

    // 3. Todo o nada: el último paso sobregira a ACCOUNT_2, así que el registro HCS y la pata 1 tampoco deben quedar.
    // Su pagador de comisión es el operador, así que el precheck del nodo pasa y el paso falla en consenso.
    console.log('\n[PROCESO] Un segundo lote cuyo último paso no puede funcionar (ACCOUNT_2 envía mucho más de lo que tiene)...')
    const leg1 = await new TransferTransaction()
      .addHbarTransfer(aliceId, new Hbar(-0.1))
      .addHbarTransfer(bobId, new Hbar(0.1))
      .batchify(alice, batchKey.publicKey)
    const record = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify({ trade: 'trade-2', note: 'nunca debe aparecer' }))
      .batchify(client, batchKey.publicKey)
    const overdraw = await new TransferTransaction()
      .addHbarTransfer(bobId, new Hbar(-1_000_000))
      .addHbarTransfer(aliceId, new Hbar(1_000_000))
      .batchify(client, batchKey.publicKey)
    await overdraw.sign(parsePrivateKey(keys[1])) // ACCOUNT_2 autoriza el débito
    const failing = await new BatchTransaction().setInnerTransactions([leg1, record, overdraw]).freezeWith(client).sign(batchKey)
    let failedStatus = 'SUCCESS'
    try {
      await (await failing.execute(client)).getReceipt(client)
    } catch (error) {
      failedStatus = error.status ? error.status.toString() : error.message
    }
    console.log(`[ÉXITO] Segundo lote rechazado: ${failedStatus}`)
    if (failedStatus === 'SUCCESS') throw new Error('el lote que debía fallar se aplicó')

    const settled = await waitForMirror(async () => {
      const rows = await Promise.all(failing.innerTransactionIds.map((id) => mirror(`/transactions/${mirrorTxId(id)}`)))
      return rows.every((r) => r?.transactions?.length) ? rows.map((r) => r.transactions[0]) : null
    })
    show.table((settled || []).map((t, i) => ({ interna: i + 1, nombre: t.name, resultado: t.result, 'comisión cobrada (ℏ)': (t.charged_tx_fee / 1e8).toFixed(5) })))
    console.log('[INFO] REVERTED_SUCCESS: el paso corrió y se cobró, y luego se revirtió con el lote.')
    const seqNow = await topicSequence(topicId)
    console.log(`[ÉXITO] El topic sigue terminando en el mensaje #${seqNow} (el registro trade-2 se revirtió con lo demás)`)
    if (seqNow !== after.seq) throw new Error('un mensaje del lote fallido llegó al topic')
    updateState('M4_BATCH_LAST', response.transactionId.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('Un lote aplica todas sus transacciones internas o ninguna, cada una firmada por su propio pagador.')
    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Los lotes fallidos pagan igual los pasos internos que corrieron; deja las llamadas a contrato fuera de los lotes.')
    console.log('\n--- SESIÓN COMPLETADA ---')
  } finally {
    alice.close()
    bob.close()
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
