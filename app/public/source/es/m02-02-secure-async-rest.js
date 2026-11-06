/**
 * ============================================================================
 * Lab 02: Consultas REST Asíncronas al Mirror Node
 * [CONCEPTO] El Camino Correcto: Interrogación Gratuita del Estado
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * No pagues por lo que es público: Los Mirror Nodes son bases de datos
 * indexadas administradas por la comunidad. Al usar solicitudes HTTP GET,
 * puedes consultar saldos e historiales libremente: SIN pagar tarifas en
 * HBAR, SIN requerir firmas criptográficas y SIN impactar la capacidad de
 * procesamiento de los nodos de consenso. Este es el patrón de oro para
 * cualquier aplicación en producción sobre Hedera.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Implementa siempre manejo defensivo de errores HTTP con retroceso exponencial al consultar Mirror Nodes públicos. Gestionar límites de tasa (HTTP 429) asegura alta disponibilidad para dashboards críticos.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/rest-api
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M2 Lab 01: Depreciación Sync
 * - Actual:   M2 Lab 02: Consulta REST Segura
 * - Siguiente: M2 Lab 03: Paginación Recursiva
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 02_secure_async_rest.js
 * ============================================================================
 */

import { getClient, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'

/**
 * Buscador Procedural del Mirror Node
 */
const getAccountBalancesAsync = async (accountId) => {
  const baseUrl = getMirrorNodeBaseUrl()
  // Arma la URL REST: las lecturas van al Mirror Node, nunca a los nodos de consenso.
  const targetUrl = `${baseUrl}/api/v1/balances?account.id=${accountId}`

  console.log(`[PROCESO] Realizando HTTP GET al Mirror Node: ${targetUrl}`)

  try {
    const response = await fetch(targetUrl)

    // Falla claramente ante errores HTTP en vez de leer una página de error como datos.
    if (!response.ok) {
      throw new Error(`Error del Mirror Node: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    if (!data.balances || data.balances.length === 0) {
      throw new Error('No se encontraron vinculaciones para la cuenta')
    }

    // El Mirror Node reporta saldos en tinybars (1 HBAR = 100,000,000 tinybars).
    const balanceData = data.balances[0]

    return {
      accountId: balanceData.account,
      hbars: balanceData.balance / 100_000_000, // conversión de tinybar a hbar
      tokens: balanceData.tokens,
      timestamp: balanceData.timestamp
    }
  } catch (error) {
    throw new Error(`La consulta REST falló: ${error.message}`)
  }
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Consultas REST Asíncronas ---\n')

  const { operatorId } = getClient()
  const targetAccount = operatorId

  try {
    const balanceData = await getAccountBalancesAsync(targetAccount)

    console.log('\n[ÉXITO] Interrogación de estado a costo cero (Costo: 0 ℏ).')
    console.log(`[REGISTRO] Account ID: ${balanceData.accountId}`)
    console.log(`[REGISTRO] Saldo Actual: ${balanceData.hbars.toFixed(8)} ℏ`)
    console.log(`[REGISTRO] Tokens Asociados: ${balanceData.tokens.length}`)

    console.log('\n[INFO] Siguiente objetivo: Manejar grandes volúmenes de datos con paginación.')

    console.log('\n CONCEPTO CLAVE:')
    console.log('Al utilizar Mirror Nodes, tu aplicación puede escalar')
    console.log('infinitamente en lecturas de datos sin incurrir en costos')
    console.log('de transacción de red, reservando HBAR solo para escrituras.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] La interrogación REST falló:', error.message)
    process.exitCode = 1
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

export { getAccountBalancesAsync }
