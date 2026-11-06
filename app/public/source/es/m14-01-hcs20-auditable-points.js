/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Puntos Auditables HCS-20 y Libros de Inscripciones
 * [CONCEPTO] Contabilidad por Event-Sourcing de Alto Rendimiento sobre Consenso
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Contabilidad por Inscripciones Basada en Eventos: En lugar de guardar los balances
 * de los usuarios en ranuras de almacenamiento de contratos inteligentes (que causan
 * saturación de estado y picos de gas EVM), HCS-20 publica acciones de inscripción
 * JSON estandarizadas y deterministas (deploy, mint, transfer, burn) en un tópico HCS.
 * Cualquier indexador, cliente o agente de IA puede reproducir el flujo de consenso
 * para reconstruir balances exactos e inalterables sin riesgo de contratos inteligentes.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los programas de puntos de alta frecuencia (puntos de fidelidad, XP en juegos, reputación
 * de agentes) exigen millones de actualizaciones. Ejecutarlos como tokens HTS o ERC-20
 * puede verse limitado por asociaciones de tokens o costos de gas. HCS-20 permite un
 * rendimiento de transacciones ilimitado a un costo fijo de $0.0001 por actualización.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-20/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M13 Lab 05: Motor de Liquidación de Intenciones Cross-Chain
 * - Siguiente: M14 Lab 02: Metodología de Puntuación de Confianza de IA HCS-25
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M14_Advanced_HCS_Standards_AI/01_hcs20_auditable_points.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import {
  HCS20DeployMessageSchema,
  HCS20MintMessageSchema,
  HCS20TransferMessageSchema
} from '@hashgraphonline/standards-sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

/**
 * Construye y valida mensajes estándar de inscripción HCS-20 mediante los esquemas
 * oficiales de `@hashgraphonline/standards-sdk`.
 */
const HCS20 = {
  deploy: (name, tick, maxSupply) => {
    const parsed = HCS20DeployMessageSchema.parse({
      p: 'hcs-20',
      op: 'deploy',
      name,
      tick: tick.toLowerCase(),
      max: maxSupply.toString()
    })
    return parsed
  },
  mint: (tick, to, amount) => {
    const parsed = HCS20MintMessageSchema.parse({
      p: 'hcs-20',
      op: 'mint',
      tick: tick.toLowerCase(),
      to,
      amt: amount.toString()
    })
    return parsed
  },
  transfer: (tick, from, to, amount) => {
    const parsed = HCS20TransferMessageSchema.parse({
      p: 'hcs-20',
      op: 'transfer',
      tick: tick.toLowerCase(),
      from,
      to,
      amt: amount.toString()
    })
    return parsed
  }
}

/**
 * Motor de estado determinista en memoria para indexar HCS-20.
 */
class HCS20StateEngine {
  constructor () {
    this.tokens = new Map()
    this.balances = new Map()
  }

  processMessage (msg, seq) {
    if (msg.p !== 'hcs-20') return false
    const tick = msg.tick.toUpperCase()

    if (msg.op === 'deploy') {
      if (this.tokens.has(tick)) return false // Tick ya desplegado
      this.tokens.set(tick, {
        tick,
        name: msg.name,
        max: BigInt(msg.max),
        currentSupply: 0n
      })
      return true
    }

    const token = this.tokens.get(tick)
    if (!token) return false

    if (msg.op === 'mint') {
      const amt = BigInt(msg.amt)
      if (token.currentSupply + amt > token.max) return false
      token.currentSupply += amt

      const balKey = `${tick}:${msg.to}`
      const current = this.balances.get(balKey) || 0n
      this.balances.set(balKey, current + amt)
      return true
    }

    if (msg.op === 'transfer') {
      const amt = BigInt(msg.amt)
      const fromKey = `${tick}:${msg.from}`
      const fromBal = this.balances.get(fromKey) || 0n
      if (fromBal < amt) return false // Fondos insuficientes

      this.balances.set(fromKey, fromBal - amt)
      const toKey = `${tick}:${msg.to}`
      const toBal = this.balances.get(toKey) || 0n
      this.balances.set(toKey, toBal + amt)
      return true
    }

    return false
  }

  getBalance (tick, accountId) {
    return (this.balances.get(`${tick.toUpperCase()}:${accountId}`) || 0n).toString()
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Puntos Auditables HCS-20 e Inscripciones ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Crear Tópico Dedicado para el Registro de Inscripciones HCS-20
    console.log('[PROCESO] Creando tópico dedicado para el libro de inscripciones HCS-20...')
    // Crea el tópico: un registro de mensajes ordenado y con timestamp; una submit key restringiría quién escribe.
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('HCS-20:AUDITABLE:POINTS:V1')
      .execute(client)

    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[ÉXITO] Libro de Puntos HCS-20 Creado: Tópico ID ${topicId}`)

    const stateEngine = new HCS20StateEngine()
    const recipientAgent = '0.0.8707881'

    // 2. Inscribir Despliegue de Token (Deploy validado por HCS20DeployMessageSchema)
    console.log('\n[PROCESO] Inscribiendo Despliegue de Token HCS-20: Ticker [aipnt] (Máx: 1,000,000)...')
    const deployMsg = HCS20.deploy('AI Reputation Points', 'aipnt', 1000000)
    // Publica: el consenso le da al mensaje un número de secuencia y un timestamp en el que todos coinciden.
    const deployTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(deployMsg))
      .execute(client)
    const deployReceipt = await deployTx.getReceipt(client)
    stateEngine.processMessage(deployMsg, deployReceipt.topicSequenceNumber)
    console.log(`[ÉXITO] AIPNT Desplegado en Secuencia de Consenso #${deployReceipt.topicSequenceNumber}`)

    // 3. Inscribir Emisión de Puntos (Mint validado por HCS20MintMessageSchema)
    console.log(`\n[PROCESO] Inscribiendo Emisión de 50,000 AIPNT para Operador (${operatorId})...`)
    const mintMsg = HCS20.mint('aipnt', operatorId.toString(), 50000)
    const mintTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(mintMsg))
      .execute(client)
    const mintReceipt = await mintTx.getReceipt(client)
    stateEngine.processMessage(mintMsg, mintReceipt.topicSequenceNumber)
    console.log(`[ÉXITO] Emitidos 50,000 AIPNT en Secuencia de Consenso #${mintReceipt.topicSequenceNumber}`)

    // 4. Inscribir Transferencia de Puntos (Transfer validado por HCS20TransferMessageSchema)
    console.log(`\n[PROCESO] Inscribiendo Transferencia de 12,500 AIPNT del Operador al Agente (${recipientAgent})...`)
    const transferMsg = HCS20.transfer('aipnt', operatorId.toString(), recipientAgent, 12500)
    const transferTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(transferMsg))
      .execute(client)
    const transferReceipt = await transferTx.getReceipt(client)
    stateEngine.processMessage(transferMsg, transferReceipt.topicSequenceNumber)
    console.log(`[ÉXITO] Transferidos 12,500 AIPNT en Secuencia de Consenso #${transferReceipt.topicSequenceNumber}`)

    // 5. Auditoría y Reconstrucción del Estado por el Indexador
    console.log('\n[AUDITORÍA] Estado Reconstruido del Libro HCS-20:')
    console.log(`[REGISTRO] Balance Operador (${operatorId}):       ${stateEngine.getBalance('AIPNT', operatorId.toString())} AIPNT`)
    console.log(`[REGISTRO] Balance Agente Destino (${recipientAgent}): ${stateEngine.getBalance('AIPNT', recipientAgent)} AIPNT`)

    // Persistir estado
    updateState('HCS20_TOPIC_ID', topicId)
    updateState('HCS20_TICK', 'AIPNT')
    updateState('HCS20_OPERATOR_BALANCE', stateEngine.getBalance('AIPNT', operatorId.toString()))
    updateState('HCS20_AGENT_BALANCE', stateEngine.getBalance('AIPNT', recipientAgent))

    console.log('\n CONCEPTO CLAVE:')
    console.log('HCS-20 es contabilidad basada en eventos puros sobre Hedera. Cualquier indexador')
    console.log(`que lea el Tópico ${topicId} llegará exactamente a los mismos balances matemáticos`)
    console.log('sin ejecutar una sola instrucción de código de bytes en un contrato inteligente.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('El almacenamiento en la máquina virtual EVM es costoso; el consenso en HCS es trivialmente barato.')
    console.log('Separar la secuencia de datos del cómputo off-chain es la clave para escalar a millones de usuarios.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Fallo en Ejecución de HCS-20:', error.message)
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
