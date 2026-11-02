/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Paginación Recursiva y Transformación de Datos
 * [ CONCEPTO ] Gestión de Grandes Conjuntos de Datos (Big Data)
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * No satures el hilo de ejecución: Para evitar la sobrecarga, los Mirror
 * Nodes limitan cada respuesta a un número máximo de elementos (campo
 * `limit`). Si existen más datos, la respuesta incluye un cursor
 * (`links.next`). Al procesar datos por páginas, tu aplicación mantiene
 * un consumo de memoria constante y predecible, independientemente de si
 * existen diez o diez mil registros. Este patrón es esencial para
 * auditorías, análisis de carteras y dashboards financieros.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Nunca asumas que los resultados caben en una sola página. Los indexadores y auditores en producción deben seguir recursivamente el cursor links.next hasta que sea nulo para garantizar que no se pierda ningún registro.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/rest-api#pagination
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M2 Lab 02: Consulta REST Segura
 * - Actual:   M2 Lab 03: Paginación Recursiva
 * - Siguiente: M2 Lab 04: Reactor de Event Sourcing en Tiempo Real (SQLite CQRS)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 03_recursive_pagination.js
 * ============================================================================
 */

import { getClient, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'

/**
 * Buscador de Paginación Recursiva
 */
const getCompleteAccountHistory = async (accountId) => {
  const baseUrl = getMirrorNodeBaseUrl()
  let nextPath = `/api/v1/transactions?account.id=${accountId}&limit=10`
  let allTransactions = []

  console.log(`[ℹ️ INFO] Extrayendo historial transaccional para: ${accountId}`)

  while (nextPath) {
    const targetUrl = nextPath.startsWith('http') ? nextPath : `${baseUrl}${nextPath}`
    console.log(`[⚙️ PROCESO] Pagina detectada. Descargando lote: ${targetUrl.substring(0, 75)}...`)

    const response = await fetch(targetUrl)
    if (!response.ok) {
      throw new Error(`Error del Mirror Node: ${response.status}`)
    }

    const data = await response.json()

    if (data.transactions) {
      allTransactions = [...allTransactions, ...data.transactions]
    }

    // Navegación lógica del cursor
    nextPath = (data.links && data.links.next) ? data.links.next : null

    // Parada de seguridad para fines demostrativos: máximo 3 páginas
    if (allTransactions.length > 30) {
      console.log('[ℹ️ INFO] Parada de seguridad activada (Límite de demo alcanzado).')
      break
    }
  }

  return allTransactions
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Datos Paginados ---\n')

  const { operatorId } = getClient()
  const targetAccount = operatorId

  try {
    const history = await getCompleteAccountHistory(targetAccount)

    console.log('\n[✅ ÉXITO] Paginación de red completada con éxito.')
    console.log(`[📊 REGISTRO] Registros totales recuperados: ${history.length}`)

    if (history.length > 0) {
      // Análisis de datos asíncrono
      const successfulTxs = history.filter(tx => tx.result === 'SUCCESS')
      const totalFeesPaid = successfulTxs.reduce((sum, tx) => sum + parseInt(tx.charged_tx_fee), 0)
      const latestTimestamp = successfulTxs[0]?.consensus_timestamp

      console.log(`[📊 REGISTRO] Transacciones Exitosas: ${successfulTxs.length}`)
      console.log(`[📊 REGISTRO] Inversión en Comisiones: ${totalFeesPaid} tinybars (${(totalFeesPaid / 100000000).toFixed(6)} ℏ)`)
      console.log(`[📊 REGISTRO] Timestamp más reciente: ${latestTimestamp}`)
    } else {
      console.log('[ℹ️ INFO] No se encontró actividad on-chain para esta cuenta.')
    }

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('La paginación basada en cursor te permite construir aplicaciones')
    console.log('financieras robustas que no colapsan al manejar miles de eventos,')
    console.log('manteniendo la interfaz fluida y eficiente.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] La obtención recursiva de datos falló:', error.message)
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

export { getCompleteAccountHistory }
