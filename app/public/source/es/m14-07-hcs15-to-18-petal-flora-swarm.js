/**
 * ============================================================================
 * Lab 07: Enjambres Botánicos de Agentes (HCS-15 Pétalos, HCS-18 Descubrimiento, HCS-16 Flora y HCS-17 State Hash)
 * [CONCEPTO] Aislamiento de Sub-Cuentas y Coordinación Multi-Firma de Enjambres (AppNets)
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Hashgraph Online (hol.org) define la "Suite Botánica" (HCS-15 a HCS-18) para
 * crear colectivos autoorganizados de agentes de IA ("Floras"):
 * 1. HCS-15 (Cuentas Pétalo): Los agentes crean sub-cuentas aisladas ("Pétalos")
 *    bajo una llave maestra ECDSA, aislando el riesgo financiero por tarea sin
 *    administrar decenas de frases semilla.
 * 2. HCS-18 (Descubrimiento de Flora): Los Pétalos se descubren en un tópico
 *    público (`announce` ➔ `propose` ➔ `respond`) sin servidores centrales.
 * 3. HCS-16 (Coordinación de Flora): Los Pétalos se unen en una cuenta colectiva
 *    multi-firma "Flora" gobernada por una `KeyList` con umbral y una Tríada de
 *    Tópicos (Comunicación, Transacción y Estado).
 * 4. HCS-17 (State Hash): La Flora ancla hashes deterministas SHA-384 del estado
 *    para que cada miembro verifique la sincronización del enjambre.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Jamás entregues una única llave privada compartida a un enjambre de IA: si un
 * nodo es vulnerado, toda la tesorería se pierde. Al combinar Pétalos HCS-15 con
 * una KeyList multi-firma HCS-16 (`2-de-2`), el enjambre logra custodia colectiva
 * tolerante a fallos verificada con hashes de estado HCS-17.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-15/
 * - https://hol.org/docs/standards/hcs-16/
 * - https://hol.org/docs/standards/hcs-17/
 * - https://hol.org/docs/standards/hcs-18/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M14 Lab 06: Chat Encriptado de Enjambre de Agentes de IA (ECDH + AES-256-GCM en HCS)
 * - Siguiente: M14 Lab 08: HashLinks HCS-12 (Micro-Apps Interactivas) y Registro de Adaptadores HCS-21
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~5 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M14_Advanced_HCS_Standards_AI/07_hcs15_to_18_petal_flora_swarm.js
 * ============================================================================
 */

import crypto from 'crypto'
import {
  KeyList,
  PrivateKey
} from '@hiero-ledger/sdk'
import {
  FloraTopicType,
  buildHcs15PetalAccountCreateTx,
  buildHcs16CreateAccountTx,
  buildHcs16CreateFloraTopicTx,
  buildHcs16FloraCreatedTx,
  buildHcs17MessageTx,
  buildHcs18AnnounceMessage,
  buildHcs18CreateDiscoveryTopicTx,
  buildHcs18ProposeMessage,
  buildHcs18RespondMessage,
  buildHcs18SubmitDiscoveryMessageTx
} from '@hashgraphonline/standards-sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Enjambre Botánico HOL (HCS-15 + HCS-18 + HCS-16 + HCS-17) ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. HCS-15: Crear Dos Sub-Cuentas Aisladas "Pétalo" (`hcs-15:op:petal_account_create`)
    console.log('[PROCESO] Paso 1 [HCS-15]: Creando Sub-Cuentas Pétalo Aisladas...')
    // Genera una llave localmente: la llave privada nunca sale de este proceso.
    const masterKeyA = PrivateKey.generateECDSA()
    const masterKeyB = PrivateKey.generateECDSA()

    const petalATx = buildHcs15PetalAccountCreateTx({
      publicKey: masterKeyA.publicKey,
      initialBalance: 0.5,
      maxAutomaticTokenAssociations: 5,
      accountMemo: 'HCS-15:PETAL:ALPHA_QUANT'
    })
    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const petalAId = (await (await petalATx.execute(client)).getReceipt(client)).accountId.toString()

    const petalBTx = buildHcs15PetalAccountCreateTx({
      publicKey: masterKeyB.publicKey,
      initialBalance: 0.5,
      maxAutomaticTokenAssociations: 5,
      accountMemo: 'HCS-15:PETAL:BETA_SENTINEL'
    })
    const petalBId = (await (await petalBTx.execute(client)).getReceipt(client)).accountId.toString()

    console.log(`[HCS-15] Pétalo Alpha Creado: ${petalAId} (Memo: HCS-15:PETAL:ALPHA_QUANT)`)
    console.log(`[HCS-15] Pétalo Beta Creado:  ${petalBId} (Memo: HCS-15:PETAL:BETA_SENTINEL)`)

    // 2. HCS-18: Protocolo Abierto de Descubrimiento de Flora (`announce` ➔ `propose` ➔ `respond`)
    console.log('\n[PROCESO] Paso 2 [HCS-18]: Desplegando Tópico de Descubrimiento y Negociación...')
    const discoveryTopicTx = buildHcs18CreateDiscoveryTopicTx({ ttlSeconds: 86400 })
      .setAutoRenewAccountId(operatorId.toString())
    const discoveryTopicId = (await (await discoveryTopicTx.execute(client)).getReceipt(client)).topicId.toString()
    console.log(`[HCS-18] Tópico de Descubrimiento Activo: ${discoveryTopicId}`)

    const announceMsg = buildHcs18AnnounceMessage({
      account: petalAId,
      petal: { name: 'AlphaQuant-Petal', priority: 100 },
      capabilities: { protocols: [15, 16, 17, 18] },
      valid_for: 3600
    })
    await (await buildHcs18SubmitDiscoveryMessageTx({
      topicId: discoveryTopicId,
      message: announceMsg
    }).execute(client)).getReceipt(client)

    const proposeMsg = buildHcs18ProposeMessage({
      proposer: petalAId,
      members: [
        { account: petalAId, priority: 100 },
        { account: petalBId, priority: 90 }
      ],
      config: {
        name: 'Aegis DeFi Arbitrage Flora',
        threshold: 2,
        purpose: 'Rebalanceo autónomo multi-firma de liquidez'
      }
    })
    await (await buildHcs18SubmitDiscoveryMessageTx({
      topicId: discoveryTopicId,
      message: proposeMsg
    }).execute(client)).getReceipt(client)

    const respondMsg = buildHcs18RespondMessage({
      responder: petalBId,
      proposal_seq: 2,
      decision: 'accept'
    })
    await (await buildHcs18SubmitDiscoveryMessageTx({
      topicId: discoveryTopicId,
      message: respondMsg
    }).execute(client)).getReceipt(client)
    console.log('[HCS-18] Descubrimiento Completado: Announce (#1) ➔ Propose (#2) ➔ Accept (#3)!')

    // 3. HCS-16: Fundar Cuenta Multi-Firma "Flora" y Tríada de Tópicos (Comunicación, Transacción, Estado)
    console.log('\n[PROCESO] Paso 3 [HCS-16]: Creando Cuenta Flora Multi-Firma 2-de-2 y Tríada de Tópicos...')
    // Un KeyList con umbral: deben firmar M de N llaves.
    const floraKeyList = new KeyList([masterKeyA.publicKey, masterKeyB.publicKey], 2)
    const floraAccountTx = buildHcs16CreateAccountTx({
      keyList: floraKeyList,
      initialBalanceHbar: 1,
      maxAutomaticTokenAssociations: 5
    })
    const floraAccountId = (await (await floraAccountTx.execute(client)).getReceipt(client)).accountId.toString()

    const commTopicId = (await (await buildHcs16CreateFloraTopicTx({
      floraAccountId,
      topicType: FloraTopicType.COMMUNICATION,
      autoRenewAccountId: operatorId.toString()
    }).execute(client)).getReceipt(client)).topicId.toString()

    const txTopicId = (await (await buildHcs16CreateFloraTopicTx({
      floraAccountId,
      topicType: FloraTopicType.TRANSACTION,
      autoRenewAccountId: operatorId.toString()
    }).execute(client)).getReceipt(client)).topicId.toString()

    const stateTopicId = (await (await buildHcs16CreateFloraTopicTx({
      floraAccountId,
      topicType: FloraTopicType.STATE,
      autoRenewAccountId: operatorId.toString()
    }).execute(client)).getReceipt(client)).topicId.toString()

    const floraCreatedTx = buildHcs16FloraCreatedTx({
      topicId: commTopicId,
      operatorId: floraAccountId,
      floraAccountId,
      topics: {
        communication: commTopicId,
        transaction: txTopicId,
        state: stateTopicId
      }
    })
    await (await floraCreatedTx.execute(client)).getReceipt(client)
    console.log(`[HCS-16] Cuenta Colectiva Flora: ${floraAccountId} (Umbral 2-de-2)`)
    console.log(`[TRÍADA] Comm: ${commTopicId} | Tx: ${txTopicId} | Estado: ${stateTopicId}`)

    // 4. HCS-17: Calcular y Anclar el Hash Criptográfico del Estado del Enjambre
    console.log('\n[PROCESO] Paso 4 [HCS-17]: Calculando y Anclando el State Hash Determinista...')
    const canonicalSwarmState = JSON.stringify({
      floraAccountId,
      members: [petalAId, petalBId],
      topics: [commTopicId, txTopicId, stateTopicId],
      epoch: 1
    })
    // Calcula el hash: cualquiera puede recalcularlo para verificar los datos.
    const stateHash = crypto.createHash('sha384').update(canonicalSwarmState).digest('hex')

    const hcs17Tx = buildHcs17MessageTx({
      topicId: stateTopicId,
      stateHash,
      accountId: floraAccountId,
      topics: [commTopicId, txTopicId],
      epoch: 1,
      memo: 'Época 1 Sincronización Génesis de Flora Verificada'
    })
    const hcs17Receipt = await (await hcs17Tx.execute(client)).getReceipt(client)
    console.log(`[HCS-17] ¡State Hash Anclado en Secuencia #${hcs17Receipt.topicSequenceNumber}!`)
    console.log(`[HASH]   sha384:${stateHash.slice(0, 48)}...`)

    updateState('HCS15_PETAL_ALPHA_ID', petalAId)
    updateState('HCS15_PETAL_BETA_ID', petalBId)
    updateState('HCS16_FLORA_ACCOUNT_ID', floraAccountId)
    updateState('HCS17_FLORA_STATE_HASH', stateHash)
    updateState('HCS18_DISCOVERY_TOPIC_ID', discoveryTopicId)

    console.log('\n CONCEPTO CLAVE:')
    console.log('La Suite Botánica de HOL (HCS-15/16/17/18) transforma agentes de IA aislados en')
    console.log('colectivos multi-firma autoorganizados (Floras) con sub-cuentas Pétalo aisladas,')
    console.log('descubrimiento abierto sin servidor y sincronización criptográfica de estado.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Al separar la charla (`COMMUNICATION`), las propuestas multi-firma (`TRANSACTION`)')
    console.log('y los hashes de estado (`STATE`) en una Tríada HCS-16, los enjambres escalan sin')
    console.log('saturar el canal de auditoría de estado con mensajes de coordinación.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Fallo en Enjambre Botánico:', error.message)
    process.exit(1)
  } finally {
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
