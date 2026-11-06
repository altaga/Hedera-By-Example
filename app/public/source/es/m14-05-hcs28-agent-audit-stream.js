/**
 * ============================================================================
 * Lab 05: Rastro de Auditoría de Agentes en HCS (Conceptos HCS-28)
 * [CONCEPTO] Directorio de Agentes HCS-2 + Topics de Cambios por Agente con Registros Firmados
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * HCS-28 (Hashgraph Online, Borrador) es el ANS Agent Transparency Registry: un topic
 * directorio HCS-2 de agentes publicados, un topic de cambios HCS-2 por agente (`t_id`) y
 * reglas de publicación de cambios, usado junto con los checkpoints Merkle de HCS-27.
 * Este lab construye esa topología de verdad en testnet:
 * 1. Un topic directorio HCS-2 indexado (memo `hcs-2:0:86400`).
 * 2. Un topic de cambios por agente, registrado en el directorio con un mensaje HCS-2
 *    `register` (`{"p":"hcs-2","op":"register","t_id":...}`, memo de tx `hcs-2:op:0:0`).
 * 3. Un registro de auditoría firmado de un ciclo de decisión del agente (hashes de prompt,
 *    razonamiento y herramientas, resultados de guardrails) añadido al topic del agente.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los investigadores necesitan una "caja negra" inalterable. Hashes + firmas en HCS dan
 * orden, marcas de tiempo y no repudio sin publicar el prompt original.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-2
 * - https://hol.org/docs/standards/hcs-27/
 * - https://hol.org/standards
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M14 Lab 04: Puntos de Control de Transparencia Merkle HCS-27
 * - Siguiente: M14 Lab 06: Chat Encriptado de Enjambre de Agentes (P2P sobre HCS)
 *
 * [SIMULADO]
 * El prompt, el razonamiento y las reglas del agente son texto predefinido, no un modelo en vivo. El formato del registro de auditoría es propio de este lab: no se reproducen las reglas de publicación JWT/hash-input de HCS-28. El directorio HCS-2, el topic de cambios, el registro y el flujo de auditoría en HCS son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M14_Advanced_HCS_Standards_AI/05_hcs28_agent_audit_stream.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

/**
 * Construye un registro de auditoría cognitivo según la especificación HCS-28.
 *
 * @param {object} params - Parámetros del ciclo de razonamiento
 * @returns {object} Registro de auditoría firmado criptográficamente
 */
const buildHCS28AuditRecord = ({ agentWallet, sessionId, cycleIndex, userPrompt, reasoningTrace, toolInvocations, finalDecision, guardrailChecks }) => {
  const promptHash = ethers.keccak256(ethers.toUtf8Bytes(userPrompt))
  const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes(reasoningTrace))
  const decisionHash = ethers.keccak256(ethers.toUtf8Bytes(finalDecision))

  const auditCore = {
    type: 'agent-audit-record',
    version: '1.0.0',
    concept: 'hcs-28',
    sessionId,
    cycleIndex,
    agentAddress: agentWallet.address,
    timestamp: new Date().toISOString(),
    hashes: {
      prompt: promptHash,
      reasoning: reasoningHash,
      decision: decisionHash
    },
    toolCalls: toolInvocations.map(t => ({
      tool: t.tool,
      paramsHash: ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(t.params))),
      status: t.status
    })),
    guardrails: {
      passed: guardrailChecks.every(g => g.status === 'PASS'),
      evaluations: guardrailChecks
    }
  }

  const recordHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(auditCore)))
  const agentSignature = agentWallet.signingKey.sign(recordHash).serialized

  return {
    ...auditCore,
    recordHash,
    agentSignature
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Auditoría Cognitiva y Transparencia HCS-28 ---\n')
  const { client } = getClient()

  try {
    // 1. Crear Tópico de Auditoría HCS-28
    console.log('[PROCESO] Creando tópico dedicado para auditoría cognitiva HCS-28...')
    // Crea el tópico: un registro de mensajes ordenado y con timestamp; una submit key restringiría quién escribe.
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('hcs-2:0:86400')
      .execute(client)

    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    // Directorio HCS-2 de agentes (indexado) + registro del topic de cambios de este agente
    const directoryId = (await (await new TopicCreateTransaction().setTopicMemo('hcs-2:0:86400').execute(client)).getReceipt(client)).topicId.toString()
    const regRes = await new TopicMessageSubmitTransaction().setTopicId(directoryId)
      .setMessage(JSON.stringify({ p: 'hcs-2', op: 'register', t_id: topicId, m: 'agent atlas change topic' }))
      .setTransactionMemo('hcs-2:op:0:0').execute(client)
    await regRes.getReceipt(client)
    console.log(`[ÉXITO] Directorio HCS-2 ${directoryId}: topic de cambios ${topicId} registrado (tx ${regRes.transactionId})`)
    console.log(`[ÉXITO] Tópico de Auditoría HCS-28 Creado: ${topicId}`)

    // 2. Simular Ciclo de Razonamiento Autónomo para Agente Financiero
    console.log('\n[PROCESO] Simulando ciclo de razonamiento autónomo para Agente Atlas...')
    const agentWallet = ethers.Wallet.createRandom()

    const simulatedPrompt = 'Rebalancear tesorería de liquidez en Hedera: Intercambiar 10,000 HBAR por USDC si volatilidad supera 35%.'
    const simulatedReasoning = '1. Consulta a oráculo de volatilidad (índice = 38.4%). 2. Slippage estimado en 0.12%. 3. Rebalanceo aprobado bajo Regla #402-B.'
    const simulatedTools = [
      { tool: 'hedera_volatility_oracle', params: { metric: 'VIX_HBAR', window: '1h' }, status: 'SUCCESS' },
      { tool: 'hts_atomic_swap', params: { sellAmount: '10000', minBuyAmount: '500' }, status: 'READY' }
    ]
    const simulatedGuardrails = [
      { rule: 'LIMITE_MAXIMO_TRANSACCION', limit: '25000 HBAR', actual: '10000 HBAR', status: 'PASS' },
      { rule: 'FRESCURA_DEL_ORACULO', maxAgeSeconds: 60, actualAgeSeconds: 4, status: 'PASS' }
    ]

    const auditRecord = buildHCS28AuditRecord({
      agentWallet,
      sessionId: 'sess_99a8b1c4',
      cycleIndex: 1,
      userPrompt: simulatedPrompt,
      reasoningTrace: simulatedReasoning,
      toolInvocations: simulatedTools,
      finalDecision: 'EXECUTE_ORDER',
      guardrailChecks: simulatedGuardrails
    })

    console.log('[REGISTRO] Registro Cognitivo HCS-28 Generado:')
    console.log(`[REGISTRO] Sesión ID:          ${auditRecord.sessionId} (Ciclo #${auditRecord.cycleIndex})`)
    console.log(`[REGISTRO] Dirección Agente:   ${auditRecord.agentAddress}`)
    console.log(`[REGISTRO] Hash de Prompt:     ${auditRecord.hashes.prompt}`)
    console.log(`[REGISTRO] Hash Razonamiento:  ${auditRecord.hashes.reasoning}`)
    console.log(`[REGISTRO] Reglas de Seguridad: ${auditRecord.guardrails.passed ? 'TODAS SUPERADAS (CUMPLIMIENTO)' : 'VIOLACIÓN'}`)
    console.log(`[REGISTRO] Hash del Registro:  ${auditRecord.recordHash}`)

    // 3. Anclar Registro al Consenso de HCS
    console.log('\n[PROCESO] Anclando registro inmutable al tópico de consenso HCS...')
    // Publica: el consenso le da al mensaje un número de secuencia y un timestamp en el que todos coinciden.
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(auditRecord))
      .execute(client)

    const submitReceipt = await submitTx.getReceipt(client)
    const seq = submitReceipt.topicSequenceNumber.toString()
    console.log(`[ÉXITO] ¡Registro Sellado en Secuencia de Consenso #${seq}!`)

    // 4. Verificación de No Repudio de la Firma del Agente
    const recoveredAgent = ethers.recoverAddress(auditRecord.recordHash, auditRecord.agentSignature)
    const isAuthentic = recoveredAgent.toLowerCase() === agentWallet.address.toLowerCase()
    console.log(`\n[AUDITORÍA] Validación de No Repudio: ${isAuthentic ? 'AUTÉNTICA (FIRMADA POR EL AGENTE)' : 'FALSIFICACIÓN'}`)

    // Persistir estado
    updateState('HCS28_TOPIC_ID', topicId)
    updateState('HCS28_DIRECTORY_TOPIC_ID', directoryId)
    updateState('HCS28_SESSION_ID', auditRecord.sessionId)
    updateState('HCS28_RECORD_HASH', auditRecord.recordHash)
    updateState('HCS28_AGENT_ADDRESS', agentWallet.address)

    console.log('\n CONCEPTO CLAVE:')
    console.log('HCS-28 resuelve el problema de responsabilidad legal en la inteligencia artificial.')
    console.log('Dado que el registro está firmado criptográficamente y secuenciado en Hedera,')
    console.log('ningún desarrollador o agente puede alterar el pasado para ocultar un error o pérdida.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('La gobernanza de IA no requiere frenar la innovación; requiere auditoría criptográfica inmutable.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Fallo en Ejecución de HCS-28:', error.message)
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
