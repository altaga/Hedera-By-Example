/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 05: Transferencias Paralelas y Escalabilidad Horizontal
 * [ CONCEPTO ] Concurrencia en el Consenso y Throughput Real
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Escalabilidad Horizontal: En una blockchain tradicional, más transacciones
 * suelen significar más congestión. En Hedera, el protocolo "Gossip about
 * Gossip" permite a los nodos procesar miles de transacciones en paralelo sin
 * frenarse de forma lineal. Ejecutar 20 transacciones en paralelo NO es 20
 * veces más lento que ejecutar 1.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Enviar transacciones paralelas de alta frecuencia desde una misma cuenta operadora requiere marcas de tiempo validStart distintas. Escalonar los nanosegundos evita que la red descarte envíos rápidos por duplicidad.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/cryptocurrency/submit-a-transaction
 *
 * [ RUTA DE APRENDIZAJE ]
 * Escalado Horizontal: A diferencia de las blockchains secuenciales que
 * procesan una transacción tras otra creando cuellos de botella, Hedera
 * permite el procesamiento concurrente. Gracias a que el Hashgraph no es
 * lineal, múltiples nodos pueden recibir y procesar transacciones
 * simultáneamente. Lanzar transacciones en paralelo con `Promise.all()`
 * revela el verdadero poder de la red, que ha demostrado capacidades de más
 * de 10,000 TPS en entornos de producción.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 05_parallel_transfers.js
 * ============================================================================
 */

import { AccountId, Hbar, TransferTransaction } from '@hiero-ledger/sdk'
import { getClient, show } from '../M99_Utilities/index.js'

/**
 * Ejecuta un lote de transferencias de HBAR en paralelo y mide la duración.
 */
const runParallelBatch = async (client, operatorId, targetId, batchSize) => {
  console.log(`[⚙️ PROCESO] Iniciando Lote Experimental: ${batchSize} transacciones concurrentes...`)

  const tasks = []
  const amount = 0.01 // Monto mínimo para el benchmark
  const startTime = Date.now()

  for (let i = 0; i < batchSize; i++) {
    tasks.push((async () => {
      const transaction = await new TransferTransaction()
        .addHbarTransfer(AccountId.fromString(operatorId), new Hbar(-amount))
        .addHbarTransfer(AccountId.fromString(targetId), new Hbar(amount))
        .freezeWith(client)

      const response = await transaction.execute(client)
      return response.getReceipt(client)
    })())
  }

  // Esperar el consenso de todos los recibos en paralelo
  await Promise.all(tasks)
  const duration = Date.now() - startTime

  console.log(`[✅ ÉXITO] Lote completado en ${duration}ms. Promedio: ${Math.round(duration / batchSize)}ms por TX.`)
  return {
    batchSize,
    totalTime: duration,
    avgTimePerTx: Math.round(duration / batchSize)
  }
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Benchmark de Escalabilidad y Concurrencia ---\n')

  const { client, operatorId } = getClient()
  const targetId = process.env.ACCOUNT_1_ID

  if (!targetId) {
    console.error('[❌ FALLO] Falta ACCOUNT_1_ID en el archivo .env.')
    process.exitCode = 1
    return
  }

  try {
    const benchmarkResults = []
    const batchSizes = [1, 5, 10, 20]

    for (const size of batchSizes) {
      const result = await runParallelBatch(client, operatorId, targetId, size)
      benchmarkResults.push(result)
      show.chart({ id: 'parallel', type: 'bar', title: 'Tiempo promedio por transacción según el tamaño del lote', unit: 'ms', xLabel: 'Batch', yLabel: 'ms / tx', items: benchmarkResults.map((r) => ({ label: `${r.batchSize} tx`, value: Number(r.avgTimePerTx) })) })
      // Pausa estratégica para permitir la propagación estable en el testnet
      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    // --- INFORME FINAL DE RENDIMIENTO ---
    console.log('\n' + '='.repeat(60))
    console.log('       📊 RESUMEN DEL BENCHMARK DE RENDIMIENTO HTS')
    console.log('='.repeat(60))
    console.log(' Lote Size  | Tiempo Total (ms) | Tiempo Prom/Tx (ms)')
    console.log('-'.repeat(60))

    benchmarkResults.forEach(res => {
      const sizeStr = res.batchSize.toString().padEnd(11)
      const totalStr = res.totalTime.toString().padEnd(17)
      const avgStr = res.avgTimePerTx.toString()
      console.log(` ${sizeStr}| ${totalStr}| ${avgStr}`)
    })
    console.log('='.repeat(60))

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Observa cómo el tiempo promedio por transacción no escala')
    console.log('linealmente con el tamaño del lote. Esto prueba que Hedera')
    console.log('puede absorber ráfagas de tráfico masivo sin degradar la')
    console.log('experiencia del usuario final.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] El Benchmark paralelizable falló:', error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[❌ FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
