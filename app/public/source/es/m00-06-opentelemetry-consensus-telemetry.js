/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 06: Telemetría de Consenso con OpenTelemetry
 * [ CONCEPTO ] Trazado Distribuido y Observabilidad APM de Alta Precisión
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En arquitecturas bancarias y fintech de misión crítica, las operaciones
 * en el ledger no pueden ser cajas negras. Los sistemas distribuidos dependen
 * de OpenTelemetry (OTel) y las especificaciones de W3C TraceContext para
 * rastrear una transacción de negocio desde el API Gateway a través de
 * microservicios hasta la finalidad de consenso en Hedera.
 *
 * Este laboratorio instrumenta el SDK de Hedera con cabeceras W3C `traceparent`,
 * registra métricas de spans (Build, Sign, Consensus, Mirror Ingestion) y
 * calcula la latencia de ida y vuelta para garantizar el cumplimiento de SLAs.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los sistemas descentralizados sin telemetría dejan a los equipos de DevOps a ciegas ante la congestión. Correlacionar marcas de tiempo de consenso con trazas OpenTelemetry une la finalidad criptográfica con la observabilidad empresarial.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://opentelemetry.io/docs/concepts/signals/traces/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  Lab 05: Firmador Enterprise con AWS KMS
 * - Siguiente: M1 Lab 01: Consenso & aBFT
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M0_Setup_and_Test/06_opentelemetry_consensus_telemetry.js
 * ============================================================================
 */

import crypto from 'crypto'
import { performance } from 'perf_hooks'
import { TransferTransaction, Hbar } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'

/**
 * Generador de Contexto de Trazado OpenTelemetry W3C Enterprise.
 * Cumple con la Recomendación W3C TraceContext (traceparent: 00-traceid-spanid-traceflags).
 */
class W3CTracer {
  constructor (serviceName = 'hedera-microservice-ledger') {
    this.serviceName = serviceName
    this.spans = []
  }

  createTraceContext () {
    const traceId = crypto.randomBytes(16).toString('hex') // 32 caracteres hex
    const parentSpanId = crypto.randomBytes(8).toString('hex') // 16 caracteres hex
    const traceFlags = '01' // Muestreado (Sampled)
    const traceparent = `00-${traceId}-${parentSpanId}-${traceFlags}`
    return { traceId, parentSpanId, traceFlags, traceparent }
  }

  async startSpan (name, traceContext, action) {
    const spanId = crypto.randomBytes(8).toString('hex')
    const startTime = performance.now()
    const timestamp = new Date().toISOString()

    try {
      const result = await action({ spanId, traceId: traceContext.traceId })
      const durationMs = performance.now() - startTime
      this.spans.push({
        name,
        traceId: traceContext.traceId,
        spanId,
        parentSpanId: traceContext.parentSpanId,
        durationMs: Number(durationMs.toFixed(3)),
        status: 'OK',
        timestamp,
        attributes: result?.attributes || {}
      })
      return result
    } catch (error) {
      const durationMs = performance.now() - startTime
      this.spans.push({
        name,
        traceId: traceContext.traceId,
        spanId,
        parentSpanId: traceContext.parentSpanId,
        durationMs: Number(durationMs.toFixed(3)),
        status: 'ERROR',
        error: error.message,
        timestamp
      })
      throw error
    }
  }

  printSpanSummary () {
    console.log('\n--- 🔭 RESUMEN DE TRAZAS OPENTELEMETRY (W3C TRACECONTEXT) ---')
    console.table(this.spans.map(s => ({
      'Nombre del Span': s.name,
      'Duración (ms)': `${s.durationMs} ms`,
      Estado: s.status,
      'Span ID': s.spanId,
      'Trace ID': `${s.traceId.substring(0, 12)}...`
    })))
  }
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Telemetría de Consenso con OpenTelemetry ---\n')

  const { client, operatorId } = getClient()
  const tracer = new W3CTracer('Hedera-Fintech-Gateway')
  const traceContext = tracer.createTraceContext()

  console.log(`[📡 APM] TraceParent W3C Activo: ${traceContext.traceparent}`)
  console.log(`[📊 REGISTRO] Cuenta Operadora:    ${operatorId.toString()}`)

  try {
    let transaction
    let response
    let receipt

    // SPAN 1: Ensamblado de Transacción e Inyección de Contexto W3C
    await tracer.startSpan('hedera.tx.build', traceContext, async ({ spanId }) => {
      console.log('\n[⚙️ PROCESO] Span [hedera.tx.build]: Construyendo transferencia con tag W3C...')
      transaction = await new TransferTransaction()
        .addHbarTransfer(operatorId, new Hbar(0))
        .setTransactionMemo(`trace:${spanId}`)
        .freezeWith(client)

      return {
        attributes: {
          'hedera.account.payer': operatorId.toString(),
          'w3c.traceparent': traceContext.traceparent
        }
      }
    })

    // SPAN 2: Transmisión y Ordenamiento de Consenso en Gossip
    await tracer.startSpan('hedera.consensus.submit', traceContext, async () => {
      console.log('[⚙️ PROCESO] Span [hedera.consensus.submit]: Transmitiendo a los nodos de consenso...')
      response = await transaction.execute(client)
      receipt = await response.getReceipt(client)

      return {
        attributes: {
          'hedera.tx.id': response.transactionId.toString(),
          'hedera.consensus.status': receipt.status.toString()
        }
      }
    })

    // SPAN 3: Sonda de Latencia de Ingesta en Mirror Node
    await tracer.startSpan('hedera.mirrornode.sync', traceContext, async () => {
      console.log('[⚙️ PROCESO] Span [hedera.mirrornode.sync]: Sondeando ingesta de estado en Mirror Node...')
      const mirrorBase = getMirrorNodeBaseUrl()
      const formattedTxId = `${response.transactionId.accountId}-${response.transactionId.validStart.seconds}-${response.transactionId.validStart.nanos}`

      let synced = false
      const maxRetries = 10
      for (let i = 0; i < maxRetries; i++) {
        const res = await fetch(`${mirrorBase}/api/v1/transactions/${formattedTxId}`)
        if (res.ok) {
          const body = await res.json()
          if (body.transactions && body.transactions.length > 0) {
            synced = true
            break
          }
        }
        await new Promise(r => setTimeout(r, 600))
      }

      return {
        attributes: {
          'mirrornode.synced': synced,
          'mirrornode.endpoint': mirrorBase
        }
      }
    })

    console.log('\n[✅ ÉXITO] ¡Consenso Verificado en Hedera Testnet!')
    console.log(`[📊 REGISTRO] ID de Transacción: ${response.transactionId.toString()}`)
    console.log(`[🔗 EXPLORADOR] HashScan:         ${getHashscanUrl(response)}`)

    // Imprimir Tabla APM de OpenTelemetry
    tracer.printSpanSummary()

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Integración APM de Producción: Al enlazar traceparents W3C en los memos')
    console.log('de transacción, los equipos de DevOps y SRE pueden correlacionar peticiones')
    console.log('web de microservicios con registros de consenso on-chain en Datadog o Jaeger.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error(`\n[❌ ERROR] Fallo en Telemetría: ${error.message}`)
    process.exitCode = 1
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
