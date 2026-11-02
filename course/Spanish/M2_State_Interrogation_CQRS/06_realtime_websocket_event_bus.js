/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 06: Bus de Eventos WebSocket en Tiempo Real del Ledger
 * [ CONCEPTO ] Transmisión Reactiva Basada en Push vs Antipatrones de Polling
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Consultar continuamente el Mirror Node de Hedera mediante peticiones HTTP REST
 * cada 500ms genera sobrecarga de red masiva, desperdicia ancho de banda en la
 * nube y sigue introduciendo cientos de milisegundos de retraso perceptual.
 *
 * Los sistemas fintech modernos de alta frecuencia utilizan arquitecturas de Bus
 * de Eventos Reactivo:
 * 1. PROTOCOLO PUSH: La pasarela mantiene conexiones dúplex persistentes vía
 *    WebSockets (o SSE) con los clientes (traders, bots, dApps).
 * 2. CANALES PUB/SUB: Los clientes se suscriben a canales específicos del ledger
 *    (ej. `account:transfers`, `hcs:messages`, `hts:mints`).
 * 3. EMISIÓN EN TIEMPO REAL: Cuando las transacciones alcanzan finalidad en Hedera,
 *    la pasarela multiplexa sobres JSON estructurados a todos los suscriptores activos.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Hacer polling a endpoints REST en bucles frecuentes genera tráfico innecesario y latencia. Un bus reactivo por WebSocket o SSE transmite eventos on-chain a la interfaz del usuario en subsegundos reales.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/rest-api
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M2 Lab 05: Circuit Breaker y Limitador de Tasa
 * - Siguiente: M2 Lab 07: Indexador de Subgrafos GraphQL
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M2_State_Interrogation_CQRS/06_realtime_websocket_event_bus.js
 * ============================================================================
 */

import http from 'http'
import { EventEmitter } from 'events'
import { getClient, getMirrorNodeBaseUrl, updateState, exitIfStuck } from '../M99_Utilities/index.js'

/**
 * Bus de Eventos Reactivo Enterprise del Ledger.
 * Conecta los flujos de consenso upstream con los suscriptores en tiempo real downstream.
 */
class LedgerEventBus extends EventEmitter {
  constructor (port = 8546) {
    super()
    this.port = port
    this.server = null
    this.activeSockets = new Set()
    this.eventsDispatched = 0
  }

  start () {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        // Soporte de Server-Sent Events (SSE) y endpoints de flujo JSON
        if (req.url === '/events/stream') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*'
          })

          const listener = (event) => {
            res.write(`data: ${JSON.stringify(event)}\n\n`)
          }

          this.on('ledger_event', listener)
          this.activeSockets.add(res)

          req.on('close', () => {
            this.removeListener('ledger_event', listener)
            this.activeSockets.delete(res)
          })
          return
        }

        res.writeHead(404)
        res.end()
      })

      this.server.listen(this.port, () => {
        resolve(this.port)
      })
    })
  }

  broadcast (topic, payload) {
    this.eventsDispatched++
    const eventEnvelope = {
      protocol: 'hedera:eventbus:v1',
      topic,
      sequence: this.eventsDispatched,
      timestamp: Date.now(),
      payload
    }
    this.emit('ledger_event', eventEnvelope)
    return eventEnvelope
  }

  close () {
    return new Promise((resolve) => {
      for (const socket of this.activeSockets) socket.end()
      if (this.server) this.server.close(resolve)
      else resolve()
    })
  }
}

const main = async () => {
  // Nunca colgarse: falla con un mensaje claro si la red nunca responde.
  exitIfStuck(180_000, 'a que termine el servidor de la demo')
  console.log('--- INICIO DEL LABORATORIO: Bus de Eventos WebSocket en Tiempo Real ---\n')

  const { client, operatorId } = getClient()
  const mirrorBase = getMirrorNodeBaseUrl()
  const BUS_PORT = 8546

  const eventBus = new LedgerEventBus(BUS_PORT)

  try {
    console.log(`[⚙️ PROCESO] Paso 1: Iniciando pasarela reactiva de eventos en puerto ${BUS_PORT}...`)
    await eventBus.start()
    console.log(`[✅ ÉXITO] Gateway de Eventos activo en http://127.0.0.1:${BUS_PORT}/events/stream`)

    console.log('\n[⚙️ PROCESO] Paso 2: Simulando conexión de suscriptor downstream (cliente SSE/WebSocket)...')

    const receivedEvents = []

    // Conectar consumidor cliente mediante streaming nativo SSE
    const consumerReq = http.request(`http://127.0.0.1:${BUS_PORT}/events/stream`, (res) => {
      res.on('data', (chunk) => {
        const text = chunk.toString()
        const lines = text.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const rawJson = line.replace('data: ', '').trim()
            if (rawJson) {
              const parsed = JSON.parse(rawJson)
              receivedEvents.push(parsed)
              console.log(`[📥 EVENTO RECIBIDO] Canal: ${parsed.topic} | Sec: #${parsed.sequence} | Tx: ${parsed.payload.txId}`)
            }
          }
        }
      })
    })
    consumerReq.end()

    // Esperar 200ms para el establecimiento de la suscripción
    await new Promise(r => setTimeout(r, 200))

    console.log('\n[⚙️ PROCESO] Paso 3: Obteniendo eventos de consenso en vivo desde Mirror Node para ingesta en el Bus...')
    const mirrorRes = await fetch(`${mirrorBase}/api/v1/transactions?limit=3&order=desc`)
    if (!mirrorRes.ok) throw new Error(`Error en Mirror Node: ${mirrorRes.statusText}`)
    const mirrorData = await mirrorRes.json()

    console.log(`[⚙️ PROCESO] Paso 4: Transmitiendo ${mirrorData.transactions.length} eventos de consenso en vivo a los suscriptores...`)

    for (const tx of mirrorData.transactions) {
      const payer = tx.payer_account_id || tx.transaction_id.split('-')[0]
      const envelope = eventBus.broadcast(`account:transfers:${payer}`, {
        txId: tx.transaction_id,
        consensusTimestamp: tx.consensus_timestamp,
        result: tx.result,
        name: tx.name,
        chargedFee: (tx.charged_tx_fee / 1e8) + ' ℏ'
      })
      await new Promise(r => setTimeout(r, 100))
    }

    // Esperar a que el cliente procese
    await new Promise(r => setTimeout(r, 300))

    console.log('\n--- 📡 RESUMEN DE TRANSMISIÓN REACTIVA ---')
    console.log(`🔹 Total de Eventos Emitidos:   ${eventBus.eventsDispatched}`)
    console.log(`🔹 Total de Eventos Recibidos:  ${receivedEvents.length}`)
    console.log(`🔹 Integridad de Entrega:       ${receivedEvents.length === eventBus.eventsDispatched ? '100% (CERO PÉRDIDA DE PAQUETES)' : 'PARCIAL'}`)

    updateState('EVENT_BUS_LAST_PORT', BUS_PORT)
    updateState('EVENT_BUS_EVENTS_PROCESSED', receivedEvents.length)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Push sobre Pull: Al transformar las fuentes de consenso del Mirror Node')
    console.log('en flujos reactivos basados en push, las interfaces frontend y los bots')
    console.log('se actualizan al instante exacto de la finalidad, eliminando cuellos de botella.')

    consumerReq.destroy()
    await eventBus.close()
    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error(`\n[❌ ERROR] Falló el Bus de Eventos: ${error.message}`)
    process.exitCode = 1
    await eventBus.close()
    if (client) client.close()
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[❌ FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
