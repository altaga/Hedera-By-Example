/**
 * ============================================================================
 * Lab 07: Motor de Tarifas Simples y Precios Deterministas HIP-1261
 * [CONCEPTO] Modelado de Tarifas Predecibles en Hedera (Node, Network, Service)
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * A diferencia de las subastas de gas de Ethereum, donde los precios se
 * multiplican por 100 durante la congestión de la red, Hedera utiliza un
 * esquema de tarifas determinista anclado al dólar estadounidense (HIP-1261).
 *
 * La tarifa de cada transacción es la suma de tres componentes:
 * 1. Node Fee: paga al nodo de consenso que recibió la transacción.
 * 2. Network Fee: paga a los nodos por el gossip y el ordenamiento del consenso.
 * 3. Service Fee: paga el cambio de estado (aquí, un CryptoTransfer).
 * Juntas forman el precio publicado en USD; para una transferencia básica de HBAR es $0.0001.
 *
 * Este laboratorio interroga el archivo de tipo de cambio en vivo de Hedera, convierte
 * el precio publicado en USD a tinybars antes de transmitir, ejecuta la transacción y
 * compara la cotización con la tarifa que la red cobró de verdad.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * A diferencia de las subastas de gas que expulsan a los usuarios en momentos de alta congestión, las comisiones de Hedera se fijan en USD en una tabla publicada (una transferencia básica de HBAR cuesta $0.0001) y se convierten a HBAR con el tipo de cambio de la red, así que el monto en HBAR solo cambia con ese tipo de cambio.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-1261
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M1 Lab 06: Staking Nativo (HIP-406)
 * - Siguiente: M1 Lab 08: Asignaciones de HBAR y Gasto Patrocinado (HIP-336)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M1_Fundamentals_Functional_JS/07_hip1261_simple_fees_engine.js
 * ============================================================================
 */

import { TransferTransaction, Hbar } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getMirrorNodeBaseUrl, updateState } from '../M99_Utilities/index.js'

/**
 * Consulta el archivo de tipo de cambio USD/HBAR en vivo desde el Mirror Node.
 *
 * @param {string} mirrorBase - URL base del Mirror Node
 * @returns {Promise<Object>} { cents, hbarEquiv, rateUsdPerHbar, expiration }
 */
const fetchExchangeRate = async (mirrorBase) => {
  // Lee de la API REST del Mirror Node: es gratis, pero va unos segundos detrás del consenso.
  const response = await fetch(`${mirrorBase}/api/v1/network/exchangerate`)
  if (!response.ok) {
    throw new Error(`Error en API de tipo de cambio del Mirror Node: ${response.statusText}`)
  }
  const data = await response.json()
  const { current_rate: current } = data
  const rateUsdPerHbar = (current.cent_equivalent / current.hbar_equivalent) / 100

  return {
    cents: current.cent_equivalent,
    hbarEquiv: current.hbar_equivalent,
    rateUsdPerHbar,
    expiration: new Date(current.expiration_time * 1000).toISOString()
  }
}

/**
 * Calcula el costo exacto en tinybars para una tarifa en USD según HIP-1261.
 *
 * @param {number} feeUsd - Tarifa en USD
 * @param {number} cents - Equivalente en centavos del tipo de cambio de la red
 * @param {number} hbarEquiv - Equivalente en HBAR del tipo de cambio de la red
 * @returns {number} Costo en tinybars (1 HBAR = 100,000,000 tinybars)
 */
const calculateTinybars = (feeUsd, cents, hbarEquiv) => {
  const tinybars = Math.round((feeUsd * 100 * hbarEquiv * 100_000_000) / cents)
  return tinybars
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Motor de Tarifas Simples HIP-1261 ---\n')

  const { client, operatorId } = getClient()
  const mirrorBase = getMirrorNodeBaseUrl()

  try {
    console.log('[PROCESO] Paso 1: Interrogando tipo de cambio de red en vivo desde Mirror Node...')
    const rateInfo = await fetchExchangeRate(mirrorBase)

    console.log('\n---  TIPO DE CAMBIO ON-CHAIN EN HEDERA ---')
    console.log(`Tasa USD por HBAR:   $${rateInfo.rateUsdPerHbar.toFixed(4)}`)
    console.log(`Equivalente HBAR:    ${rateInfo.hbarEquiv} ℏ`)
    console.log(`Equivalente Céntimos: ${rateInfo.cents} ¢`)
    console.log(`Vencimiento de Tasa: ${rateInfo.expiration}`)

    console.log('\n[PROCESO] Paso 2: Descomponiendo esquema de tarifas HIP-1261 para CryptoTransfer...')

    // Precio publicado en USD de una transferencia básica de HBAR (tarifas de nodo, red y servicio juntas).
    const TOTAL_STANDARD_FEE_USD = 0.0001
    const totalPredictedTinybars = calculateTinybars(TOTAL_STANDARD_FEE_USD, rateInfo.cents, rateInfo.hbarEquiv)

    console.log('\n---  COTIZACIÓN DE TARIFA (precio publicado) ---')
    console.log(`Cotización:   $${TOTAL_STANDARD_FEE_USD.toFixed(4)} USD -> ${totalPredictedTinybars.toLocaleString()} tinybars (~${(totalPredictedTinybars / 1e8).toFixed(6)} ℏ)`)

    console.log('\n[PROCESO] Paso 3: Ejecutando CryptoTransfer en vivo para verificar facturación de consenso...')

    // Transacción de prueba: transferir 0 HBAR a sí mismo
    const transaction = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(0))
      .freezeWith(client)

    const response = await transaction.execute(client)
    const record = await response.getRecord(client)
    const actualFeeTinybars = record.transactionFee.toTinybars().toNumber()
    const actualFeeUsd = (actualFeeTinybars / 1e8) * rateInfo.rateUsdPerHbar

    console.log('\n---  VERIFICACIÓN DE FACTURACIÓN EN CONSENSO ---')
    console.log(`Estado de Consenso:  ${record.receipt.status.toString()}`)
    console.log(`ID de Transacción:   ${response.transactionId.toString()}`)
    console.log(`Tarifa Real Cobrada: ${actualFeeTinybars.toLocaleString()} tinybars (${record.transactionFee.toString()})`)
    console.log(`Tarifa Real en USD:  $${actualFeeUsd.toFixed(6)} USD`)
    console.log(`Variación vs Cuota:  ${Math.abs(actualFeeTinybars - totalPredictedTinybars).toLocaleString()} tinybars`)
    console.log(`[EXPLORADOR] Ver en HashScan: ${getHashscanUrl(response)}`)

    updateState('HIP1261_LAST_TX_ID', response.transactionId.toString())
    updateState('HIP1261_ACTUAL_FEE_TINYBARS', actualFeeTinybars)
    updateState('HIP1261_RATE_USD_PER_HBAR', rateInfo.rateUsdPerHbar)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Sin Subastas de Gas: en Hedera, las tarifas se fijan en USD y no dependen de la demanda.')
    console.log(`Esta transferencia se cotizó en $${TOTAL_STANDARD_FEE_USD} y se cobró $${actualFeeUsd.toFixed(6)}; la`)
    console.log('diferencia viene de extras como las firmas y el tamaño de la transacción.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error(`\n[FALLO] Falló el Cálculo del Motor de Tarifas: ${error.message}`)
    process.exitCode = 1
    if (client) client.close()
    process.exit(1)
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
