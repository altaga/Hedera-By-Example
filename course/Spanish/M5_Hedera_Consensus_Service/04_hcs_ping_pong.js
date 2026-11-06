/**
 * ============================================================================
 * Lab 04: Benchmark de Latencia HCS (Protocolo Ping-Pong)
 * [CONCEPTO] Latencia de Ida y Vuelta Descentralizada
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * SLA Descentralizado: La "Latencia de Consenso" es el tiempo que tarda la
 * red en recibir tu mensaje, alcanzar el quorum entre los nodos ("Gossip
 * about Gossip") y asignarle un timestamp global e inmutable. Medir el RTT
 * (Round-Trip Time) es vital para entender las capacidades reales de tu dApp.
 * En Hedera, este número es consistente y suele oscilar entre 2 y 5 segundos,
 * siendo el límite duro que define la experiencia de usuario (UX)
 * en tiempo real sobre el ledger.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Medir el tiempo de respuesta en consenso de HCS proporciona prueba empírica de finalidad en subsegundos. Evaluar los tiempos de ida y vuelta confirma el ordenamiento justo a través de nodos globales.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/native/consensus
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M5 Lab 03: Paginación y Fragmentación
 * - Actual:   M5 Lab 04: HCS Ping-Pong
 * - Siguiente: M6 Lab 01: Almacenamiento Nativo HFS
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 01 de M5 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 04_hcs_ping_pong.js
 * ============================================================================
 */

import {
  TopicMessageQuery,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, getState, exitIfStuck, show } from '../M99_Utilities/index.js'

class HcsNode {
  constructor (name, client, topicId) {
    this.name = name
    this.client = client
    this.topicId = topicId
  }

  listen (messageType, onMessageCallback) {
    console.log(`[INFO] ${this.name}: Escuchando mensajes de tipo '${messageType}'...`)
    // Suscríbete vía Mirror Node: los mensajes llegan en orden de consenso.
    new TopicMessageQuery()
      .setTopicId(this.topicId)
      .subscribe(this.client, null, (message) => {
        const payload = Buffer.from(message.contents).toString()
        try {
          const data = JSON.parse(payload)
          if (data.msg === messageType) {
            onMessageCallback(data, message)
          }
        } catch (e) { }
      })
  }

  async send (messageType, extraData = {}) {
    const payload = JSON.stringify({
      node: this.name,
      msg: messageType,
      localTimestamp: Date.now(),
      ...extraData
    })

    // Publica: el consenso le da al mensaje un número de secuencia y un timestamp en el que todos coinciden.
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(this.topicId)
      .setMessage(payload)
      .execute(this.client)

    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    return await tx.getReceipt(this.client)
  }
}

const main = async () => {
  // Nunca colgarse: falla con un mensaje claro si la red nunca responde.
  exitIfStuck(180_000, 'mensajes de la suscripción')
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Latencia de Consenso (RTT) ---\n')

  const { client } = getClient()
  const topicId = getState('HCS_TOPIC_ID')

  if (!topicId) {
    console.error('[FALLO] Falta HCS_TOPIC_ID en el estado local. Ejecuta el Lab 01 primero.')
    process.exitCode = 1
    return
  }

  const nodeA = new HcsNode('NODO_A', client, topicId)
  const nodeB = new HcsNode('NODO_B', client, topicId)

  const benchmarkResults = []
  const TOTAL_CYCLES = 5
  const outboundConsensusMap = {}

  /**
   * Nodo B: Respondedor (Backend/Agente)
   */
  nodeB.listen('PING', async (data) => {
    // El Nodo B responde inmediatamente al recibir el PING por consenso
    await nodeB.send('PONG', { cycle: data.cycle, pingStart: data.localTimestamp })
  })

  /**
   * Nodo A: Escucha su propio PING para capturar el tiempo de consenso de salida
   */
  nodeA.listen('PING', (data, raw) => {
    if (data.node === 'NODO_A') {
      outboundConsensusMap[data.cycle] = raw.consensusTimestamp.toDate().getTime()
    }
  })

  /**
   * Nodo A: Procesador Principal del Benchmark (Recolección de PONG)
   */
  nodeA.listen('PONG', (data, raw) => {
    const catchTime = Date.now()
    const cycle = data.cycle

    const intervalId = setInterval(() => {
      if (outboundConsensusMap[cycle]) {
        clearInterval(intervalId)

        const startTime = data.pingStart
        const pingConsensusTime = outboundConsensusMap[cycle]
        const pongConsensusTime = raw.consensusTimestamp.toDate().getTime()

        // Métricas Granulares
        const outbound = pingConsensusTime - startTime // A -> Ledger
        const turnaround = pongConsensusTime - pingConsensusTime // Ledger -> B -> Ledger
        const inbound = catchTime - pongConsensusTime // Ledger -> A
        const rtt = catchTime - startTime // TOTAL RTT

        benchmarkResults.push({ cycle, outbound, turnaround, inbound, rtt })
        console.log(`[ÉXITO] Ciclo ${cycle} procesado. RTT Total: ${rtt}ms`)

        if (benchmarkResults.length === TOTAL_CYCLES) {
          renderFinalReport(benchmarkResults)
          console.log('\n--- SESIÓN COMPLETADA ---')
          process.exit()
        }
      }
    }, 100)
  })

  const renderFinalReport = (results) => {
    results.sort((a, b) => a.cycle - b.cycle)
    show.chart({ type: 'stacked', title: 'Tiempo de ida y vuelta por etapa', unit: 'ms', xLabel: 'Cycle', categories: results.map((r) => `#${r.cycle}`), series: [{ name: 'A → ledger', values: results.map((r) => r.outbound) }, { name: 'ledger → B → ledger', values: results.map((r) => r.turnaround) }, { name: 'ledger → A', values: results.map((r) => r.inbound) }] })

    console.log('\n' + '='.repeat(75))
    console.log('INFORME DE LATENCIA DE PRECISIÓN HCS')
    console.log('='.repeat(75))
    console.log('Ciclo | Salida(A->L) | Retorno(L->B->L)  | Entrada(L->A) | RTT TOTAL')
    console.log('-'.repeat(75))
    results.forEach(res => {
      const cycleStr = res.cycle.toString().padEnd(6)
      const outStr = `${res.outbound}ms`.padEnd(14)
      const turnStr = `${res.turnaround}ms`.padEnd(20)
      const inStr = `${res.inbound}ms`.padEnd(14)
      console.log(`${cycleStr}| ${outStr}| ${turnStr}| ${inStr}| ${res.rtt}ms`)
    })
    console.log('='.repeat(75))
    console.log('[INFO] RTT es la latencia de red pura (estabilización excluida).')
    console.log('='.repeat(75))
  }

  try {
    console.log('[INFO] Esperando estabilización de malla gRPC (5s)...')
    await new Promise(resolve => setTimeout(resolve, 5000))

    for (let i = 1; i <= TOTAL_CYCLES; i++) {
      console.log(`\n--- [PROCESO] Lanzando Ciclo de Handshake ${i}/${TOTAL_CYCLES} ---`)
      await nodeA.send('PING', { cycle: i })

      if (i < TOTAL_CYCLES) {
        console.log(`[INFO] Ciclo ${i} enviado. Pausa de estabilidad...`)
        await new Promise(resolve => setTimeout(resolve, 5000))
      }
    }
    console.log('\n[INFO] Todos los disparadores enviados. Esperando reensamblaje final de consenso...')

    console.log('\n CONCEPTO CLAVE:')
    console.log('Conocer este RTT te permite decidir si una operación debe ser')
    console.log('asincrónica (optimista) en el Frontend o si el usuario puede')
    console.log('esperar la confirmación definitiva del ledger sin fricción.')
  } catch (error) {
    console.error('\n[FALLO] El Benchmark falló:', error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
